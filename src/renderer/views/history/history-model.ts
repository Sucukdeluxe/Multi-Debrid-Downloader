import type { DebridProvider, HistoryEntry } from "../../../shared/types";

export type HistoryFilter = "all" | "today" | "week" | "older" | "completed" | "partial" | "failed" | "cancelled" | "deleted";
export type HistoryViewStatus = HistoryEntry["status"] | "failed";
export type HistoryViewEntry = Omit<HistoryEntry, "status"> & { status: HistoryViewStatus };
export type HistoryLanguage = "de" | "en";

export interface HistoryRow extends HistoryViewEntry {
  language: HistoryLanguage;
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
  rows: readonly HistoryViewEntry[];
  visibleIds: readonly string[];
  filter: HistoryFilter;
  query: string;
  selectedIds: string[];
  expandedIds: string[];
  counts: HistoryFilterCounts;
  loading: boolean;
  error: string;
  totalCount: number;
  animationsEnabled: boolean;
  language: HistoryLanguage;
  restorableSelected: boolean;
  pageSource: HistoryPageSource;
}

export interface HistoryPage {
  rows: HistoryRow[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  rangeLabel: string;
  language?: HistoryLanguage;
}

export interface HistoryPageSource {
  entries: readonly HistoryViewEntry[];
  language: HistoryLanguage;
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

const statusLabels: Record<HistoryLanguage, Record<HistoryViewStatus, string>> = {
  de: {
    completed: "Abgeschlossen",
    partial: "Teilweise",
    cancelled: "Abgebrochen",
    deleted: "Gelöscht",
    failed: "Fehlgeschlagen"
  },
  en: {
    completed: "Completed",
    partial: "Partial",
    cancelled: "Cancelled",
    deleted: "Deleted",
    failed: "Failed"
  }
};

const locales: Record<HistoryLanguage, string> = { de: "de-DE", en: "en-US" };
const numberFormatters: Record<HistoryLanguage, Intl.NumberFormat> = {
  de: new Intl.NumberFormat(locales.de, { maximumFractionDigits: 1 }),
  en: new Intl.NumberFormat(locales.en, { maximumFractionDigits: 1 })
};
const integerFormatters: Record<HistoryLanguage, Intl.NumberFormat> = {
  de: new Intl.NumberFormat(locales.de, { maximumFractionDigits: 0 }),
  en: new Intl.NumberFormat(locales.en, { maximumFractionDigits: 0 })
};
const dateFormatters: Record<HistoryLanguage, Intl.DateTimeFormat> = {
  de: new Intl.DateTimeFormat(locales.de, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }),
  en: new Intl.DateTimeFormat(locales.en, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  })
};

export function formatHistoryInteger(value: number, language: HistoryLanguage = "de"): string {
  return integerFormatters[language].format(value);
}

function formatBytes(bytes: number, language: HistoryLanguage): string {
  const safe = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
  if (safe < 1024) {
    return `${formatHistoryInteger(Math.round(safe), language)} B`;
  }
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let value = safe / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${numberFormatters[language].format(value)} ${units[unitIndex]}`;
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

function formatTimestamp(timestamp: number | undefined, language: HistoryLanguage): string {
  const safe = Math.max(0, Number.isFinite(timestamp) ? Number(timestamp) : 0);
  return safe > 0 ? dateFormatters[language].format(new Date(safe)) : "—";
}

function failurePhaseLabel(entry: HistoryViewEntry, language: HistoryLanguage): string {
  if (entry.failurePhase === "download") return "Download";
  if (entry.failurePhase === "extract") return language === "de" ? "Entpacken" : "Extraction";
  if (entry.failurePhase === "remux") return "Remux";
  if (entry.failurePhase === "cleanup") return language === "de" ? "Aufräumen" : "Cleanup";
  if (entry.failurePhase === "postprocess") return language === "de" ? "Nachbearbeitung" : "Post-processing";
  return "—";
}

function failureCountsLabel(entry: HistoryViewEntry, language: HistoryLanguage): string {
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
    : values.map((value) => formatHistoryInteger(Math.max(0, Number(value) || 0), language)).join(" / ");
}

function createHistoryPage(source: HistoryPageSource, requestedPage: number): HistoryPage {
  const totalItems = source.entries.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / HISTORY_PAGE_SIZE));
  const normalizedPage = Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1;
  const page = Math.min(totalPages, Math.max(1, normalizedPage));
  const startIndex = (page - 1) * HISTORY_PAGE_SIZE;
  const endIndex = Math.min(totalItems, startIndex + HISTORY_PAGE_SIZE);
  const rangeLabel = totalItems === 0
    ? source.language === "de" ? "0 von 0" : "0 of 0"
    : source.language === "de"
      ? `${formatHistoryInteger(startIndex + 1, source.language)}–${formatHistoryInteger(endIndex, source.language)} von ${formatHistoryInteger(totalItems, source.language)}`
      : `${formatHistoryInteger(startIndex + 1, source.language)}–${formatHistoryInteger(endIndex, source.language)} of ${formatHistoryInteger(totalItems, source.language)}`;

  return {
    rows: source.entries.slice(startIndex, endIndex).map((entry) => toHistoryRow(entry, source.language)),
    page,
    pageSize: HISTORY_PAGE_SIZE,
    totalItems,
    totalPages,
    rangeLabel,
    language: source.language
  };
}

const historyPageCaches = new WeakMap<HistoryPageSource, Map<number, HistoryPage>>();

export function getHistoryPage(model: Pick<HistoryViewModel, "pageSource">, requestedPage: number): HistoryPage {
  const source = model.pageSource;
  const totalPages = Math.max(1, Math.ceil(source.entries.length / HISTORY_PAGE_SIZE));
  const normalizedRequest = Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1;
  const page = Math.min(totalPages, Math.max(1, normalizedRequest));
  let pages = historyPageCaches.get(source);
  if (!pages) {
    pages = new Map();
    historyPageCaches.set(source, pages);
  }
  const cached = pages.get(page);
  if (cached) return cached;
  const projected = createHistoryPage(source, page);
  pages.set(page, projected);
  return projected;
}

export function paginateHistoryRows(
  rows: readonly HistoryViewEntry[],
  requestedPage: number,
  language: HistoryLanguage = "de"
): HistoryPage {
  return createHistoryPage({ entries: rows, language }, requestedPage);
}

function localDayStart(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

interface HistoryTimeWindow {
  todayStart: number;
  tomorrowStart: number;
  weekStart: number;
}

function createHistoryTimeWindow(now: number): HistoryTimeWindow {
  const todayStart = localDayStart(now);
  const tomorrowStartDate = new Date(todayStart);
  tomorrowStartDate.setDate(tomorrowStartDate.getDate() + 1);
  const weekStartDate = new Date(todayStart);
  weekStartDate.setDate(weekStartDate.getDate() - 6);
  return {
    todayStart,
    tomorrowStart: tomorrowStartDate.getTime(),
    weekStart: weekStartDate.getTime()
  };
}

function matchesTemporalFilter(entry: HistoryViewEntry, filter: HistoryFilter, window: HistoryTimeWindow): boolean {
  if (filter === "completed" || filter === "partial" || filter === "failed" || filter === "cancelled" || filter === "deleted") {
    return entry.status === filter;
  }
  if (filter === "all") {
    return true;
  }
  if (filter === "today") {
    return entry.completedAt >= window.todayStart && entry.completedAt < window.tomorrowStart;
  }
  if (filter === "week") {
    return entry.completedAt >= window.weekStart && entry.completedAt < window.tomorrowStart;
  }
  return entry.completedAt < window.weekStart;
}

function normalizeSearch(value: string, language: HistoryLanguage): string {
  return value.trim().toLocaleLowerCase(locales[language]);
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

function toHistoryRow(entry: HistoryViewEntry, language: HistoryLanguage): HistoryRow {
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
    language,
    hoster,
    providerLabel,
    startAt,
    sizeLabel: `${formatBytes(entry.downloadedBytes, language)} / ${formatBytes(entry.totalBytes, language)}`,
    startedLabel: formatTimestamp(startAt, language),
    completedLabel: formatTimestamp(entry.completedAt, language),
    durationLabel: formatHistoryDuration(downloadDurationSeconds),
    averageSpeedLabel: downloadDurationSeconds > 0 ? `${formatBytes(averageBytesPerSecond, language)}/s` : "—",
    statusLabel: statusLabels[language][entry.status],
    hasStructuredLifecycle,
    downloadEndedLabel: formatTimestamp(entry.downloadEndedAt, language),
    postProcessStartedLabel: formatTimestamp(entry.postProcessStartedAt, language),
    downloadDurationLabel: formatHistoryDuration(entry.downloadDurationSeconds ?? 0),
    extractionDurationLabel: formatHistoryDuration(entry.extractionDurationSeconds ?? 0),
    remuxDurationLabel: formatHistoryDuration(entry.remuxDurationSeconds ?? 0),
    postProcessDurationLabel: formatHistoryDuration(entry.postProcessDurationSeconds ?? 0),
    totalDurationLabel: formatHistoryDuration(entry.totalDurationSeconds ?? 0),
    failurePhaseLabel: failurePhaseLabel(entry, language),
    failureCountsLabel: failureCountsLabel(entry, language)
  };
}

export function filterHistoryRows(
  entries: readonly HistoryViewEntry[],
  filter: HistoryFilter,
  query: string,
  now = Date.now(),
  language: HistoryLanguage = "de"
): HistoryRow[] {
  return getHistoryAnalysis(entries, filter, query, now, language).match.entries.map((entry) => toHistoryRow(entry, language));
}

interface HistoryMatchAnalysis {
  entries: HistoryViewEntry[];
  ids: string[];
  entriesById: Map<string, HistoryViewEntry>;
  pageSource: HistoryPageSource;
}

interface HistorySourceAnalysis {
  dayStart: number;
  counts: HistoryFilterCounts;
  searchTexts: string[];
  matchKey: string;
  match: HistoryMatchAnalysis;
}

const historySourceCache = new WeakMap<readonly HistoryViewEntry[], HistorySourceAnalysis>();
const emptyHistoryEntries: readonly HistoryViewEntry[] = [];

function createHistoryFilterCounts(): HistoryFilterCounts {
  return {
    all: 0,
    today: 0,
    week: 0,
    older: 0,
    completed: 0,
    partial: 0,
    cancelled: 0,
    deleted: 0,
    failed: 0
  };
}

function createHistorySearchText(entry: HistoryViewEntry, language: HistoryLanguage): string {
  return [
    entry.name,
    entry.outputDir,
    entry.provider ? providerLabels[entry.provider] : "",
    ...(entry.urls ?? [])
  ].join("\n").toLocaleLowerCase(locales[language]);
}

function createHistoryMatchAnalysis(
  entries: readonly HistoryViewEntry[],
  filter: HistoryFilter,
  normalizedQuery: string,
  window: HistoryTimeWindow,
  language: HistoryLanguage,
  searchTexts: string[],
  counts?: HistoryFilterCounts,
  populateSearchTexts = false
): HistoryMatchAnalysis {
  const matchingEntries: HistoryViewEntry[] = [];
  const ids: string[] = [];
  const entriesById = new Map<string, HistoryViewEntry>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const searchText = populateSearchTexts ? createHistorySearchText(entry, language) : searchTexts[index];
    if (populateSearchTexts) searchTexts.push(searchText);
    if (counts) {
      counts.all += 1;
      if (entry.completedAt >= window.todayStart && entry.completedAt < window.tomorrowStart) counts.today += 1;
      if (entry.completedAt >= window.weekStart && entry.completedAt < window.tomorrowStart) counts.week += 1;
      if (entry.completedAt < window.weekStart) counts.older += 1;
      counts[entry.status] += 1;
    }
    if (!matchesTemporalFilter(entry, filter, window) || (normalizedQuery && !searchText.includes(normalizedQuery))) continue;
    matchingEntries.push(entry);
    ids.push(entry.id);
    entriesById.set(entry.id, entry);
  }
  return {
    entries: matchingEntries,
    ids,
    entriesById,
    pageSource: { entries: matchingEntries, language }
  };
}

function getHistoryAnalysis(
  entries: readonly HistoryViewEntry[],
  filter: HistoryFilter,
  query: string,
  now: number,
  language: HistoryLanguage
): HistorySourceAnalysis {
  const window = createHistoryTimeWindow(now);
  const normalizedQuery = normalizeSearch(query, language);
  const matchKey = `${filter}\u0000${language}\u0000${normalizedQuery}`;
  const cached = historySourceCache.get(entries);
  if (cached?.dayStart === window.todayStart) {
    if (cached.matchKey === matchKey) return cached;
    const next = {
      ...cached,
      matchKey,
      match: createHistoryMatchAnalysis(entries, filter, normalizedQuery, window, language, cached.searchTexts)
    };
    historySourceCache.set(entries, next);
    return next;
  }
  const counts = createHistoryFilterCounts();
  const searchTexts: string[] = [];
  const analysis = {
    dayStart: window.todayStart,
    counts,
    searchTexts,
    matchKey,
    match: createHistoryMatchAnalysis(entries, filter, normalizedQuery, window, language, searchTexts, counts, true)
  };
  historySourceCache.set(entries, analysis);
  return analysis;
}

export function buildHistoryViewModel(
  entries: readonly HistoryViewEntry[],
  filter: HistoryFilter,
  query: string,
  selectedIds: Iterable<string>,
  expandedIds: Iterable<string>,
  loading: boolean,
  error: string,
  now = Date.now(),
  animationsEnabled = true,
  language: HistoryLanguage = "de"
): HistoryViewModel {
  const availableEntries = loading || error ? emptyHistoryEntries : entries;
  const analysis = getHistoryAnalysis(availableEntries, filter, query, now, language);
  const selected: string[] = [];
  let restorableSelected = false;
  for (const id of selectedIds) {
    const entry = analysis.match.entriesById.get(id);
    if (!entry) continue;
    selected.push(id);
    if ((entry.urls?.length ?? 0) > 0) restorableSelected = true;
  }
  return {
    rows: analysis.match.entries,
    visibleIds: analysis.match.ids,
    filter,
    query,
    selectedIds: selected,
    expandedIds: [...expandedIds],
    counts: analysis.counts,
    loading,
    error,
    totalCount: availableEntries.length,
    animationsEnabled,
    language,
    restorableSelected,
    pageSource: analysis.match.pageSource
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

export function toggleHistoryPageSelection(current: ReadonlySet<string>, visibleIds: readonly string[]): Set<string> {
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => current.has(id));
  const next = new Set(current);
  for (const id of visibleIds) {
    if (allVisibleSelected) {
      next.delete(id);
    } else {
      next.add(id);
    }
  }
  return next;
}
