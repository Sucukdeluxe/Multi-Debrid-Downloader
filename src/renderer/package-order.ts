import type { DownloadItem, PackageEntry } from "../shared/types";
import { compareAvailabilitySummaries, getAvailabilitySummary } from "./views/downloads/DownloadsTable";

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

export function sortPackageOrderByAvailability(
  order: string[],
  packages: Record<string, PackageEntry>,
  items: Record<string, DownloadItem>,
  descending: boolean
): string[] {
  const summaries = new Map(order.map((packageId) => {
    const packageItems = (packages[packageId]?.itemIds ?? []).map((id) => items[id]).filter((item): item is DownloadItem => Boolean(item));
    return [packageId, getAvailabilitySummary(packageItems)] as const;
  }));
  const sorted = [...order];
  sorted.sort((a, b) => {
    const summaryA = summaries.get(a)!;
    const summaryB = summaries.get(b)!;
    const cmp = compareAvailabilitySummaries(summaryA, summaryB) || summaryB.total - summaryA.total;
    return descending ? -cmp : cmp;
  });
  return sorted;
}

export function preservePackageOrderForDisplay(packages: PackageEntry[]): PackageEntry[] {
  return packages;
}

export function createAvailabilitySortCycle() {
  let phase: "off" | "online" | "offline" = "off";
  let originalOrder: string[] = [];
  return {
    reset(): void {
      phase = "off";
      originalOrder = [];
    },
    next(currentOrder: string[]): { descending: boolean | null; order: string[] } {
      if (phase === "off") {
        originalOrder = [...currentOrder];
        phase = "online";
        return { descending: false, order: currentOrder };
      }
      if (phase === "online") {
        phase = "offline";
        return { descending: true, order: currentOrder };
      }
      phase = "off";
      const available = new Set(currentOrder);
      const order = originalOrder.filter((id) => available.delete(id));
      order.push(...available);
      originalOrder = [];
      return { descending: null, order };
    }
  };
}
