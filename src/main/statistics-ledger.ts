import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { getProviderUsageDayKey } from "../shared/provider-daily-limits";
import type {
  DebridProvider,
  StatisticsAccountMinuteUsage,
  StatisticsAccountUsage,
  StatisticsDayBucket,
  StatisticsLedger,
  StatisticsMinuteBucket,
  StatisticsProviderBucket,
  StatisticsRolling24Hours
} from "../shared/types";
export { aggregateStatisticsRange } from "../shared/statistics-aggregation";

const providers = new Set<DebridProvider>([
  "realdebrid",
  "megadebrid",
  "megadebrid-api",
  "megadebrid-web",
  "bestdebrid",
  "alldebrid",
  "deepbrid",
  "ddownload",
  "onefichier",
  "debridlink",
  "linksnappy"
]);

const renameRetryDelaysMs = [15, 40, 90];
const minuteMs = 60_000;
const rollingWindowMs = 24 * 60 * minuteMs;
const retainedMinuteCount = 48 * 60;
const maximumAccountIdLength = 128;
const maximumAccountLabelLength = 96;

const providerLabels: Record<DebridProvider, string> = {
  realdebrid: "Real-Debrid",
  megadebrid: "Mega-Debrid",
  "megadebrid-api": "Mega-Debrid API",
  "megadebrid-web": "Mega-Debrid Web",
  bestdebrid: "BestDebrid",
  alldebrid: "AllDebrid",
  deepbrid: "Deepbrid",
  ddownload: "DDownload",
  onefichier: "1Fichier",
  debridlink: "Debrid-Link",
  linksnappy: "LinkSnappy"
};

function finiteNonNegative(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function finiteInteger(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.max(-Number.MAX_SAFE_INTEGER, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(number)));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function minuteStart(epochMs: number): number {
  return Math.floor(finiteNonNegative(epochMs) / minuteMs) * minuteMs;
}

function validAccountId(value: unknown): string | null {
  const id = String(value || "").trim();
  return id.length > 0
    && id.length <= maximumAccountIdLength
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)
    ? id
    : null;
}

function maskEmailLikeLabel(value: string): string {
  const match = /^([^@\s]+)@([^@\s]+)$/.exec(value);
  if (!match) {
    return value;
  }
  const local = match[1];
  const hidden = "*".repeat(Math.max(3, Math.min(8, local.length - 1)));
  return `${local.slice(0, 1)}${hidden}@${match[2]}`;
}

function safeAccountLabel(value: unknown, provider: DebridProvider): string {
  const clean = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumAccountLabelLength);
  return maskEmailLikeLabel(clean || providerLabels[provider]);
}

function fallbackAccountId(provider: DebridProvider): string {
  return `provider:${provider}`;
}

function normalizeMinuteAccounts(value: unknown): Record<string, StatisticsAccountMinuteUsage> {
  const accounts: Record<string, StatisticsAccountMinuteUsage> = {};
  for (const [rawId, rawUsage] of Object.entries(asRecord(value) ?? {})) {
    const id = validAccountId(rawId);
    const usage = asRecord(rawUsage);
    const provider = String(usage?.provider || "") as DebridProvider;
    const bytes = finiteNonNegative(usage?.bytes);
    if (!id || !providers.has(provider) || bytes <= 0) {
      continue;
    }
    accounts[id] = {
      provider,
      label: safeAccountLabel(usage?.label, provider),
      bytes
    };
  }
  return accounts;
}

function minimumRetainedMinute(now: number): number {
  return minuteStart(now) - ((retainedMinuteCount - 1) * minuteMs);
}

function normalizeMinutes(value: unknown, now: number): StatisticsMinuteBucket[] {
  const currentMinute = minuteStart(now);
  const minimumMinute = minimumRetainedMinute(now);
  const buckets = new Map<number, StatisticsMinuteBucket>();
  for (const rawValue of Array.isArray(value) ? value : []) {
    const record = asRecord(rawValue);
    const minute = minuteStart(Number(record?.minute));
    if (!record || minute < minimumMinute || minute > currentMinute) {
      continue;
    }
    const accounts = normalizeMinuteAccounts(record.accounts);
    if (Object.keys(accounts).length === 0) {
      continue;
    }
    const target = buckets.get(minute) ?? { minute, downloadedBytes: 0, accounts: {} };
    for (const [id, usage] of Object.entries(accounts)) {
      const existing = target.accounts[id];
      if (existing && existing.provider === usage.provider) {
        existing.bytes += usage.bytes;
        existing.label = usage.label;
      } else {
        target.accounts[id] = { ...usage };
      }
    }
    target.downloadedBytes = Object.values(target.accounts).reduce((total, usage) => total + usage.bytes, 0);
    buckets.set(minute, target);
  }
  return [...buckets.values()]
    .sort((left, right) => left.minute - right.minute)
    .slice(-retainedMinuteCount);
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

function normalizeProviderSeedBaseline(value: unknown): Partial<Record<DebridProvider, number>> | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const baseline: Partial<Record<DebridProvider, number>> = {};
  for (const [provider, bytes] of Object.entries(record)) {
    if (providers.has(provider as DebridProvider)) {
      baseline[provider as DebridProvider] = finiteInteger(bytes);
    }
  }
  return baseline;
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
  return { version: 2, startedAt: now, minuteTrackingStartedAt: now, days: [], minutes: [] };
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
  const providerSeedSuppressedDay = /^\d{4}-\d{2}-\d{2}$/.test(String(record.providerSeedSuppressedDay || ""))
    ? String(record.providerSeedSuppressedDay)
    : undefined;
  const providerBytesOnlyDays = [...new Set(
    (Array.isArray(record.providerBytesOnlyDays) ? record.providerBytesOnlyDays : [])
      .map((day) => String(day || ""))
      .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day) && byDay.has(day))
  )].sort();
  return {
    version: 2,
    startedAt: finiteNonNegative(record.startedAt) || now,
    minuteTrackingStartedAt: Math.min(finiteNonNegative(record.minuteTrackingStartedAt) || now, now),
    providerSeedSuppressedDay,
    providerSeedBaselineBytes: providerSeedSuppressedDay
      ? normalizeProviderSeedBaseline(record.providerSeedBaselineBytes)
      : undefined,
    providerBytesOnlyDays: providerBytesOnlyDays.length > 0 ? providerBytesOnlyDays : undefined,
    days: [...byDay.values()].sort((left, right) => left.day.localeCompare(right.day)),
    minutes: normalizeMinutes(record.minutes, now)
  };
}

export function projectStatisticsLedger(ledger: StatisticsLedger, now = Date.now()): StatisticsLedger {
  return normalizeStatisticsLedger({ ...ledger, minutes: [] }, now);
}

export function addStatisticsAccountBytesInPlace(
  ledger: StatisticsLedger,
  provider: DebridProvider,
  byteDelta: number,
  accountId?: string,
  accountLabel?: string,
  epochMs = Date.now()
): StatisticsAccountUsage | null {
  const bytes = finiteNonNegative(byteDelta);
  if (bytes <= 0 || !providers.has(provider)) {
    return null;
  }
  const minute = minuteStart(epochMs);
  const id = validAccountId(accountId) ?? fallbackAccountId(provider);
  const label = safeAccountLabel(accountLabel, provider);
  let bucket: StatisticsMinuteBucket | undefined = ledger.minutes[ledger.minutes.length - 1];
  if (!bucket || bucket.minute !== minute) {
    ledger.minutes = ledger.minutes.filter((entry) => entry.minute >= minimumRetainedMinute(epochMs) && entry.minute <= minute);
    bucket = ledger.minutes.find((entry) => entry.minute === minute);
    if (!bucket) {
      bucket = { minute, downloadedBytes: 0, accounts: {} };
      ledger.minutes.push(bucket);
      ledger.minutes.sort((left, right) => left.minute - right.minute);
      if (ledger.minutes.length > retainedMinuteCount) {
        ledger.minutes.splice(0, ledger.minutes.length - retainedMinuteCount);
      }
    }
  }
  if (!bucket) {
    return null;
  }
  const existing = bucket.accounts[id];
  if (existing && existing.provider === provider) {
    existing.bytes += bytes;
    existing.label = label;
  } else {
    bucket.accounts[id] = { provider, label, bytes };
  }
  bucket.downloadedBytes = Object.values(bucket.accounts).reduce((total, usage) => total + usage.bytes, 0);
  return { id, provider, label, bytes };
}

function aggregateRollingAccountStatistics(ledger: StatisticsLedger, now: number): StatisticsRolling24Hours {
  const currentMinute = minuteStart(now);
  const from = minuteStart(now - rollingWindowMs);
  const accounts = new Map<string, StatisticsAccountUsage>();
  for (const bucket of ledger.minutes) {
    if (bucket.minute < from || bucket.minute > currentMinute) {
      continue;
    }
    for (const [id, usage] of Object.entries(bucket.accounts)) {
      const existing = accounts.get(id);
      if (existing && existing.provider === usage.provider) {
        existing.bytes += usage.bytes;
        existing.label = usage.label;
      } else {
        accounts.set(id, { id, provider: usage.provider, label: usage.label, bytes: usage.bytes });
      }
    }
  }
  const rows = [...accounts.values()].sort((left, right) =>
    right.bytes - left.bytes
    || left.label.localeCompare(right.label, "de-DE", { sensitivity: "base" })
    || left.id.localeCompare(right.id)
  );
  return {
    from,
    to: now,
    downloadedBytes: rows.reduce((total, account) => total + account.bytes, 0),
    accounts: rows
  };
}

export class RollingAccountStatisticsAccumulator {
  private ledger: StatisticsLedger;
  private minute = -1;
  private aggregate: StatisticsRolling24Hours;

  public constructor(ledger: StatisticsLedger, now = Date.now()) {
    this.ledger = ledger;
    this.aggregate = aggregateRollingAccountStatistics(ledger, now);
    this.minute = minuteStart(now);
  }

  public record(
    provider: DebridProvider,
    byteDelta: number,
    accountId?: string,
    accountLabel?: string,
    epochMs = Date.now()
  ): void {
    this.refresh(epochMs);
    const recorded = addStatisticsAccountBytesInPlace(
      this.ledger,
      provider,
      byteDelta,
      accountId,
      accountLabel,
      epochMs
    );
    if (!recorded || minuteStart(epochMs) < this.aggregate.from || minuteStart(epochMs) > this.minute) {
      return;
    }
    const existing = this.aggregate.accounts.find((account) => account.id === recorded.id && account.provider === recorded.provider);
    if (existing) {
      existing.bytes += recorded.bytes;
      existing.label = recorded.label;
    } else {
      this.aggregate.accounts.push({ ...recorded });
    }
    this.aggregate.downloadedBytes += recorded.bytes;
    this.aggregate.accounts.sort((left, right) =>
      right.bytes - left.bytes
      || left.label.localeCompare(right.label, "de-DE", { sensitivity: "base" })
      || left.id.localeCompare(right.id)
    );
    this.aggregate.to = epochMs;
  }

  public snapshot(now = Date.now()): StatisticsRolling24Hours {
    this.refresh(now);
    return {
      ...this.aggregate,
      to: now,
      accounts: this.aggregate.accounts.map((account) => ({ ...account }))
    };
  }

  public reset(ledger: StatisticsLedger, now = Date.now()): void {
    this.ledger = ledger;
    this.minute = minuteStart(now);
    this.aggregate = aggregateRollingAccountStatistics(ledger, now);
  }

  private refresh(now: number): void {
    const currentMinute = minuteStart(now);
    if (currentMinute === this.minute) {
      return;
    }
    this.minute = currentMinute;
    this.aggregate = aggregateRollingAccountStatistics(this.ledger, now);
  }
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

function markProviderBytesOnlyDay(ledger: StatisticsLedger, dayKey: string): StatisticsLedger {
  return {
    ...ledger,
    providerBytesOnlyDays: [...new Set([...(ledger.providerBytesOnlyDays ?? []), dayKey])].sort()
  };
}

export function seedStatisticsDayProviderBytes(
  ledger: StatisticsLedger,
  usage: Partial<Record<DebridProvider, number>>,
  epochMs = Date.now()
): StatisticsLedger {
  const normalized = normalizeStatisticsLedger(ledger, epochMs);
  const dayKey = getProviderUsageDayKey(epochMs);
  if (normalized.providerSeedSuppressedDay === dayKey) {
    const baseline = normalized.providerSeedBaselineBytes;
    if (!baseline) {
      return normalized;
    }
    const deltas: Partial<Record<DebridProvider, number>> = {};
    for (const [provider, rawBytes] of Object.entries(usage) as Array<[DebridProvider, number | undefined]>) {
      if (!providers.has(provider)) continue;
      const delta = Math.max(0, finiteNonNegative(rawBytes) - finiteInteger(baseline[provider]));
      if (delta > 0) {
        deltas[provider] = delta;
      }
    }
    if (Object.keys(deltas).length === 0) {
      return normalized;
    }
    let recovered = false;
    const seeded = updateDay(normalized, epochMs, (day) => {
      for (const [provider, bytes] of Object.entries(deltas) as Array<[DebridProvider, number]>) {
        const existing = day.providers[provider] ?? emptyProviderBucket();
        recovered ||= bytes > existing.bytes;
        existing.bytes = Math.max(existing.bytes, bytes);
        day.providers[provider] = existing;
      }
      day.downloadedBytes = Math.max(
        day.downloadedBytes,
        Object.values(day.providers).reduce((total, bucket) => total + finiteNonNegative(bucket?.bytes), 0)
      );
    });
    return recovered ? markProviderBytesOnlyDay(seeded, dayKey) : seeded;
  }
  let recovered = false;
  const seeded = updateDay(normalized, epochMs, (day) => {
    for (const [provider, rawBytes] of Object.entries(usage) as Array<[DebridProvider, number | undefined]>) {
      if (!providers.has(provider)) continue;
      const bytes = finiteNonNegative(rawBytes);
      const existing = day.providers[provider] ?? emptyProviderBucket();
      recovered ||= bytes > existing.bytes;
      existing.bytes = Math.max(existing.bytes, bytes);
      day.providers[provider] = existing;
    }
    day.downloadedBytes = Math.max(
      day.downloadedBytes,
      Object.values(day.providers).reduce((total, bucket) => total + finiteNonNegative(bucket?.bytes), 0)
    );
  });
  const current = normalized.providerSeedSuppressedDay && normalized.providerSeedSuppressedDay !== dayKey
    ? { ...seeded, providerSeedSuppressedDay: undefined, providerSeedBaselineBytes: undefined }
    : seeded;
  return recovered ? markProviderBytesOnlyDay(current, dayKey) : current;
}

export function rebaseStatisticsProviderSeedBaseline(
  ledger: StatisticsLedger,
  provider: DebridProvider,
  providerUsageBytes: number,
  epochMs = Date.now()
): StatisticsLedger {
  const normalized = normalizeStatisticsLedger(ledger, epochMs);
  const dayKey = getProviderUsageDayKey(epochMs);
  if (!providers.has(provider)) {
    return normalized;
  }
  const activeBaseline = normalized.providerSeedSuppressedDay === dayKey
    ? normalized.providerSeedBaselineBytes
    : {};
  if (normalized.providerSeedSuppressedDay === dayKey && activeBaseline === undefined) {
    return normalized;
  }
  const providerBytes = finiteNonNegative(
    normalized.days.find((day) => day.day === dayKey)?.providers[provider]?.bytes
  );
  return {
    ...normalized,
    providerSeedSuppressedDay: dayKey,
    providerSeedBaselineBytes: {
      ...activeBaseline,
      [provider]: finiteNonNegative(providerUsageBytes) - providerBytes
    }
  };
}

export function suppressStatisticsProviderSeedForDay(
  ledger: StatisticsLedger,
  epochMs = Date.now(),
  baselineUsage?: Partial<Record<DebridProvider, number>>
): StatisticsLedger {
  return {
    ...normalizeStatisticsLedger(ledger, epochMs),
    providerSeedSuppressedDay: getProviderUsageDayKey(epochMs),
    providerSeedBaselineBytes: baselineUsage === undefined
      ? undefined
      : normalizeProviderSeedBaseline(baselineUsage) ?? {}
  };
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
