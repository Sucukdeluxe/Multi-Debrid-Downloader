import { getProviderUsageDayKey } from "../../../shared/provider-daily-limits";
import type { DebridProvider, DownloadItem, DownloadSummary, UiSnapshot } from "../../../shared/types";

export type StatisticsRange = "session" | "today" | "week" | "month" | "all";
export type StatisticsCoverage = "partial" | "unavailable";
export type StatisticsSessionState = "empty" | "idle" | "active" | "paused";
export type StatisticsProviderScope = "current-queue" | "today" | "all";
export type StatisticsMetricTone = "danger";

export interface StatisticsMetric {
  value: number | null;
  available: boolean;
  sourceLabel: string;
  tone?: StatisticsMetricTone;
}

export interface StatisticsProviderRow {
  id: DebridProvider;
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
  ddownload: "DDownload",
  onefichier: "1Fichier",
  debridlink: "Debrid-Link",
  linksnappy: "LinkSnappy"
};

const historicalUnavailableMessage = "Für diesen Zeitraum werden noch keine historischen Daten gespeichert.";

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

function deriveUsageProviders(usage: Partial<Record<DebridProvider, number>>): StatisticsProviderRow[] {
  const rows: StatisticsProviderRow[] = [];
  for (const [id, rawBytes] of Object.entries(usage) as Array<[DebridProvider, number | undefined]>) {
    const bytes = normalizeNonNegative(rawBytes ?? 0);
    if (bytes <= 0 || !providerLabels[id]) {
      continue;
    }
    rows.push({
      id,
      label: providerLabels[id],
      bytes,
      completed: null,
      failed: null
    });
  }
  return sortProviderRows(rows);
}

function sumProviderBytes(rows: StatisticsProviderRow[]): number {
  return rows.reduce((total, row) => total + row.bytes, 0);
}

function buildUnavailableMetrics(): StatisticsMetrics {
  return {
    downloadedBytes: unavailableMetric(historicalUnavailableMessage),
    files: unavailableMetric(historicalUnavailableMessage),
    successRate: unavailableMetric(historicalUnavailableMessage),
    averageSpeedBps: unavailableMetric(historicalUnavailableMessage),
    errors: unavailableMetric(historicalUnavailableMessage)
  };
}

export function buildStatisticsViewModel(
  snapshot: UiSnapshot,
  range: StatisticsRange,
  nowMs = Date.now()
): StatisticsViewModel {
  const sessionState = deriveSessionState(snapshot);

  if (range === "week" || range === "month") {
    return {
      range,
      coverage: "unavailable",
      message: historicalUnavailableMessage,
      sessionState,
      metrics: buildUnavailableMetrics(),
      providerScope: null,
      providers: [],
      errorResetAvailable: false
    };
  }

  if (range === "today") {
    const isCurrentDay = snapshot.settings.providerDailyUsageDay === getProviderUsageDayKey(nowMs);
    const providers = isCurrentDay ? deriveUsageProviders(snapshot.settings.providerDailyUsageBytes) : [];
    return {
      range,
      coverage: "partial",
      message: "Heutige Daten stammen aus den lokalen Provider-Nutzungszählern des aktuellen Kalendertags.",
      sessionState,
      metrics: {
        downloadedBytes: availableMetric(sumProviderBytes(providers), "Provider-Nutzung heute"),
        files: unavailableMetric("Dateianzahlen werden nicht tagesweise gespeichert"),
        successRate: unavailableMetric("Ergebnisse werden nicht tagesweise gespeichert"),
        averageSpeedBps: unavailableMetric("Durchschnittsgeschwindigkeit wird nicht tagesweise gespeichert"),
        errors: unavailableMetric("Fehler werden nicht tagesweise gespeichert")
      },
      providerScope: "today",
      providers,
      errorResetAvailable: false
    };
  }

  if (range === "all") {
    const providers = deriveUsageProviders(snapshot.settings.providerTotalUsageBytes);
    return {
      range,
      coverage: "partial",
      message: "Gesamtwerte stammen aus dauerhaft gespeicherten Zählern. Ergebnisse und Geschwindigkeiten werden nicht historisch gespeichert.",
      sessionState,
      metrics: {
        downloadedBytes: availableMetric(snapshot.stats.totalDownloadedAllTime, "Gesamtzähler"),
        files: availableMetric(snapshot.stats.totalFilesAllTime, "Gesamtzähler"),
        successRate: unavailableMetric("Ergebnisse werden nicht dauerhaft gespeichert"),
        averageSpeedBps: unavailableMetric("Durchschnittsgeschwindigkeit wird nicht dauerhaft gespeichert"),
        errors: unavailableMetric("Fehler werden nicht dauerhaft gespeichert")
      },
      providerScope: "all",
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
    providers: deriveQueueProviders(items),
    errorResetAvailable: queueResults.failed > 0
  };
}
