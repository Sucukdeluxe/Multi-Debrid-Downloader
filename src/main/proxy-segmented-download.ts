import { setMaxListeners } from "node:events";
import fs from "node:fs";
import { withProcessingBudget } from "./processing-budget";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { IncomingMessage } from "node:http";
import { HttpsProxyAgent } from "https-proxy-agent";
import { runtimePerformance } from "./runtime-performance";
import { ProxyReadbackLimiter } from "./proxy-readback-limiter";
import { markFileSparse } from "./sparse-file";

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_IDLE_TIMEOUT_MS = 45_000;
const DEFAULT_MIN_SEGMENT_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_CHUNK_BYTES = 16 * 1024 * 1024;
const DEFAULT_CHUNKS_PER_CONNECTION = 8;
const DEFAULT_PROXY_ATTEMPTS = 3;
const DEFAULT_CONNECTION_LIMIT = 32;
const MAX_CONNECTION_LIMIT = 80;
const PROXY_PROBE_END = 1;
const MAX_REDIRECTS = 5;
const MAX_SEGMENTS = 4_096;
const MAX_PROXY_FILE_BYTES = 8 * 1024 * 1024;
const SEGMENT_READBACK_BUFFER_BYTES = 1024 * 1024;
const SEGMENT_WRITE_BUFFER_BYTES = 4 * 1024 * 1024;
const SEGMENT_WRITE_FLUSH_INTERVAL_MS = 500;
const SUSPICIOUS_ZERO_RUN_BYTES = 1024;
const MAX_ZERO_RUN_VERIFICATIONS_PER_SEGMENT = 4;
const ZERO_RUN_SENTINEL = Buffer.alloc(SUSPICIOUS_ZERO_RUN_BYTES);
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

interface SegmentDownloadOutcome {
  bytes: number;
  suspiciousZeroRanges: Segment[];
}

export interface ProxySegmentValidationRetry {
  reason: "readback_mismatch" | "zero_run_mismatch";
  rangeStart: number;
  rangeEnd: number;
  segmentStart: number;
  segmentEnd: number;
}

export interface ProxySegmentedDownloadOptions {
  directUrl: string;
  targetPath: string;
  proxyListPath: string;
  connections: number;
  totalConnectionLimit?: number;
  downloadId?: string;
  reservedProxyIndex?: number;
  signal: AbortSignal;
  skipTlsVerify?: boolean;
  minSegmentBytes?: number;
  connectTimeoutMs?: number;
  idleTimeoutMs?: number;
  proxyAttempts?: number;
  waitWhilePaused?: () => Promise<void>;
  onTrafficBytes?: (bytes: number) => void;
  onProgress?: (deltaBytes: number, downloadedBytes: number, totalBytes: number) => void;
  onValidationRetry?: (event: ProxySegmentValidationRetry) => void;
  onRepresentationRetry?: () => void;
  onDiskActivity?: (active: boolean) => void;
}

type DiskOperation = <T>(operation: () => Promise<T>) => Promise<T>;

export type ProxySegmentedDownloadResult =
  | { status: "completed"; totalBytes: number; connections: number }
  | { status: "fallback"; reason: ProxyFallbackReason; httpStatus?: number; errorCode?: string };

export type ProxyFallbackReason =
  | "proxy_file_unavailable"
  | "no_valid_proxies"
  | "range_unsupported"
  | "file_too_small"
  | "not_enough_proxies"
  | "proxy_unavailable"
  | "origin_http_error"
  | "segment_failed";

const proxyFileCache = new Map<string, CachedProxyFile>();

export function normalizeProxyConnectionLimit(value: number, fallback = DEFAULT_CONNECTION_LIMIT): number {
  const candidate = Number.isFinite(value) && value !== 0 ? value : fallback;
  return Math.max(2, Math.min(MAX_CONNECTION_LIMIT, Math.floor(candidate)));
}

function proxyEndpointKey(proxy: ProxyEndpoint): string {
  return `${proxy.url}\0${proxy.authorization}`;
}

class OriginHttpError extends Error {
  public constructor(public readonly statusCode: number) {
    super(`origin_http_${statusCode}`);
  }
}

class SegmentValidationError extends Error {
  public constructor(
    public readonly reason: ProxySegmentValidationRetry["reason"],
    public readonly rangeStart: number,
    public readonly rangeEnd: number,
    public readonly segment: Segment
  ) {
    super(`proxy_segment_${reason}`);
  }
}

function proxyFailureCode(error: unknown): string {
  if (error instanceof OriginHttpError) return `http_${error.statusCode}`;
  if (error instanceof SegmentValidationError) return error.reason;
  const message = error instanceof Error ? error.message : "";
  const knownMessages = new Set([
    "proxy_connect_timeout", "proxy_idle_timeout", "proxy_redirect_limit", "proxy_redirect_invalid",
    "proxy_probe_overflow", "proxy_range_mismatch", "proxy_representation_changed", "proxy_segment_overflow", "proxy_segment_underflow",
    "proxy_verification_range_mismatch", "proxy_verification_range_overflow", "proxy_verification_range_underflow",
    "proxy_zero_run_verification_unavailable", "proxy_segment_failed"
  ]);
  if (knownMessages.has(message)) return message;
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EPIPE|CERT_HAS_EXPIRED|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE)$/.test(code)
    ? code
    : "proxy_transport_error";
}

interface ProxyLeaseOutcome {
  succeeded: boolean;
  transferredBytes?: number;
  durationMs?: number;
  reason?: string;
}

interface ProxyLease {
  proxy: ProxyEndpoint;
  releaseSlot: () => void;
  release: (outcome: ProxyLeaseOutcome) => void;
}

interface ProxyLeaseWaiter {
  poolKey: string;
  groupId: string;
  proxies: ProxyEndpoint[];
  excluded: ReadonlySet<string>;
  signal: AbortSignal;
  resolve: (lease: ProxyLease | null) => void;
  reject: (error: Error) => void;
}

interface ProxyPerformance {
  ewmaBytesPerSecond: number;
  failures: number;
  samples: number;
}

export class SharedProxyCoordinator {
  private configuredConnectionLimit = DEFAULT_CONNECTION_LIMIT;
  private adaptiveConnectionLimit = DEFAULT_CONNECTION_LIMIT;
  private activeConnections = 0;
  private readonly activeProxies = new Set<string>();
  private readonly activeConnectionsByGroup = new Map<string, number>();
  private readonly registeredGroups = new Map<string, number>();
  private readonly cooldownUntil = new Map<string, number>();
  private readonly cursors = new Map<string, number>();
  private readonly performance = new Map<string, ProxyPerformance>();
  private readonly waiters: ProxyLeaseWaiter[] = [];
  private acquisitionCount = 0;
  private lastThrottleAt = 0;
  private successfulTransfersSinceThrottle = 0;
  private cooldownTimer: NodeJS.Timeout | null = null;
  private cooldownWakeAt: number | null = null;
  private readonly groupOrigins = new Map<string, string>();
  private readonly originThrottle = new Map<string, { limit: number; lastThrottleAt: number; successes: number }>();
  private readonly failureReasons = new Map<string, number>();
  private leaseSuccesses = 0;
  private leaseFailures = 0;

  public snapshot() {
    return {
      configuredConnections: this.configuredConnectionLimit,
      effectiveConnections: this.adaptiveConnectionLimit,
      activeConnections: this.activeConnections,
      waitingConnections: this.waiters.length,
      downloadGroups: this.registeredGroups.size,
      cooldownWakeAt: this.cooldownWakeAt,
      throttledAt: Math.max(this.lastThrottleAt, ...Array.from(this.originThrottle.values(), state => state.lastThrottleAt)) || null,
      originLimits: Array.from(this.originThrottle, ([origin, state]) => ({ origin, limit: state.limit, active: this.activeForOrigin(origin), throttledAt: state.lastThrottleAt })),
      coolingProxies: this.countCoolingProxies(),
      measuredProxies: this.performance.size,
      leaseSuccesses: this.leaseSuccesses,
      leaseFailures: this.leaseFailures,
      failureReasons: Object.fromEntries(this.failureReasons)
    };
  }

  private countCoolingProxies(): number {
    const now = Date.now();
    let cooling = 0;
    for (const until of this.cooldownUntil.values()) if (until > now) cooling += 1;
    return cooling;
  }

  public setConnectionLimit(limit: number): void {
    const normalized = normalizeProxyConnectionLimit(limit);
    if (normalized !== this.configuredConnectionLimit) {
      this.configuredConnectionLimit = normalized;
      this.adaptiveConnectionLimit = normalized;
      this.lastThrottleAt = 0;
      this.successfulTransfersSinceThrottle = 0;
      this.originThrottle.clear();
    } else {
      this.adaptiveConnectionLimit = Math.min(this.adaptiveConnectionLimit, normalized);
    }
    this.drain();
  }

  public registerGroup(groupId: string, origin?: string): () => void {
    for (const [key, state] of this.originThrottle) {
      if (Date.now() - state.lastThrottleAt > 900_000 && !Array.from(this.groupOrigins.values()).includes(key)) this.originThrottle.delete(key);
    }
    if (origin) this.groupOrigins.set(groupId, origin);
    this.registeredGroups.set(groupId, (this.registeredGroups.get(groupId) || 0) + 1);
    this.drain();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = Math.max(0, (this.registeredGroups.get(groupId) || 1) - 1);
      if (remaining > 0) {
        this.registeredGroups.set(groupId, remaining);
      } else {
        this.registeredGroups.delete(groupId);
        this.groupOrigins.delete(groupId);
      }
      this.drain();
    };
  }

  public reportOriginStatus(statusCode: number, origin?: string): void {
    if (statusCode !== 429 && statusCode !== 503) return;
    const now = Date.now();
    if (statusCode === 503 && origin) {
      const state = this.originThrottle.get(origin);
      if (state && now - state.lastThrottleAt < 1_500) return;
      const originGroups = Array.from(this.groupOrigins.values()).filter(value => value === origin).length;
      const share = Math.max(2, Math.ceil(this.adaptiveConnectionLimit * Math.max(1, originGroups) / Math.max(1, this.registeredGroups.size)));
      this.originThrottle.set(origin, { limit: Math.max(2, Math.min(state?.limit ?? share, share) - 2), lastThrottleAt: now, successes: 0 });
      this.drain();
      return;
    }
    if (now - this.lastThrottleAt < 1_500) return;
    this.lastThrottleAt = now;
    this.successfulTransfersSinceThrottle = 0;
    this.adaptiveConnectionLimit = Math.max(2, this.adaptiveConnectionLimit - 2);
    this.drain();
  }

  public reportContentMismatch(proxy: ProxyEndpoint): void {
    const key = proxyEndpointKey(proxy);
    const previous = this.performance.get(key);
    this.cooldownUntil.set(key, Date.now() + 30_000);
    this.performance.set(key, {
      ewmaBytesPerSecond: (previous?.ewmaBytesPerSecond || 0) * 0.5,
      failures: (previous?.failures || 0) + 1,
      samples: previous?.samples || 0
    });
    this.drain();
  }

  public acquire(
    poolKey: string,
    groupId: string,
    proxies: ProxyEndpoint[],
    excluded: ReadonlySet<string>,
    signal: AbortSignal
  ): Promise<ProxyLease | null> {
    if (signal.aborted) {
      return Promise.reject(abortError());
    }
    if (!proxies.some((proxy) => !excluded.has(proxyEndpointKey(proxy)))) {
      return Promise.resolve(null);
    }
    return new Promise<ProxyLease | null>((resolve, reject) => {
      const waiter: ProxyLeaseWaiter = { poolKey, groupId, proxies, excluded, signal, resolve, reject };
      const onAbort = (): void => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) {
          this.waiters.splice(index, 1);
          reject(abortError());
          this.drain();
        }
      };
      signal.addEventListener("abort", onAbort, { once: true });
      const resolveWithoutListener = waiter.resolve;
      const rejectWithoutListener = waiter.reject;
      waiter.resolve = (lease) => {
        signal.removeEventListener("abort", onAbort);
        resolveWithoutListener(lease);
      };
      waiter.reject = (error) => {
        signal.removeEventListener("abort", onAbort);
        rejectWithoutListener(error);
      };
      this.waiters.push(waiter);
      this.drain();
    });
  }

  private selectProxy(waiter: ProxyLeaseWaiter, borrowIdleCapacity = false): ProxyEndpoint | null {
    if (this.activeConnections >= this.adaptiveConnectionLimit) {
      return null;
    }
    const origin = this.groupOrigins.get(waiter.groupId);
    const originState = origin ? this.originThrottle.get(origin) : undefined;
    if (origin && originState && this.activeForOrigin(origin) >= originState.limit) return null;
    const groupCount = Math.max(1, this.registeredGroups.size);
    const originGroupCount = originState ? Array.from(this.groupOrigins.values()).filter(value => value === origin).length : 0;
    const originShare = originState ? Math.ceil(originState.limit / Math.max(1, originGroupCount)) : this.adaptiveConnectionLimit;
    const groupLimit = Math.max(1, Math.min(Math.ceil(this.adaptiveConnectionLimit / groupCount), originShare));
    if (!borrowIdleCapacity && (this.activeConnectionsByGroup.get(waiter.groupId) || 0) >= groupLimit) {
      return null;
    }
    const now = Date.now();
    const start = (this.cursors.get(waiter.poolKey) || 0) % waiter.proxies.length;
    const select = (allowCooldown: boolean): ProxyEndpoint | null => {
      const candidates: Array<{ proxy: ProxyEndpoint; index: number; key: string }> = [];
      for (let offset = 0; offset < waiter.proxies.length; offset += 1) {
        const index = (start + offset) % waiter.proxies.length;
        const proxy = waiter.proxies[index];
        const key = proxyEndpointKey(proxy);
        if (waiter.excluded.has(key)
          || this.activeProxies.has(key)
          || (!allowCooldown && (this.cooldownUntil.get(key) || 0) > now)) {
          continue;
        }
        candidates.push({ proxy, index, key });
      }
      if (candidates.length === 0) return null;
      this.acquisitionCount += 1;
      const unknown = candidates.filter((candidate) => !this.performance.has(candidate.key));
      const exploreUnknown = unknown.length > 0 && (unknown.length === candidates.length || this.acquisitionCount % 8 === 0);
      let selected = exploreUnknown ? unknown[0] : candidates[0];
      if (!exploreUnknown) {
        let selectedScore = Number.NEGATIVE_INFINITY;
        for (const candidate of candidates) {
          const metric = this.performance.get(candidate.key);
          const score = metric
            ? (metric.ewmaBytesPerSecond / (1 + metric.failures)) - (metric.failures * 1024 * 1024)
            : 0;
          if (score > selectedScore) {
            selected = candidate;
            selectedScore = score;
          }
        }
      }
      this.cursors.set(waiter.poolKey, (selected.index + 1) % waiter.proxies.length);
      return selected.proxy;
    };
    const available = select(false);
    if (available) return available;
    const poolHasActiveProxy = waiter.proxies.some((proxy) => this.activeProxies.has(proxyEndpointKey(proxy)));
    return poolHasActiveProxy ? null : select(true);
  }

  private createLease(proxy: ProxyEndpoint, groupId: string): ProxyLease {
    const key = proxyEndpointKey(proxy);
    this.activeConnections += 1;
    this.activeProxies.add(key);
    this.activeConnectionsByGroup.set(groupId, (this.activeConnectionsByGroup.get(groupId) || 0) + 1);
    let slotReleased = false;
    const releaseCapacity = (): void => {
      if (slotReleased) return;
      slotReleased = true;
      this.activeConnections = Math.max(0, this.activeConnections - 1);
      this.activeProxies.delete(key);
      const groupConnections = Math.max(0, (this.activeConnectionsByGroup.get(groupId) || 1) - 1);
      if (groupConnections > 0) {
        this.activeConnectionsByGroup.set(groupId, groupConnections);
      } else {
        this.activeConnectionsByGroup.delete(groupId);
      }
    };
    let released = false;
    return {
      proxy,
      releaseSlot: () => {
        releaseCapacity();
        this.drain();
      },
      release: (outcome) => {
        if (released) return;
        released = true;
        releaseCapacity();
        if (outcome.succeeded) {
          this.leaseSuccesses += 1;
          this.cooldownUntil.delete(key);
          if ((outcome.transferredBytes || 0) > 0 && (outcome.durationMs || 0) > 0) {
            const sample = ((outcome.transferredBytes || 0) * 1_000) / Math.max(1, outcome.durationMs || 1);
            const previous = this.performance.get(key);
            this.performance.set(key, {
              ewmaBytesPerSecond: previous && previous.samples > 0
                ? (previous.ewmaBytesPerSecond * 0.7) + (sample * 0.3)
                : sample,
              failures: Math.max(0, (previous?.failures || 0) - 1),
              samples: (previous?.samples || 0) + 1
            });
            this.restoreAdaptiveCapacity(this.groupOrigins.get(groupId));
          }
        } else {
          this.leaseFailures += 1;
          const reason = String(outcome.reason || "unknown").slice(0, 60);
          if (this.failureReasons.has(reason) || this.failureReasons.size < 40) this.failureReasons.set(reason, (this.failureReasons.get(reason) || 0) + 1);
          this.cooldownUntil.set(key, Date.now() + 30_000);
          const previous = this.performance.get(key);
          this.performance.set(key, {
            ewmaBytesPerSecond: (previous?.ewmaBytesPerSecond || 0) * 0.5,
            failures: (previous?.failures || 0) + 1,
            samples: previous?.samples || 0
          });
        }
        this.drain();
      }
    };
  }

  private activeForOrigin(origin: string): number {
    let active = 0;
    for (const [group, count] of this.activeConnectionsByGroup) {
      if (this.groupOrigins.get(group) === origin) active += count;
    }
    return active;
  }

  private restoreAdaptiveCapacity(origin?: string): void {
    const state = origin ? this.originThrottle.get(origin) : undefined;
    if (state) {
      state.successes += 1;
      if (Date.now() - state.lastThrottleAt >= 5_000 && state.successes >= Math.max(2, state.limit)) {
        state.limit = Math.min(this.configuredConnectionLimit, state.limit + Math.max(1, Math.ceil(state.limit / 4)));
        state.successes = 0;
        if (state.limit >= this.configuredConnectionLimit) this.originThrottle.delete(origin!);
      }
    }
    if (this.adaptiveConnectionLimit >= this.configuredConnectionLimit) return;
    this.successfulTransfersSinceThrottle += 1;
    if (Date.now() - this.lastThrottleAt < 5_000 || this.successfulTransfersSinceThrottle < 24) return;
    this.adaptiveConnectionLimit = Math.min(this.configuredConnectionLimit, this.adaptiveConnectionLimit + 1);
    this.successfulTransfersSinceThrottle = 0;
  }

  private drain(): void {
    if (this.cooldownTimer) clearTimeout(this.cooldownTimer);
    this.cooldownTimer = null;
    this.cooldownWakeAt = null;
    let granted = true;
    while (granted && this.activeConnections < this.adaptiveConnectionLimit) {
      granted = false;
      for (const borrowIdleCapacity of [false, true]) {
        for (let index = 0; index < this.waiters.length; index += 1) {
          const waiter = this.waiters[index];
          if (waiter.signal.aborted) {
            this.waiters.splice(index, 1);
            waiter.reject(abortError());
            granted = true;
            break;
          }
          const proxy = this.selectProxy(waiter, borrowIdleCapacity);
          if (!proxy) {
            continue;
          }
          this.waiters.splice(index, 1);
          waiter.resolve(this.createLease(proxy, waiter.groupId));
          granted = true;
          break;
        }
        if (granted) break;
      }
    }
    this.scheduleCooldownWake();
  }

  private scheduleCooldownWake(): void {
    if (!this.waiters.length || this.activeConnections >= this.adaptiveConnectionLimit) return;
    const now = Date.now();
    let earliest = Infinity;
    for (const waiter of this.waiters) {
      if (waiter.signal.aborted) continue;
      for (const proxy of waiter.proxies) {
        const key = proxyEndpointKey(proxy);
        if (waiter.excluded.has(key) || this.activeProxies.has(key)) continue;
        const until = this.cooldownUntil.get(key) || 0;
        if (until > now) earliest = Math.min(earliest, until);
      }
    }
    if (!Number.isFinite(earliest)) return;
    this.cooldownWakeAt = earliest;
    this.cooldownTimer = setTimeout(() => {
      this.cooldownTimer = null;
      this.cooldownWakeAt = null;
      this.drain();
    }, Math.max(1, earliest - now));
    this.cooldownTimer.unref();
  }
}

const sharedProxyCoordinator = new SharedProxyCoordinator();
const sharedReadbackLimiter = new ProxyReadbackLimiter(8);
const sparseAllocations = { ok: 0, failed: 0 };

export function getProxyTransferSnapshot() {
  return { ...sharedProxyCoordinator.snapshot(), readback: sharedReadbackLimiter.snapshot(), sparseAllocations: { ...sparseAllocations }, representationChanges: representationChanges.map(entry => ({ ...entry })) };
}

interface ProxyConnectionEntry {
  agent: HttpsProxyAgent<string>;
  origin: string;
  skipTlsVerify: boolean;
  active: number;
}

class ProxyConnectionPool {
  private readonly entries = new Map<string, ProxyConnectionEntry>();
  private references = 0;
  private limit = DEFAULT_CONNECTION_LIMIT;

  public retain(limit: number): () => void {
    this.references += 1;
    this.limit = limit;
    this.evictIdle();
    return () => {
      this.references -= 1;
      if (this.references === 0) {
        for (const entry of this.entries.values()) entry.agent.destroy();
        this.entries.clear();
      }
    };
  }

  public acquire(proxy: ProxyEndpoint, target: URL, skipTlsVerify: boolean): { agent: HttpsProxyAgent<string>; release: () => void } {
    const key = proxyEndpointKey(proxy);
    let entry = this.entries.get(key);
    if (entry && (entry.origin !== target.origin || entry.skipTlsVerify !== skipTlsVerify)) {
      entry.agent.destroy();
      this.entries.delete(key);
      entry = undefined;
    }
    if (!entry) {
      entry = {
        agent: new HttpsProxyAgent(proxy.url, {
          keepAlive: true,
          maxSockets: 1,
          maxFreeSockets: 1,
          timeout: DEFAULT_CONNECT_TIMEOUT_MS,
          headers: proxy.authorization ? { "Proxy-Authorization": proxy.authorization } : {}
        }),
        origin: target.origin,
        skipTlsVerify,
        active: 0
      };
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    entry.active += 1;
    this.evictIdle();
    const acquired = entry;
    let released = false;
    return {
      agent: acquired.agent,
      release: () => {
        if (released) return;
        released = true;
        acquired.active -= 1;
        this.evictIdle();
      }
    };
  }

  private evictIdle(): void {
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= this.limit) break;
      if (entry.active > 0) continue;
      entry.agent.destroy();
      this.entries.delete(key);
    }
  }
}

const sharedProxyConnections = new ProxyConnectionPool();

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

const representationChanges: Array<{ at: number; host: string; proxyId: number; expectedTotal: number; receivedTotal: number; rangeStart: number; rangeEnd: number; kind: string }> = [];

function recordRepresentationChange(kind: string, target: URL, proxy: ProxyEndpoint, expectedTotal: number, range: ParsedRange): void {
  representationChanges.push({ at: Date.now(), host: target.host, proxyId: proxy.id, expectedTotal, receivedTotal: range.total, rangeStart: range.start, rangeEnd: range.end, kind });
  if (representationChanges.length > 20) representationChanges.shift();
}

function isChangedRepresentation(status: number, range: ParsedRange | null, start: number, end: number, total: number, contentLength: number): boolean {
  return status === 206 && range !== null && range.total !== total
    && range.start === start && range.end === Math.min(end, range.total - 1)
    && (contentLength === 0 || contentLength === range.end - range.start + 1);
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

  const connection = sharedProxyConnections.acquire(proxy, target, skipTlsVerify);
  const requestOptions: https.RequestOptions = {
    method: "GET",
    headers: {
      Accept: "*/*",
      Range: `bytes=${start}-${end}`,
      "User-Agent": "Multi-Debrid-Downloader"
    },
    agent: connection.agent,
    rejectUnauthorized: !skipTlsVerify
  };

  return runtimePerformance.measure("proxy.response", () => new Promise<RangeResponse>((resolve, reject) => {
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
      connection.release();
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
  }));
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
  poolKey: string,
  groupId: string,
  proxies: ProxyEndpoint[],
  signal: AbortSignal,
  options: Required<Pick<ProxySegmentedDownloadOptions, "skipTlsVerify" | "connectTimeoutMs" | "idleTimeoutMs" | "proxyAttempts">>,
  onTrafficBytes?: (bytes: number) => void
): Promise<
  { status: "ok"; totalBytes: number }
  | { status: "unsupported" }
  | { status: "unavailable"; errorCode?: string }
  | { status: "origin_error"; httpStatus: number }
> {
  const attempts = Math.min(proxies.length, options.proxyAttempts);
  const excluded = new Set<string>();
  let lastHttpStatus = 0;
  let lastErrorCode: string | undefined;
  for (let index = 0; index < attempts; index += 1) {
    let opened: RangeResponse | null = null;
    let lease: ProxyLease | null = null;
    try {
      lease = await sharedProxyCoordinator.acquire(poolKey, groupId, proxies, excluded, signal);
      if (!lease) break;
      excluded.add(proxyEndpointKey(lease.proxy));
      opened = await openRangeResponse(
        target,
        lease.proxy,
        0,
        PROXY_PROBE_END,
        signal,
        options.skipTlsVerify,
        options.connectTimeoutMs,
        options.idleTimeoutMs
      );
      const status = opened.response.statusCode || 0;
      if (status >= 400) {
        lastHttpStatus = status;
        opened.dispose();
        opened = null;
        lease.release({ succeeded: true });
        lease = null;
        continue;
      }
      if (status === 200) {
        opened.dispose();
        opened = null;
        lease.release({ succeeded: true });
        lease = null;
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
        lastErrorCode = "proxy_probe_range_mismatch";
        opened.dispose();
        opened = null;
        lease.release({ succeeded: false, reason: lastErrorCode });
        lease = null;
        continue;
      }
      const received = await consumeProbe(opened.response, expectedBytes, onTrafficBytes);
      opened.dispose();
      opened = null;
      if (received === expectedBytes) {
        lease.release({ succeeded: true });
        lease = null;
        return { status: "ok", totalBytes: range.total };
      }
      lastErrorCode = "proxy_probe_underflow";
    } catch (error) {
      lastErrorCode = proxyFailureCode(error);
      opened?.dispose();
      opened = null;
      lease?.release({ succeeded: signal.aborted, reason: lastErrorCode });
      lease = null;
      if (signal.aborted) {
        throw abortError();
      }
      if (isDiskError(error)) {
        throw error;
      }
    } finally {
      opened?.dispose();
      lease?.release({ succeeded: false, reason: lastErrorCode || "proxy_probe_incomplete" });
    }
  }
  if (lastHttpStatus > 0) {
    sharedProxyCoordinator.reportOriginStatus(lastHttpStatus, target.origin);
    return { status: "origin_error", httpStatus: lastHttpStatus };
  }
  return { status: "unavailable", ...(lastErrorCode ? { errorCode: lastErrorCode } : {}) };
}

function buildSegments(totalBytes: number, connections: number, minSegmentBytes: number): Segment[] {
  const preferredChunkBytes = Math.max(
    minSegmentBytes,
    Math.min(DEFAULT_MAX_CHUNK_BYTES, Math.ceil(totalBytes / Math.max(1, connections * DEFAULT_CHUNKS_PER_CONNECTION)))
  );
  const chunkBytes = Math.max(preferredChunkBytes, Math.ceil(totalBytes / MAX_SEGMENTS));
  const count = Math.ceil(totalBytes / chunkBytes);
  let start = 0;
  return Array.from({ length: count }, (_, index) => {
    const end = Math.min(totalBytes - 1, start + chunkBytes - 1);
    const segment = { index, start, end };
    start = end + 1;
    return segment;
  });
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

function appendSuspiciousZeroRange(ranges: Segment[], start: number): void {
  if (ranges.length >= MAX_ZERO_RUN_VERIFICATIONS_PER_SEGMENT) {
    return;
  }
  const candidate = {
    index: ranges.length,
    start,
    end: start + SUSPICIOUS_ZERO_RUN_BYTES - 1
  };
  const previous = ranges[ranges.length - 1];
  if (previous && candidate.start <= previous.end + 1) {
    return;
  }
  ranges.push(candidate);
}

function collectSuspiciousZeroRanges(
  chunk: Buffer,
  chunkStart: number,
  previousTrailingZeros: number,
  ranges: Segment[]
): number {
  let leadingZeros = 0;
  while (leadingZeros < chunk.length && chunk[leadingZeros] === 0) {
    leadingZeros += 1;
  }
  if (previousTrailingZeros + leadingZeros >= SUSPICIOUS_ZERO_RUN_BYTES) {
    appendSuspiciousZeroRange(ranges, chunkStart - previousTrailingZeros);
  }

  let searchAt = 0;
  while (ranges.length < MAX_ZERO_RUN_VERIFICATIONS_PER_SEGMENT) {
    const foundAt = chunk.indexOf(ZERO_RUN_SENTINEL, searchAt);
    if (foundAt < 0) {
      break;
    }
    appendSuspiciousZeroRange(ranges, chunkStart + foundAt);
    searchAt = foundAt + SUSPICIOUS_ZERO_RUN_BYTES;
  }

  let trailingZeros = 0;
  for (let index = chunk.length - 1; index >= 0 && chunk[index] === 0; index -= 1) {
    trailingZeros += 1;
    if (trailingZeros >= SUSPICIOUS_ZERO_RUN_BYTES - 1) {
      break;
    }
  }
  return trailingZeros;
}

async function hashFileRange(
  handle: fs.promises.FileHandle,
  start: number,
  length: number,
  signal: AbortSignal
): Promise<Buffer> {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(Math.min(SEGMENT_READBACK_BUFFER_BYTES, Math.max(1, length)));
  let position = start;
  let remaining = length;
    while (remaining > 0) {
      if (signal.aborted) {
        throw abortError();
      }
      const requested = Math.min(buffer.length, remaining);
      const { bytesRead } = await withProcessingBudget("downloadWrites", signal, () =>
        runtimePerformance.measure("proxy.readback.read", () => handle.read(buffer, 0, requested, position)));
      if (bytesRead <= 0) {
        throw new Error("proxy_segment_readback_underflow");
      }
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
      remaining -= bytesRead;
    }
    return hash.digest();
}

async function readRangeOnce(
  target: URL,
  proxy: ProxyEndpoint,
  range: Segment,
  totalBytes: number,
  signal: AbortSignal,
  options: Required<Pick<ProxySegmentedDownloadOptions, "skipTlsVerify" | "connectTimeoutMs" | "idleTimeoutMs">>,
  onTrafficBytes?: (bytes: number) => void
): Promise<Buffer> {
  const opened = await openRangeResponse(
    target,
    proxy,
    range.start,
    range.end,
    signal,
    options.skipTlsVerify,
    options.connectTimeoutMs,
    options.idleTimeoutMs
  );
  const response = opened.response;
  const status = response.statusCode || 0;
  if (status >= 400) {
    opened.dispose();
    throw new OriginHttpError(status);
  }
  const expectedBytes = range.end - range.start + 1;
  const contentRange = parseContentRange(response.headers["content-range"]);
  const contentLength = Number(response.headers["content-length"] || 0);
  if (isChangedRepresentation(status, contentRange, range.start, range.end, totalBytes, contentLength)) {
    recordRepresentationChange("verification", target, proxy, totalBytes, contentRange!);
    opened.dispose();
    throw new Error("proxy_representation_changed");
  }
  if (status !== 206
    || !contentRange
    || contentRange.start !== range.start
    || contentRange.end !== range.end
    || contentRange.total !== totalBytes
    || (contentLength > 0 && contentLength !== expectedBytes)) {
    opened.dispose();
    throw new Error("proxy_verification_range_mismatch");
  }

  const chunks: Buffer[] = [];
  let received = 0;
  try {
    for await (const rawChunk of response) {
      if (signal.aborted) {
        throw abortError();
      }
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      onTrafficBytes?.(chunk.length);
      received += chunk.length;
      if (received > expectedBytes) {
        throw new Error("proxy_verification_range_overflow");
      }
      chunks.push(chunk);
    }
    if (received !== expectedBytes) {
      throw new Error("proxy_verification_range_underflow");
    }
    return Buffer.concat(chunks, received);
  } finally {
    opened.dispose();
  }
}

async function downloadSegmentOnce(
  target: URL,
  handle: fs.promises.FileHandle,
  segment: Segment,
  proxy: ProxyEndpoint,
  signal: AbortSignal,
  options: Required<Pick<ProxySegmentedDownloadOptions, "skipTlsVerify" | "connectTimeoutMs" | "idleTimeoutMs">>,
  callbacks: Pick<ProxySegmentedDownloadOptions, "waitWhilePaused" | "onTrafficBytes" | "onProgress"> & { onTransferWritten?: () => void; withDiskActivity: DiskOperation },
  totalBytes: number,
  currentProgress: () => number
): Promise<SegmentDownloadOutcome> {
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
  const status = response.statusCode || 0;
  if (status >= 400) {
    opened.dispose();
    throw new OriginHttpError(status);
  }
  const expectedBytes = segment.end - segment.start + 1;
  const range = parseContentRange(response.headers["content-range"]);
  const contentLength = Number(response.headers["content-length"] || 0);
  if (isChangedRepresentation(status, range, segment.start, segment.end, totalBytes, contentLength)) {
    recordRepresentationChange("segment", target, proxy, totalBytes, range!);
    opened.dispose();
    throw new Error("proxy_representation_changed");
  }
  if (status !== 206
    || !range
    || range.start !== segment.start
    || range.end !== segment.end
    || range.total !== totalBytes
    || (contentLength > 0 && contentLength !== expectedBytes)) {
    opened.dispose();
    throw new Error("proxy_range_mismatch");
  }

  let received = 0;
  const receivedHash = createHash("sha256");
  const suspiciousZeroRanges: Segment[] = [];
  let trailingZeros = 0;
  let writeBuffer = Buffer.allocUnsafe(Math.min(SEGMENT_WRITE_BUFFER_BYTES, expectedBytes));
  let bufferedBytes = 0;
  let writtenBytes = 0;
  let lastFlushAt = performance.now();
  const flushBuffered = async (): Promise<void> => {
    if (!bufferedBytes) return;
    if (signal.aborted) throw abortError();
    const length = bufferedBytes;
    response.setTimeout(0);
    try {
      await callbacks.withDiskActivity(() => withProcessingBudget("downloadWrites", signal, () => runtimePerformance.measure("proxy.write", () => writeBufferAt(handle, writeBuffer.subarray(0, length), segment.start + writtenBytes))));
    } finally {
      if (!response.destroyed) response.setTimeout(options.idleTimeoutMs);
    }
    writtenBytes += length;
    bufferedBytes = 0;
    lastFlushAt = performance.now();
    callbacks.onProgress?.(length, currentProgress() + length, totalBytes);
  };
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
      receivedHash.update(chunk);
      trailingZeros = collectSuspiciousZeroRanges(
        chunk,
        segment.start + received,
        trailingZeros,
        suspiciousZeroRanges
      );
      received += chunk.length;
      let offset = 0;
      while (offset < chunk.length) {
        const length = Math.min(writeBuffer.length - bufferedBytes, chunk.length - offset);
        chunk.copy(writeBuffer, bufferedBytes, offset, offset + length);
        bufferedBytes += length;
        offset += length;
        if (bufferedBytes === writeBuffer.length) await flushBuffered();
      }
      if (performance.now() - lastFlushAt >= SEGMENT_WRITE_FLUSH_INTERVAL_MS) await flushBuffered();
    }
    if (received !== expectedBytes) {
      throw new Error("proxy_segment_underflow");
    }
    await flushBuffered();
  } finally {
    opened.dispose();
    writeBuffer = Buffer.alloc(0);
  }
  callbacks.onTransferWritten?.();
  const writtenHash = await callbacks.withDiskActivity(async () => {
    const releaseReadback = await runtimePerformance.measure("proxy.readback.wait", () => sharedReadbackLimiter.acquire(signal));
    try {
      return await runtimePerformance.measure("proxy.readback", () => hashFileRange(handle, segment.start, expectedBytes, signal));
    } finally {
      releaseReadback();
    }
  });
  const networkHash = receivedHash.digest();
  if (!timingSafeEqual(networkHash, writtenHash)) {
    throw new SegmentValidationError("readback_mismatch", segment.start, segment.end, segment);
  }
  return { bytes: received, suspiciousZeroRanges };
}

export async function downloadWithProxySegments(options: ProxySegmentedDownloadOptions): Promise<ProxySegmentedDownloadResult> {
  let pendingDiskOperations = 0;
  const withDiskActivity: DiskOperation = async (operation) => {
    if (++pendingDiskOperations === 1) options.onDiskActivity?.(true);
    try { return await operation(); }
    finally { if (--pendingDiskOperations === 0) options.onDiskActivity?.(false); }
  };
  const result = await downloadWithProxySegmentsOnce(options, withDiskActivity);
  if (result.status !== "fallback" || result.errorCode !== "proxy_representation_changed") return result;
  if (options.signal.aborted) throw abortError();
  try { options.onRepresentationRetry?.(); } catch {}
  if (options.signal.aborted) throw abortError();
  return downloadWithProxySegmentsOnce(options, withDiskActivity);
}

async function downloadWithProxySegmentsOnce(options: ProxySegmentedDownloadOptions, withDiskActivity: DiskOperation): Promise<ProxySegmentedDownloadResult> {
  const proxyPath = String(options.proxyListPath || "").trim();
  if (!proxyPath) {
    return { status: "fallback", reason: "proxy_file_unavailable" };
  }
  const loaded = await withDiskActivity(() => loadProxyFile(proxyPath));
  if (loaded.status === "unavailable") {
    return { status: "fallback", reason: "proxy_file_unavailable" };
  }
  if (loaded.status === "empty") {
    return { status: "fallback", reason: "no_valid_proxies" };
  }
  const poolKey = path.resolve(proxyPath);
  const requestedConnections = normalizeProxyConnectionLimit(options.connections);
  const totalConnectionLimit = normalizeProxyConnectionLimit(options.totalConnectionLimit ?? requestedConnections, requestedConnections);
  sharedProxyCoordinator.setConnectionLimit(totalConnectionLimit);
  const reservedProxyIndex = Math.max(0, Math.floor(options.reservedProxyIndex || 0));
  const reservedProxy = reservedProxyIndex > 0 ? loaded.proxies[reservedProxyIndex - 1] : null;
  const reservedProxyKey = reservedProxy ? proxyEndpointKey(reservedProxy) : "";
  const segmentProxies = reservedProxyKey
    ? loaded.proxies.filter((proxy) => proxyEndpointKey(proxy) !== reservedProxyKey)
    : loaded.proxies;

  let target: URL;
  try {
    target = new URL(options.directUrl);
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return { status: "fallback", reason: "proxy_unavailable" };
    }
  } catch {
    return { status: "fallback", reason: "proxy_unavailable" };
  }

  const groupId = String(options.downloadId || options.targetPath || randomUUID());
  const unregisterGroup = sharedProxyCoordinator.registerGroup(groupId, target.origin);
  const releaseConnections = sharedProxyConnections.retain(totalConnectionLimit);
  try {
  const normalized = {
    skipTlsVerify: Boolean(options.skipTlsVerify),
    connectTimeoutMs: Math.max(1_000, Math.floor(options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS)),
    idleTimeoutMs: Math.max(2_000, Math.floor(options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS)),
    proxyAttempts: Math.max(1, Math.min(10, Math.floor(options.proxyAttempts ?? DEFAULT_PROXY_ATTEMPTS)))
  };
  const probe = await probeRangeSupport(target, poolKey, groupId, segmentProxies, options.signal, normalized, options.onTrafficBytes);
  if (probe.status === "unsupported") {
    return { status: "fallback", reason: "range_unsupported" };
  }
  if (probe.status === "unavailable") {
    return { status: "fallback", reason: "proxy_unavailable", ...(probe.errorCode ? { errorCode: probe.errorCode } : {}) };
  }
  if (probe.status === "origin_error") {
    return { status: "fallback", reason: "origin_http_error", httpStatus: probe.httpStatus };
  }

  const minSegmentBytes = Math.max(1, Math.floor(options.minSegmentBytes ?? DEFAULT_MIN_SEGMENT_BYTES));
  const connections = Math.min(requestedConnections, segmentProxies.length, Math.floor(probe.totalBytes / minSegmentBytes));
  if (connections < 2) {
    return {
      status: "fallback",
      reason: segmentProxies.length < 2 ? "not_enough_proxies" : "file_too_small"
    };
  }

  await withDiskActivity(() => fs.promises.mkdir(path.dirname(options.targetPath), { recursive: true }));
  try {
    const targetStat = await withDiskActivity(() => fs.promises.stat(options.targetPath));
    if (targetStat.size > 0) {
      return { status: "fallback", reason: "segment_failed" };
    }
    await withDiskActivity(() => fs.promises.rm(options.targetPath, { force: true }));
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
  let fileHandle: fs.promises.FileHandle | null = null;
  const updateProgress = (deltaBytes: number, _downloadedBytes: number, totalBytes: number): void => {
    committedProgress = Math.max(0, Math.min(totalBytes, committedProgress + deltaBytes));
    options.onProgress?.(deltaBytes, committedProgress, totalBytes);
  };

  try {
    await withDiskActivity(async () => {
    fileHandle = await fs.promises.open(tempPath, "wx+");
    tempCreated = true;
      if (await markFileSparse(tempPath)) sparseAllocations.ok += 1;
      else sparseAllocations.failed += 1;
      await runtimePerformance.measure("proxy.allocate", () => fileHandle!.truncate(probe.totalBytes));
    });

    const segments = buildSegments(probe.totalBytes, connections, minSegmentBytes);
    const segmentController = new AbortController();
    const cascadeAbort = (): void => segmentController.abort("parent_abort");
    options.signal.addEventListener("abort", cascadeAbort, { once: true });
    const signal = AbortSignal.any([options.signal, segmentController.signal]);
    setMaxListeners(0, signal);

    const downloadSegment = async (segment: Segment): Promise<number> => {
      const excluded = new Set<string>();
      let lastError: unknown = null;
      for (let attempt = 0; attempt < normalized.proxyAttempts; attempt += 1) {
        if (signal.aborted) {
          throw abortError();
        }
        let lease = await runtimePerformance.measure("proxy.wait", () => sharedProxyCoordinator.acquire(poolKey, groupId, segmentProxies, excluded, signal));
        if (!lease) {
          break;
        }
        const primaryProxy = lease.proxy;
        excluded.add(proxyEndpointKey(primaryProxy));
        let attemptProgress = 0;
        const startedAt = Date.now();
        let transferDurationMs = 0;
        try {
          const outcome = await downloadSegmentOnce(
            target,
            fileHandle!,
            segment,
            primaryProxy,
            signal,
            normalized,
            {
              waitWhilePaused: options.waitWhilePaused,
              withDiskActivity,
              onTrafficBytes: options.onTrafficBytes,
              onTransferWritten: () => {
                transferDurationMs = Math.max(1, Date.now() - startedAt);
                lease?.releaseSlot();
              },
              onProgress: (deltaBytes, downloadedBytes, totalBytes) => {
                attemptProgress += deltaBytes;
                updateProgress(deltaBytes, downloadedBytes, totalBytes);
              }
            },
            probe.totalBytes,
            () => committedProgress
          );
          lease.release({
            succeeded: true,
            transferredBytes: outcome.bytes,
            durationMs: transferDurationMs || Math.max(1, Date.now() - startedAt)
          });
          lease = null;

          if (outcome.suspiciousZeroRanges.length > 0) {
            lease = await runtimePerformance.measure("proxy.wait", () => sharedProxyCoordinator.acquire(poolKey, groupId, segmentProxies, excluded, signal));
            if (!lease) {
              throw new Error("proxy_zero_run_verification_unavailable");
            }
            const verificationStartedAt = Date.now();
            let verificationBytes = 0;
            for (const suspiciousRange of outcome.suspiciousZeroRanges) {
              const verification = await readRangeOnce(
                target,
                lease.proxy,
                suspiciousRange,
                probe.totalBytes,
                signal,
                normalized,
                (bytes) => {
                  verificationBytes += bytes;
                  options.onTrafficBytes?.(bytes);
                }
              );
              if (!timingSafeEqual(verification, ZERO_RUN_SENTINEL)) {
                lease.release({
                  succeeded: true,
                  transferredBytes: verificationBytes,
                  durationMs: Math.max(1, Date.now() - verificationStartedAt)
                });
                lease = null;
                sharedProxyCoordinator.reportContentMismatch(primaryProxy);
                throw new SegmentValidationError(
                  "zero_run_mismatch",
                  suspiciousRange.start,
                  suspiciousRange.end,
                  segment
                );
              }
            }
            lease.release({
              succeeded: true,
              transferredBytes: verificationBytes,
              durationMs: Math.max(1, Date.now() - verificationStartedAt)
            });
            lease = null;
          }

          return outcome.bytes;
        } catch (error) {
          const originError = error instanceof OriginHttpError;
          const representationChanged = error instanceof Error && error.message === "proxy_representation_changed";
          lease?.release({ succeeded: originError || representationChanged || signal.aborted, reason: proxyFailureCode(error) });
          lease = null;
          if (originError) {
            sharedProxyCoordinator.reportOriginStatus(error.statusCode, target.origin);
          }
          if (attemptProgress > 0) {
            updateProgress(-attemptProgress, committedProgress - attemptProgress, probe.totalBytes);
          }
          if (options.signal.aborted || isDiskError(error)) {
            throw error;
          }
          if (error instanceof SegmentValidationError) {
            try {
              options.onValidationRetry?.({
                reason: error.reason,
                rangeStart: error.rangeStart,
                rangeEnd: error.rangeEnd,
                segmentStart: error.segment.start,
                segmentEnd: error.segment.end
              });
            } catch {
            }
          }
          lastError = error;
        }
      }
      throw lastError || new Error("proxy_segment_failed");
    };

    let nextSegmentIndex = 0;
    const tasks = Array.from({ length: Math.min(connections, segments.length) }, async () => {
      let downloadedBytes = 0;
      while (!signal.aborted) {
        const segmentIndex = nextSegmentIndex;
        nextSegmentIndex += 1;
        const segment = segments[segmentIndex];
        if (!segment) break;
        downloadedBytes += await downloadSegment(segment);
      }
      return downloadedBytes;
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
      const originFailure = settled.find((result): result is PromiseRejectedResult => (
        result.status === "rejected" && result.reason instanceof OriginHttpError
      ));
      if (originFailure) {
        return {
          status: "fallback",
          reason: "origin_http_error",
          httpStatus: (originFailure.reason as OriginHttpError).statusCode
        };
      }
      const primaryFailure = settled.find((result): result is PromiseRejectedResult => (
        result.status === "rejected" && !String(result.reason).includes("aborted:proxy_download")
      ));
      return { status: "fallback", reason: "segment_failed", errorCode: proxyFailureCode((primaryFailure || failed).reason) };
    }

    return await withDiskActivity(async () => {
    await runtimePerformance.measure("proxy.flush", () => fileHandle!.datasync());
    const finalStat = await fileHandle!.stat();
    if (finalStat.size !== probe.totalBytes) {
      return { status: "fallback", reason: "segment_failed" } as const;
    }
    await runtimePerformance.measure("proxy.close", () => fileHandle!.close());
    fileHandle = null;
    await runtimePerformance.measure("proxy.commit", () => fs.promises.rename(tempPath, options.targetPath));
    tempCreated = false;
    return { status: "completed", totalBytes: probe.totalBytes, connections } as const;
    });
  } catch (error) {
    if (options.signal.aborted || String(error).includes("aborted:proxy_download")) {
      throw abortError();
    }
    if (isDiskError(error)) {
      throw error;
    }
    return { status: "fallback", reason: "segment_failed", errorCode: proxyFailureCode(error) };
  } finally {
    if (fileHandle) {
      await withDiskActivity(() => runtimePerformance.measure("proxy.close", () => fileHandle!.close()));
      fileHandle = null;
    }
    if (tempCreated) {
      try {
        await withDiskActivity(() => fs.promises.rm(tempPath, { force: true }));
      } catch {
      }
    }
    if (committedProgress > 0 && tempCreated) {
      updateProgress(-committedProgress, 0, probe.totalBytes);
    }
  }
  } finally {
    releaseConnections();
    unregisterGroup();
  }
}
