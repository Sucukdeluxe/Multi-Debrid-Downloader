import { UnrestrictedLink } from "./realdebrid";
import { filenameFromUrl, sanitizeFilename } from "./utils";

export type GenerateOutcome =
  | { kind: "success"; value: UnrestrictedLink }
  | { kind: "login_required" }
  | { kind: "error"; status: number; error: string; errorCode: number | null; retryAfterMs: number };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeStatus(value: unknown): number {
  const status = Number(value ?? NaN);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
}

function normalizeErrorCode(value: unknown): number | null {
  const code = Number(value ?? NaN);
  return Number.isInteger(code) && code >= 0 ? code : null;
}

function normalizeErrorText(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 160) : fallback;
}

function normalizeFileSize(value: unknown): number | null {
  const size = Number(value ?? NaN);
  return Number.isFinite(size) && size > 0 && size <= Number.MAX_SAFE_INTEGER ? Math.floor(size) : null;
}

function normalizeRetryAfterMs(value: unknown): number {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    return 0;
  }
  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(120_000, Math.floor(seconds * 1000));
  }
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.min(120_000, Math.max(0, date - Date.now())) : 0;
}

function isAllowedDownloadUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === "https:"
      && !parsed.username
      && !parsed.password
      && (!parsed.port || parsed.port === "443")
      && (host === "download.real-debrid.com" || host.endsWith(".download.real-debrid.com"));
  } catch {
    return false;
  }
}

function normalizeFileName(payload: Record<string, unknown>, directUrl: string, originalLink: string): string {
  const supplied = typeof payload.filename === "string" ? payload.filename.trim().slice(0, 1024) : "";
  const suppliedBase = supplied.split(/[\\/]/).pop() || "";
  const directName = filenameFromUrl(directUrl);
  const originalName = filenameFromUrl(originalLink);
  const candidate = suppliedBase || (directName !== "download.bin" ? directName : originalName);
  return sanitizeFilename(candidate || "download.bin");
}

export function buildRealDebridWebGenerationScript(link: string): string {
  const serializedLink = JSON.stringify(String(link || "")).replace(/</g, "\\u003c");
  return `(async () => {
    const sourceLink = ${serializedLink};
    let sourceUrl;
    try {
      sourceUrl = new URL(sourceLink);
    } catch {
      return { kind: "page_error", error: "invalid_source_link" };
    }
    const host = sourceUrl.hostname.toLowerCase().replace(/^www\\./, "");
    const pathname = sourceUrl.pathname.toLowerCase();
    const isFolderLink =
      ((host === "mega.nz" || host === "mega.co.nz") && (pathname.startsWith("/folder/") || sourceUrl.hash.startsWith("#F!"))) ||
      ((host === "rapidgator.net" || host === "rg.to") && pathname.startsWith("/folder/")) ||
      (host === "protected.to" && pathname.startsWith("/f-")) ||
      (host === "ncrypt.in" && pathname.startsWith("/folder-")) ||
      host === "adf.ly" ||
      (host === "4shared.com" && (/^\\/(dir|folder)\\//).test(pathname)) ||
      (host === "1fichier.com" && pathname.startsWith("/dir/")) ||
      (host === "filefactory.com" && (/^\\/(f|folder)\\//).test(pathname)) ||
      host === "linksave.in" ||
      host === "soundcloud.com" ||
      (host === "go4up.com" && pathname.startsWith("/dl/")) ||
      ((host === "uploaded.to" || host === "uploaded.net" || host === "ul.to" || host === "ul.net") && (/^\\/(folder|f)\\//).test(pathname)) ||
      (host === "turbobit.net" && pathname.startsWith("/download/folder/")) ||
      (host === "safelinking.net" && pathname.startsWith("/p/")) ||
      host === "ed-protect.org" ||
      ((host === "drive.google.com" || host === "docs.google.com") && pathname.includes("/folders/")) ||
      (host === "mediafire.com" && (pathname.startsWith("/folder/") || sourceUrl.searchParams.has("sharekey")));
    if (isFolderLink) {
      return { kind: "page_error", error: "folder_link_not_supported" };
    }
    const forbidden = document.querySelector("#forbidden");
    const area = document.querySelector("#unrestrictArea");
    const form = document.querySelector("#unrestrictArea #debform");
    const links = document.querySelector("#unrestrictArea #links");
    const password = document.querySelector("#unrestrictArea #password");
    const remote = document.querySelector('#unrestrictArea input[name="remoteupload"]');
    const showLinks = document.querySelector('#unrestrictArea input[name="showlinks"]');
    const container = document.querySelector("#unrestrictArea #links-container");
    if (forbidden || !area || !form || !links || !password || !container) {
      return { kind: "login_required" };
    }
    if (typeof area.onsubmit !== "function" || typeof form.requestSubmit !== "function") {
      return { kind: "request_error", error: "page_not_ready" };
    }
    return await new Promise((resolve) => {
      let settled = false;
      let observer;
      let timer;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (observer) observer.disconnect();
        if (timer) clearTimeout(timer);
        resolve(value);
      };
      const inspect = () => {
        const anchor = container.querySelector(".link-generated a[href]");
        if (anchor) {
          finish({
            kind: "generated",
            download: String(anchor.href || anchor.getAttribute?.("href") || "").slice(0, 4096),
            text: String(anchor.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 1200)
          });
          return;
        }
        const error = container.querySelector(".link-error");
        if (error) {
          const rawError = String(error.textContent || "").replace(/\\s+/g, " ").trim();
          const sourcePrefix = sourceLink + ":";
          const errorText = rawError.startsWith(sourcePrefix)
            ? rawError.slice(sourcePrefix.length).trim()
            : rawError;
          finish({
            kind: "page_error",
            error: errorText.slice(0, 500)
          });
        }
      };
      observer = new MutationObserver(inspect);
      observer.observe(container, { childList: true, subtree: true, attributes: true });
      timer = setTimeout(() => finish({ kind: "request_error", error: "generation_timeout" }), 60_000);
      links.value = sourceLink;
      password.value = "";
      if (remote) remote.checked = false;
      if (showLinks) showLinks.checked = false;
      container.innerHTML = "";
      try {
        form.requestSubmit();
        inspect();
      } catch {
        finish({ kind: "request_error", error: "form_submit_failed" });
      }
    });
  })()`;
}

function parseGeneratedText(text: unknown): { fileName: string; fileSize: number | null } {
  const normalized = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  const withoutPrefix = normalized.replace(/^[^:]{1,40}:\s*/, "");
  const sizeMatch = withoutPrefix.match(/\(([\d.,]+)\s*(B|KB|MB|GB|TB)\)\s*$/i);
  let fileSize: number | null = null;
  if (sizeMatch) {
    const value = Number(sizeMatch[1].replace(",", "."));
    const unit = sizeMatch[2].toUpperCase();
    const multiplier = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }[unit] || 1;
    if (Number.isFinite(value) && value > 0) {
      fileSize = Math.floor(value * multiplier);
    }
  }
  const fileName = (sizeMatch ? withoutPrefix.slice(0, sizeMatch.index).trim() : withoutPrefix).trim();
  return { fileName, fileSize };
}

function normalizePageError(value: unknown): { status: number; error: string; errorCode: number | null } {
  const error = normalizeErrorText(value, "web_generation_failed");
  const lower = error.toLowerCase();
  if (lower.includes("folder_link_not_supported")) return { status: 400, error: "folder_link_not_supported", errorCode: null };
  if (lower.includes("hoster_unavailable")) return { status: 503, error: "hoster_unavailable", errorCode: 19 };
  if (lower.includes("hoster_maintenance")) return { status: 503, error: "hoster_maintenance", errorCode: 17 };
  if (lower.includes("file_unavailable")) return { status: 503, error: "file_unavailable", errorCode: 24 };
  if (lower.includes("service_unavailable")) return { status: 503, error: "service_unavailable", errorCode: 25 };
  if (lower.includes("fair_usage_limit")) return { status: 429, error: "fair_usage_limit", errorCode: 36 };
  if (lower.includes("ip_not_allowed")) return { status: 403, error: "ip_not_allowed", errorCode: 22 };
  if (lower.includes("traffic_exhausted")) return { status: 403, error: "traffic_exhausted", errorCode: 23 };
  if (lower.includes("too_many_requests")) return { status: 429, error: "too_many_requests", errorCode: 34 };
  return { status: 0, error, errorCode: null };
}

export function normalizeRealDebridWebGenerationResult(value: unknown, originalLink: string): GenerateOutcome {
  const result = asRecord(value);
  if (result?.kind === "login_required") {
    return { kind: "login_required" };
  }
  if (result?.kind === "generated") {
    const directUrl = typeof result.download === "string" ? result.download.trim() : "";
    if (!isAllowedDownloadUrl(directUrl)) {
      return { kind: "error", status: 200, error: "invalid_download_url", errorCode: null, retryAfterMs: 0 };
    }
    const generated = parseGeneratedText(result.text);
    const directName = filenameFromUrl(directUrl);
    const preferredName = directName && directName !== "download.bin"
      ? directName
      : generated.fileName || filenameFromUrl(originalLink);
    return {
      kind: "success",
      value: {
        directUrl,
        fileName: sanitizeFilename(preferredName),
        fileSize: generated.fileSize,
        retriesUsed: 0
      }
    };
  }
  if (result?.kind === "page_error") {
    const pageError = normalizePageError(result.error);
    return { kind: "error", ...pageError, retryAfterMs: 0 };
  }
  if (result?.kind !== "response") {
    return { kind: "error", status: 0, error: "invalid_response", errorCode: null, retryAfterMs: 0 };
  }

  const status = normalizeStatus(result.status);
  const payload = asRecord(result.payload);
  const errorCode = normalizeErrorCode(payload?.error_code);
  const retryAfterMs = normalizeRetryAfterMs(result.retryAfter);
  if (status === 401 || status === 403 || errorCode === 8) {
    return { kind: "login_required" };
  }
  if (!payload) {
    return { kind: "error", status, error: "invalid_response", errorCode: null, retryAfterMs };
  }

  const errorText = normalizeErrorText(payload.error, status >= 400 ? `http_${status}` : "");
  if (status < 200 || status >= 300 || errorText) {
    return {
      kind: "error",
      status,
      error: errorText || "web_generation_failed",
      errorCode,
      retryAfterMs
    };
  }

  const directUrl = typeof payload.download === "string"
    ? payload.download.trim().slice(0, 4096)
    : typeof payload.link === "string"
      ? payload.link.trim().slice(0, 4096)
      : "";
  if (!isAllowedDownloadUrl(directUrl)) {
    return { kind: "error", status, error: "invalid_download_url", errorCode: null, retryAfterMs };
  }

  return {
    kind: "success",
    value: {
      directUrl,
      fileName: normalizeFileName(payload, directUrl, originalLink),
      fileSize: normalizeFileSize(payload.filesize),
      retriesUsed: 0
    }
  };
}
