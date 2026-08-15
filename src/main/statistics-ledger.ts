import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { getProviderUsageDayKey } from "../shared/provider-daily-limits";
import type {
  DebridProvider,
  StatisticsDayBucket,
  StatisticsLedger,
  StatisticsProviderBucket
} from "../shared/types";
export { aggregateStatisticsRange } from "../shared/statistics-aggregation";

const providers = new Set<DebridProvider>([
  "realdebrid",
  "megadebrid",
  "megadebrid-api",
  "megadebrid-web",
  "bestdebrid",
  "alldebrid",
  "ddownload",
  "onefichier",
  "debridlink",
  "linksnappy"
]);

const renameRetryDelaysMs = [15, 40, 90];

function finiteNonNegative(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function emptyProviderBucket(): StatisticsProviderBucket {
  return { bytes: 0, completed: 0, failed: 0 };
}

function emptyDay(day: string): StatisticsDayBucket {
  return {
    day,
    downloadedBytes: 0,
    measuredBytes: 0,
    completedFiles: 0,
    failedFiles: 0,
    activeDownloadMs: 0,
    providers: {}
  };
}

function normalizeProviderBucket(value: unknown): StatisticsProviderBucket {
  const record = asRecord(value);
  return {
    bytes: finiteNonNegative(record?.bytes),
    completed: finiteNonNegative(record?.completed),
    failed: finiteNonNegative(record?.failed)
  };
}

function normalizeDay(value: unknown): StatisticsDayBucket | null {
  const record = asRecord(value);
  const day = String(record?.day || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return null;
  }
  const rawProviders = asRecord(record?.providers);
  const normalizedProviders: Partial<Record<DebridProvider, StatisticsProviderBucket>> = {};
  for (const [provider, bucket] of Object.entries(rawProviders ?? {})) {
    if (providers.has(provider as DebridProvider)) {
      normalizedProviders[provider as DebridProvider] = normalizeProviderBucket(bucket);
    }
  }
  return {
    day,
    downloadedBytes: finiteNonNegative(record?.downloadedBytes),
    measuredBytes: finiteNonNegative(record?.measuredBytes),
    completedFiles: finiteNonNegative(record?.completedFiles),
    failedFiles: finiteNonNegative(record?.failedFiles),
    activeDownloadMs: finiteNonNegative(record?.activeDownloadMs),
    providers: normalizedProviders
  };
}

export function createStatisticsLedger(now = Date.now()): StatisticsLedger {
  return { version: 1, startedAt: now, days: [] };
}

export function normalizeStatisticsLedger(value: unknown, now = Date.now()): StatisticsLedger {
  const record = asRecord(value);
  if (!record) {
    return createStatisticsLedger(now);
  }
  const byDay = new Map<string, StatisticsDayBucket>();
  for (const value of Array.isArray(record.days) ? record.days : []) {
    const day = normalizeDay(value);
    if (day) {
      byDay.set(day.day, day);
    }
  }
  return {
    version: 1,
    startedAt: finiteNonNegative(record.startedAt) || now,
    days: [...byDay.values()].sort((left, right) => left.day.localeCompare(right.day))
  };
}

function updateDay(
  ledger: StatisticsLedger,
  epochMs: number,
  update: (day: StatisticsDayBucket) => void
): StatisticsLedger {
  const normalized = normalizeStatisticsLedger(ledger, epochMs);
  const key = getProviderUsageDayKey(epochMs);
  const days = normalized.days.map((day) => ({ ...day, providers: { ...day.providers } }));
  let day = days.find((entry) => entry.day === key);
  if (!day) {
    day = emptyDay(key);
    days.push(day);
    days.sort((left, right) => left.day.localeCompare(right.day));
  }
  update(day);
  return { ...normalized, days };
}

function mutableDay(ledger: StatisticsLedger, epochMs: number): StatisticsDayBucket {
  const key = getProviderUsageDayKey(epochMs);
  let day = ledger.days.find((entry) => entry.day === key);
  if (!day) {
    day = emptyDay(key);
    ledger.days.push(day);
    ledger.days.sort((left, right) => left.day.localeCompare(right.day));
  }
  return day;
}

export function seedStatisticsDayProviderBytes(
  ledger: StatisticsLedger,
  usage: Partial<Record<DebridProvider, number>>,
  epochMs = Date.now()
): StatisticsLedger {
  return updateDay(ledger, epochMs, (day) => {
    for (const [provider, rawBytes] of Object.entries(usage) as Array<[DebridProvider, number | undefined]>) {
      if (!providers.has(provider)) continue;
      const bytes = finiteNonNegative(rawBytes);
      const existing = day.providers[provider] ?? emptyProviderBucket();
      existing.bytes = Math.max(existing.bytes, bytes);
      day.providers[provider] = existing;
    }
    day.downloadedBytes = Math.max(
      day.downloadedBytes,
      Object.values(day.providers).reduce((total, bucket) => total + finiteNonNegative(bucket?.bytes), 0)
    );
  });
}

export function recordStatisticsBytes(
  ledger: StatisticsLedger,
  provider: DebridProvider,
  byteDelta: number,
  epochMs = Date.now()
): StatisticsLedger {
  const bytes = finiteNonNegative(byteDelta);
  if (bytes <= 0 || !providers.has(provider)) {
    return normalizeStatisticsLedger(ledger, epochMs);
  }
  return updateDay(ledger, epochMs, (day) => {
    day.downloadedBytes += bytes;
    day.measuredBytes += bytes;
    const bucket = day.providers[provider] ?? emptyProviderBucket();
    bucket.bytes += bytes;
    day.providers[provider] = bucket;
  });
}

export function addStatisticsBytesInPlace(
  ledger: StatisticsLedger,
  provider: DebridProvider,
  byteDelta: number,
  epochMs = Date.now()
): void {
  const bytes = finiteNonNegative(byteDelta);
  if (bytes <= 0 || !providers.has(provider)) return;
  const day = mutableDay(ledger, epochMs);
  day.downloadedBytes += bytes;
  day.measuredBytes += bytes;
  const bucket = day.providers[provider] ?? emptyProviderBucket();
  bucket.bytes += bytes;
  day.providers[provider] = bucket;
}

export function recordStatisticsOutcome(
  ledger: StatisticsLedger,
  provider: DebridProvider | null | undefined,
  outcome: "completed" | "failed",
  epochMs = Date.now()
): StatisticsLedger {
  return updateDay(ledger, epochMs, (day) => {
    if (outcome === "completed") {
      day.completedFiles += 1;
    } else {
      day.failedFiles += 1;
    }
    if (!provider || !providers.has(provider)) {
      return;
    }
    const bucket = day.providers[provider] ?? emptyProviderBucket();
    bucket[outcome] += 1;
    day.providers[provider] = bucket;
  });
}

export function addStatisticsOutcomeInPlace(
  ledger: StatisticsLedger,
  provider: DebridProvider | null | undefined,
  outcome: "completed" | "failed",
  epochMs = Date.now()
): void {
  const day = mutableDay(ledger, epochMs);
  day[outcome === "completed" ? "completedFiles" : "failedFiles"] += 1;
  if (!provider || !providers.has(provider)) return;
  const bucket = day.providers[provider] ?? emptyProviderBucket();
  bucket[outcome] += 1;
  day.providers[provider] = bucket;
}

function startOfNextLocalDay(epochMs: number): number {
  const date = new Date(epochMs);
  date.setHours(24, 0, 0, 0);
  return date.getTime();
}

export function recordStatisticsActiveInterval(
  ledger: StatisticsLedger,
  startMs: number,
  endMs: number
): StatisticsLedger {
  let next = normalizeStatisticsLedger(ledger, startMs);
  let cursor = finiteNonNegative(startMs);
  const end = finiteNonNegative(endMs);
  while (cursor < end) {
    const boundary = Math.min(end, startOfNextLocalDay(cursor));
    const duration = Math.max(0, boundary - cursor);
    next = updateDay(next, cursor, (day) => {
      day.activeDownloadMs += duration;
    });
    cursor = boundary;
  }
  return next;
}

export function addStatisticsActiveIntervalInPlace(
  ledger: StatisticsLedger,
  startMs: number,
  endMs: number
): void {
  let cursor = finiteNonNegative(startMs);
  const end = finiteNonNegative(endMs);
  while (cursor < end) {
    const boundary = Math.min(end, startOfNextLocalDay(cursor));
    mutableDay(ledger, cursor).activeDownloadMs += Math.max(0, boundary - cursor);
    cursor = boundary;
  }
}

export function loadStatisticsLedger(filePath: string, now = Date.now()): StatisticsLedger {
  try {
    if (!fs.existsSync(filePath)) {
      return createStatisticsLedger(now);
    }
    return normalizeStatisticsLedger(JSON.parse(fs.readFileSync(filePath, "utf8")), now);
  } catch {
    return createStatisticsLedger(now);
  }
}

function statisticsPayload(ledger: StatisticsLedger): string {
  return JSON.stringify(normalizeStatisticsLedger(ledger), null, 2);
}

function renameErrorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error
    ? String((error as NodeJS.ErrnoException).code || "")
    : "";
}

function isTransientRenameError(error: unknown): boolean {
  return ["EPERM", "EACCES", "EBUSY"].includes(renameErrorCode(error));
}

function renameStatisticsFileSync(tempPath: string, filePath: string): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(tempPath, filePath);
      return;
    } catch (error) {
      if (!isTransientRenameError(error) || attempt >= renameRetryDelaysMs.length) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, renameRetryDelaysMs[attempt]);
    }
  }
}

async function renameStatisticsFile(tempPath: string, filePath: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fsp.rename(tempPath, filePath);
      return;
    } catch (error) {
      if (!isTransientRenameError(error) || attempt >= renameRetryDelaysMs.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, renameRetryDelaysMs[attempt]));
    }
  }
}

export function saveStatisticsLedger(filePath: string, ledger: StatisticsLedger): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  try {
    fs.writeFileSync(tempPath, statisticsPayload(ledger), "utf8");
    renameStatisticsFileSync(tempPath, filePath);
  } catch (error) {
    try { fs.rmSync(tempPath, { force: true }); } catch {}
    throw error;
  }
}

export async function saveStatisticsLedgerAsync(filePath: string, ledger: StatisticsLedger): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.async.tmp`;
  try {
    await fsp.writeFile(tempPath, statisticsPayload(ledger), "utf8");
    await renameStatisticsFile(tempPath, filePath);
  } catch (error) {
    try { await fsp.rm(tempPath, { force: true }); } catch {}
    throw error;
  }
}
