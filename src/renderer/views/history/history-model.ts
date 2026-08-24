import type { DebridProvider, HistoryEntry } from "../../../shared/types";

export type HistoryFilter = "all" | "today" | "week" | "older" | "completed" | "partial" | "failed" | "cancelled" | "deleted";
export type HistoryViewStatus = HistoryEntry["status"] | "failed";
export type HistoryViewEntry = Omit<HistoryEntry, "status"> & { status: HistoryViewStatus };

export interface HistoryRow extends HistoryViewEntry {
  hoster: string;
  providerLabel: string;
  startAt: number;
  sizeLabel: string;
  startedLabel: string;
  completedLabel: string;
  durationLabel: string;
  averageSpeedLabel: string;
  statusLabel: string;
  hasStructuredLifecycle: boolean;
  downloadEndedLabel: string;
  postProcessStartedLabel: string;
  downloadDurationLabel: string;
  extractionDurationLabel: string;
  remuxDurationLabel: string;
  postProcessDurationLabel: string;
  totalDurationLabel: string;
  failurePhaseLabel: string;
  failureCountsLabel: string;
}

export interface HistoryFilterCounts {
  all: number;
  today: number;
  week: number;
  older: number;
  completed: number;
  partial: number;
  cancelled: number;
  deleted: number;
  failed: number;
}

export interface HistoryViewModel {
  rows: HistoryRow[];
  filter: HistoryFilter;
  query: string;
  selectedIds: string[];
  expandedIds: string[];
  counts: HistoryFilterCounts;
  loading: boolean;
  error: string;
  totalCount: number;
  animationsEnabled: boolean;
}

export interface HistoryPage {
  rows: HistoryRow[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  rangeLabel: string;
}

export const HISTORY_PAGE_SIZE = 100;

export function mergeLiveHistoryEntry(
  entries: readonly HistoryEntry[],
  incoming: HistoryEntry,
  limits: { maxEntries: number; maxAgeDays: number },
  nowMs: number = Date.now()
): HistoryEntry[] {
  const maxEntries = limits.maxEntries > 0 ? Math.min(limits.maxEntries, 100_000) : 500;
  const cutoff = limits.maxAgeDays > 0 ? nowMs - limits.maxAgeDays * 86_400_000 : 0;
  const merged = [incoming, ...entries.filter((entry) => entry.id !== incoming.id)];
  const retained = cutoff > 0 ? merged.filter((entry) => entry.completedAt >= cutoff) : merged;
  return retained.length > maxEntries ? retained.slice(0, maxEntries) : retained;
}

export const HISTORY_TABLE_COLUMN_IDS = ["name", "status", "size", "hoster", "started", "completed"] as const;
export type HistoryTableColumnId = typeof HISTORY_TABLE_COLUMN_IDS[number];
export type HistoryTableColumnWidths = Record<HistoryTableColumnId, number>;

const HISTORY_TABLE_COLUMN_LIMITS: Record<HistoryTableColumnId, { initial: number; min: number; max: number }> = {
  name: { initial: 320, min: 220, max: 680 },
  status: { initial: 150, min: 120, max: 280 },
  size: { initial: 190, min: 140, max: 320 },
  hoster: { initial: 180, min: 120, max: 360 },
  started: { initial: 185, min: 150, max: 280 },
  completed: { initial: 185, min: 150, max: 280 }
};

export function createHistoryTableColumnWidths(value?: unknown): HistoryTableColumnWidths {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.fromEntries(HISTORY_TABLE_COLUMN_IDS.map((id) => {
    const limits = HISTORY_TABLE_COLUMN_LIMITS[id];
    const candidate = typeof raw[id] === "number" && Number.isFinite(raw[id]) ? Math.round(raw[id]) : limits.initial;
    return [id, Math.max(limits.min, Math.min(limits.max, candidate))];
  })) as HistoryTableColumnWidths;
}

export function resizeHistoryTableColumn(
  widths: HistoryTableColumnWidths,
  column: HistoryTableColumnId,
  delta: number
): HistoryTableColumnWidths {
  return createHistoryTableColumnWidths({ ...widths, [column]: widths[column] + delta });
}

export function getHistoryTableGridTemplate(widths: HistoryTableColumnWidths): string {
  return `48px ${HISTORY_TABLE_COLUMN_IDS.map((id) => `${widths[id]}px`).join(" ")} minmax(72px, 1fr)`;
}

export function getHistoryTableMinWidth(widths: HistoryTableColumnWidths): number {
  return 48 + 72 + HISTORY_TABLE_COLUMN_IDS.reduce((sum, id) => sum + widths[id], 0);
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

const statusLabels: Record<HistoryViewStatus, string> = {
  completed: "Abgeschlossen",
  partial: "Teilweise",
  cancelled: "Abgebrochen",
  deleted: "Gelöscht",
  failed: "Fehlgeschlagen"
};

const numberFormatter = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const integerFormatter = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

function formatBytes(bytes: number): string {
  const safe = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
  if (safe < 1024) {
    return `${Math.round(safe)} B`;
  }
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let value = safe / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${numberFormatter.format(value)} ${units[unitIndex]}`;
}

export function formatHistoryDuration(durationSeconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(durationSeconds) ? durationSeconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatTimestamp(timestamp: number | undefined): string {
  const safe = Math.max(0, Number.isFinite(timestamp) ? Number(timestamp) : 0);
  return safe > 0 ? dateFormatter.format(new Date(safe)) : "—";
}

function failurePhaseLabel(entry: HistoryViewEntry): string {
  if (entry.failurePhase === "download") return "Download";
  if (entry.failurePhase === "extract") return "Entpacken";
  if (entry.failurePhase === "remux") return "Remux";
  if (entry.failurePhase === "cleanup") return "Aufräumen";
  if (entry.failurePhase === "postprocess") return "Nachbearbeitung";
  return "—";
}

function failureCountsLabel(entry: HistoryViewEntry): string {
  const values = [
    entry.downloadFailures,
    entry.offlineFailures,
    entry.extractionFailures,
    entry.remuxFailures,
    entry.cleanupFailures,
    entry.postProcessFailures
  ];
  return values.every((value) => value === undefined)
    ? "—"
    : values.map((value) => Math.max(0, Number(value) || 0)).join(" / ");
}

export function paginateHistoryRows(rows: HistoryRow[], requestedPage: number): HistoryPage {
  const totalItems = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / HISTORY_PAGE_SIZE));
  const normalizedPage = Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1;
  const page = Math.min(totalPages, Math.max(1, normalizedPage));
  const startIndex = (page - 1) * HISTORY_PAGE_SIZE;
  const endIndex = Math.min(totalItems, startIndex + HISTORY_PAGE_SIZE);
  const rangeLabel = totalItems === 0
    ? "0 von 0"
    : `${integerFormatter.format(startIndex + 1)}–${integerFormatter.format(endIndex)} von ${integerFormatter.format(totalItems)}`;

  return {
    rows: rows.slice(startIndex, endIndex),
    page,
    pageSize: HISTORY_PAGE_SIZE,
    totalItems,
    totalPages,
    rangeLabel
  };
}

function localDayStart(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function matchesTemporalFilter(entry: HistoryViewEntry, filter: HistoryFilter, now: number): boolean {
  if (filter === "completed" || filter === "partial" || filter === "failed" || filter === "cancelled" || filter === "deleted") {
    return entry.status === filter;
  }
  if (filter === "all") {
    return true;
  }
  const todayStart = localDayStart(now);
  const tomorrowStartDate = new Date(todayStart);
  tomorrowStartDate.setDate(tomorrowStartDate.getDate() + 1);
  const tomorrowStart = tomorrowStartDate.getTime();
  const weekStartDate = new Date(todayStart);
  weekStartDate.setDate(weekStartDate.getDate() - 6);
  const weekStart = weekStartDate.getTime();
  if (filter === "today") {
    return entry.completedAt >= todayStart && entry.completedAt < tomorrowStart;
  }
  if (filter === "week") {
    return entry.completedAt >= weekStart && entry.completedAt < todayStart;
  }
  return entry.completedAt < weekStart;
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase("de-DE");
}

export function deriveHistoryHoster(urls: string[] | undefined): string {
  const hostnames: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls ?? []) {
    try {
      const url = new URL(raw);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        continue;
      }
      const hostname = url.hostname.toLocaleLowerCase("de-DE");
      if (!hostname || seen.has(hostname)) {
        continue;
      }
      seen.add(hostname);
      hostnames.push(hostname);
    } catch {
      continue;
    }
  }
  return hostnames.length > 0 ? hostnames.join(", ") : "—";
}

export function deriveHistoryStartAt(entry: Pick<HistoryViewEntry, "completedAt" | "durationSeconds" | "startedAt">): number {
  const startedAt = Math.max(0, Number.isFinite(entry.startedAt) ? Number(entry.startedAt) : 0);
  if (startedAt > 0) {
    return startedAt;
  }
  const completedAt = Math.max(0, Number.isFinite(entry.completedAt) ? entry.completedAt : 0);
  const durationMs = Math.max(0, Number.isFinite(entry.durationSeconds) ? entry.durationSeconds : 0) * 1000;
  return Math.max(0, completedAt - durationMs);
}

function toHistoryRow(entry: HistoryViewEntry): HistoryRow {
  const hoster = deriveHistoryHoster(entry.urls);
  const providerLabel = entry.provider ? providerLabels[entry.provider] : "—";
  const startAt = deriveHistoryStartAt(entry);
  const downloadDurationSeconds = Math.max(0, entry.downloadDurationSeconds ?? entry.durationSeconds ?? 0);
  const averageBytesPerSecond = downloadDurationSeconds > 0 ? entry.downloadedBytes / downloadDurationSeconds : 0;
  const hasStructuredLifecycle = entry.startedAt !== undefined
    || entry.downloadEndedAt !== undefined
    || entry.postProcessStartedAt !== undefined
    || entry.totalDurationSeconds !== undefined;
  return {
    ...entry,
    hoster,
    providerLabel,
    startAt,
    sizeLabel: `${formatBytes(entry.downloadedBytes)} / ${formatBytes(entry.totalBytes)}`,
    startedLabel: formatTimestamp(startAt),
    completedLabel: formatTimestamp(entry.completedAt),
    durationLabel: formatHistoryDuration(downloadDurationSeconds),
    averageSpeedLabel: downloadDurationSeconds > 0 ? `${formatBytes(averageBytesPerSecond)}/s` : "—",
    statusLabel: statusLabels[entry.status],
    hasStructuredLifecycle,
    downloadEndedLabel: formatTimestamp(entry.downloadEndedAt),
    postProcessStartedLabel: formatTimestamp(entry.postProcessStartedAt),
    downloadDurationLabel: formatHistoryDuration(entry.downloadDurationSeconds ?? 0),
    extractionDurationLabel: formatHistoryDuration(entry.extractionDurationSeconds ?? 0),
    remuxDurationLabel: formatHistoryDuration(entry.remuxDurationSeconds ?? 0),
    postProcessDurationLabel: formatHistoryDuration(entry.postProcessDurationSeconds ?? 0),
    totalDurationLabel: formatHistoryDuration(entry.totalDurationSeconds ?? 0),
    failurePhaseLabel: failurePhaseLabel(entry),
    failureCountsLabel: failureCountsLabel(entry)
  };
}

export function filterHistoryRows(
  entries: HistoryViewEntry[],
  filter: HistoryFilter,
  query: string,
  now = Date.now()
): HistoryRow[] {
  const normalizedQuery = normalizeSearch(query);
  return entries
    .filter((entry) => matchesTemporalFilter(entry, filter, now))
    .map(toHistoryRow)
    .filter((row) => {
      if (!normalizedQuery) {
        return true;
      }
      const searchable = [
        row.name,
        row.outputDir,
        row.hoster,
        row.providerLabel,
        ...(row.urls ?? [])
      ].join("\n").toLocaleLowerCase("de-DE");
      return searchable.includes(normalizedQuery);
    });
}

function countHistoryFilters(entries: HistoryViewEntry[], now: number): HistoryFilterCounts {
  return {
    all: entries.length,
    today: entries.filter((entry) => matchesTemporalFilter(entry, "today", now)).length,
    week: entries.filter((entry) => matchesTemporalFilter(entry, "week", now)).length,
    older: entries.filter((entry) => matchesTemporalFilter(entry, "older", now)).length,
    completed: entries.filter((entry) => entry.status === "completed").length,
    partial: entries.filter((entry) => entry.status === "partial").length,
    cancelled: entries.filter((entry) => entry.status === "cancelled").length,
    deleted: entries.filter((entry) => entry.status === "deleted").length,
    failed: entries.filter((entry) => entry.status === "failed").length
  };
}

export function buildHistoryViewModel(
  entries: HistoryViewEntry[],
  filter: HistoryFilter,
  query: string,
  selectedIds: Iterable<string>,
  expandedIds: Iterable<string>,
  loading: boolean,
  error: string,
  now = Date.now(),
  animationsEnabled = true
): HistoryViewModel {
  const rows = filterHistoryRows(entries, filter, query, now);
  const visibleIds = new Set(rows.map((row) => row.id));
  return {
    rows,
    filter,
    query,
    selectedIds: [...selectedIds].filter((id) => visibleIds.has(id)),
    expandedIds: [...expandedIds],
    counts: countHistoryFilters(entries, now),
    loading,
    error,
    totalCount: entries.length,
    animationsEnabled
  };
}

export function pruneHistoryIds(current: Set<string>, availableIds: Iterable<string>): Set<string> {
  if (current.size === 0) {
    return current;
  }
  const available = new Set(availableIds);
  const next = new Set<string>();
  for (const id of current) {
    if (available.has(id)) {
      next.add(id);
    }
  }
  return next.size === current.size ? current : next;
}

export function selectVisibleHistoryIds(visibleIds: Iterable<string>): Set<string> {
  return new Set(visibleIds);
}
