import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { buildDownloadLogicalRows, type DownloadLogicalRow } from "./downloads-model";
import type { DownloadsViewActions, DownloadsViewModel } from "./DownloadsView";
import { ItemRow, PackageCard } from "./DownloadsTable";
import { calculateDownloadVirtualWindow, DOWNLOAD_VIRTUAL_DEFAULT_VIEWPORT_HEIGHT, DOWNLOAD_VIRTUAL_OVERSCAN_ROWS } from "./download-virtualizer";

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

function rowStyle(top: number, height: number): CSSProperties {
  return {
    "--downloads-virtual-row-top": `${top}px`,
    "--downloads-virtual-row-height": `${height}px`
  } as CSSProperties;
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
      renderItems={false}
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
  const logicalRows = useMemo(() => buildDownloadLogicalRows(model), [model]);
  const virtualWindow = useMemo(() => calculateDownloadVirtualWindow(logicalRows, {
    scrollTop: viewport.scrollTop,
    viewportHeight: viewport.viewportHeight,
    overscan: DOWNLOAD_VIRTUAL_OVERSCAN_ROWS,
    pinnedIds: [model.editingPackageId]
  }), [logicalRows, model.editingPackageId, viewport.scrollTop, viewport.viewportHeight]);
  const spacerStyle = { "--downloads-virtual-total-height": `${virtualWindow.totalHeight}px` } as CSSProperties;

  return (
    <div className="downloads-table-body" data-visual-region="downloads-table-body" ref={bodyRef} role="rowgroup">
      {state}
      {!state ? (
        <div className="downloads-virtual-spacer" style={spacerStyle}>
          {virtualWindow.rows.map((entry) => (
            <div className="downloads-virtual-row" data-download-virtual-index={entry.index} key={`${entry.id}:${entry.index}`} style={rowStyle(entry.top, entry.height)}>
              {renderVirtualRow(entry.source, model, actions)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
