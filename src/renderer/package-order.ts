import type { PackageEntry } from "../shared/types";

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

export function preservePackageOrderForDisplay(packages: PackageEntry[]): PackageEntry[] {
  return packages;
}

export type OptimisticPackageOrderStatus = "idle" | "pending" | "acknowledged" | "timed-out";

export interface OptimisticPackageOrderReconciliation {
  displayOrder: string[];
  pendingOrder: string[] | null;
  pendingAt: number;
  status: OptimisticPackageOrderStatus;
}

function samePackageOrder(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((packageId, index) => packageId === right[index]);
}

export function reconcileOptimisticPackageOrder(
  authoritativeOrder: string[],
  pendingOrder: string[] | null,
  pendingAt: number,
  now: number,
  holdMs = 1_500
): OptimisticPackageOrderReconciliation {
  if (!pendingOrder) {
    return {
      displayOrder: authoritativeOrder,
      pendingOrder: null,
      pendingAt: 0,
      status: "idle"
    };
  }
  if (samePackageOrder(authoritativeOrder, pendingOrder)) {
    return {
      displayOrder: authoritativeOrder,
      pendingOrder: null,
      pendingAt: 0,
      status: "acknowledged"
    };
  }
  if (now - pendingAt >= holdMs) {
    return {
      displayOrder: authoritativeOrder,
      pendingOrder: null,
      pendingAt: 0,
      status: "timed-out"
    };
  }
  return {
    displayOrder: pendingOrder,
    pendingOrder,
    pendingAt,
    status: "pending"
  };
}

export function reconcileCollapsedPackageState(
  previous: Record<string, boolean>,
  packageOrder: string[],
  packages: Record<string, PackageEntry>,
  defaultCollapsed: boolean
): Record<string, boolean> {
  let changed = false;
  const next = { ...previous };
  for (const packageId of packageOrder) {
    if (!(packageId in previous)) {
      next[packageId] = defaultCollapsed;
      changed = true;
    }
  }
  for (const packageId of Object.keys(next)) {
    if (!packages[packageId]) {
      delete next[packageId];
      changed = true;
    }
  }
  return changed ? next : previous;
}
