import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { buildDownloadLogicalRows, type DownloadLogicalRow } from "./downloads-model";
import {
  activateDownloadDisclosureTransition,
  DOWNLOAD_DISCLOSURE_DURATION_MS,
  mergeDownloadDisclosureRows,
  prepareDownloadDisclosureTransition,
  scheduleDownloadDisclosureActivation,
  type DownloadDisclosureRow
} from "./download-disclosure-transition";
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

function renderVirtualRow(row: DownloadLogicalRow, model: DownloadsViewModel, actions: DownloadsViewActions): ReactElement {
  if (row.type === "item") {
    return (
      <ItemRow actions={actions} columnOrder={model.columnOrder} gridTemplate={model.gridTemplate} item={row.item} selected={model.selectedIds.has(row.item.id)} sessionRunning={model.running} />
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
  const [transitionRows, setTransitionRows] = useState<DownloadDisclosureRow[] | null>(null);

  useEffect(() => {
    if (!transitionRowsRef.current) previousRowsRef.current = desiredRows;
  }, [desiredRows]);

  useRendererLayoutEffect(() => {
    const prepared = prepareDownloadDisclosureTransition(transitionRowsRef.current ?? previousRowsRef.current, desiredRowsRef.current);
    if (!prepared.animated) {
      transitionRowsRef.current = null;
      previousRowsRef.current = desiredRowsRef.current;
      setTransitionRows(null);
      return;
    }
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
        setTransitionRows(null);
      }, DOWNLOAD_DISCLOSURE_DURATION_MS);
    });
    return () => {
      cancelActivation();
      if (settleTimer) window.clearTimeout(settleTimer);
    };
  }, [model.disclosureRevision, model.displayMode]);

  const renderedRows = useMemo(() => transitionRows ? mergeDownloadDisclosureRows(transitionRows, desiredRows) : desiredRows, [desiredRows, transitionRows]);
  const virtualWindow = useMemo(() => calculateDownloadVirtualWindow(renderedRows, {
    scrollTop: viewport.scrollTop,
    viewportHeight: viewport.viewportHeight,
    overscan: DOWNLOAD_VIRTUAL_OVERSCAN_ROWS,
    pinnedIds: [model.editingPackageId]
  }), [model.editingPackageId, renderedRows, viewport.scrollTop, viewport.viewportHeight]);
  const spacerStyle = { "--downloads-virtual-total-height": `${virtualWindow.totalHeight}px` } as CSSProperties;

  return (
    <div className="downloads-table-body" data-visual-region="downloads-table-body" ref={bodyRef} role="rowgroup">
      {state}
      {!state ? (
        <div className="downloads-virtual-spacer" style={spacerStyle}>
          {virtualWindow.rows.map((entry) => (
            <div className={`downloads-virtual-row${disclosureClassName(entry.source)}`} data-download-virtual-index={entry.index} key={`${entry.source.type}:${entry.id}`} style={rowStyle(entry.top, entry.height, disclosureOpacity(entry.source))}>
              {renderVirtualRow(entry.source, model, actions)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
