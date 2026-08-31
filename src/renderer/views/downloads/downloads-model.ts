import type { DownloadItem, DownloadStatus, PackageEntry } from "../../../shared/types";
import { extractHoster, humanSize } from "../../download-format";
import { DOWNLOAD_FILE_ROW_HEIGHT, DOWNLOAD_PACKAGE_ROW_HEIGHT, type DownloadVirtualRowInput } from "./download-virtualizer";

export type DownloadDisplayMode = "packages" | "files";
export type DownloadSidebarFilter = "all" | "active" | "queued" | "paused" | "completed" | "failed";

export interface DownloadsModelInput {
  packageOrder: string[];
  packages: Record<string, PackageEntry>;
  items: Record<string, DownloadItem>;
  displayMode: DownloadDisplayMode;
  filter: DownloadSidebarFilter;
  providerFilter: string;
  query: string;
  collapsedPackageIds: Iterable<string>;
  selectedIds: Iterable<string>;
  hideExtractedItems: boolean;
  showAllPackages: boolean;
  renderLimit: number;
}

export interface DownloadFilterCounts {
  all: number;
  active: number;
  queued: number;
  paused: number;
  completed: number;
  failed: number;
}

export interface DownloadPackageRow {
  package: PackageEntry;
  items: DownloadItem[];
  allItems: DownloadItem[];
  collapsed: boolean;
}

export interface DownloadsViewModelCore {
  displayMode: DownloadDisplayMode;
  filter: DownloadSidebarFilter;
  providerFilter: string;
  providerOptions: Array<{ id: string; label: string }>;
  query: string;
  counts: DownloadFilterCounts;
  eligibleItems: DownloadItem[];
  eligiblePackageCount: number;
  packageRows: DownloadPackageRow[];
  fileRows: DownloadItem[];
  visibleItemIds: string[];
  visibleRowIds: string[];
  actionableSelectedIds: string[];
  actionableSelectedPackageIds: string[];
  selectedIds: Set<string>;
  mainRowCount: number;
  totalMainRowCount: number;
  paginationLabel: string;
  limited: boolean;
  sourceEmpty: boolean;
  presentationEmpty: boolean;
  empty: boolean;
  filteredEmpty: boolean;
}

export interface DownloadByteSummary {
  bytes: number;
  unknownItems: number;
}

export type DownloadLogicalRow =
  | (DownloadVirtualRowInput & { type: "package"; packageId: string; packageRow: DownloadPackageRow })
  | (DownloadVirtualRowInput & { type: "item"; packageId: string; item: DownloadItem });

const activeStatuses = new Set<DownloadStatus>(["downloading", "validating", "extracting", "integrity_check"]);
const queuedStatuses = new Set<DownloadStatus>(["queued", "reconnect_wait"]);

export function classifyDownloadStatus(status: DownloadStatus): DownloadSidebarFilter {
  if (activeStatuses.has(status)) return "active";
  if (queuedStatuses.has(status)) return "queued";
  if (status === "paused" || status === "completed" || status === "failed") return status;
  return "all";
}

export function buildDownloadSidebarCounts(items: Iterable<DownloadItem>): DownloadFilterCounts {
  const counts: DownloadFilterCounts = { all: 0, active: 0, queued: 0, paused: 0, completed: 0, failed: 0 };
  for (const item of items) {
    counts.all += 1;
    const category = classifyDownloadStatus(item.status);
    if (category !== "all") counts[category] += 1;
  }
  return counts;
}

export function getDownloadQueueTotalBytes(items: Iterable<DownloadItem>): DownloadByteSummary {
  let bytes = 0;
  let unknownItems = 0;
  for (const item of items) {
    if (item.totalBytes && item.totalBytes > 0) {
      bytes += item.totalBytes;
    } else {
      bytes += Math.max(0, item.downloadedBytes || 0);
      unknownItems += 1;
    }
  }
  return { bytes, unknownItems };
}

function isPendingDownloadItem(item: DownloadItem): boolean {
  return item.status !== "completed" && item.status !== "cancelled" && item.status !== "failed";
}

export function getPendingDownloadItemCount(items: Iterable<DownloadItem>): number {
  let count = 0;
  for (const item of items) {
    if (isPendingDownloadItem(item)) count += 1;
  }
  return count;
}

export function getRemainingDownloadBytes(items: Iterable<DownloadItem>): { bytes: number; unknownItems: number } {
  let bytes = 0;
  let unknownItems = 0;
  for (const item of items) {
    if (!isPendingDownloadItem(item)) continue;
    if (!item.totalBytes || item.totalBytes <= 0) {
      unknownItems += 1;
      continue;
    }
    bytes += Math.max(0, item.totalBytes - Math.max(0, item.downloadedBytes));
  }
  return { bytes, unknownItems };
}

export function getDownloadQueueStatusMetrics(items: readonly DownloadItem[]): {
  packageCount: number;
  pendingItemCount: number;
  total: DownloadByteSummary;
  remaining: { bytes: number; unknownItems: number };
  hosterCount: number;
} {
  return {
    packageCount: new Set(items.map((item) => item.packageId)).size,
    pendingItemCount: getPendingDownloadItemCount(items),
    total: getDownloadQueueTotalBytes(items),
    remaining: getRemainingDownloadBytes(items),
    hosterCount: new Set(items.map((item) => extractHoster(item.url)).filter(Boolean)).size
  };
}

export function formatRemainingDownloadBytes(summary: { bytes: number; unknownItems: number }): string {
  const value = summary.bytes >= 1024 ** 4
    ? `${(summary.bytes / 1024 ** 4).toFixed(5)} TB`
    : humanSize(summary.bytes);
  if (summary.unknownItems <= 0) return value;
  return summary.bytes > 0 ? `≥ ${value}` : "Unbekannt";
}

export function formatRemainingDownloadTooltip(summary: { bytes: number; unknownItems: number }): string {
  if (summary.unknownItems <= 0) return "";
  return `Noch unbekannte Dateigrößen: ${summary.unknownItems}. Die tatsächliche Restmenge kann höher sein.`;
}

export function formatDownloadEta(
  remaining: DownloadByteSummary,
  speedBps: number,
  running: boolean,
  paused: boolean
): string {
  if (!running || paused || speedBps <= 0 || remaining.unknownItems > 0 || remaining.bytes <= 0) return "--";
  const totalSeconds = Math.ceil(remaining.bytes / speedBps);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function getDownloadSpeedBps(packageSpeeds: Record<string, number>): number {
  let total = 0;
  for (const speed of Object.values(packageSpeeds)) {
    if (Number.isFinite(speed) && speed > 0) total += speed;
  }
  return total;
}

function isExtracted(item: DownloadItem): boolean {
  return item.fullStatus.trim().toLocaleLowerCase("de-DE").startsWith("entpackt");
}

function matchesQuery(value: string | undefined, query: string): boolean {
  return Boolean(value?.toLocaleLowerCase("de-DE").includes(query));
}

export function isDownloadItemError(item: DownloadItem): boolean {
  const status = item.fullStatus.trim();
  return item.status === "failed"
    || /^(?:Entpack(?:-|\s*)Fehler\b|Entpacken\b.*(?:\bFehler\b|\bError\b|fehlgeschlagen)|Extraction\b.*(?:\bError\b|failed))/i.test(status);
}

export function getPackageErrorItemIds(
  packageIds: readonly string[],
  packages: Record<string, PackageEntry>,
  items: Record<string, DownloadItem>
): string[] {
  const errorItemIds = new Set<string>();
  for (const packageId of packageIds) {
    const pkg = packages[packageId];
    if (!pkg) continue;
    for (const itemId of pkg.itemIds) {
      const item = items[itemId];
      if (item && isDownloadItemError(item)) errorItemIds.add(itemId);
    }
  }
  return [...errorItemIds];
}

function classifyDownloadItem(item: DownloadItem, pkg: PackageEntry): DownloadSidebarFilter {
  if (isDownloadItemError(item)) return "failed";
  if (item.status === "cancelled") return "all";
  if (isExtracted(item)) return "completed";
  if ((pkg.status === "extracting" || pkg.status === "integrity_check") && item.status === "completed") return "active";
  if (item.status === "completed") return "completed";
  if (pkg.status === "failed") return "failed";
  if (pkg.status === "paused") return "paused";
  return classifyDownloadStatus(item.status);
}

function buildDownloadLifecycleCounts(packages: readonly PackageEntry[], items: Record<string, DownloadItem>, hideExtractedItems: boolean): DownloadFilterCounts {
  const counts: DownloadFilterCounts = { all: 0, active: 0, queued: 0, paused: 0, completed: 0, failed: 0 };
  for (const pkg of packages) {
    for (const itemId of pkg.itemIds) {
      const item = items[itemId];
      if (!item || (hideExtractedItems && isExtracted(item))) continue;
      counts.all += 1;
      const category = classifyDownloadItem(item, pkg);
      if (category !== "all") counts[category] += 1;
    }
  }
  return counts;
}

function matchesFilter(item: DownloadItem, pkg: PackageEntry, filter: DownloadSidebarFilter): boolean {
  return filter === "all" || classifyDownloadItem(item, pkg) === filter;
}

function matchesProvider(item: DownloadItem, providerFilter: string): boolean {
  return providerFilter === "all" || item.provider === providerFilter;
}

function paginationLabel(visible: number, total: number): string {
  if (visible === 0 || total === 0) return "0 von 0";
  return `1–${visible} von ${total}`;
}

export function buildDownloadLogicalRows(model: Pick<DownloadsViewModelCore, "displayMode" | "packageRows" | "fileRows">): DownloadLogicalRow[] {
  if (model.displayMode === "files") {
    return model.fileRows.map((item) => ({ type: "item", id: item.id, packageId: item.packageId, item, height: DOWNLOAD_FILE_ROW_HEIGHT }));
  }
  return model.packageRows.flatMap((row): DownloadLogicalRow[] => {
    const packageRow: DownloadLogicalRow = { type: "package", id: row.package.id, packageId: row.package.id, packageRow: row, height: DOWNLOAD_PACKAGE_ROW_HEIGHT };
    if (row.collapsed) return [packageRow];
    return [packageRow, ...row.items.map((item): DownloadLogicalRow => ({ type: "item", id: item.id, packageId: item.packageId, item, height: DOWNLOAD_FILE_ROW_HEIGHT }))];
  });
}

export function buildDownloadsViewModel(input: DownloadsModelInput): DownloadsViewModelCore {
  const allPackages = input.packageOrder
    .map((id) => input.packages[id])
    .filter((entry): entry is PackageEntry => Boolean(entry));
  const allItems = allPackages.flatMap((entry) => entry.itemIds.map((id) => input.items[id]).filter((item): item is DownloadItem => Boolean(item)));
  const eligibleItems = input.hideExtractedItems ? allItems.filter((item) => !isExtracted(item)) : allItems;
  const eligiblePackageCount = new Set(eligibleItems.map((item) => item.packageId)).size;
  const counts = buildDownloadLifecycleCounts(allPackages, input.items, input.hideExtractedItems);
  const providerMap = new Map<string, string>();
  for (const entry of eligibleItems) {
    if (entry.provider) providerMap.set(entry.provider, entry.providerLabel?.trim() || entry.provider);
  }
  const providerFilter = input.providerFilter === "all" || providerMap.has(input.providerFilter) ? input.providerFilter : "all";

  const query = input.query.trim().toLocaleLowerCase("de-DE");
  const collapsed = new Set(input.collapsedPackageIds);
  const selectedIds = new Set(input.selectedIds);
  const packageRows = allPackages.flatMap((entry): DownloadPackageRow[] => {
    const allPackageItems = entry.itemIds
      .map((id) => input.items[id])
      .filter((item): item is DownloadItem => Boolean(item));
    const items = allPackageItems
      .filter((item) => !input.hideExtractedItems || !isExtracted(item));
    const packageMatchesQuery = query === "" || matchesQuery(entry.name, query) || matchesQuery(entry.status, query);
    const matchingItems = items.filter((item) => {
      const itemMatchesQuery = query === ""
        || matchesQuery(item.fileName, query)
        || matchesQuery(item.targetPath, query)
        || matchesQuery(item.providerLabel, query)
        || matchesQuery(item.providerAccountLabel, query)
        || matchesQuery(item.fullStatus, query)
        || matchesQuery(item.lastError, query);
      return matchesFilter(item, entry, input.filter) && matchesProvider(item, providerFilter) && (packageMatchesQuery || itemMatchesQuery);
    });
    if (matchingItems.length === 0) return [];
    const visibleItems = packageMatchesQuery && query !== ""
      ? items.filter((item) => matchesFilter(item, entry, input.filter) && matchesProvider(item, providerFilter))
      : matchingItems;
    return [{ package: entry, items: visibleItems, allItems: allPackageItems, collapsed: collapsed.has(entry.id) }];
  });

  const totalPackageRows = packageRows.length;
  const allMatchingFileRows = packageRows.flatMap((row) => row.items);
  const fileRows = input.displayMode === "files" ? allMatchingFileRows : [];
  const displayedPackages = input.displayMode === "packages" ? packageRows : [];
  const logicalRows = buildDownloadLogicalRows({
    displayMode: input.displayMode,
    packageRows: displayedPackages,
    fileRows
  });
  const visibleItemIds = logicalRows.filter((row): row is Extract<DownloadLogicalRow, { type: "item" }> => row.type === "item").map((row) => row.item.id);
  const visibleRowIds = logicalRows.map((row) => row.id);
  const visibleRowSet = new Set(visibleRowIds);
  const actionableSelectedIds = [...selectedIds].filter((id) => visibleRowSet.has(id));
  const visiblePackageSet = new Set(displayedPackages.map((row) => row.package.id));
  const actionableSelectedPackageIds = actionableSelectedIds.filter((id) => visiblePackageSet.has(id));
  const mainRowCount = input.displayMode === "files" ? fileRows.length : displayedPackages.length;
  const totalMainRowCount = input.displayMode === "files"
    ? fileRows.length
    : totalPackageRows;

  const sourceEmpty = allItems.length === 0;
  const presentationEmpty = eligibleItems.length === 0;

  return {
    displayMode: input.displayMode,
    filter: input.filter,
    providerFilter,
    providerOptions: [...providerMap].map(([id, label]) => ({ id, label })).sort((left, right) => left.label.localeCompare(right.label, "de")),
    query: input.query,
    counts,
    eligibleItems,
    eligiblePackageCount,
    packageRows: displayedPackages,
    fileRows,
    visibleItemIds,
    visibleRowIds,
    actionableSelectedIds,
    actionableSelectedPackageIds,
    selectedIds,
    mainRowCount,
    totalMainRowCount,
    paginationLabel: paginationLabel(mainRowCount, totalMainRowCount),
    limited: false,
    sourceEmpty,
    presentationEmpty,
    empty: sourceEmpty,
    filteredEmpty: !sourceEmpty && mainRowCount === 0
  };
}
