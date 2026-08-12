import type { DownloadItem, DownloadStatus, PackageEntry } from "../../../shared/types";
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
  empty: boolean;
  filteredEmpty: boolean;
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

export function getDownloadQueueTotalBytes(items: Iterable<DownloadItem>): number {
  let total = 0;
  for (const item of items) {
    total += item.totalBytes || item.downloadedBytes || 0;
  }
  return total;
}

export function getPendingDownloadItemCount(items: Iterable<DownloadItem>): number {
  let count = 0;
  for (const item of items) {
    if (item.status !== "completed" && item.status !== "cancelled" && item.status !== "failed") count += 1;
  }
  return count;
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

function matchesFilter(item: DownloadItem, filter: DownloadSidebarFilter): boolean {
  return filter === "all" || classifyDownloadStatus(item.status) === filter;
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
  const counts = buildDownloadSidebarCounts(allItems);
  const providerMap = new Map<string, string>();
  for (const entry of allItems) {
    if (entry.provider) providerMap.set(entry.provider, entry.providerLabel?.trim() || entry.provider);
  }

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
      return matchesFilter(item, input.filter) && matchesProvider(item, input.providerFilter) && (packageMatchesQuery || itemMatchesQuery);
    });
    if (matchingItems.length === 0) return [];
    const visibleItems = packageMatchesQuery && query !== ""
      ? items.filter((item) => matchesFilter(item, input.filter) && matchesProvider(item, input.providerFilter))
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

  return {
    displayMode: input.displayMode,
    filter: input.filter,
    providerFilter: input.providerFilter,
    providerOptions: [...providerMap].map(([id, label]) => ({ id, label })).sort((left, right) => left.label.localeCompare(right.label, "de")),
    query: input.query,
    counts,
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
    empty: allItems.length === 0,
    filteredEmpty: allItems.length > 0 && mainRowCount === 0
  };
}
