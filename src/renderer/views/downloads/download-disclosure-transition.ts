import type { DownloadLogicalRow } from "./downloads-model";
import {
  DOWNLOAD_FILE_ROW_HEIGHT,
  calculateDownloadVirtualWindow,
  type DownloadVirtualRowInput,
  type DownloadVirtualWindowOptions
} from "./download-virtualizer";

export const DOWNLOAD_DISCLOSURE_DURATION_MS = 1500;
export const DOWNLOAD_DISCLOSURE_MAX_ANIMATED_ITEMS = 64;

export function scheduleDownloadDisclosureActivation(
  requestFrame: (callback: FrameRequestCallback) => number,
  cancelFrame: (frame: number) => void,
  activate: () => void
): () => void {
  let paintFrame = 0;
  let activationFrame = 0;
  paintFrame = requestFrame(() => {
    activationFrame = requestFrame(activate);
  });
  return () => {
    cancelFrame(paintFrame);
    if (activationFrame) cancelFrame(activationFrame);
  };
}

export type DownloadDisclosurePhase = "stable" | "entering" | "leaving";

type DownloadItemLogicalRow = Extract<DownloadLogicalRow, { type: "item" }>;

type DownloadDisclosureMeta = {
  disclosureOpacity: number;
  disclosurePhase: DownloadDisclosurePhase;
};

export type DownloadDisclosureLogicalRow = DownloadLogicalRow & DownloadDisclosureMeta;

export type DownloadDisclosureGroupRow = DownloadVirtualRowInput & DownloadDisclosureMeta & {
  type: "item-group";
  packageId: string;
  items: DownloadItemLogicalRow[];
};

export type DownloadDisclosureRow = DownloadDisclosureLogicalRow | DownloadDisclosureGroupRow;

type DownloadDisclosureSourceRow = DownloadLogicalRow | DownloadDisclosureRow;

function stableRow(row: DownloadLogicalRow): DownloadDisclosureLogicalRow {
  return { ...row, disclosureOpacity: 1, disclosurePhase: "stable" };
}

function itemGroup(
  packageId: string,
  items: readonly DownloadItemLogicalRow[],
  height: number,
  phase: Exclude<DownloadDisclosurePhase, "stable">
): DownloadDisclosureGroupRow {
  return {
    type: "item-group",
    id: `${packageId}:items`,
    packageId,
    items: items.map((row) => ({ ...row, height: DOWNLOAD_FILE_ROW_HEIGHT })),
    height,
    disclosureOpacity: phase === "entering" ? 0 : 1,
    disclosurePhase: phase
  };
}

export function stableDownloadDisclosureRows(rows: readonly DownloadLogicalRow[]): DownloadDisclosureRow[] {
  return rows.map(stableRow);
}

function itemRowsByPackage(rows: readonly DownloadDisclosureSourceRow[]): Map<string, DownloadItemLogicalRow[]> {
  const grouped = new Map<string, DownloadItemLogicalRow[]>();
  for (const row of rows) {
    if (row.type === "item-group") {
      grouped.set(row.packageId, row.items);
      continue;
    }
    if (row.type !== "item") continue;
    const entries = grouped.get(row.packageId) ?? [];
    entries.push(row);
    grouped.set(row.packageId, entries);
  }
  return grouped;
}

function groupRowsByPackage(rows: readonly DownloadDisclosureSourceRow[]): Map<string, DownloadDisclosureGroupRow> {
  return new Map(rows.filter((row): row is DownloadDisclosureGroupRow => row.type === "item-group").map((row) => [row.packageId, row]));
}

export function prepareDownloadDisclosureTransition(
  current: readonly DownloadDisclosureSourceRow[],
  desired: readonly DownloadLogicalRow[],
  enabled = true
): { animated: boolean; rows: DownloadDisclosureRow[] } {
  if (!enabled || !desired.some((row) => row.type === "package")) {
    return { animated: false, rows: stableDownloadDisclosureRows(desired) };
  }

  const currentItems = itemRowsByPackage(current);
  const currentGroups = groupRowsByPackage(current);
  const currentPackages = new Map(current.filter((row) => row.type === "package").map((row) => [row.packageId, row]));
  const desiredItems = itemRowsByPackage(desired);

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
    const previousGroup = currentGroups.get(row.packageId);
    const disclosureChanged = previousPackage?.type === "package" && previousPackage.packageRow.collapsed !== row.packageRow.collapsed;
    if (!disclosureChanged) {
      rows.push(...after.map(stableRow));
      continue;
    }
    if (row.packageRow.collapsed && before.length > 0) {
      animated = true;
      rows.push(itemGroup(row.packageId, before, previousGroup?.height ?? before.length * DOWNLOAD_FILE_ROW_HEIGHT, "leaving"));
      continue;
    }
    if (after.length > 0) {
      animated = true;
      rows.push(itemGroup(row.packageId, after, previousGroup?.height ?? 0, "entering"));
    }
  }
  return { animated, rows };
}

export function mergeDownloadDisclosureRows(
  transition: readonly DownloadDisclosureRow[],
  desired: readonly DownloadLogicalRow[]
): DownloadDisclosureRow[] {
  const transitionPackages = new Map(transition.filter((row) => row.type === "package").map((row) => [row.packageId, row]));
  const transitionGroups = groupRowsByPackage(transition);
  const desiredItems = itemRowsByPackage(desired);
  const desiredPackages = new Map(desired.filter((row) => row.type === "package").map((row) => [row.packageId, row]));
  const freshGroupItems = new Map<string, DownloadItemLogicalRow[]>();
  let groupedItemCount = 0;
  for (const group of transitionGroups.values()) {
    const packageRow = desiredPackages.get(group.packageId);
    if (!packageRow || packageRow.type !== "package") continue;
    const items = desiredItems.get(group.packageId) ?? packageRow.packageRow.items.map((item): DownloadItemLogicalRow => ({
      type: "item",
      id: item.id,
      packageId: item.packageId,
      item,
      height: DOWNLOAD_FILE_ROW_HEIGHT
    }));
    groupedItemCount += items.length;
    if (groupedItemCount > DOWNLOAD_DISCLOSURE_MAX_ANIMATED_ITEMS) {
      return stableDownloadDisclosureRows(desired);
    }
    freshGroupItems.set(group.packageId, items);
  }
  const rows: DownloadDisclosureRow[] = [];

  for (const row of desired) {
    if (row.type !== "package") continue;
    const animatedPackage = transitionPackages.get(row.packageId);
    rows.push(animatedPackage?.type === "package"
      ? { ...row, height: animatedPackage.height, disclosureOpacity: animatedPackage.disclosureOpacity, disclosurePhase: animatedPackage.disclosurePhase }
      : stableRow(row));

    const group = transitionGroups.get(row.packageId);
    if (!group) {
      rows.push(...(desiredItems.get(row.packageId) ?? []).map(stableRow));
      continue;
    }

    const freshItems = freshGroupItems.get(row.packageId) ?? [];
    rows.push({
      ...group,
      items: freshItems,
      height: group.height > 0 ? freshItems.length * DOWNLOAD_FILE_ROW_HEIGHT : 0
    });
  }
  return rows;
}

export function activateDownloadDisclosureTransition(rows: readonly DownloadDisclosureRow[]): DownloadDisclosureRow[] {
  return rows.map((row) => {
    if (row.type !== "item-group") return row;
    return row.disclosurePhase === "entering"
      ? { ...row, height: row.items.length * DOWNLOAD_FILE_ROW_HEIGHT, disclosureOpacity: 1 }
      : { ...row, height: 0, disclosureOpacity: 0 };
  });
}

export function getDownloadDisclosurePinnedIds(
  preparedRows: readonly DownloadDisclosureRow[],
  options: DownloadVirtualWindowOptions
): string[] {
  const windowOptions = { ...options, pinnedIds: [] };
  const startRows = calculateDownloadVirtualWindow(preparedRows, windowOptions).rows;
  const targetRows = calculateDownloadVirtualWindow(activateDownloadDisclosureTransition(preparedRows), windowOptions).rows;
  return [...new Set([...startRows, ...targetRows].map((entry) => entry.id))];
}
