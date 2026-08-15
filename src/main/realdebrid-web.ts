import { BrowserWindow, session } from "electron";
import { UnrestrictedLink } from "./realdebrid";
import { filenameFromUrl, sleep } from "./utils";
import { API_BASE_URL, REQUEST_RETRIES } from "./constants";
import { applyRemoteLoginSecurity, createRemoteLoginWebPreferences, REALDEBRID_LOGIN_HOSTS } from "./browser-security";

const RD_BASE_URL = "https://real-debrid.com";
const RD_LOGIN_URL = RD_BASE_URL;
const RD_APITOKEN_URL = `${RD_BASE_URL}/apitoken`;
const RD_UNRESTRICT_API = `${API_BASE_URL}/unrestrict/link`;
const RD_USER_API = `${API_BASE_URL}/user`;
const RD_PARTITION_PATTERN = /^persist:realdebrid-web(?:-rdw_[A-Za-z0-9_-]{1,96})?$/;
const RD_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

type GenerateOutcome =
  | { kind: "success"; value: UnrestrictedLink }
  | { kind: "login_required" };

export interface RealDebridLoginState {
  valid: boolean;
  username: string;
  email: string;
  isPremium: boolean;
  premiumUntilMs: number | null;
  message: string;
}

function loginFailure(message: string): RealDebridLoginState {
  return { valid: false, username: "", email: "", isPremium: false, premiumUntilMs: null, message };
}

function abortError(): Error {
  return new Error("aborted:realdebrid-web");
}

function withTimeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!signal) {
    return timeoutSignal;
  }
  return AbortSignal.any([signal, timeoutSignal]);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortError();
  }
}

async function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await sleep(ms);
    return;
  }
  if (signal.aborted) {
    throw abortError();
  }

  await new Promise<void>((resolve, reject) => {
    let timer: NodeJS.Timeout | null = setTimeout(() => {
      timer = null;
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, ms));

    const onAbort = (): void => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      signal.removeEventListener("abort", onAbort);
      reject(abortError());
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function looksLikeHtmlResponse(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("<!") || trimmed.startsWith("<html") || trimmed.startsWith("<HTML");
}

export function extractPrivateTokenFromHtml(html: string): string | null {
  const normalized = String(html || "");
  if (!normalized.trim()) {
    return null;
  }

  const patterns = [
    /private_token['"]\]\[0\]\.value\s*=\s*['"]([^'"]+)['"]/i,
    /getElementsByName\(\s*['"]private_token['"]\s*\)\s*\[\s*0\s*\]\.value\s*=\s*['"]([^'"]+)['"]/i,
    /querySelector(?:All)?\(\s*['"][^'"]*private_token[^'"]*['"]\s*\)(?:\s*\[\s*0\s*\])?\.value\s*=\s*['"]([^'"]+)['"]/i,
    /name=['"]private_token['"][^>]*value=['"]([^'"]+)['"]/i,
    /value=['"]([^'"]+)['"][^>]*name=['"]private_token['"]/i
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const token = match?.[1]?.trim();
    if (token) {
      return token;
    }
  }

  return null;
}

export class RealDebridWebFallback {
  private queue: Promise<unknown> = Promise.resolve();

  private loginWindow: BrowserWindow | null = null;

  private loginWindowPartition = "";

  private cachedToken = "";

  private cachedTokenAt = 0;

  private getRememberSession: () => boolean;

  private onAuthenticated?: () => void;

  private onClosed?: () => void;

  private persistentPartition: string;

  private transientPartition: string;

  private lifecycleGeneration = 0;

  private programmaticClosures = new WeakSet<BrowserWindow>();

  private disposed = false;

  public constructor(partition: string, getRememberSession: () => boolean, onAuthenticated?: () => void, onClosed?: () => void) {
    const normalizedPartition = String(partition || "").trim();
    if (!RD_PARTITION_PATTERN.test(normalizedPartition)) {
      throw new Error("Real-Debrid Web-Partition ist ungültig");
    }
    this.persistentPartition = normalizedPartition;
    this.transientPartition = normalizedPartition.slice("persist:".length);
    this.getRememberSession = getRememberSession;
    this.onAuthenticated = onAuthenticated;
    this.onClosed = onClosed;
  }

  public async unrestrict(link: string, signal?: AbortSignal): Promise<UnrestrictedLink | null> {
    this.throwIfDisposed();
    const overallSignal = withTimeoutSignal(signal, 10 * 60 * 1000);
    return this.runExclusive(async () => {
      throwIfAborted(overallSignal);
      if (!String(link || "").trim()) {
        return null;
      }

      const initial = await this.generate(link, overallSignal);
      if (initial.kind === "success") {
        return initial.value;
      }
      return this.waitForLoginAndGenerate(link, overallSignal);
    }, overallSignal);
  }

  public async openLoginWindow(): Promise<void> {
    this.throwIfDisposed();
    const window = await this.ensureLoginWindow();
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
    void this.primeTokenFromWindow(window);
  }

  public async probeLoginState(signal?: AbortSignal): Promise<RealDebridLoginState> {
    this.throwIfDisposed();
    let token: string | null = null;
    try {
      token = await this.extractApiToken(signal);
    } catch (error) {
      if (signal?.aborted) {
        throw abortError();
      }
      return loginFailure(`Sitzung nicht prüfbar: ${String(error)}`);
    }
    if (!token) {
      return loginFailure("Nicht angemeldet");
    }
    try {
      const response = await fetch(RD_USER_API, {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": RD_USER_AGENT
        },
        signal: withTimeoutSignal(signal, 30_000)
      });
      const text = await response.text();
      if (response.status === 401 || response.status === 403) {
        this.cachedToken = "";
        this.cachedTokenAt = 0;
        return loginFailure("Sitzung abgelaufen");
      }
      if (!response.ok) {
        return loginFailure(`Real-Debrid Web HTTP ${response.status}`);
      }
      const payload = parseJson(text);
      if (!payload) {
        return loginFailure("Ungültige Antwort von Real-Debrid");
      }
      const expiration = Date.parse(String(payload.expiration || ""));
      const premiumUntilMs = Number.isFinite(expiration) ? expiration : null;
      const isPremium = String(payload.type || "").toLowerCase() === "premium"
        && (premiumUntilMs == null || premiumUntilMs > Date.now());
      return {
        valid: true,
        username: String(payload.username || "").trim(),
        email: String(payload.email || "").trim(),
        isPremium,
        premiumUntilMs,
        message: isPremium ? "Premium aktiv" : "Kein Premium (Free)"
      };
    } catch (error) {
      if (signal?.aborted) {
        throw abortError();
      }
      return loginFailure(`Sitzung nicht prüfbar: ${String(error)}`);
    }
  }

  public async clearSessions(): Promise<void> {
    this.disposed = true;
    this.disposeLoginWindow();
    this.cachedToken = "";
    this.cachedTokenAt = 0;
    for (const partition of [this.persistentPartition, this.transientPartition]) {
      const currentSession = session.fromPartition(partition);
      try {
        await currentSession.clearStorageData({
          storages: ["cookies", "indexdb", "localstorage", "serviceworkers", "cachestorage"]
        });
      } catch {
      }
      try {
        await currentSession.clearCache();
      } catch {
      }
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.disposeLoginWindow();
    this.cachedToken = "";
    this.cachedTokenAt = 0;
  }

  private getPartition(): string {
    return this.getRememberSession() ? this.persistentPartition : this.transientPartition;
  }

  private throwIfDisposed(): void {
    if (this.disposed) {
      throw new Error("Real-Debrid Web-Sitzung wurde geschlossen");
    }
  }

  private disposeLoginWindow(): void {
    this.lifecycleGeneration += 1;
    const current = this.loginWindow;
    this.loginWindow = null;
    this.loginWindowPartition = "";
    if (current && !current.isDestroyed()) {
      this.programmaticClosures.add(current);
      current.close();
    }
  }

  private async runExclusive<T>(job: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const queuedAt = Date.now();
    const queueWaitTimeoutMs = 10 * 60 * 1000 + 30_000;
    const guardedJob = async (): Promise<T> => {
      throwIfAborted(signal);
      const waited = Date.now() - queuedAt;
      if (waited > queueWaitTimeoutMs) {
        throw new Error(`Real-Debrid-Web Queue-Timeout (${Math.floor(waited / 1000)}s gewartet)`);
      }
      return job();
    };
    const run = this.queue.then(guardedJob, guardedJob);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async ensureLoginWindow(): Promise<BrowserWindow> {
    const partition = this.getPartition();
    const existing = this.loginWindow;
    if (existing && !existing.isDestroyed() && this.loginWindowPartition === partition) {
      return existing;
    }

    if (existing && !existing.isDestroyed()) {
      existing.close();
    }

    const window = new BrowserWindow({
      width: 1120,
      height: 900,
      minWidth: 980,
      minHeight: 760,
      autoHideMenuBar: true,
      title: "Real-Debrid Web-Login",
      webPreferences: createRemoteLoginWebPreferences(partition)
    });
    applyRemoteLoginSecurity(window, {
      providerHosts: REALDEBRID_LOGIN_HOSTS,
      externalHosts: REALDEBRID_LOGIN_HOSTS
    });
    window.setMenuBarVisibility(false);
    window.webContents.setUserAgent(RD_USER_AGENT);
    const windowGeneration = this.lifecycleGeneration;
    const primeFromWindow = (): void => {
      void this.primeTokenFromWindow(window, windowGeneration);
    };
    window.webContents.on("did-finish-load", primeFromWindow);
    window.webContents.on("did-navigate", primeFromWindow);
    window.webContents.on("did-navigate-in-page", primeFromWindow);
    let closingTokenProbe: Promise<void> = Promise.resolve();
    window.on("close", () => {
      if (!this.programmaticClosures.has(window)) {
        closingTokenProbe = this.primeTokenFromWindow(window, windowGeneration);
      }
    });
    window.on("closed", () => {
      if (this.loginWindow === window) {
        this.loginWindow = null;
        this.loginWindowPartition = "";
      }
      if (!this.programmaticClosures.has(window)) {
        void closingTokenProbe.finally(() => this.onClosed?.());
      }
    });
    this.loginWindow = window;
    this.loginWindowPartition = partition;
    try {
      await window.loadURL(RD_LOGIN_URL);
    } catch (error) {
      if (this.loginWindow === window) {
        this.disposeLoginWindow();
      }
      throw error;
    }
    return window;
  }

  private rememberToken(token: string, generation = this.lifecycleGeneration): string | null {
    if (this.disposed || generation !== this.lifecycleGeneration) {
      return null;
    }
    const changed = token !== this.cachedToken;
    this.cachedToken = token;
    this.cachedTokenAt = Date.now();
    if (changed && this.onAuthenticated) {
      void Promise.resolve().then(() => this.onAuthenticated?.());
    }
    return token;
  }

  private getActiveLoginWindow(): BrowserWindow | null {
    const window = this.loginWindow;
    if (!window || window.isDestroyed()) {
      return null;
    }
    if (this.loginWindowPartition !== this.getPartition()) {
      return null;
    }
    return window;
  }

  private async extractApiTokenFromWindow(window: BrowserWindow, signal?: AbortSignal, generation = this.lifecycleGeneration): Promise<string | null> {
    throwIfAborted(signal);

    try {
      const rawResult = await window.webContents.executeJavaScript(`
        (async () => {
          const readTokenFromHtml = (html) => {
            const text = String(html || "");
            const patterns = [
              /private_token['"]\\]\\[0\\]\\.value\\s*=\\s*['"]([^'"]+)['"]/i,
              /getElementsByName\\(\\s*['"]private_token['"]\\s*\\)\\s*\\[\\s*0\\s*\\]\\.value\\s*=\\s*['"]([^'"]+)['"]/i,
              /querySelector(?:All)?\\(\\s*['"][^'"]*private_token[^'"]*['"]\\s*\\)(?:\\s*\\[\\s*0\\s*\\])?\\.value\\s*=\\s*['"]([^'"]+)['"]/i,
              /name=['"]private_token['"][^>]*value=['"]([^'"]+)['"]/i,
              /value=['"]([^'"]+)['"][^>]*name=['"]private_token['"]/i
            ];
            for (const pattern of patterns) {
              const match = text.match(pattern);
              if (match && match[1]) {
                return String(match[1]).trim();
              }
            }
            return "";
          };

          const directInput = document.querySelector('input[name="private_token"]');
          if (directInput instanceof HTMLInputElement && directInput.value.trim()) {
            return directInput.value.trim();
          }

          const html = document.documentElement ? document.documentElement.outerHTML : "";
          const directToken = readTokenFromHtml(html);
          if (directToken) {
            return directToken;
          }

          try {
            const response = await fetch(${JSON.stringify(RD_APITOKEN_URL)}, {
              credentials: "include",
              cache: "no-store",
              headers: {
                "X-Requested-With": "XMLHttpRequest"
              }
            });
            const tokenHtml = await response.text();
            return readTokenFromHtml(tokenHtml);
          } catch {
            return "";
          }
        })();
      `, true);
      const token = String(rawResult || "").trim();
      if (token && generation === this.lifecycleGeneration && !this.programmaticClosures.has(window)) {
        return this.rememberToken(token, generation);
      }
    } catch {
    }

    return null;
  }

  private async primeTokenFromWindow(window: BrowserWindow, generation = this.lifecycleGeneration): Promise<void> {
    try {
      await this.extractApiTokenFromWindow(window, undefined, generation);
    } catch {
    }
  }

  private async extractApiToken(signal?: AbortSignal): Promise<string | null> {
    throwIfAborted(signal);
    const generation = this.lifecycleGeneration;

    if (this.disposed) {
      return null;
    }

    if (this.cachedToken && Date.now() - this.cachedTokenAt < 30 * 60 * 1000) {
      return this.cachedToken;
    }

    const activeLoginWindow = this.getActiveLoginWindow();
    if (activeLoginWindow) {
      const windowToken = await this.extractApiTokenFromWindow(activeLoginWindow, signal);
      if (windowToken) {
        return windowToken;
      }
    }

    const currentSession = session.fromPartition(this.getPartition());
    const response = await currentSession.fetch(RD_APITOKEN_URL, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: RD_BASE_URL + "/",
        "User-Agent": RD_USER_AGENT
      },
      signal: withTimeoutSignal(signal, 30_000)
    });
    const html = await response.text();

    if (this.disposed || generation !== this.lifecycleGeneration) {
      return null;
    }

    if (!response.ok || response.status === 403) {
      return null;
    }

    const token = extractPrivateTokenFromHtml(html);
    if (token) {
      return this.rememberToken(token, generation);
    }

    return null;
  }

  private async generate(link: string, signal?: AbortSignal): Promise<GenerateOutcome> {
    throwIfAborted(signal);

    const token = await this.extractApiToken(signal);
    if (!token) {
      return { kind: "login_required" };
    }

    for (let attempt = 1; attempt <= REQUEST_RETRIES; attempt += 1) {
      throwIfAborted(signal);
      try {
        const body = new URLSearchParams({ link });
        const response = await fetch(RD_UNRESTRICT_API, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": RD_USER_AGENT
          },
          body,
          signal: withTimeoutSignal(signal, 30_000)
        });

        const text = await response.text();

        if (response.status === 401 || response.status === 403) {
          this.cachedToken = "";
          this.cachedTokenAt = 0;
          return { kind: "login_required" };
        }

        if (!response.ok) {
          if ((response.status === 429 || response.status >= 500) && attempt < REQUEST_RETRIES) {
            await sleepWithSignal(Math.min(5000, 400 * 2 ** attempt), signal);
            continue;
          }
          throw new Error(`Real-Debrid Web HTTP ${response.status}: ${text.slice(0, 200)}`);
        }

        if (looksLikeHtmlResponse(text)) {
          throw new Error("Real-Debrid Web lieferte HTML statt JSON");
        }

        const payload = parseJson(text.trim());
        if (!payload) {
          throw new Error("Ungültige JSON-Antwort von Real-Debrid Web");
        }

        const directUrl = String(payload.download || payload.link || "").trim();
        if (!directUrl) {
          throw new Error("Real-Debrid Web: Antwort ohne Download-URL");
        }

        const fileName = String(payload.filename || "").trim() || filenameFromUrl(directUrl) || filenameFromUrl(link);
        const fileSizeRaw = Number(payload.filesize ?? NaN);
        return {
          kind: "success",
          value: {
            directUrl,
            fileName,
            fileSize: Number.isFinite(fileSizeRaw) && fileSizeRaw > 0 ? Math.floor(fileSizeRaw) : null,
            retriesUsed: attempt - 1
          }
        };
      } catch (error) {
        if (signal?.aborted) {
          throw abortError();
        }
        if (attempt >= REQUEST_RETRIES) {
          throw error;
        }
        await sleepWithSignal(Math.min(5000, 400 * 2 ** attempt), signal);
      }
    }

    throw new Error("Real-Debrid Web: Unrestrict fehlgeschlagen");
  }

  private async waitForLoginAndGenerate(link: string, signal?: AbortSignal): Promise<UnrestrictedLink | null> {
    const window = await this.ensureLoginWindow();
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();

    const startedAt = Date.now();
    while (Date.now() - startedAt < 10 * 60 * 1000) {
      throwIfAborted(signal);
      if (window.isDestroyed()) {
        throw new Error("Real-Debrid Web-Login abgebrochen");
      }

      const outcome = await this.generate(link, signal);
      if (outcome.kind === "success") {
        if (!window.isDestroyed()) {
          window.close();
        }
        return outcome.value;
      }

      await sleepWithSignal(1_500, signal);
    }

    throw new Error("Real-Debrid Web-Login Timeout");
  }
}
