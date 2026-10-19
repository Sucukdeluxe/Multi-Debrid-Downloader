import { getProviderUsageDayKey } from "./provider-daily-limits";
import type { DebridProvider, StatisticsLedger, StatisticsProviderBucket } from "./types";

export interface StatisticsAggregate {
  downloadedBytes: number;
  measuredBytes: number;
  completedFiles: number;
  failedFiles: number;
  activeDownloadMs: number;
  averageSpeedBps: number | null;
  coveredDays: number;
  startedAt: number;
  providers: Partial<Record<DebridProvider, StatisticsProviderBucket>>;
}

function emptyProviderBucket(): StatisticsProviderBucket {
  return { bytes: 0, completed: 0, failed: 0 };
}

function localWindowStart(nowMs: number, days: number): string {
  const date = new Date(nowMs);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - Math.max(0, Math.floor(days) - 1));
  return getProviderUsageDayKey(date.getTime());
}

export function aggregateStatisticsRange(
  ledger: StatisticsLedger | null | undefined,
  days: number | null,
  nowMs = Date.now()
): StatisticsAggregate {
  const endKey = getProviderUsageDayKey(nowMs);
  const startKey = days === null ? "0000-00-00" : localWindowStart(nowMs, days);
  const aggregate: StatisticsAggregate = {
    downloadedBytes: 0,
    measuredBytes: 0,
    completedFiles: 0,
    failedFiles: 0,
    activeDownloadMs: 0,
    averageSpeedBps: null,
    coveredDays: 0,
    startedAt: Math.max(0, Number(ledger?.startedAt) || nowMs),
    providers: {}
  };
  for (const day of ledger?.days ?? []) {
    if (day.day < startKey || day.day > endKey) continue;
    aggregate.coveredDays += 1;
    aggregate.downloadedBytes += day.downloadedBytes;
    aggregate.measuredBytes += day.measuredBytes;
    aggregate.completedFiles += day.completedFiles;
    aggregate.failedFiles += day.failedFiles;
    aggregate.activeDownloadMs += day.activeDownloadMs;
    for (const [provider, bucket] of Object.entries(day.providers) as Array<[DebridProvider, StatisticsProviderBucket | undefined]>) {
      if (!bucket) continue;
      const target = aggregate.providers[provider] ?? emptyProviderBucket();
      target.bytes += bucket.bytes;
      target.completed += bucket.completed;
      target.failed += bucket.failed;
      aggregate.providers[provider] = target;
    }
  }
  if (aggregate.activeDownloadMs > 0 && aggregate.measuredBytes > 0) {
    aggregate.averageSpeedBps = Math.floor(aggregate.measuredBytes * 1000 / aggregate.activeDownloadMs);
  }
  return aggregate;
}
