import type { UnrestrictedLink } from "./realdebrid";

export const DEEPBRID_ACCOUNT_ID = "svc-deepbrid";

const API_BASE_URL = "https://www.deepbrid.com/api/v1";
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 30000;
const MAX_RETRY_DELAY_MS = 30000;

export type DeepbridErrorClassification = "auth" | "rate_limit" | "temporary" | "link" | "malformed";

export class DeepbridApiError extends Error {
  public readonly status: number;
  public readonly code: number;
  public readonly classification: DeepbridErrorClassification;

  public constructor(status: number, code: number, classification: DeepbridErrorClassification) {
    super(`Deepbrid-Anfrage fehlgeschlagen (${classification}, HTTP ${status}, Code ${code})`);
    this.name = "DeepbridApiError";
    this.status = status;
    this.code = code;
    this.classification = classification;
  }
}

export interface DeepbridUserInfo {
  username: string;
  email: string;
  type: string;
  expiration: string;
  maxDownloads: number;
  maxConnections: number;
}

export interface DeepbridHostInfo {
  domain: string;
  status: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function malformedError(status = 200): DeepbridApiError {
  return new DeepbridApiError(status, status || 0, "malformed");
}

function parseErrorCode(payload: unknown, status: number): number {
  if (!isRecord(payload)) {
    return status;
  }
  const value = Number(payload.error ?? payload.code ?? status);
  return Number.isFinite(value) ? Math.trunc(value) : status;
}

function parseRetryAfterMs(value: string | null): number | null {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_RETRY_DELAY_MS, Math.floor(seconds * 1000));
  }
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, timestamp - Date.now()));
}

function defaultRetryDelayMs(attempt: number): number {
  return Math.min(MAX_RETRY_DELAY_MS, 250 * 2 ** (attempt - 1));
}

function callerAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

async function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw callerAbortReason(signal);
  }
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      signal?.removeEventListener("abort", onAbort);
      reject(signal ? callerAbortReason(signal) : new DOMException("The operation was aborted", "AbortError"));
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

async function parseJson(response: Response): Promise<unknown> {
  const mediaType = String(response.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  const isJson = mediaType === "application/json"
    || /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+\+json$/.test(mediaType);
  if (!isJson) {
    throw malformedError(response.status);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw malformedError(response.status);
    }
    throw error;
  }
  if (!isRecord(payload) && !Array.isArray(payload)) {
    throw malformedError(response.status);
  }
  return payload;
}

function classifyHttpError(status: number, payload: unknown, linkRequest: boolean): DeepbridApiError {
  const code = parseErrorCode(payload, status);
  if (status === 401 || status === 403) {
    return new DeepbridApiError(status, code, "auth");
  }
  if (status === 429) {
    return new DeepbridApiError(status, code, "rate_limit");
  }
  if (status >= 500) {
    return new DeepbridApiError(status, code, "temporary");
  }
  if (linkRequest && isRecord(payload)) {
    const structured = Number.isFinite(Number(payload.error ?? payload.code)) || typeof payload.message === "string";
    if (structured) {
      return new DeepbridApiError(status, code, "link");
    }
  }
  return malformedError(status);
}

function isRetryable(error: DeepbridApiError): boolean {
  return error.classification === "rate_limit" || error.classification === "temporary";
}

function validateUser(payload: unknown): DeepbridUserInfo {
  if (!isRecord(payload)
    || typeof payload.username !== "string"
    || typeof payload.email !== "string"
    || typeof payload.type !== "string"
    || typeof payload.expiration !== "string"
    || !Number.isFinite(payload.maxDownloads)
    || !Number.isFinite(payload.maxConnections)) {
    throw malformedError();
  }
  return {
    username: payload.username,
    email: payload.email,
    type: payload.type,
    expiration: payload.expiration,
    maxDownloads: Number(payload.maxDownloads),
    maxConnections: Number(payload.maxConnections)
  };
}

function validateHosts(payload: unknown): DeepbridHostInfo[] {
  if (!Array.isArray(payload)) {
    throw malformedError();
  }
  const hosts: DeepbridHostInfo[] = [];
  for (const entry of payload) {
    if (typeof entry === "string") {
      const domain = entry.trim();
      if (!domain) {
        throw malformedError();
      }
      hosts.push({ domain, status: "unknown" });
      continue;
    }
    if (!isRecord(entry)) {
      throw malformedError();
    }
    if (typeof entry.domain === "string" && typeof entry.status === "string") {
      const domain = entry.domain.trim();
      const status = entry.status.trim();
      if (!domain || !status) {
        throw malformedError();
      }
      hosts.push({ domain, status });
      continue;
    }
    const pairs = Object.entries(entry);
    if (pairs.length === 0 || pairs.some(([domain, status]) => !domain.trim() || typeof status !== "string" || !status.trim())) {
      throw malformedError();
    }
    hosts.push(...pairs.map(([domain, status]) => ({ domain: domain.trim(), status: String(status).trim() })));
  }
  return hosts;
}

function safeBaseName(value: string): string | null {
  const baseName = value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .split(/[\\/]/)
    .filter((part) => part && part !== "." && part !== "..")
    .at(-1);
  if (!baseName) {
    return null;
  }
  const sanitized = baseName
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/[. ]+$/g, "");
  if (!sanitized) {
    return null;
  }
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(sanitized)
    ? `_${sanitized}`
    : sanitized;
}

function fallbackFileName(url: URL): string {
  const segment = url.pathname.split("/").filter(Boolean).at(-1) || "";
  if (!segment) {
    return "download.bin";
  }
  try {
    return safeBaseName(decodeURIComponent(segment)) || "download.bin";
  } catch {
    return safeBaseName(segment) || "download.bin";
  }
}

function validateUnrestrictedLink(payload: unknown, retriesUsed: number): UnrestrictedLink {
  if (!isRecord(payload)) {
    throw malformedError();
  }
  const apiCode = Number(payload.error ?? 0);
  if (Number.isFinite(apiCode) && apiCode !== 0) {
    throw new DeepbridApiError(200, Math.trunc(apiCode), "link");
  }
  if (typeof payload.link !== "string" || !payload.link.trim()) {
    throw malformedError();
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(payload.link.trim());
  } catch {
    throw malformedError();
  }
  if ((parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") || parsedUrl.username || parsedUrl.password) {
    throw malformedError();
  }
  const providedName = typeof payload.filename === "string" ? safeBaseName(payload.filename) : null;
  return {
    fileName: providedName || fallbackFileName(parsedUrl),
    directUrl: parsedUrl.toString(),
    fileSize: parseDeepbridSize(payload.size),
    retriesUsed
  };
}

export function parseDeepbridSize(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? Math.floor(value) : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const match = value.trim().match(/^(\d+(?:[.,]\d+)?)\s*(B|KB|MB|GB|TB|KIB|MIB|GIB|TIB)$/i);
  if (!match) {
    return null;
  }
  const amount = Number(match[1].replace(",", "."));
  const unit = match[2].toUpperCase();
  const exponents: Record<string, number> = { B: 0, KB: 1, KIB: 1, MB: 2, MIB: 2, GB: 3, GIB: 3, TB: 4, TIB: 4 };
  const exponent = exponents[unit];
  if (exponent === undefined) {
    return null;
  }
  const bytes = amount * 1024 ** exponent;
  return Number.isFinite(bytes) && bytes >= 0 && bytes <= Number.MAX_SAFE_INTEGER ? Math.floor(bytes) : null;
}

export class DeepbridClient {
  private readonly apiKey: string;

  public constructor(apiKey: string) {
    this.apiKey = String(apiKey || "").trim();
  }

  public async getUser(signal?: AbortSignal): Promise<DeepbridUserInfo> {
    return this.request("/user", { method: "GET" }, validateUser, signal, false, true);
  }

  public async getHosts(signal?: AbortSignal): Promise<DeepbridHostInfo[]> {
    return this.request("/hosts", { method: "GET" }, validateHosts, signal, false, false);
  }

  public async unrestrictLink(link: string, signal?: AbortSignal, password?: string): Promise<UnrestrictedLink> {
    const body = new URLSearchParams({ link });
    if (password) {
      body.set("pass", password);
    }
    return this.request(
      "/generate/link",
      { method: "POST", body },
      validateUnrestrictedLink,
      signal,
      true,
      true
    );
  }

  private async request<T>(
    path: string,
    init: { method: "GET" | "POST"; body?: URLSearchParams },
    validate: (payload: unknown, retriesUsed: number) => T,
    signal: AbortSignal | undefined,
    linkRequest: boolean,
    authenticated: boolean
  ): Promise<T> {
    if (authenticated && !this.apiKey) {
      throw new DeepbridApiError(401, 401, "auth");
    }
    if (signal?.aborted) {
      throw callerAbortReason(signal);
    }
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const headers: Record<string, string> = { Accept: "application/json" };
        if (authenticated) {
          headers.Authorization = `Bearer ${this.apiKey}`;
        }
        if (init.method === "POST") {
          headers["Content-Type"] = "application/x-www-form-urlencoded";
        }
        const response = await fetch(`${API_BASE_URL}${path}`, {
          method: init.method,
          headers,
          body: init.body,
          signal: requestSignal(signal)
        });
        if (signal?.aborted) {
          throw callerAbortReason(signal);
        }
        let payload: unknown = null;
        try {
          payload = await parseJson(response);
        } catch (error) {
          if (response.ok || (response.status < 500 && response.status !== 429 && response.status !== 401 && response.status !== 403)) {
            throw error;
          }
        }
        if (signal?.aborted) {
          throw callerAbortReason(signal);
        }
        if (response.ok) {
          return validate(payload, attempt - 1);
        }
        const error = classifyHttpError(response.status, payload, linkRequest);
        if (isRetryable(error) && attempt < MAX_ATTEMPTS) {
          const delay = response.status === 429
            ? parseRetryAfterMs(response.headers.get("retry-after")) ?? defaultRetryDelayMs(attempt)
            : defaultRetryDelayMs(attempt);
          await sleepWithSignal(delay, signal);
          continue;
        }
        throw error;
      } catch (error) {
        if (signal?.aborted) {
          throw callerAbortReason(signal);
        }
        if (error instanceof DeepbridApiError) {
          throw error;
        }
        const transportError = new DeepbridApiError(0, 0, "temporary");
        if (attempt >= MAX_ATTEMPTS) {
          throw transportError;
        }
        await sleepWithSignal(defaultRetryDelayMs(attempt), signal);
      }
    }
    throw new DeepbridApiError(0, 0, "temporary");
  }
}
