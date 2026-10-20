import path from "node:path";
import { ParsedPackageInput } from "../shared/types";

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const WINDOWS_RESERVED_BASENAMES = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9"
]);

type NetworkErrorContext = () => string | null;
let networkErrorContext: NetworkErrorContext | null = null;

export function setNetworkErrorContext(provider: NetworkErrorContext | null): void {
  networkErrorContext = provider;
}

const NETWORK_ERROR_CODE = /^(ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|EPIPE|UND_ERR_[A-Z_]+|ERR_TLS_[A-Z_]+|CERT_[A-Z_]+|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE)$/;
const PROXY_ONLY_REASONS: Record<string, string> = {
  proxy_file_unavailable: "Proxy-Liste nicht verfügbar",
  no_valid_proxies: "keine gültigen Proxys in der Liste",
  proxy_index_unavailable: "der feste API-Proxy-Eintrag fehlt in der Liste"
};

function withoutCredentials(text: string): string {
  return text.replace(/(\/\/)[^\s/@:]+:[^\s/@]+@/g, "$1");
}

function describeErrorCause(cause: unknown): { text: string; network: boolean } {
  const code = cause && typeof cause === "object" && "code" in cause ? String((cause as { code: unknown }).code || "") : "";
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  const tunnel = /^Proxy response \((\d{3})\)/i.exec(message);
  if (tunnel) {
    const status = tunnel[1];
    return { text: status === "407" ? "Proxy antwortet mit HTTP 407 (Zugangsdaten oder IP-Freigabe prüfen)" : `Proxy antwortet mit HTTP ${status}`, network: true };
  }
  const blocked = /^proxy_only_blocked:([a-z_]+)/.exec(message);
  if (blocked) {
    return { text: `Proxy-only blockiert: ${PROXY_ONLY_REASONS[blocked[1]] || blocked[1]}`, network: true };
  }
  const network = NETWORK_ERROR_CODE.test(code);
  const text = code && !message.includes(code) ? `${code}: ${message}` : message || code;
  return { text, network };
}

function errorCauseChain(error: Error): { causes: string[]; network: boolean } {
  const causes: string[] = [];
  const seen = new Set<unknown>([error]);
  let network = false;
  const queue: unknown[] = [(error as { cause?: unknown }).cause];
  if (error instanceof AggregateError) queue.push(...error.errors.slice(0, 3));
  while (queue.length && causes.length < 4) {
    const cause = queue.shift();
    if (!cause || seen.has(cause)) continue;
    seen.add(cause);
    const described = describeErrorCause(cause);
    network ||= described.network;
    if (described.text && !causes.includes(described.text)) causes.push(described.text);
    if (cause instanceof AggregateError) queue.push(...cause.errors.slice(0, 3));
    queue.push((cause as { cause?: unknown }).cause);
  }
  return { causes, network };
}

function describeError(message: unknown): string {
  if (!(message instanceof Error)) return String(message ?? "");
  const own = describeErrorCause(message);
  const { causes, network } = errorCauseChain(message);
  const proxyRelated = /fetch failed/i.test(message.message) || own.text.startsWith("Proxy");
  const proxy = proxyRelated && (network || own.network) ? networkErrorContext?.() ?? null : null;
  if (proxy) return `Verbindung über Proxy fehlgeschlagen: ${proxy} – ${(causes.length ? causes : [own.text]).join("; ")}`;
  return causes.length ? `${String(message)} (${causes.join("; ")})` : String(message);
}

export function compactErrorText(message: unknown, maxLen = 220): string {
  const raw = withoutCredentials(describeError(message)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!raw) {
    return "Unbekannter Fehler";
  }
  const safeMaxLen = Number.isFinite(maxLen) ? Math.max(4, Math.floor(maxLen)) : 220;
  if (raw.length <= safeMaxLen) {
    return raw;
  }
  return `${raw.slice(0, safeMaxLen - 3)}...`;
}

export function sanitizeFilename(name: string): string {
  const cleaned = String(name || "")
    .replace(/\0/g, "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  let normalized = cleaned
    .replace(/^[.\s]+/g, "")
    .replace(/[.\s]+$/g, "")
    .trim();

  if (!normalized || normalized === "." || normalized === ".." || /^\.+$/.test(normalized)) {
    return "Paket";
  }

  const parsed = path.parse(normalized);
  const reservedBase = (parsed.name.split(".")[0] || parsed.name).toLowerCase();
  if (WINDOWS_RESERVED_BASENAMES.has(reservedBase)) {
    normalized = `${parsed.name.replace(/^([^.]*)/, "$1_")}${parsed.ext}`;
  }

  return normalized || "Paket";
}

export function isHttpLink(value: string): boolean {
  const text = String(value || "").trim();
  if (!text) {
    return false;
  }
  try {
    const url = new URL(text);
    return (url.protocol === "http:" || url.protocol === "https:") && !!url.hostname;
  } catch {
    return false;
  }
}

export function extractHttpLinksFromText(text: string): string[] {
  const matches = String(text || "").match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  const seen = new Set<string>();
  const links: string[] = [];

  for (const match of matches) {
    let candidate = String(match || "").trim();
    let openParen = 0;
    let closeParen = 0;
    let openBracket = 0;
    let closeBracket = 0;
    for (const char of candidate) {
      if (char === "(") {
        openParen += 1;
      } else if (char === ")") {
        closeParen += 1;
      } else if (char === "[") {
        openBracket += 1;
      } else if (char === "]") {
        closeBracket += 1;
      }
    }
    while (candidate.length > 0) {
      const lastChar = candidate[candidate.length - 1];
      if (![")", "]", ",", ".", "!", "?", ";", ":"].includes(lastChar)) {
        break;
      }
      if (lastChar === ")") {
        if (closeParen <= openParen) {
          break;
        }
      }
      if (lastChar === "]") {
        if (closeBracket <= openBracket) {
          break;
        }
      }
      if (lastChar === ")") {
        closeParen = Math.max(0, closeParen - 1);
      } else if (lastChar === "]") {
        closeBracket = Math.max(0, closeBracket - 1);
      }
      candidate = candidate.slice(0, -1);
    }
    if (!candidate || !isHttpLink(candidate) || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    links.push(candidate);
  }

  return links;
}

export function humanSize(bytes: number): string {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) {
    return "0 B";
  }
  if (value < 1024) {
    return `${Math.round(value)} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size < 10 ? 1 : 0)} ${units[unit]}`;
}

export function filenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "download.bin";
    }
    const queryName = parsed.searchParams.get("filename")
      || parsed.searchParams.get("file")
      || parsed.searchParams.get("name")
      || parsed.searchParams.get("download")
      || parsed.searchParams.get("title")
      || "";
    const rawName = queryName || path.basename(parsed.pathname || "");
    const decoded = safeDecodeURIComponent(rawName || "").trim();
    const normalized = decoded
      .replace(/\.(rar|zip|7z|tar|gz|bz2|xz|iso|part\d+\.rar|r\d{2,3})\.html$/i, ".$1")
      .replace(/\.(mp4|mkv|avi|mp3|flac|srt)\.html$/i, ".$1");
    return sanitizeFilename(normalized || "download.bin");
  } catch {
    return "download.bin";
  }
}

export function looksLikeOpaqueFilename(name: string): boolean {
  const cleaned = sanitizeFilename(name || "").toLowerCase();
  if (!cleaned || cleaned === "download.bin") {
    return true;
  }
  const parsed = path.parse(cleaned);
  return /^[a-f0-9]{24,}$/i.test(parsed.name || cleaned);
}

export function inferPackageNameFromLinks(links: string[]): string {
  if (links.length === 0) {
    return "Paket";
  }
  const names = links.map((link) => filenameFromUrl(link).toLowerCase());
  const first = names[0];
  const match = first.match(/^([a-z0-9._\- ]{3,80}?)(?:\.|-|_)(?:part\d+|r\d{2}|s\d{2}e\d{2})/i);
  if (match) {
    return sanitizeFilename(match[1]);
  }
  return sanitizeFilename(path.parse(first).name || "Paket");
}

export function uniquePreserveOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function parsePackagesFromLinksText(rawText: string, defaultPackageName: string): ParsedPackageInput[] {
  const lines = String(rawText || "").split(/\r?\n/);
  const packages: ParsedPackageInput[] = [];
  let currentName = String(defaultPackageName || "").trim();
  let currentLinks: string[] = [];
  let currentFileNames: string[] = [];
  let pendingFileName = "";

  const flush = (): void => {
    const links = uniquePreserveOrder(currentLinks.filter((line) => isHttpLink(line)));
    if (links.length > 0) {
      const normalizedCurrentName = String(currentName || "").trim();
      const fileNames = links.map((link) => {
        const firstIndex = currentLinks.findIndex((currentLink) => currentLink === link);
        return firstIndex >= 0 ? currentFileNames[firstIndex] || "" : "";
      });
      const nextPackage: ParsedPackageInput = {
        name: normalizedCurrentName
          ? sanitizeFilename(normalizedCurrentName)
          : inferPackageNameFromLinks(links),
        links
      };
      if (fileNames.some((fileName) => fileName.trim().length > 0)) {
        nextPackage.fileNames = fileNames;
      }
      packages.push(nextPackage);
    }
    currentLinks = [];
    currentFileNames = [];
    pendingFileName = "";
  };

  for (const line of lines) {
    const text = line.trim();
    if (!text) {
      continue;
    }
    const marker = text.match(/^#\s*package\s*:\s*(.+)$/i);
    if (marker) {
      flush();
      currentName = String(marker[1] || "").trim();
      pendingFileName = "";
      continue;
    }
    const fileMarker = text.match(/^#\s*file\s*:\s*(.+)$/i);
    if (fileMarker) {
      pendingFileName = sanitizeFilename(String(fileMarker[1] || "").trim());
      continue;
    }
    if (!isHttpLink(text)) {
      continue;
    }
    currentLinks.push(text);
    currentFileNames.push(pendingFileName);
    pendingFileName = "";
  }

  flush();
  if (packages.length === 0) {
    return [];
  }
  return packages;
}

export function ensureDirPath(baseDir: string, packageName: string): string {
  if (!path.isAbsolute(baseDir)) {
    throw new Error("baseDir muss ein absoluter Pfad sein");
  }
  return path.join(baseDir, sanitizeFilename(packageName));
}

export function nowMs(): number {
  return Date.now();
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(String(signal.reason || "aborted")));
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      cleanup();
      reject(new Error(String(signal?.reason || "aborted")));
    };
    const cleanup = (): void => {
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "--";
  }
  const s = Math.floor(seconds);
  const sec = s % 60;
  const minTotal = Math.floor(s / 60);
  const min = minTotal % 60;
  const hr = Math.floor(minTotal / 60);
  if (hr > 0) {
    return `${String(hr).padStart(2, "0")}:${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
