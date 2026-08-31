import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { HttpsProxyAgent } from "https-proxy-agent";

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_IDLE_TIMEOUT_MS = 45_000;
const DEFAULT_MIN_SEGMENT_BYTES = 4 * 1024 * 1024;
const DEFAULT_PROXY_ATTEMPTS = 3;
const PROXY_PROBE_END = 1;
const MAX_REDIRECTS = 5;
const MAX_PROXY_FILE_BYTES = 8 * 1024 * 1024;
const DISK_ERROR_CODES = new Set(["ENOSPC", "EDQUOT", "EACCES", "EPERM", "EROFS", "EIO", "ENODEV"]);

export interface ProxyEndpoint {
  id: number;
  url: string;
  authorization: string;
  username: string;
  password: string;
  hostname: string;
  port: number;
}

interface CachedProxyFile {
  mtimeMs: number;
  size: number;
  proxies: ProxyEndpoint[];
}

interface ParsedRange {
  start: number;
  end: number;
  total: number;
}

interface RangeResponse {
  response: IncomingMessage;
  dispose: () => void;
}

interface Segment {
  index: number;
  start: number;
  end: number;
}

export interface ProxySegmentedDownloadOptions {
  directUrl: string;
  targetPath: string;
  proxyListPath: string;
  connections: number;
  signal: AbortSignal;
  skipTlsVerify?: boolean;
  minSegmentBytes?: number;
  connectTimeoutMs?: number;
  idleTimeoutMs?: number;
  proxyAttempts?: number;
  waitWhilePaused?: () => Promise<void>;
  onTrafficBytes?: (bytes: number) => void;
  onProgress?: (deltaBytes: number, downloadedBytes: number, totalBytes: number) => void;
}

export type ProxySegmentedDownloadResult =
  | { status: "completed"; totalBytes: number; connections: number }
  | { status: "fallback"; reason: ProxyFallbackReason };

export type ProxyFallbackReason =
  | "proxy_file_unavailable"
  | "no_valid_proxies"
  | "range_unsupported"
  | "file_too_small"
  | "proxy_unavailable"
  | "segment_failed";

const proxyFileCache = new Map<string, CachedProxyFile>();

function parseProxyLine(rawLine: string, id: number): ProxyEndpoint | null {
  const value = rawLine.trim();
  if (!value || value.startsWith("#") || /\s/.test(value)) {
    return null;
  }

  let candidate = value;
  if (!/^https?:\/\//i.test(candidate)) {
    const parts = candidate.split(":");
    if (!candidate.includes("@") && parts.length === 4 && /^\d+$/.test(parts[1])) {
      const [host, port, username, password] = parts;
      candidate = `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
    } else if (candidate.includes("@")) {
      const separator = candidate.lastIndexOf("@");
      const credentials = candidate.slice(0, separator);
      const address = candidate.slice(separator + 1);
      const credentialSeparator = credentials.indexOf(":");
      if (credentialSeparator < 1 || !address) {
        return null;
      }
      candidate = `http://${encodeURIComponent(credentials.slice(0, credentialSeparator))}:${encodeURIComponent(credentials.slice(credentialSeparator + 1))}@${address}`;
    } else {
      candidate = `http://${candidate}`;
    }
  }

  try {
    const parsed = new URL(candidate);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname || !parsed.port) {
      return null;
    }
    const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return null;
    }
    let authorization = "";
    let username = "";
    let password = "";
    if (parsed.username || parsed.password) {
      username = decodeURIComponent(parsed.username);
      password = decodeURIComponent(parsed.password);
      authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
      parsed.username = "";
      parsed.password = "";
    }
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return {
      id,
      url: parsed.toString(),
      authorization,
      username,
      password,
      hostname: parsed.hostname,
      port
    };
  } catch {
    return null;
  }
}

export function parseProxyList(content: string): number {
  return content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .reduce((count, line, index) => count + (parseProxyLine(line, index) ? 1 : 0), 0);
}

function parseUniqueProxyEndpoints(content: string): ProxyEndpoint[] {
  const seen = new Set<string>();
  return content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line, index) => parseProxyLine(line, index))
    .filter((proxy): proxy is ProxyEndpoint => {
      if (!proxy) return false;
      const key = `${proxy.url}\0${proxy.authorization}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export type FixedProxySelection =
  | { status: "ok"; proxy: ProxyEndpoint; selectedIndex: number; proxyCount: number }
  | { status: "proxy_file_unavailable" | "no_valid_proxies" | "proxy_index_unavailable" };

export function selectFixedProxy(proxyListPath: string, requestedIndex: number): FixedProxySelection {
  const filePath = String(proxyListPath || "").trim();
  if (!filePath) return { status: "proxy_file_unavailable" };
  try {
    const normalizedPath = path.resolve(filePath);
    const stat = fs.statSync(normalizedPath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_PROXY_FILE_BYTES) {
      return { status: stat.size <= 0 ? "no_valid_proxies" : "proxy_file_unavailable" };
    }
    const proxies = parseUniqueProxyEndpoints(fs.readFileSync(normalizedPath, "utf8"));
    if (proxies.length === 0) return { status: "no_valid_proxies" };
    const selectedIndex = Math.max(1, Math.floor(requestedIndex || 1));
    const proxy = proxies[selectedIndex - 1];
    if (!proxy) return { status: "proxy_index_unavailable" };
    return { status: "ok", proxy, selectedIndex, proxyCount: proxies.length };
  } catch {
    return { status: "proxy_file_unavailable" };
  }
}

async function loadProxyFile(filePath: string): Promise<
  { status: "ok"; proxies: ProxyEndpoint[] }
  | { status: "unavailable" }
  | { status: "empty" }
> {
  const normalizedPath = path.resolve(filePath.trim());
  try {
    const stat = await fs.promises.stat(normalizedPath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_PROXY_FILE_BYTES) {
      return { status: stat.size <= 0 ? "empty" : "unavailable" };
    }
    const cached = proxyFileCache.get(normalizedPath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.proxies.length > 0
        ? { status: "ok", proxies: cached.proxies }
        : { status: "empty" };
    }
    const content = await fs.promises.readFile(normalizedPath, "utf8");
    const proxies = parseUniqueProxyEndpoints(content);
    proxyFileCache.set(normalizedPath, { mtimeMs: stat.mtimeMs, size: stat.size, proxies });
    return proxies.length > 0 ? { status: "ok", proxies } : { status: "empty" };
  } catch {
    return { status: "unavailable" };
  }
}

function parseContentRange(value: string | undefined): ParsedRange | null {
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(String(value || "").trim());
  if (!match) {
    return null;
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(total)
    || start < 0 || end < start || total <= end) {
    return null;
  }
  return { start, end, total };
}

function abortError(): Error {
  return new Error("aborted:proxy_download");
}

function isDiskError(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as NodeJS.ErrnoException).code || "")
    : "";
  return DISK_ERROR_CODES.has(code);
}

async function openRangeResponse(
  target: URL,
  proxy: ProxyEndpoint,
  start: number,
  end: number,
  signal: AbortSignal,
  skipTlsVerify: boolean,
  connectTimeoutMs: number,
  idleTimeoutMs: number,
  redirectCount = 0
): Promise<RangeResponse> {
  if (signal.aborted) {
    throw abortError();
  }

  const agent = new HttpsProxyAgent(proxy.url, {
    keepAlive: false,
    headers: proxy.authorization ? { "Proxy-Authorization": proxy.authorization } : {}
  });
  const requestOptions: https.RequestOptions = {
    method: "GET",
    headers: {
      Accept: "*/*",
      Range: `bytes=${start}-${end}`,
      "User-Agent": "Multi-Debrid-Downloader"
    },
    agent,
    rejectUnauthorized: !skipTlsVerify
  };

  return new Promise<RangeResponse>((resolve, reject) => {
    let settled = false;
    let responseRef: IncomingMessage | null = null;
    const requestFn: typeof http.request = target.protocol === "https:" ? https.request : http.request;
    const request = requestFn(target, requestOptions, (response) => {
      responseRef = response;
      clearTimeout(connectTimer);
      const status = response.statusCode || 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        settled = true;
        response.resume();
        response.once("end", () => {
          cleanup();
          if (redirectCount >= MAX_REDIRECTS) {
            reject(new Error("proxy_redirect_limit"));
            return;
          }
          let redirected: URL;
          try {
            redirected = new URL(location, target);
            if (redirected.protocol !== "http:" && redirected.protocol !== "https:") {
              reject(new Error("proxy_redirect_invalid"));
              return;
            }
          } catch {
            reject(new Error("proxy_redirect_invalid"));
            return;
          }
          openRangeResponse(
            redirected,
            proxy,
            start,
            end,
            signal,
            skipTlsVerify,
            connectTimeoutMs,
            idleTimeoutMs,
            redirectCount + 1
          ).then(resolve, reject);
        });
        return;
      }
      settled = true;
      response.setTimeout(idleTimeoutMs, () => response.destroy(new Error("proxy_idle_timeout")));
      response.once("close", cleanup);
      resolve({
        response,
        dispose: () => {
          cleanup();
          response.destroy();
        }
      });
    });

    const cleanup = (): void => {
      clearTimeout(connectTimer);
      signal.removeEventListener("abort", onAbort);
      agent.destroy();
    };
    const onAbort = (): void => {
      request.destroy(abortError());
      responseRef?.destroy(abortError());
    };
    const connectTimer = setTimeout(() => request.destroy(new Error("proxy_connect_timeout")), connectTimeoutMs);
    signal.addEventListener("abort", onAbort, { once: true });
    request.once("error", (error) => {
      cleanup();
      if (!settled) {
        reject(signal.aborted ? abortError() : error);
      }
    });
    request.setTimeout(idleTimeoutMs, () => request.destroy(new Error("proxy_idle_timeout")));
    request.end();
  });
}

async function consumeProbe(response: IncomingMessage, expectedBytes: number, onTrafficBytes?: (bytes: number) => void): Promise<number> {
  let received = 0;
  for await (const rawChunk of response) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    received += chunk.length;
    onTrafficBytes?.(chunk.length);
    if (received > expectedBytes) {
      throw new Error("proxy_probe_overflow");
    }
  }
  return received;
}

async function probeRangeSupport(
  target: URL,
  proxies: ProxyEndpoint[],
  signal: AbortSignal,
  options: Required<Pick<ProxySegmentedDownloadOptions, "skipTlsVerify" | "connectTimeoutMs" | "idleTimeoutMs" | "proxyAttempts">>,
  onTrafficBytes?: (bytes: number) => void
): Promise<
  { status: "ok"; totalBytes: number }
  | { status: "unsupported" }
  | { status: "unavailable" }
> {
  const attempts = Math.min(proxies.length, options.proxyAttempts);
  for (let index = 0; index < attempts; index += 1) {
    let opened: RangeResponse | null = null;
    try {
      opened = await openRangeResponse(
        target,
        proxies[Math.floor((index * proxies.length) / attempts)],
        0,
        PROXY_PROBE_END,
        signal,
        options.skipTlsVerify,
        options.connectTimeoutMs,
        options.idleTimeoutMs
      );
      const status = opened.response.statusCode || 0;
      if (status === 200) {
        opened.dispose();
        return { status: "unsupported" };
      }
      const range = parseContentRange(opened.response.headers["content-range"]);
      const expectedEnd = range ? Math.min(PROXY_PROBE_END, range.total - 1) : -1;
      const expectedBytes = expectedEnd + 1;
      const contentLength = Number(opened.response.headers["content-length"] || 0);
      if (status !== 206
        || !range
        || range.start !== 0
        || range.end !== expectedEnd
        || (contentLength > 0 && contentLength !== expectedBytes)) {
        opened.dispose();
        continue;
      }
      const received = await consumeProbe(opened.response, expectedBytes, onTrafficBytes);
      opened.dispose();
      if (received === expectedBytes) {
        return { status: "ok", totalBytes: range.total };
      }
    } catch (error) {
      opened?.dispose();
      if (signal.aborted) {
        throw abortError();
      }
      if (isDiskError(error)) {
        throw error;
      }
    }
  }
  return { status: "unavailable" };
}

function buildSegments(totalBytes: number, count: number): Segment[] {
  const baseSize = Math.floor(totalBytes / count);
  const remainder = totalBytes % count;
  let start = 0;
  return Array.from({ length: count }, (_, index) => {
    const size = baseSize + (index < remainder ? 1 : 0);
    const segment = { index, start, end: start + size - 1 };
    start += size;
    return segment;
  });
}

class ProxyPool {
  private cursor = 0;
  private active = new Set<number>();
  private cooldownUntil = new Map<number, number>();

  public constructor(private readonly proxies: ProxyEndpoint[]) {}

  public acquire(excluded: ReadonlySet<number>): ProxyEndpoint | null {
    const now = Date.now();
    const select = (allowActive: boolean, allowCooldown: boolean): ProxyEndpoint | null => {
      for (let offset = 0; offset < this.proxies.length; offset += 1) {
        const index = (this.cursor + offset) % this.proxies.length;
        const proxy = this.proxies[index];
        if (excluded.has(proxy.id)
          || (!allowActive && this.active.has(proxy.id))
          || (!allowCooldown && (this.cooldownUntil.get(proxy.id) || 0) > now)) {
          continue;
        }
        this.cursor = (index + 1) % this.proxies.length;
        this.active.add(proxy.id);
        return proxy;
      }
      return null;
    };
    return select(false, false) || select(false, true) || select(true, true);
  }

  public release(proxy: ProxyEndpoint, succeeded: boolean): void {
    this.active.delete(proxy.id);
    if (succeeded) {
      this.cooldownUntil.delete(proxy.id);
    } else {
      this.cooldownUntil.set(proxy.id, Date.now() + 30_000);
    }
  }
}

async function writeBufferAt(handle: fs.promises.FileHandle, buffer: Buffer, position: number): Promise<void> {
  let offset = 0;
  while (offset < buffer.length) {
    const result = await handle.write(buffer, offset, buffer.length - offset, position + offset);
    if (result.bytesWritten <= 0) {
      throw new Error("proxy_disk_write_zero");
    }
    offset += result.bytesWritten;
  }
}

async function downloadSegmentOnce(
  target: URL,
  tempPath: string,
  segment: Segment,
  proxy: ProxyEndpoint,
  signal: AbortSignal,
  options: Required<Pick<ProxySegmentedDownloadOptions, "skipTlsVerify" | "connectTimeoutMs" | "idleTimeoutMs">>,
  callbacks: Pick<ProxySegmentedDownloadOptions, "waitWhilePaused" | "onTrafficBytes" | "onProgress">,
  totalBytes: number,
  currentProgress: () => number
): Promise<number> {
  const opened = await openRangeResponse(
    target,
    proxy,
    segment.start,
    segment.end,
    signal,
    options.skipTlsVerify,
    options.connectTimeoutMs,
    options.idleTimeoutMs
  );
  const response = opened.response;
  const expectedBytes = segment.end - segment.start + 1;
  const range = parseContentRange(response.headers["content-range"]);
  const contentLength = Number(response.headers["content-length"] || 0);
  if ((response.statusCode || 0) !== 206
    || !range
    || range.start !== segment.start
    || range.end !== segment.end
    || range.total !== totalBytes
    || (contentLength > 0 && contentLength !== expectedBytes)) {
    opened.dispose();
    throw new Error("proxy_range_mismatch");
  }

  let handle: fs.promises.FileHandle;
  try {
    handle = await fs.promises.open(tempPath, "r+");
  } catch (error) {
    opened.dispose();
    throw error;
  }
  let received = 0;
  try {
    for await (const rawChunk of response) {
      if (signal.aborted) {
        throw abortError();
      }
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      callbacks.onTrafficBytes?.(chunk.length);
      if (received + chunk.length > expectedBytes) {
        throw new Error("proxy_segment_overflow");
      }
      if (callbacks.waitWhilePaused) {
        response.setTimeout(0);
        await callbacks.waitWhilePaused();
        response.setTimeout(options.idleTimeoutMs);
      }
      await writeBufferAt(handle, chunk, segment.start + received);
      received += chunk.length;
      callbacks.onProgress?.(chunk.length, currentProgress() + chunk.length, totalBytes);
    }
    if (received !== expectedBytes) {
      throw new Error("proxy_segment_underflow");
    }
    return received;
  } finally {
    opened.dispose();
    await handle.close();
  }
}

export async function downloadWithProxySegments(options: ProxySegmentedDownloadOptions): Promise<ProxySegmentedDownloadResult> {
  const proxyPath = String(options.proxyListPath || "").trim();
  if (!proxyPath) {
    return { status: "fallback", reason: "proxy_file_unavailable" };
  }
  const loaded = await loadProxyFile(proxyPath);
  if (loaded.status === "unavailable") {
    return { status: "fallback", reason: "proxy_file_unavailable" };
  }
  if (loaded.status === "empty") {
    return { status: "fallback", reason: "no_valid_proxies" };
  }

  let target: URL;
  try {
    target = new URL(options.directUrl);
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return { status: "fallback", reason: "proxy_unavailable" };
    }
  } catch {
    return { status: "fallback", reason: "proxy_unavailable" };
  }

  const normalized = {
    skipTlsVerify: Boolean(options.skipTlsVerify),
    connectTimeoutMs: Math.max(1_000, Math.floor(options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS)),
    idleTimeoutMs: Math.max(2_000, Math.floor(options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS)),
    proxyAttempts: Math.max(1, Math.min(10, Math.floor(options.proxyAttempts ?? DEFAULT_PROXY_ATTEMPTS)))
  };
  const probe = await probeRangeSupport(target, loaded.proxies, options.signal, normalized, options.onTrafficBytes);
  if (probe.status === "unsupported") {
    return { status: "fallback", reason: "range_unsupported" };
  }
  if (probe.status === "unavailable") {
    return { status: "fallback", reason: "proxy_unavailable" };
  }

  const requestedConnections = Math.max(2, Math.min(32, Math.floor(options.connections || 16)));
  const minSegmentBytes = Math.max(1, Math.floor(options.minSegmentBytes ?? DEFAULT_MIN_SEGMENT_BYTES));
  const connections = Math.min(requestedConnections, loaded.proxies.length, Math.floor(probe.totalBytes / minSegmentBytes));
  if (connections < 2) {
    return { status: "fallback", reason: "file_too_small" };
  }

  await fs.promises.mkdir(path.dirname(options.targetPath), { recursive: true });
  try {
    const targetStat = await fs.promises.stat(options.targetPath);
    if (targetStat.size > 0) {
      return { status: "fallback", reason: "segment_failed" };
    }
    await fs.promises.rm(options.targetPath, { force: true });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as NodeJS.ErrnoException).code || "")
      : "";
    if (code !== "ENOENT") {
      throw error;
    }
  }
  const tempPath = `${options.targetPath}.proxy-${process.pid}-${randomUUID()}.part`;
  let committedProgress = 0;
  let tempCreated = false;
  const updateProgress = (deltaBytes: number, _downloadedBytes: number, totalBytes: number): void => {
    committedProgress = Math.max(0, Math.min(totalBytes, committedProgress + deltaBytes));
    options.onProgress?.(deltaBytes, committedProgress, totalBytes);
  };

  try {
    const initialHandle = await fs.promises.open(tempPath, "wx");
    tempCreated = true;
    try {
      await initialHandle.truncate(probe.totalBytes);
    } finally {
      await initialHandle.close();
    }

    const segments = buildSegments(probe.totalBytes, connections);
    const pool = new ProxyPool(loaded.proxies);
    const segmentController = new AbortController();
    const cascadeAbort = (): void => segmentController.abort("parent_abort");
    options.signal.addEventListener("abort", cascadeAbort, { once: true });
    const signal = AbortSignal.any([options.signal, segmentController.signal]);

    const tasks = segments.map(async (segment) => {
      const excluded = new Set<number>();
      let lastError: unknown = null;
      for (let attempt = 0; attempt < normalized.proxyAttempts; attempt += 1) {
        if (signal.aborted) {
          throw abortError();
        }
        const proxy = pool.acquire(excluded);
        if (!proxy) {
          break;
        }
        excluded.add(proxy.id);
        let attemptProgress = 0;
        try {
          const bytes = await downloadSegmentOnce(
            target,
            tempPath,
            segment,
            proxy,
            signal,
            normalized,
            {
              waitWhilePaused: options.waitWhilePaused,
              onTrafficBytes: options.onTrafficBytes,
              onProgress: (deltaBytes, downloadedBytes, totalBytes) => {
                attemptProgress += deltaBytes;
                updateProgress(deltaBytes, downloadedBytes, totalBytes);
              }
            },
            probe.totalBytes,
            () => committedProgress
          );
          pool.release(proxy, true);
          return bytes;
        } catch (error) {
          pool.release(proxy, false);
          if (attemptProgress > 0) {
            updateProgress(-attemptProgress, committedProgress - attemptProgress, probe.totalBytes);
          }
          if (options.signal.aborted || isDiskError(error)) {
            throw error;
          }
          lastError = error;
        }
      }
      throw lastError || new Error("proxy_segment_failed");
    });

    const guardedTasks = tasks.map((task) => task.catch((error) => {
      segmentController.abort("segment_failed");
      throw error;
    }));
    const settled = await Promise.allSettled(guardedTasks);
    options.signal.removeEventListener("abort", cascadeAbort);
    const failed = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) {
      if (options.signal.aborted) {
        throw abortError();
      }
      if (isDiskError(failed.reason)) {
        throw failed.reason;
      }
      return { status: "fallback", reason: "segment_failed" };
    }

    const finalizedHandle = await fs.promises.open(tempPath, "r+");
    try {
      await finalizedHandle.datasync();
    } finally {
      await finalizedHandle.close();
    }
    const finalStat = await fs.promises.stat(tempPath);
    if (finalStat.size !== probe.totalBytes) {
      return { status: "fallback", reason: "segment_failed" };
    }
    await fs.promises.rename(tempPath, options.targetPath);
    tempCreated = false;
    return { status: "completed", totalBytes: probe.totalBytes, connections };
  } catch (error) {
    if (options.signal.aborted || String(error).includes("aborted:proxy_download")) {
      throw abortError();
    }
    if (isDiskError(error)) {
      throw error;
    }
    return { status: "fallback", reason: "segment_failed" };
  } finally {
    if (tempCreated) {
      try {
        await fs.promises.rm(tempPath, { force: true });
      } catch {
      }
    }
    if (committedProgress > 0 && tempCreated) {
      updateProgress(-committedProgress, 0, probe.totalBytes);
    }
  }
}
