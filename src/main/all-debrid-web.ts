import { BrowserWindow, session } from "electron";
import { ALLDEBRID_LOGIN_HOSTS, applyRemoteLoginSecurity, createRemoteLoginWebPreferences } from "./browser-security";

const ALLDEBRID_PIN_GET_URL = "https://api.alldebrid.com/v4.1/pin/get";
const ALLDEBRID_PIN_CHECK_URL = "https://api.alldebrid.com/v4/pin/check";
const ALLDEBRID_PERSISTENT_PARTITION = "persist:alldebrid-web";
const ALLDEBRID_TRANSIENT_PARTITION = "alldebrid-web";
const ALLDEBRID_POLL_INTERVAL_MS = 5_000;

type AllDebridApiPayload = {
  status?: unknown;
  data?: unknown;
  error?: unknown;
};

type AllDebridPin = {
  pin: string;
  check: string;
  expiresIn: number;
  userUrl: string;
};

export type AllDebridPinLoginResult = {
  apiKey: string;
};

type AllDebridPinLoginHandler = (result: AllDebridPinLoginResult) => void | Promise<void>;

type AllDebridPinLoginErrorHandler = (error: Error) => void;

function abortError(): Error {
  return new Error("aborted:alldebrid-pin-login");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function stringValue(record: Record<string, unknown> | null, key: string): string {
  const value = record?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function positiveSeconds(record: Record<string, unknown> | null, key: string): number {
  const value = Number(record?.[key] ?? NaN);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortError();
  }
}

async function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
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

function apiError(payload: AllDebridApiPayload): Error {
  const error = asRecord(payload.error);
  const code = stringValue(error, "code");
  const message = stringValue(error, "message");
  const detail = [code, message].filter(Boolean).join(": ");
  return new Error(detail ? `AllDebrid PIN-Login: ${detail}` : "AllDebrid PIN-Login fehlgeschlagen");
}

async function requestPayload(url: string, init: RequestInit, signal: AbortSignal): Promise<AllDebridApiPayload> {
  throwIfAborted(signal);
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)])
  });
  const text = await response.text();
  let payload: AllDebridApiPayload;
  try {
    payload = JSON.parse(text) as AllDebridApiPayload;
  } catch {
    throw new Error(`AllDebrid PIN-Login: ungültige API-Antwort (HTTP ${response.status})`);
  }
  if (!response.ok || payload.status !== "success") {
    throw apiError(payload);
  }
  return payload;
}

function parsePin(payload: AllDebridApiPayload): AllDebridPin {
  const data = asRecord(payload.data);
  const pin = stringValue(data, "pin");
  const check = stringValue(data, "check");
  const expiresIn = positiveSeconds(data, "expires_in");
  const userUrl = stringValue(data, "user_url");
  if (!pin || !check || !expiresIn || !userUrl) {
    throw new Error("AllDebrid PIN-Login: unvollständige PIN-Antwort");
  }
  const parsedUrl = new URL(userUrl);
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "alldebrid.com") {
    throw new Error("AllDebrid PIN-Login: ungültige Benutzer-URL");
  }
  return { pin, check, expiresIn, userUrl };
}

export class AllDebridWebFallback {
  private loginWindow: BrowserWindow | null = null;

  private loginController: AbortController | null = null;

  private opening: Promise<void> | null = null;

  private removeCallerAbortListener: (() => void) | null = null;

  private readonly getRememberSession: () => boolean;

  private readonly onAuthenticated: AllDebridPinLoginHandler;

  private readonly onLoginFailed: AllDebridPinLoginErrorHandler;

  public constructor(
    getRememberSession: () => boolean,
    onAuthenticated: AllDebridPinLoginHandler = () => {},
    onLoginFailed: AllDebridPinLoginErrorHandler = () => {}
  ) {
    this.getRememberSession = getRememberSession;
    this.onAuthenticated = onAuthenticated;
    this.onLoginFailed = onLoginFailed;
  }

  public async openLoginWindow(signal?: AbortSignal): Promise<void> {
    const current = this.loginWindow;
    if (this.loginController && !this.loginController.signal.aborted && current && !current.isDestroyed()) {
      this.showWindow(current);
      return;
    }
    if (this.opening) {
      await this.opening;
      const opened = this.loginWindow;
      if (opened && !opened.isDestroyed()) {
        this.showWindow(opened);
      }
      return;
    }

    const opening = this.startPinLogin(signal);
    this.opening = opening;
    try {
      await opening;
    } finally {
      if (this.opening === opening) {
        this.opening = null;
      }
    }
  }

  public async clearSessions(): Promise<void> {
    this.cancelLoginFlow(true);
    for (const partition of [ALLDEBRID_PERSISTENT_PARTITION, ALLDEBRID_TRANSIENT_PARTITION]) {
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
    this.cancelLoginFlow(true);
  }

  private getPartition(): string {
    return this.getRememberSession() ? ALLDEBRID_PERSISTENT_PARTITION : ALLDEBRID_TRANSIENT_PARTITION;
  }

  private showWindow(window: BrowserWindow): void {
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
  }

  private async startPinLogin(signal?: AbortSignal): Promise<void> {
    this.cancelLoginFlow(true);
    throwIfAborted(signal);
    const controller = new AbortController();
    this.loginController = controller;
    if (signal) {
      const onAbort = (): void => this.cancelLoginFlow(true);
      signal.addEventListener("abort", onAbort, { once: true });
      this.removeCallerAbortListener = () => signal.removeEventListener("abort", onAbort);
    }

    try {
      const payload = await requestPayload(ALLDEBRID_PIN_GET_URL, { method: "GET" }, controller.signal);
      const pin = parsePin(payload);
      throwIfAborted(controller.signal);
      const window = this.createLoginWindow(controller);
      await window.loadURL(pin.userUrl);
      throwIfAborted(controller.signal);
      this.showWindow(window);
      void this.pollForActivation(pin, controller.signal).then(
        (result) => this.completeLogin(controller, result),
        (error) => this.failLogin(controller, error)
      );
    } catch (error) {
      if (this.loginController === controller) {
        this.cancelLoginFlow(true);
      }
      throw error;
    }
  }

  private createLoginWindow(controller: AbortController): BrowserWindow {
    const partition = this.getPartition();
    const window = new BrowserWindow({
      width: 1120,
      height: 900,
      minWidth: 980,
      minHeight: 760,
      autoHideMenuBar: true,
      title: "AllDebrid PIN-Login",
      webPreferences: createRemoteLoginWebPreferences(partition)
    });
    applyRemoteLoginSecurity(window, {
      providerHosts: ALLDEBRID_LOGIN_HOSTS,
      externalHosts: ALLDEBRID_LOGIN_HOSTS
    });
    window.setMenuBarVisibility(false);
    window.on("closed", () => {
      if (this.loginWindow !== window) {
        return;
      }
      this.loginWindow = null;
      if (this.loginController === controller) {
        controller.abort();
        this.loginController = null;
        this.clearCallerAbortListener();
      }
    });
    this.loginWindow = window;
    return window;
  }

  private async pollForActivation(pin: AllDebridPin, signal: AbortSignal): Promise<AllDebridPinLoginResult> {
    const deadline = Date.now() + pin.expiresIn * 1000;
    while (Date.now() < deadline) {
      throwIfAborted(signal);
      const body = new URLSearchParams({
        check: pin.check,
        pin: pin.pin
      });
      const payload = await requestPayload(ALLDEBRID_PIN_CHECK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
        },
        body: body.toString()
      }, signal);
      const data = asRecord(payload.data);
      if (data?.activated === true) {
        const apiKey = stringValue(data, "apikey");
        if (!apiKey) {
          throw new Error("AllDebrid PIN-Login: aktivierte Antwort ohne API-Key");
        }
        return { apiKey };
      }
      const serverExpiresIn = positiveSeconds(data, "expires_in");
      if (!serverExpiresIn) {
        break;
      }
      const remainingMs = Math.max(0, deadline - Date.now());
      if (!remainingMs) {
        break;
      }
      await sleepWithSignal(Math.min(ALLDEBRID_POLL_INTERVAL_MS, remainingMs), signal);
    }
    throw new Error("AllDebrid PIN-Login Timeout");
  }

  private async completeLogin(controller: AbortController, result: AllDebridPinLoginResult): Promise<void> {
    if (this.loginController !== controller || controller.signal.aborted) {
      return;
    }
    try {
      await this.onAuthenticated(result);
    } catch (error) {
      this.failLogin(controller, error);
      return;
    }
    if (this.loginController === controller) {
      this.cancelLoginFlow(true);
    }
  }

  private failLogin(controller: AbortController, error: unknown): void {
    if (this.loginController !== controller || controller.signal.aborted) {
      return;
    }
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.cancelLoginFlow(true);
    this.onLoginFailed(normalized);
  }

  private clearCallerAbortListener(): void {
    this.removeCallerAbortListener?.();
    this.removeCallerAbortListener = null;
  }

  private cancelLoginFlow(closeWindow: boolean): void {
    const controller = this.loginController;
    this.loginController = null;
    controller?.abort();
    this.clearCallerAbortListener();
    const window = this.loginWindow;
    this.loginWindow = null;
    if (closeWindow && window && !window.isDestroyed()) {
      window.close();
    }
  }
}
