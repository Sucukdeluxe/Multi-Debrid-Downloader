import type { DownloadLogicalRow } from "./downloads-model";

export const DOWNLOAD_ORDER_TRANSITION_DURATION_MS = 3000;
export const DOWNLOAD_ORDER_TRANSITION_MAX_PINNED_ROWS = 96;
const DOWNLOAD_ORDER_TRANSITION_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

export interface DownloadOrderAnimationResult {
  animations: Animation[];
  targetTops: Map<string, number>;
}

export function getDownloadPackageOrder(rows: readonly DownloadLogicalRow[]): string[] {
  return rows.filter((row) => row.type === "package").map((row) => row.id);
}

export function isDownloadPackageOrderChange(previous: readonly string[], next: readonly string[]): boolean {
  if (previous.length !== next.length || previous.length < 2) return false;
  const previousIds = new Set(previous);
  if (next.some((id) => !previousIds.has(id))) return false;
  return next.some((id, index) => previous[index] !== id);
}

export function shouldAnimateDownloadOrderChange(input: { animationsEnabled: boolean; sortRevision: number; appliedSortRevision: number }): boolean {
  return input.animationsEnabled && input.sortRevision === input.appliedSortRevision;
}

export function hasRemovedDownloadItems(previous: Readonly<Record<string, unknown>> | undefined, current: Readonly<Record<string, unknown>> | undefined): boolean {
  return Boolean(previous && current && previous !== current && Object.keys(previous).some((id) => !Object.hasOwn(current, id)));
}

export function getDownloadOrderTransitionPinnedIds(input: {
  enabled: boolean;
  previousOrder: readonly string[];
  nextOrder: readonly string[];
  previousVisibleIds: readonly string[];
  activePinnedIds: readonly string[];
}): string[] {
  if (!input.enabled) return [];
  if (!isDownloadPackageOrderChange(input.previousOrder, input.nextOrder)) return [...input.activePinnedIds];
  return [...new Set([...input.activePinnedIds, ...input.previousVisibleIds])].slice(0, DOWNLOAD_ORDER_TRANSITION_MAX_PINNED_ROWS);
}

export function captureDownloadOrderRowTops(container: HTMLElement): Map<string, number> {
  const tops = new Map<string, number>();
  for (const element of container.querySelectorAll<HTMLElement>(".downloads-virtual-row[data-download-row-id]")) {
    const id = element.dataset.downloadRowId;
    if (id) tops.set(id, element.getBoundingClientRect().top);
  }
  return tops;
}

export function getDownloadOrderTransformKeyframes(virtualTop: number, previousTop: number, targetTop: number): Keyframe[] {
  const offset = previousTop - targetTop;
  return [
    { transform: `translateY(${virtualTop + offset}px)` },
    { transform: `translateY(${virtualTop}px)` }
  ];
}

export function animateDownloadOrderRows(container: HTMLElement, previousTops: ReadonlyMap<string, number>): DownloadOrderAnimationResult {
  const targetTops = captureDownloadOrderRowTops(container);
  const animations: Animation[] = [];
  for (const element of container.querySelectorAll<HTMLElement>(".downloads-virtual-row[data-download-row-id]")) {
    const id = element.dataset.downloadRowId;
    const previousTop = id ? previousTops.get(id) : undefined;
    const targetTop = id ? targetTops.get(id) : undefined;
    const virtualTop = Number.parseFloat(element.style.getPropertyValue("--downloads-virtual-row-top"));
    if (previousTop === undefined || targetTop === undefined || !Number.isFinite(virtualTop) || Math.abs(previousTop - targetTop) < 0.5) continue;
    animations.push(element.animate(getDownloadOrderTransformKeyframes(virtualTop, previousTop, targetTop), {
      duration: DOWNLOAD_ORDER_TRANSITION_DURATION_MS,
      easing: DOWNLOAD_ORDER_TRANSITION_EASING
    }));
  }
  return { animations, targetTops };
}
