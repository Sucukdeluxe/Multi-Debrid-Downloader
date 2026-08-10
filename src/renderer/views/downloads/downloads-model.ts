import type { DownloadItem, DownloadStatus, PackageEntry } from "../../../shared/types";

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

function isActivePackage(row: DownloadPackageRow): boolean {
  return row.items.some((entry) => classifyDownloadStatus(entry.status) === "active");
}

function paginationLabel(visible: number, total: number): string {
  if (visible === 0 || total === 0) return "0 von 0";
  return `1–${visible} von ${total}`;
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
  let packageRows = allPackages.flatMap((entry): DownloadPackageRow[] => {
    const items = entry.itemIds
      .map((id) => input.items[id])
      .filter((item): item is DownloadItem => Boolean(item))
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
    return [{ package: entry, items: visibleItems, collapsed: collapsed.has(entry.id) }];
  });

  const totalPackageRows = packageRows.length;
  const allMatchingFileRows = packageRows.flatMap((row) => row.items);
  if (!input.showAllPackages && input.renderLimit > 0 && packageRows.length > input.renderLimit) {
    const activeRows = packageRows.filter(isActivePackage);
    const inactiveRows = packageRows.filter((row) => !isActivePackage(row));
    packageRows = [...activeRows, ...inactiveRows].slice(0, input.renderLimit);
  }

  const fileRows = input.displayMode === "files" ? allMatchingFileRows : [];
  const displayedPackages = input.displayMode === "packages" ? packageRows : [];
  const visibleItemIds = (input.displayMode === "files"
    ? fileRows
    : displayedPackages.flatMap((row) => row.collapsed ? [] : row.items)).map((entry) => entry.id);
  const visibleRowIds = input.displayMode === "files"
    ? visibleItemIds
    : displayedPackages.flatMap((row) => row.collapsed ? [row.package.id] : [row.package.id, ...row.items.map((entry) => entry.id)]);
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
    limited: mainRowCount < totalMainRowCount,
    empty: allItems.length === 0,
    filteredEmpty: allItems.length > 0 && mainRowCount === 0
  };
}
