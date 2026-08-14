import type { DownloadLogicalRow } from "./downloads-model";
import { DOWNLOAD_FILE_ROW_HEIGHT } from "./download-virtualizer";

export const DOWNLOAD_DISCLOSURE_DURATION_MS = 300;
export const DOWNLOAD_DISCLOSURE_MAX_ANIMATED_ITEMS = 64;

export type DownloadDisclosurePhase = "stable" | "entering" | "leaving";

export type DownloadDisclosureRow = DownloadLogicalRow & {
  disclosureOpacity: number;
  disclosurePhase: DownloadDisclosurePhase;
};

function stableRow(row: DownloadLogicalRow): DownloadDisclosureRow {
  return { ...row, disclosureOpacity: 1, disclosurePhase: "stable" };
}

type DownloadDisclosureSourceRow = DownloadLogicalRow | DownloadDisclosureRow;

function disclosureOpacity(row: DownloadDisclosureSourceRow): number {
  return "disclosureOpacity" in row ? row.disclosureOpacity : 1;
}

export function stableDownloadDisclosureRows(rows: readonly DownloadLogicalRow[]): DownloadDisclosureRow[] {
  return rows.map(stableRow);
}

function itemRowsByPackage(rows: readonly DownloadDisclosureSourceRow[]): Map<string, DownloadDisclosureSourceRow[]> {
  const grouped = new Map<string, DownloadDisclosureSourceRow[]>();
  for (const row of rows) {
    if (row.type !== "item") continue;
    const entries = grouped.get(row.packageId) ?? [];
    entries.push(row);
    grouped.set(row.packageId, entries);
  }
  return grouped;
}

export function prepareDownloadDisclosureTransition(
  current: readonly DownloadDisclosureSourceRow[],
  desired: readonly DownloadLogicalRow[]
): { animated: boolean; rows: DownloadDisclosureRow[] } {
  if (!desired.some((row) => row.type === "package")) {
    return { animated: false, rows: stableDownloadDisclosureRows(desired) };
  }

  const currentItems = itemRowsByPackage(current);
  const currentPackages = new Map(current.filter((row) => row.type === "package").map((row) => [row.packageId, row]));
  const desiredItems = new Map<string, DownloadLogicalRow[]>();
  for (const row of desired) {
    if (row.type !== "item") continue;
    const entries = desiredItems.get(row.packageId) ?? [];
    entries.push(row);
    desiredItems.set(row.packageId, entries);
  }

  let animatedItemCount = 0;
  for (const row of desired) {
    if (row.type !== "package") continue;
    const previousPackage = currentPackages.get(row.packageId);
    if (previousPackage?.type !== "package" || previousPackage.packageRow.collapsed === row.packageRow.collapsed) continue;
    animatedItemCount += Math.max(currentItems.get(row.packageId)?.length ?? 0, desiredItems.get(row.packageId)?.length ?? 0);
    if (animatedItemCount > DOWNLOAD_DISCLOSURE_MAX_ANIMATED_ITEMS) {
      return { animated: false, rows: stableDownloadDisclosureRows(desired) };
    }
  }

  const rows: DownloadDisclosureRow[] = [];
  let animated = false;
  for (const row of desired) {
    if (row.type !== "package") continue;
    rows.push(stableRow(row));
    const before = currentItems.get(row.packageId) ?? [];
    const after = desiredItems.get(row.packageId) ?? [];
    const previousPackage = currentPackages.get(row.packageId);
    const disclosureChanged = previousPackage?.type === "package" && previousPackage.packageRow.collapsed !== row.packageRow.collapsed;
    if (!disclosureChanged) {
      rows.push(...after.map(stableRow));
      continue;
    }
    if (row.packageRow.collapsed && before.length > 0) {
      animated = true;
      rows.push(...before.map((entry) => ({ ...entry, disclosureOpacity: disclosureOpacity(entry), disclosurePhase: "leaving" as const })));
      continue;
    }
    const beforeById = new Map(before.map((entry) => [entry.id, entry]));
    for (const entry of after) {
      const previous = beforeById.get(entry.id);
      if (!previous) {
        animated = true;
        rows.push({ ...entry, height: 0, disclosureOpacity: 0, disclosurePhase: "entering" });
      } else if (("disclosurePhase" in previous && previous.disclosurePhase === "leaving") || previous.height === 0) {
        animated = true;
        rows.push({ ...entry, height: previous.height, disclosureOpacity: disclosureOpacity(previous), disclosurePhase: "entering" });
      } else {
        rows.push(stableRow(entry));
      }
    }
  }
  return { animated, rows };
}

export function mergeDownloadDisclosureRows(
  transition: readonly DownloadDisclosureRow[],
  desired: readonly DownloadLogicalRow[]
): DownloadDisclosureRow[] {
  const transitionById = new Map(transition.map((row) => [`${row.type}:${row.id}`, row]));
  const desiredIds = new Set(desired.map((row) => `${row.type}:${row.id}`));
  const leavingByPackage = new Map<string, DownloadDisclosureRow[]>();
  for (const row of transition) {
    if (row.type !== "item" || row.disclosurePhase !== "leaving" || desiredIds.has(`item:${row.id}`)) continue;
    const entries = leavingByPackage.get(row.packageId) ?? [];
    entries.push(row);
    leavingByPackage.set(row.packageId, entries);
  }

  const rows: DownloadDisclosureRow[] = [];
  for (const row of desired) {
    const animated = transitionById.get(`${row.type}:${row.id}`);
    rows.push(animated
      ? { ...row, height: animated.height, disclosureOpacity: animated.disclosureOpacity, disclosurePhase: animated.disclosurePhase }
      : stableRow(row));
    if (row.type === "package") rows.push(...(leavingByPackage.get(row.packageId) ?? []));
  }
  return rows;
}

export function activateDownloadDisclosureTransition(rows: readonly DownloadDisclosureRow[]): DownloadDisclosureRow[] {
  return rows.map((row) => {
    if (row.type !== "item" || row.disclosurePhase === "stable") return row;
    return row.disclosurePhase === "entering"
      ? { ...row, height: DOWNLOAD_FILE_ROW_HEIGHT, disclosureOpacity: 1 }
      : { ...row, height: 0, disclosureOpacity: 0 };
  });
}
