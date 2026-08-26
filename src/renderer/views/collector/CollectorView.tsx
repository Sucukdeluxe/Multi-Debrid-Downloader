import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type ReactElement } from "react";
import { formatDateTime, formatHosterLabel, humanSize } from "../../download-format";
import { DataTable, DataTableBody, DataTableEmpty, DataTableHeader } from "../../ui/DataTable";
import { Dialog } from "../../ui/Dialog";
import { SlidingSelection } from "../../ui/SlidingSelection";
import { Toolbar, ToolbarGroup, ToolbarSearch } from "../../ui/Toolbar";
import { calculateDownloadVirtualWindow, DOWNLOAD_VIRTUAL_DEFAULT_VIEWPORT_HEIGHT } from "../downloads/download-virtualizer";
import { getCollectorDisclosurePinnedIds, getCollectorDisclosureViewportIds, getCollectorFocusPackageId, mergeCollectorPinnedIds, resolveCollectorTransitionPins } from "./collector-disclosure";
import type {
  CollectorWorkspaceFilter,
  CollectorWorkspacePackageRow,
  CollectorWorkspaceViewModel
} from "./collector-model";
import "./collector.css";

const useRendererLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface CollectorViewActions {
  onFilterChange: (filter: CollectorWorkspaceFilter) => void;
  onOpenInput: () => void;
  onImportDlc: () => void;
  onImportFile: () => void;
  onSubmitSelected: () => void;
  onSubmitAll: () => void;
  onQueryChange: (value: string) => void;
  onLinkSelectionChange: (linkId: string, selected: boolean) => void;
  onPackageSelectionChange: (packageId: string, selected: boolean) => void;
  onPackageCollapseChange: (packageId: string) => void;
  onToggleAllPackages: () => void;
  onRemoveSelected: () => void;
}

export type CollectorViewRegion = "all" | "sidebar" | "toolbar" | "content";

export interface CollectorViewProps {
  model: CollectorWorkspaceViewModel;
  actions: CollectorViewActions;
  region?: CollectorViewRegion;
}

export interface CollectorInputDialogProps {
  open: boolean;
  tabName?: string;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onCommit: () => void;
}

function packageStatus(row: CollectorWorkspacePackageRow): string {
  if (row.offlineCount === row.totalCount) return "Offline";
  if (row.onlineCount === row.totalCount) return "Online";
  if (row.onlineCount > 0) return "Teilweise online";
  return "Ungeprüft";
}

function packageAvailability(row: CollectorWorkspacePackageRow): string {
  if (row.onlineCount === row.totalCount) return `${row.onlineCount}/${row.totalCount} online`;
  if (row.offlineCount === row.totalCount) return "Offline";
  if (row.onlineCount > 0) return `${row.onlineCount}/${row.totalCount} online`;
  return "Ungeprüft";
}

function packageSize(row: CollectorWorkspacePackageRow): string {
  if (row.totalBytes <= 0) return "Unbekannt";
  return `${row.unknownSizeCount > 0 ? "≥ " : ""}${humanSize(row.totalBytes)}`;
}

function availabilityClass(row: CollectorWorkspacePackageRow): string {
  if (row.offlineCount === row.totalCount) return "offline";
  if (row.onlineCount === row.totalCount) return "online";
  return "unknown";
}

function availabilityTone(online: number, offline: number, total: number): "online" | "offline" | "partial" | "unknown" {
  if (online === total) return "online";
  if (offline === total) return "offline";
  if (online > 0) return "partial";
  return "unknown";
}

function linkAvailability(availability: "online" | "offline" | "unknown"): string {
  if (availability === "online") return "Online";
  if (availability === "offline") return "Offline";
  return "Ungeprüft";
}

export function collectorPackageIntrinsicBlockSize(row: CollectorWorkspacePackageRow): number {
  return 46 + (row.collapsed ? 0 : row.links.length * 40);
}

export function collectorFileInteractionAttributes(
  rowIndexStart: number,
  focusIndexStart: number,
  linkIndex: number,
  collapsed: boolean
): { rowIndex: number | undefined; focusIndex: number | undefined; tabIndex: number | undefined } {
  return collapsed
    ? { rowIndex: undefined, focusIndex: undefined, tabIndex: -1 }
    : { rowIndex: rowIndexStart + linkIndex + 1, focusIndex: focusIndexStart + linkIndex + 2, tabIndex: undefined };
}

interface CollectorViewportState {
  scrollLeft: number;
  scrollTop: number;
  viewportHeight: number;
}

interface CollectorVirtualPackage {
  focusCount: number;
  focusIndexStart: number;
  id: string;
  height: number;
  rowIndex: number;
  row: CollectorWorkspacePackageRow;
}

function useCollectorViewport(bodyRef: React.RefObject<HTMLDivElement>): CollectorViewportState {
  const [viewport, setViewport] = useState<CollectorViewportState>({
    scrollLeft: 0,
    scrollTop: 0,
    viewportHeight: DOWNLOAD_VIRTUAL_DEFAULT_VIEWPORT_HEIGHT
  });
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const next = {
        scrollLeft: body.scrollLeft,
        scrollTop: body.scrollTop,
        viewportHeight: body.clientHeight || DOWNLOAD_VIRTUAL_DEFAULT_VIEWPORT_HEIGHT
      };
      setViewport((current) => current.scrollLeft === next.scrollLeft && current.scrollTop === next.scrollTop && current.viewportHeight === next.viewportHeight ? current : next);
    };
    const schedule = (): void => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(measure);
    };
    measure();
    body.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      body.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [bodyRef]);
  return viewport;
}

export function collectorHeaderScrollStyle(scrollLeft: number): CSSProperties {
  return { transform: `translateX(${-Math.max(0, scrollLeft)}px)` };
}

function collectorVirtualPackageStyle(top: number, height: number): CSSProperties {
  return {
    "--collector-virtual-package-top": `${top}px`,
    "--collector-virtual-package-height": `${height}px`
  } as CSSProperties;
}

export function toggleAllCollectorPackageIds(
  packageIds: readonly string[],
  collapsedPackageIds: ReadonlySet<string>
): Set<string> {
  return packageIds.some((packageId) => !collapsedPackageIds.has(packageId))
    ? new Set(packageIds)
    : new Set();
}

function CollectorHosterLabel({ hoster }: { hoster: ReturnType<typeof formatHosterLabel> }): ReactElement {
  return (
    <span className="collector-hoster-label" title={hoster.title}>
      {hoster.iconSrc ? (
        <>
          <img
            alt=""
            className="collector-hoster-icon"
            data-hoster={hoster.title.toLowerCase()}
            onError={(event) => {
              event.currentTarget.hidden = true;
              event.currentTarget.nextElementSibling?.removeAttribute("hidden");
            }}
            src={hoster.iconSrc}
          />
          <span hidden>{hoster.compact}</span>
        </>
      ) : hoster.compact}
    </span>
  );
}

export function CollectorSidebar({ model, actions }: CollectorViewProps): ReactElement {
  return (
    <div aria-label="Linksammler-Filter" className="collector-sidebar" data-visual-region="collector-sidebar">
      <div className="collector-sidebar-heading"><strong>Status</strong><span>{model.totalCount}</span></div>
      <SlidingSelection activeKey={model.filter} axis="vertical" className="collector-sidebar-list">
        {model.filters.map((filter) => (
          <button
            aria-current={filter.id === model.filter ? "page" : undefined}
            className={`collector-sidebar-filter${filter.id === model.filter ? " is-active" : ""}`}
            data-sliding-selection-active={filter.id === model.filter}
            data-sliding-selection-item="true"
            key={filter.id}
            onClick={() => actions.onFilterChange(filter.id)}
            type="button"
          >
            <span>{filter.label}</span><span>{filter.count}</span>
          </button>
        ))}
      </SlidingSelection>
    </div>
  );
}

export function CollectorSidebarStatus({ model }: { model: CollectorWorkspaceViewModel }): ReactElement {
  return (
    <>
      <span>Pakete: {model.packageCount}</span>
      <span>Links: {model.totalCount}</span>
      <span>Ausgewählt: {model.selectedCount}</span>
      {model.analyzing ? (
        <span aria-live="polite" className="collector-sidebar-analysis" role="status"><span aria-hidden="true" />Analyse läuft im Hintergrund</span>
      ) : null}
    </>
  );
}

export function CollectorToolbar({ model, actions }: CollectorViewProps): ReactElement {
  return (
    <Toolbar className="collector-toolbar" data-visual-region="collector-toolbar" label="Linksammler-Aktionen">
      <ToolbarGroup label="Links erfassen">
        <button className="collector-action collector-action-primary" onClick={actions.onOpenInput} type="button">Links hinzufügen</button>
        <button className="collector-action" onClick={actions.onImportDlc} type="button">DLC importieren</button>
        <button className="collector-action" onClick={actions.onImportFile} type="button">Datei importieren</button>
      </ToolbarGroup>
      <ToolbarGroup label="Downloads übergeben">
        <button className="collector-action" disabled={model.selectedCount === 0} onClick={actions.onSubmitSelected} type="button">{`Auswahl übergeben (${model.selectedCount})`}</button>
        <button className="collector-action" disabled={model.totalCount === 0} onClick={actions.onSubmitAll} type="button">{`Alle übergeben (${model.totalCount})`}</button>
        <button className="collector-action collector-action-danger" disabled={model.selectedCount === 0} onClick={actions.onRemoveSelected} type="button">Auswahl entfernen</button>
      </ToolbarGroup>
      <ToolbarGroup className="collector-toolbar-tail" label="Suche und Paketdarstellung">
        <ToolbarSearch label="Links durchsuchen" onChange={(event) => actions.onQueryChange(event.target.value)} placeholder="Name, URL oder Hoster" value={model.query} />
        <button className="collector-action" disabled={model.totalCount === 0} onClick={actions.onToggleAllPackages} type="button">Alle ein-/ausklappen</button>
      </ToolbarGroup>
    </Toolbar>
  );
}

function CollectorPackageGroup({ row, model, actions, selected, focusIndexStart, rowIndexStart }: {
  focusIndexStart: number;
  row: CollectorWorkspacePackageRow;
  model: CollectorWorkspaceViewModel;
  actions: CollectorViewActions;
  selected: ReadonlySet<string>;
  rowIndexStart: number;
}): ReactElement {
  const allSelected = row.selectedCount === row.totalCount;
  const partiallySelected = row.selectedCount > 0 && !allSelected;
  const animateItems = model.animationsEnabled && row.allLinks.length <= 64;
  const [renderItems, setRenderItems] = useState(!row.collapsed);
  const [expanding, setExpanding] = useState(false);
  const previousCollapsedRef = useRef(row.collapsed);
  const packageStyle: CSSProperties = {
    containIntrinsicBlockSize: `auto ${collectorPackageIntrinsicBlockSize(row)}px`,
    flex: "0 0 auto"
  };
  useEffect(() => {
    const changed = previousCollapsedRef.current !== row.collapsed;
    previousCollapsedRef.current = row.collapsed;
    if (!changed) return;
    if (!row.collapsed) {
      setRenderItems(true);
      if (!animateItems) {
        setExpanding(false);
        return;
      }
      setExpanding(true);
      const timer = window.setTimeout(() => setExpanding(false), 300);
      return () => window.clearTimeout(timer);
    }
    setExpanding(false);
    if (!animateItems) {
      setRenderItems(false);
      return;
    }
    const timer = window.setTimeout(() => setRenderItems(false), 300);
    return () => window.clearTimeout(timer);
  }, [animateItems, row.collapsed]);
  const animateDisclosure = animateItems && (row.collapsed || expanding);
  return (
    <div className={`collector-package-group${row.collapsed ? " is-collapsed" : ""}${model.animationsEnabled ? " is-motion-enabled" : ""}`} role="rowgroup" style={packageStyle}>
      <div aria-rowindex={rowIndexStart} className={`collector-package-row${row.selectedCount > 0 ? " is-selected" : ""}`} role="row">
        <span className="collector-column-select" role="cell">
          <input
            aria-checked={partiallySelected ? "mixed" : allSelected}
            aria-label={`Paket ${row.name} auswählen`}
            checked={allSelected}
            data-collector-focus-index={focusIndexStart}
            onChange={(event) => actions.onPackageSelectionChange(row.id, event.target.checked)}
            ref={(node) => { if (node) node.indeterminate = partiallySelected; }}
            type="checkbox"
          />
        </span>
        <span className="collector-name-cell" role="cell">
          <button
            aria-expanded={!row.collapsed}
            aria-label={row.collapsed ? `${row.name} ausklappen` : `${row.name} einklappen`}
            className="collector-collapse-button"
            data-collector-focus-index={focusIndexStart + 1}
            onClick={() => actions.onPackageCollapseChange(row.id)}
            type="button"
          >{row.collapsed ? "+" : "−"}</button>
          <strong title={row.name}>{row.name}</strong>
          <small>{row.totalCount} Dateien</small>
        </span>
        <span className="collector-size-cell" role="cell">{packageSize(row)}</span>
        <span className="collector-hoster-cell" role="cell">
          {row.hosters.map(formatHosterLabel).map((hoster) => <CollectorHosterLabel hoster={hoster} key={hoster.title} />)}
        </span>
        <span className={`collector-status-cell is-${availabilityTone(row.onlineCount, row.offlineCount, row.totalCount)}`} role="cell">{packageStatus(row)}</span>
        <span className={`collector-availability-cell is-${availabilityClass(row)}`} role="cell">{packageAvailability(row)}</span>
        <span className="collector-added-cell" role="cell">{formatDateTime(row.addedAt)}</span>
      </div>
      {renderItems ? (
        <div aria-hidden={row.collapsed ? true : undefined} className={`collector-package-items-frame${row.collapsed ? " is-collapsed" : ""}${animateDisclosure ? " is-animated" : ""}${expanding ? " is-expanding" : ""}`}>
          <div className="collector-package-items">
            {row.links.map((link, linkIndex) => {
              const hoster = formatHosterLabel(link.hoster);
              const interaction = collectorFileInteractionAttributes(rowIndexStart, focusIndexStart, linkIndex, row.collapsed);
              return (
                <div aria-rowindex={interaction.rowIndex} className={`collector-file-row${selected.has(link.id) ? " is-selected" : ""}`} key={link.id} role="row">
                  <span className="collector-column-select" role="cell">
                    <input aria-label={`${link.fileName} auswählen`} checked={selected.has(link.id)} data-collector-focus-index={interaction.focusIndex} onChange={(event) => actions.onLinkSelectionChange(link.id, event.target.checked)} tabIndex={interaction.tabIndex} type="checkbox" />
                  </span>
                  <span className="collector-name-cell is-file" role="cell" title={link.url}><span className={`collector-link-state is-${link.availability}`} />{link.fileName}</span>
                  <span className="collector-size-cell" role="cell">{link.fileSizeBytes === null ? "Unbekannt" : humanSize(link.fileSizeBytes)}</span>
                  <span className="collector-hoster-cell" role="cell"><CollectorHosterLabel hoster={hoster} /></span>
                  <span className={`collector-status-cell is-${link.availability}`} role="cell">{linkAvailability(link.availability)}</span>
                  <span className={`collector-availability-cell is-${link.availability}`} role="cell">{linkAvailability(link.availability)}</span>
                  <span className="collector-added-cell" role="cell">{formatDateTime(link.addedAt)}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function CollectorContent({ model, actions }: CollectorViewProps): ReactElement {
  const selected = new Set(model.selectedIds);
  const bodyRef = useRef<HTMLDivElement>(null);
  const viewport = useCollectorViewport(bodyRef);
  const virtualPackages = useMemo<CollectorVirtualPackage[]>(() => {
    let focusIndex = 0;
    let rowIndex = 2;
    return model.packages.map((row) => {
      const focusCount = 2 + (row.collapsed ? 0 : row.links.length);
      const entry = {
        focusCount,
        focusIndexStart: focusIndex,
        id: row.id,
        height: collectorPackageIntrinsicBlockSize(row),
        rowIndex,
        row
      };
      focusIndex += focusCount;
      rowIndex += 1 + (row.collapsed ? 0 : row.links.length);
      return entry;
    });
  }, [model.packages]);
  const logicalRowCount = 1 + virtualPackages.reduce((count, entry) => count + 1 + (entry.row.collapsed ? 0 : entry.row.links.length), 0);
  const logicalFocusCount = virtualPackages.reduce((count, entry) => count + entry.focusCount, 0);
  const previousCollapsedRef = useRef(new Map(model.packages.map((row) => [row.id, row.collapsed])));
  const previousVisibleIdsRef = useRef<string[]>([]);
  const transitionTimerRef = useRef(0);
  const [transitionPinnedIds, setTransitionPinnedIds] = useState<string[]>([]);
  const [focusedPackageId, setFocusedPackageId] = useState<string | null>(null);
  const [pendingFocusIndex, setPendingFocusIndex] = useState<number | null>(null);
  const freshPinnedIds = getCollectorDisclosurePinnedIds(
    previousVisibleIdsRef.current,
    previousCollapsedRef.current,
    model.packages,
    model.animationsEnabled
  );
  const effectivePinnedIds = mergeCollectorPinnedIds(resolveCollectorTransitionPins(transitionPinnedIds, freshPinnedIds), focusedPackageId);
  const stateOffset = model.error ? 38 : 0;
  const virtualWindow = useMemo(() => calculateDownloadVirtualWindow(virtualPackages, {
    scrollTop: Math.max(0, viewport.scrollTop - stateOffset),
    viewportHeight: viewport.viewportHeight,
    overscan: 2,
    pinnedIds: effectivePinnedIds
  }), [effectivePinnedIds.join("\u0000"), stateOffset, viewport.scrollTop, viewport.viewportHeight, virtualPackages]);
  const collapsedById = new Map(model.packages.map((row) => [row.id, row.collapsed]));
  const freshPinnedKey = freshPinnedIds.map((id) => `${id}:${collapsedById.get(id) ? 1 : 0}`).join("\u0000");
  useRendererLayoutEffect(() => {
    if (freshPinnedIds.length === 0) return;
    setTransitionPinnedIds((current) => resolveCollectorTransitionPins(current, freshPinnedIds));
    if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
    transitionTimerRef.current = window.setTimeout(() => {
      transitionTimerRef.current = 0;
      setTransitionPinnedIds([]);
    }, 320);
  }, [freshPinnedKey]);
  useRendererLayoutEffect(() => {
    previousCollapsedRef.current = new Map(model.packages.map((row) => [row.id, row.collapsed]));
    previousVisibleIdsRef.current = getCollectorDisclosureViewportIds(virtualWindow.rows, virtualWindow.startIndex, virtualWindow.endIndex);
  }, [model.packages, virtualWindow.rows]);
  useRendererLayoutEffect(() => {
    if (pendingFocusIndex === null) return;
    const target = bodyRef.current?.querySelector<HTMLElement>(`[data-collector-focus-index="${pendingFocusIndex}"]`);
    if (!target) return;
    target.focus();
    target.scrollIntoView({ block: "nearest" });
    setPendingFocusIndex(null);
  }, [pendingFocusIndex, virtualWindow.rows]);
  useEffect(() => () => {
    if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
  }, []);
  const spacerStyle = { "--collector-virtual-total-height": `${virtualWindow.totalHeight}px` } as CSSProperties;
  return (
    <section className="collector-content" aria-label="Gesammelte Downloadpakete">
      <DataTable aria-rowcount={logicalRowCount} className="collector-table" label="Gesammelte Downloadpakete">
        <DataTableHeader className="collector-table-header">
            <div aria-rowindex={1} className="collector-table-header-row" role="row" style={collectorHeaderScrollStyle(viewport.scrollLeft)}>
            <span aria-label="Auswahl" className="collector-column-select" role="columnheader" />
            <span role="columnheader">Name</span>
            <span role="columnheader">Größe</span>
            <span role="columnheader">Hoster</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Verfügbarkeit</span>
            <span role="columnheader">Hinzugefügt</span>
          </div>
        </DataTableHeader>
        <DataTableBody
          className="collector-table-body"
          data-visual-region="collector-table-body"
          onKeyDownCapture={(event) => {
            if (event.key !== "Tab") return;
            const currentIndex = Number((event.target as HTMLElement).dataset.collectorFocusIndex);
            if (!Number.isInteger(currentIndex)) return;
            const nextIndex = currentIndex + (event.shiftKey ? -1 : 1);
            if (nextIndex < 0 || nextIndex >= logicalFocusCount) return;
            const packageId = getCollectorFocusPackageId(virtualPackages, nextIndex);
            if (!packageId) return;
            event.preventDefault();
            setFocusedPackageId(packageId);
            setPendingFocusIndex(nextIndex);
          }}
          ref={bodyRef}
        >
          {model.error ? <div aria-live="polite" className="collector-background-error" role="status">{model.error}</div> : null}
          {model.empty ? (
            <DataTableEmpty
              data-visual-region="collector-empty-state"
              description={model.query || model.filter !== "all" ? "Passe Suche oder Statusfilter an." : model.analyzing ? "Die ersten Links erscheinen sofort nach dem Import." : "Füge Links hinzu, um Pakete vor dem Download zu prüfen."}
              title={model.query || model.filter !== "all" ? "Keine passenden Links" : model.analyzing ? "Links werden vorbereitet" : "Noch keine Links"}
            />
          ) : (
            <div className={`collector-virtual-spacer${model.animationsEnabled ? " is-motion-enabled" : ""}`} style={spacerStyle}>
              {virtualWindow.rows.map((entry) => (
                <div
                  className="collector-virtual-package"
                  data-collector-package-id={entry.id}
                  key={entry.id}
                  onBlurCapture={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      setFocusedPackageId((current) => current === entry.id ? null : current);
                    }
                  }}
                  onFocusCapture={() => setFocusedPackageId(entry.id)}
                  style={collectorVirtualPackageStyle(entry.top, entry.height)}
                >
                  <CollectorPackageGroup actions={actions} focusIndexStart={entry.source.focusIndexStart} model={model} row={entry.source.row} rowIndexStart={entry.source.rowIndex} selected={selected} />
                </div>
              ))}
            </div>
          )}
        </DataTableBody>
      </DataTable>
    </section>
  );
}

export const MemoizedCollectorContent = memo(
  CollectorContent,
  (previous, next) => previous.model === next.model
);

export function CollectorView({ model, actions, region = "all" }: CollectorViewProps): ReactElement {
  if (region === "sidebar") return <CollectorSidebar actions={actions} model={model} />;
  if (region === "toolbar") return <CollectorToolbar actions={actions} model={model} />;
  if (region === "content") return <MemoizedCollectorContent actions={actions} model={model} />;
  return (
    <div className="collector-view">
      <CollectorSidebar actions={actions} model={model} />
      <div className="collector-view-main">
        <CollectorToolbar actions={actions} model={model} />
        <MemoizedCollectorContent actions={actions} model={model} />
      </div>
    </div>
  );
}

export function CollectorInputDialog({ open, value, onChange, onClose, onCommit }: CollectorInputDialogProps): ReactElement | null {
  return (
    <Dialog
      actions={(
        <>
          <button className="collector-dialog-secondary" onClick={onClose} type="button">Abbrechen</button>
          <button className="collector-dialog-primary" onClick={onCommit} type="button">Hinzufügen</button>
        </>
      )}
      description="Links erscheinen sofort und werden anschließend im Hintergrund geprüft."
      onClose={onClose}
      open={open}
      size="wide"
      title="Links hinzufügen"
    >
      <label className="collector-input-label">
        <span>Links</span>
        <textarea
          aria-label="Links"
          autoFocus
          className="collector-input"
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
          placeholder="Eine URL pro Zeile"
          rows={12}
          value={value}
        />
      </label>
    </Dialog>
  );
}
