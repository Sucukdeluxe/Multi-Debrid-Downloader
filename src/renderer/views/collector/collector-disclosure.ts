export interface CollectorDisclosureRow {
  id: string;
  collapsed: boolean;
}

export function getCollectorDisclosurePinnedIds(
  previousVisibleIds: readonly string[],
  previousCollapsed: ReadonlyMap<string, boolean>,
  nextRows: readonly CollectorDisclosureRow[],
  enabled: boolean
): string[] {
  if (!enabled || previousVisibleIds.length === 0) return [];
  const nextCollapsed = new Map(nextRows.map((row) => [row.id, row.collapsed]));
  return previousVisibleIds.filter((id) => previousCollapsed.has(id)
    && nextCollapsed.has(id)
    && previousCollapsed.get(id) !== nextCollapsed.get(id));
}

export function getCollectorDisclosureViewportIds(
  rows: readonly { id: string; index: number; pinned?: boolean }[],
  startIndex: number,
  endIndex: number
): string[] {
  return rows.filter((row) => row.index >= startIndex && row.index <= endIndex).map((row) => row.id);
}

export function mergeCollectorPinnedIds(transitionPinnedIds: readonly string[], focusedPackageId: string | null): string[] {
  return [...new Set([...transitionPinnedIds, focusedPackageId].filter((id): id is string => Boolean(id)))];
}

export function getCollectorFocusPackageId(
  ranges: readonly { id: string; focusIndexStart: number; focusCount: number }[],
  focusIndex: number
): string | null {
  return ranges.find((range) => focusIndex >= range.focusIndexStart && focusIndex < range.focusIndexStart + range.focusCount)?.id ?? null;
}

export function resolveCollectorTransitionPins(current: readonly string[], fresh: readonly string[], maximum = 8): string[] {
  const freshSet = new Set(fresh);
  const merged = [...current.filter((id) => !freshSet.has(id)), ...fresh];
  return merged.slice(-Math.max(1, Math.floor(maximum)));
}
