import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from "react";
import type { DownloadItem } from "../../../shared/types";
import { buildDownloadLogicalRows, type DownloadDisplayMode, type DownloadLogicalRow } from "./downloads-model";
import {
  activateDownloadDisclosureTransition,
  DOWNLOAD_DISCLOSURE_DURATION_MS,
  getDownloadDisclosurePinnedIds,
  mergeDownloadDisclosureRows,
  prepareDownloadDisclosureTransition,
  scheduleDownloadDisclosureActivation,
  stableDownloadDisclosureRows,
  type DownloadDisclosureRow
} from "./download-disclosure-transition";
import {
  DOWNLOAD_ORDER_TRANSITION_DURATION_MS,
  animateDownloadOrderRows,
  captureDownloadOrderRowTops,
  getDownloadOrderTransitionPinnedIds,
  shouldAnimateDownloadOrderChange,
  getDownloadPackageOrder,
  isDownloadPackageOrderChange
} from "./download-order-transition";
import type { DownloadsViewActions, DownloadsViewModel } from "./DownloadsView";
import { ItemRow, PackageCard } from "./DownloadsTable";
import { calculateDownloadVirtualWindow, DOWNLOAD_VIRTUAL_DEFAULT_VIEWPORT_HEIGHT, DOWNLOAD_VIRTUAL_OVERSCAN_ROWS } from "./download-virtualizer";

const useRendererLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

interface DownloadViewportState {
  scrollTop: number;
  viewportHeight: number;
}

function useDownloadViewport(bodyRef: React.RefObject<HTMLDivElement>): DownloadViewportState {
  const [viewport, setViewport] = useState<DownloadViewportState>({ scrollTop: 0, viewportHeight: DOWNLOAD_VIRTUAL_DEFAULT_VIEWPORT_HEIGHT });

  useEffect(() => {
    const body = bodyRef.current;
    const scrollport = body?.closest<HTMLElement>(".downloads-table");
    if (!body || !scrollport) return;
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const next = {
        scrollTop: scrollport.scrollTop,
        viewportHeight: scrollport.clientHeight || DOWNLOAD_VIRTUAL_DEFAULT_VIEWPORT_HEIGHT
      };
      setViewport((current) => current.scrollTop === next.scrollTop && current.viewportHeight === next.viewportHeight ? current : next);
    };
    const schedule = (): void => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(measure);
    };
    measure();
    scrollport.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      scrollport.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [bodyRef]);

  return viewport;
}

function rowStyle(top: number, height: number, opacity: number): CSSProperties {
  return {
    "--downloads-virtual-row-top": `${top}px`,
    "--downloads-virtual-row-height": `${height}px`,
    opacity
  } as CSSProperties;
}

function disclosureClassName(row: DownloadLogicalRow | DownloadDisclosureRow): string {
  return "disclosurePhase" in row ? ` is-${row.disclosurePhase}` : "";
}

function disclosureOpacity(row: DownloadLogicalRow | DownloadDisclosureRow): number {
  return "disclosureOpacity" in row && typeof row.disclosureOpacity === "number" ? row.disclosureOpacity : 1;
}

export function isDownloadItemVisuallySelected(
  item: Pick<DownloadItem, "id" | "packageId">,
  selectedIds: ReadonlySet<string>,
  displayMode: DownloadDisplayMode
): boolean {
  return selectedIds.has(item.id) || (displayMode === "packages" && selectedIds.has(item.packageId));
}

function renderVirtualRow(row: DownloadLogicalRow | DownloadDisclosureRow, model: DownloadsViewModel, actions: DownloadsViewActions): ReactElement {
  if (row.type === "item-group") {
    return (
      <div className="downloads-disclosure-item-group">
        {row.items.map((entry) => (
          <ItemRow actions={actions} columnOrder={model.columnOrder} gridTemplate={model.gridTemplate} item={entry.item} key={entry.id} selected={isDownloadItemVisuallySelected(entry.item, model.selectedIds, model.displayMode)} sessionRunning={model.running} />
        ))}
      </div>
    );
  }
  if (row.type === "item") {
    return (
      <ItemRow actions={actions} columnOrder={model.columnOrder} gridTemplate={model.gridTemplate} item={row.item} selected={isDownloadItemVisuallySelected(row.item, model.selectedIds, model.displayMode)} sessionRunning={model.running} />
    );
  }
  return (
    <PackageCard
      actions={actions}
      columnOrder={model.columnOrder}
      editing={model.editingPackageId === row.packageId}
      editingName={model.editingName}
      gridTemplate={model.gridTemplate}
      packageSpeedBps={model.packageSpeedBps[row.packageId] ?? 0}
      row={row.packageRow}
      selectedIds={model.selectedIds}
      selectedVersion={model.actionableSelectedIds.length}
      sessionRunning={model.running}
    />
  );
}

export function VirtualizedDownloadsBody({ actions, model, state }: { actions: DownloadsViewActions; model: DownloadsViewModel; state: ReactElement | null }): ReactElement {
  const bodyRef = useRef<HTMLDivElement>(null);
  const viewport = useDownloadViewport(bodyRef);
  const desiredRows = useMemo(() => buildDownloadLogicalRows(model), [model]);
  const desiredRowsRef = useRef(desiredRows);
  desiredRowsRef.current = desiredRows;
  const previousRowsRef = useRef<readonly DownloadLogicalRow[]>(desiredRows);
  const transitionRowsRef = useRef<DownloadDisclosureRow[] | null>(null);
  const transitionPinnedIdsRef = useRef<string[]>([]);
  const [transitionRows, setTransitionRows] = useState<DownloadDisclosureRow[] | null>(null);
  const packageOrder = getDownloadPackageOrder(desiredRows);
  const previousPackageOrderRef = useRef<readonly string[]>(packageOrder);
  const previousVisibleIdsRef = useRef<readonly string[]>([]);
  const orderTransitionPinnedIdsRef = useRef<string[]>([]);
  const orderTransitionTimerRef = useRef(0);
  const orderAnimationsRef = useRef<Animation[]>([]);
  const orderRowTopsRef = useRef<Map<string, number>>(new Map());
  const [, setOrderTransitionRevision] = useState(0);
  const packageOrderChanged = isDownloadPackageOrderChange(previousPackageOrderRef.current, packageOrder);
  const packageOrderSortRevision = model.packageOrderSortRevision ?? 0;
  const appliedSortRevisionRef = useRef(packageOrderSortRevision);
  const orderAnimationsEnabled = shouldAnimateDownloadOrderChange({
    animationsEnabled: model.animationsEnabled,
    sortRevision: packageOrderSortRevision,
    appliedSortRevision: appliedSortRevisionRef.current
  });
  const orderTransitionPinnedIds = getDownloadOrderTransitionPinnedIds({
    enabled: orderAnimationsEnabled,
    previousOrder: previousPackageOrderRef.current,
    nextOrder: packageOrder,
    previousVisibleIds: previousVisibleIdsRef.current,
    activePinnedIds: orderTransitionPinnedIdsRef.current
  });

  useEffect(() => {
    if (!transitionRowsRef.current) previousRowsRef.current = desiredRows;
  }, [desiredRows]);

  useRendererLayoutEffect(() => {
    const prepared = prepareDownloadDisclosureTransition(
      transitionRowsRef.current ?? previousRowsRef.current,
      desiredRowsRef.current,
      model.animationsEnabled
    );
    if (!prepared.animated) {
      transitionRowsRef.current = null;
      transitionPinnedIdsRef.current = [];
      previousRowsRef.current = desiredRowsRef.current;
      setTransitionRows(null);
      return;
    }
    transitionPinnedIdsRef.current = getDownloadDisclosurePinnedIds(prepared.rows, {
      scrollTop: viewport.scrollTop,
      viewportHeight: viewport.viewportHeight,
      overscan: DOWNLOAD_VIRTUAL_OVERSCAN_ROWS
    });
    transitionRowsRef.current = prepared.rows;
    setTransitionRows(prepared.rows);
    let settleTimer = 0;
    const cancelActivation = scheduleDownloadDisclosureActivation(window.requestAnimationFrame.bind(window), window.cancelAnimationFrame.bind(window), () => {
      const active = activateDownloadDisclosureTransition(transitionRowsRef.current ?? prepared.rows);
      transitionRowsRef.current = active;
      setTransitionRows(active);
      settleTimer = window.setTimeout(() => {
        previousRowsRef.current = desiredRowsRef.current;
        transitionRowsRef.current = null;
        transitionPinnedIdsRef.current = [];
        setTransitionRows(null);
      }, DOWNLOAD_DISCLOSURE_DURATION_MS);
    });
    return () => {
      cancelActivation();
      if (settleTimer) window.clearTimeout(settleTimer);
    };
  }, [model.animationsEnabled, model.disclosureRevision, model.displayMode]);

  const renderedRows = useMemo<DownloadDisclosureRow[]>(() => transitionRows ? mergeDownloadDisclosureRows(transitionRows, desiredRows) : stableDownloadDisclosureRows(desiredRows), [desiredRows, transitionRows]);
  const virtualWindow = useMemo(() => calculateDownloadVirtualWindow(renderedRows, {
    scrollTop: viewport.scrollTop,
    viewportHeight: viewport.viewportHeight,
    overscan: DOWNLOAD_VIRTUAL_OVERSCAN_ROWS,
    pinnedIds: [model.editingPackageId, ...transitionPinnedIdsRef.current, ...orderTransitionPinnedIds]
  }), [model.editingPackageId, orderTransitionPinnedIds, renderedRows, viewport.scrollTop, viewport.viewportHeight]);

  useRendererLayoutEffect(() => {
    previousPackageOrderRef.current = packageOrder;
    previousVisibleIdsRef.current = virtualWindow.rows.map((entry) => entry.id);
    appliedSortRevisionRef.current = packageOrderSortRevision;
    const body = bodyRef.current;
    if (!body) return;
    if (!orderAnimationsEnabled) {
      for (const animation of orderAnimationsRef.current) animation.cancel();
      orderAnimationsRef.current = [];
      orderRowTopsRef.current = captureDownloadOrderRowTops(body);
      if (orderTransitionTimerRef.current) window.clearTimeout(orderTransitionTimerRef.current);
      orderTransitionTimerRef.current = 0;
      orderTransitionPinnedIdsRef.current = [];
      return;
    }
    if (!packageOrderChanged) {
      if (orderAnimationsRef.current.every((animation) => animation.playState === "finished" || animation.playState === "idle")) {
        orderAnimationsRef.current = [];
        orderRowTopsRef.current = captureDownloadOrderRowTops(body);
      }
      return;
    }
    const previousTops = orderAnimationsRef.current.length > 0 ? captureDownloadOrderRowTops(body) : orderRowTopsRef.current;
    for (const animation of orderAnimationsRef.current) animation.cancel();
    const animated = animateDownloadOrderRows(body, previousTops);
    orderAnimationsRef.current = animated.animations;
    orderRowTopsRef.current = animated.targetTops;
    orderTransitionPinnedIdsRef.current = orderTransitionPinnedIds;
    if (orderTransitionTimerRef.current) window.clearTimeout(orderTransitionTimerRef.current);
    orderTransitionTimerRef.current = window.setTimeout(() => {
      orderTransitionPinnedIdsRef.current = [];
      orderTransitionTimerRef.current = 0;
      setOrderTransitionRevision((revision) => revision + 1);
    }, DOWNLOAD_ORDER_TRANSITION_DURATION_MS);
  }, [orderAnimationsEnabled, orderTransitionPinnedIds, packageOrder, packageOrderChanged, packageOrderSortRevision, virtualWindow.rows]);

  useEffect(() => () => {
    if (orderTransitionTimerRef.current) window.clearTimeout(orderTransitionTimerRef.current);
    for (const animation of orderAnimationsRef.current) animation.cancel();
  }, []);
  const spacerStyle = { "--downloads-virtual-total-height": `${virtualWindow.totalHeight}px` } as CSSProperties;

  return (
    <div className={`downloads-table-body${orderAnimationsEnabled ? "" : " is-download-motion-disabled"}`} data-visual-region="downloads-table-body" ref={bodyRef} role="rowgroup">
      {state}
      {!state ? (
        <div className="downloads-virtual-spacer" style={spacerStyle}>
          {virtualWindow.rows.map((entry) => (
            <div className={`downloads-virtual-row${entry.source.type === "item-group" ? " is-disclosure-group" : ""}${disclosureClassName(entry.source)}`} data-download-row-id={entry.id} data-download-virtual-index={entry.index} key={`${entry.source.type}:${entry.id}`} style={rowStyle(entry.top, entry.height, disclosureOpacity(entry.source))}>
              {renderVirtualRow(entry.source, model, actions)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
