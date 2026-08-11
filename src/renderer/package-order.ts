import type { DownloadItem, DownloadStatus, PackageEntry } from "../shared/types";

const ACTIVE_PACKAGE_STATUSES = new Set<DownloadStatus>(["downloading", "validating", "integrity_check", "extracting"]);

function isPackageActive(pkg: PackageEntry, itemsById: Record<string, DownloadItem>): boolean {
  return pkg.itemIds.some((id) => {
    const item = itemsById[id];
    return item != null && ACTIVE_PACKAGE_STATUSES.has(item.status);
  });
}

export function reorderPackageOrderByDrop(order: string[], draggedPackageId: string, targetPackageId: string): string[] {
  const fromIndex = order.indexOf(draggedPackageId);
  const toIndex = order.indexOf(targetPackageId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return order;
  }
  const next = [...order];
  const [dragged] = next.splice(fromIndex, 1);
  const insertIndex = Math.max(0, Math.min(next.length, toIndex));
  next.splice(insertIndex, 0, dragged);
  return next;
}

export function sortPackageOrderByName(order: string[], packages: Record<string, PackageEntry>, descending: boolean): string[] {
  const sorted = [...order];
  sorted.sort((a, b) => {
    const nameA = (packages[a]?.name ?? "").toLowerCase();
    const nameB = (packages[b]?.name ?? "").toLowerCase();
    const cmp = nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: "base" });
    return descending ? -cmp : cmp;
  });
  return sorted;
}

export function sortPackagesForDisplay(
  packages: PackageEntry[],
  itemsById: Record<string, DownloadItem>,
  running: boolean,
  autoSortPackagesByProgress: boolean
): PackageEntry[] {
  if (!running || !autoSortPackagesByProgress || packages.length <= 1) {
    return packages;
  }

  const active = packages
    .map((pkg, index) => ({ pkg, index }))
    .filter(({ pkg }) => isPackageActive(pkg, itemsById))
    .sort((left, right) => {
      const leftStartedAt = left.pkg.downloadStartedAt || 0;
      const rightStartedAt = right.pkg.downloadStartedAt || 0;
      if (leftStartedAt > 0 && rightStartedAt > 0 && leftStartedAt !== rightStartedAt) {
        return leftStartedAt - rightStartedAt;
      }
      if (leftStartedAt > 0 && rightStartedAt <= 0) return -1;
      if (leftStartedAt <= 0 && rightStartedAt > 0) return 1;
      return left.index - right.index;
    })
    .map(({ pkg }) => pkg);
  const activeSet = new Set(active.map((pkg) => pkg.id));
  const rest = packages.filter((pkg) => !activeSet.has(pkg.id));

  if (active.length === 0) {
    return packages;
  }

  return [...active, ...rest];
}
