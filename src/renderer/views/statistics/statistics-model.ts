import { aggregateStatisticsRange, type StatisticsAggregate } from "../../../shared/statistics-aggregation";
import type { DebridProvider, DownloadItem, DownloadSummary, StatisticsProviderBucket, UiSnapshot } from "../../../shared/types";

export type StatisticsRange = "session" | "today" | "last24" | "week" | "month" | "all";
export type StatisticsCoverage = "partial" | "unavailable";
export type StatisticsSessionState = "empty" | "idle" | "active" | "paused";
export type StatisticsProviderScope = "current-queue" | "today" | "last24" | "week" | "month" | "all";
export type StatisticsUsageKind = "providers" | "accounts";
export type StatisticsMetricTone = "danger";

export interface StatisticsMetric {
  value: number | null;
  available: boolean;
  sourceLabel: string;
  tone?: StatisticsMetricTone;
}

export interface StatisticsProviderRow {
  id: string;
  label: string;
  bytes: number;
  completed: number | null;
  failed: number | null;
}

export interface StatisticsMetrics {
  downloadedBytes: StatisticsMetric;
  files: StatisticsMetric;
  successRate: StatisticsMetric;
  averageSpeedBps: StatisticsMetric;
  errors: StatisticsMetric;
}

export interface StatisticsViewModel {
  range: StatisticsRange;
  coverage: StatisticsCoverage;
  message: string;
  sessionState: StatisticsSessionState;
  metrics: StatisticsMetrics;
  providerScope: StatisticsProviderScope | null;
  usageKind: StatisticsUsageKind;
  providers: StatisticsProviderRow[];
  errorResetAvailable: boolean;
}

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

function normalizeNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function normalizeCount(value: number): number {
  return Math.floor(normalizeNonNegative(value));
}

function availableMetric(value: number, sourceLabel: string, tone?: StatisticsMetricTone): StatisticsMetric {
  return {
    value: normalizeNonNegative(value),
    available: true,
    sourceLabel,
    ...(tone ? { tone } : {})
  };
}

function unavailableMetric(sourceLabel: string): StatisticsMetric {
  return {
    value: null,
    available: false,
    sourceLabel
  };
}

function sortProviderRows(rows: StatisticsProviderRow[]): StatisticsProviderRow[] {
  return rows.sort((left, right) => right.bytes - left.bytes || left.id.localeCompare(right.id));
}

function deriveSessionState(snapshot: UiSnapshot): StatisticsSessionState {
  if (snapshot.session.paused) {
    return "paused";
  }
  if (snapshot.session.running) {
    return "active";
  }
  const hasItems = Object.keys(snapshot.session.items).length > 0;
  const summary = snapshot.summary;
  const hasSummary = Boolean(summary && normalizeCount(summary.success) + normalizeCount(summary.failed) + normalizeCount(summary.cancelled) > 0);
  return hasItems || hasSummary ? "idle" : "empty";
}

function countQueueResults(items: DownloadItem[]): { completed: number; failed: number } {
  let completed = 0;
  let failed = 0;
  for (const item of items) {
    if (item.status === "completed") {
      completed += 1;
    } else if (item.status === "failed") {
      failed += 1;
    }
  }
  return { completed, failed };
}

function countSummaryResults(summary: DownloadSummary): { completed: number; failed: number } {
  return {
    completed: normalizeCount(summary.success),
    failed: normalizeCount(summary.failed)
  };
}

function successRateMetric(completed: number, failed: number, sourceLabel: string): StatisticsMetric {
  const terminal = completed + failed;
  return terminal > 0
    ? availableMetric((completed / terminal) * 100, sourceLabel)
    : unavailableMetric("Keine abgeschlossenen oder fehlgeschlagenen Ergebnisse");
}

function deriveQueueProviders(items: DownloadItem[]): StatisticsProviderRow[] {
  const providers = new Map<DebridProvider, StatisticsProviderRow>();
  for (const item of items) {
    if (!item.provider) {
      continue;
    }
    const existing = providers.get(item.provider);
    const row = existing ?? {
      id: item.provider,
      label: item.providerLabel?.trim() || providerLabels[item.provider],
      bytes: 0,
      completed: 0,
      failed: 0
    };
    if (!existing && item.providerLabel?.trim()) {
      row.label = item.providerLabel.trim();
    }
    row.bytes += normalizeNonNegative(item.downloadedBytes);
    if (item.status === "completed") {
      row.completed = (row.completed ?? 0) + 1;
    } else if (item.status === "failed") {
      row.failed = (row.failed ?? 0) + 1;
    }
    providers.set(item.provider, row);
  }
  return sortProviderRows([...providers.values()]);
}

function deriveUsageProviders(
  usage: Partial<Record<DebridProvider, number>>,
  outcomes: Partial<Record<DebridProvider, StatisticsProviderBucket>> = {}
): StatisticsProviderRow[] {
  const rows: StatisticsProviderRow[] = [];
  const providerIds = new Set<DebridProvider>([
    ...(Object.keys(usage) as DebridProvider[]),
    ...(Object.keys(outcomes) as DebridProvider[])
  ]);
  for (const id of providerIds) {
    const rawBytes = usage[id];
    const bytes = normalizeNonNegative(rawBytes ?? 0);
    const completed = normalizeCount(outcomes[id]?.completed ?? 0);
    const failed = normalizeCount(outcomes[id]?.failed ?? 0);
    if ((bytes <= 0 && completed <= 0 && failed <= 0) || !providerLabels[id]) {
      continue;
    }
    rows.push({
      id,
      label: providerLabels[id],
      bytes,
      completed,
      failed
    });
  }
  return sortProviderRows(rows);
}

function deriveRollingAccounts(snapshot: UiSnapshot): StatisticsProviderRow[] {
  return (snapshot.stats.rolling24Hours?.accounts ?? []).map((account) => ({
    id: account.id,
    label: `${providerLabels[account.provider]} · ${account.label}`,
    bytes: normalizeNonNegative(account.bytes),
    completed: null,
    failed: null
  })).sort((left, right) => right.bytes - left.bytes || left.label.localeCompare(right.label, "de-DE", { sensitivity: "base" }) || left.id.localeCompare(right.id));
}

function aggregateMetrics(aggregate: StatisticsAggregate, sourceLabel: string): StatisticsMetrics {
  return {
    downloadedBytes: availableMetric(aggregate.downloadedBytes, sourceLabel),
    files: availableMetric(aggregate.completedFiles, sourceLabel),
    successRate: successRateMetric(aggregate.completedFiles, aggregate.failedFiles, sourceLabel),
    averageSpeedBps: aggregate.averageSpeedBps === null
      ? unavailableMetric("Noch keine aktive Downloadzeit mit übertragenen Daten erfasst")
      : availableMetric(aggregate.averageSpeedBps, sourceLabel),
    errors: availableMetric(
      aggregate.failedFiles,
      sourceLabel,
      aggregate.failedFiles > 0 ? "danger" : undefined
    )
  };
}

function recordedDaysMessage(label: string, coveredDays: number): string {
  const days = coveredDays === 1 ? "1 erfasster Tag" : `${coveredDays} erfasste Tage`;
  return `${label}: ${days} werden bis heute zusammengefasst.`;
}

export function buildStatisticsViewModel(
  snapshot: UiSnapshot,
  range: StatisticsRange,
  nowMs = Date.now()
): StatisticsViewModel {
  const sessionState = deriveSessionState(snapshot);

  if (range === "last24") {
    const rolling = snapshot.stats.rolling24Hours;
    const hasFullCoverage = nowMs - Math.max(0, snapshot.stats.statistics?.startedAt ?? nowMs) >= 24 * 60 * 60 * 1_000;
    return {
      range,
      coverage: "partial",
      message: hasFullCoverage
        ? "Account-Traffic der vergangenen 24 Stunden."
        : "Letzte 24 Stunden: Werte seit Beginn der Aufzeichnung.",
      sessionState,
      metrics: {
        downloadedBytes: availableMetric(rolling?.downloadedBytes ?? 0, "Letzte 24 Stunden"),
        files: unavailableMetric("Dateien werden nicht minutengenau nach Account erfasst"),
        successRate: unavailableMetric("Ergebnisse werden nicht minutengenau nach Account erfasst"),
        averageSpeedBps: unavailableMetric("Aktive Downloadzeit wird nur tagesweise erfasst"),
        errors: unavailableMetric("Fehler werden nicht minutengenau nach Account erfasst")
      },
      providerScope: "last24",
      usageKind: "accounts",
      providers: deriveRollingAccounts(snapshot),
      errorResetAvailable: false
    };
  }

  if (range === "today" || range === "week" || range === "month") {
    const days = range === "today" ? 1 : range === "week" ? 7 : 30;
    const aggregate = aggregateStatisticsRange(snapshot.stats.statistics, days, nowMs);
    const label = range === "today" ? "Heute" : range === "week" ? "Letzte sieben Tage" : "Letzte 30 Tage";
    return {
      range,
      coverage: "partial",
      message: range === "today"
        ? "Heutige Werte stammen aus der lokalen Statistikaufzeichnung."
        : recordedDaysMessage(label, aggregate.coveredDays),
      sessionState,
      metrics: aggregateMetrics(aggregate, label),
      providerScope: range,
      usageKind: "providers",
      providers: deriveUsageProviders(
        Object.fromEntries(Object.entries(aggregate.providers).map(([provider, bucket]) => [provider, bucket?.bytes ?? 0])),
        aggregate.providers
      ),
      errorResetAvailable: false
    };
  }

  if (range === "all") {
    const aggregate = aggregateStatisticsRange(snapshot.stats.statistics, null, nowMs);
    const providers = deriveUsageProviders(snapshot.settings.providerTotalUsageBytes, aggregate.providers);
    const recordedMetrics = aggregateMetrics(aggregate, "Seit Beginn der Statistikaufzeichnung");
    return {
      range,
      coverage: "partial",
      message: "Datenmenge und Dateien stammen aus den Gesamtzählern; Ergebnisse und Durchschnitt seit Beginn der Statistikaufzeichnung.",
      sessionState,
      metrics: {
        downloadedBytes: availableMetric(snapshot.stats.totalDownloadedAllTime, "Gesamtzähler"),
        files: availableMetric(snapshot.stats.totalFilesAllTime, "Gesamtzähler"),
        successRate: recordedMetrics.successRate,
        averageSpeedBps: recordedMetrics.averageSpeedBps,
        errors: recordedMetrics.errors
      },
      providerScope: "all",
      usageKind: "providers",
      providers,
      errorResetAvailable: false
    };
  }

  const items = Object.values(snapshot.session.items);
  const queueResults = countQueueResults(items);
  const runInProgress = snapshot.session.running || snapshot.session.paused;
  const useSummary = !runInProgress && snapshot.summary !== null;
  const results = useSummary ? countSummaryResults(snapshot.summary as DownloadSummary) : queueResults;
  const resultSource = useSummary ? "Letzter beendeter Lauf" : "Aktuelle Queue";
  const failed = results.failed;
  const summaryAverage = useSummary && results.completed + results.failed > 0
    ? availableMetric((snapshot.summary as DownloadSummary).averageSpeedBps, "Letzter beendeter Lauf")
    : unavailableMetric(runInProgress
      ? "Während des laufenden Durchgangs nicht als Gesamtwert verfügbar"
      : "Kein beendeter Lauf mit Ergebnissen verfügbar");

  return {
    range,
    coverage: "partial",
    message: useSummary
      ? "Sitzungszähler und Ergebnisse des zuletzt beendeten Laufs werden angezeigt."
      : "Sitzungszähler und Ergebnisse der aktuellen Queue werden angezeigt.",
    sessionState,
    metrics: {
      downloadedBytes: availableMetric(snapshot.stats.totalDownloaded, "Sitzungszähler"),
      files: availableMetric(snapshot.stats.totalFilesSession, "Sitzungszähler"),
      successRate: successRateMetric(results.completed, failed, resultSource),
      averageSpeedBps: summaryAverage,
      errors: availableMetric(failed, resultSource, failed > 0 ? "danger" : undefined)
    },
    providerScope: "current-queue",
    usageKind: "providers",
    providers: deriveQueueProviders(items),
    errorResetAvailable: queueResults.failed > 0
  };
}
