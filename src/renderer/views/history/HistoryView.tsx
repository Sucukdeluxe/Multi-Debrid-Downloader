import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type UIEvent
} from "react";
import {
  DataTable,
  DataTableBody,
  DataTableEmpty,
  DataTableHeader
} from "../../ui/DataTable";
import { Toolbar, ToolbarGroup, ToolbarSearch } from "../../ui/Toolbar";
import { SlidingSelection } from "../../ui/SlidingSelection";
import {
  createHistoryTableColumnWidths,
  formatHistoryDuration,
  getHistoryTableGridTemplate,
  getHistoryTableMinWidth,
  HISTORY_TABLE_COLUMN_IDS,
  paginateHistoryRows,
  resizeHistoryTableColumn,
  type HistoryFilter,
  type HistoryPage,
  type HistoryRow,
  type HistoryTableColumnId,
  type HistoryTableColumnWidths,
  type HistoryViewModel
} from "./history-model";
import "./history.css";

export interface HistoryViewActions {
  onFilterChange: (filter: HistoryFilter) => void;
  onQueryChange: (value: string) => void;
  onToggleSelection: (entryId: string) => void;
  onToggleSelectAll: (visibleIds: string[]) => void;
  onToggleExpansion: (entryId: string) => void;
  onRestore: (entryIds: string[]) => void;
  onReveal: (entryId: string) => void;
  onRemove: (entryIds: string[]) => void;
  onClearSelection: () => void;
  onClearHistory: () => void;
  onContextMenu: (entryId: string, x: number, y: number) => void;
}

export interface HistoryViewProps {
  model: HistoryViewModel;
  actions: HistoryViewActions;
}

const filterItems: Array<{ id: HistoryFilter; label: string }> = [
  { id: "all", label: "Alle Einträge" },
  { id: "today", label: "Heute" },
  { id: "week", label: "Letzte 7 Tage" },
  { id: "older", label: "Älter" },
  { id: "completed", label: "Fertig" },
  { id: "deleted", label: "Gelöscht" },
  { id: "failed", label: "Fehlgeschlagen" }
];

const HISTORY_TABLE_COLUMNS = ["Paket / Datei", "Status", "Größe", "Hoster", "Gestartet", "Beendet"] as const;
const HISTORY_TABLE_COLUMN_STORAGE_KEY = "mdd.history-table-columns.v1";
const HISTORY_DISCLOSURE_DURATION_MS = 520;
const useRendererLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
let historyTableResizeSession: { column: HistoryTableColumnId; startX: number; initial: HistoryTableColumnWidths } | null = null;

function operationStatusLabel(status: "completed" | "failed" | "cancelled"): string {
  if (status === "completed") return "Abgeschlossen";
  if (status === "failed") return "Fehlgeschlagen";
  return "Abgebrochen";
}

function loadHistoryTableColumnWidths(): HistoryTableColumnWidths {
  try {
    const stored = typeof window === "undefined" ? null : window.localStorage.getItem(HISTORY_TABLE_COLUMN_STORAGE_KEY);
    return createHistoryTableColumnWidths(stored ? JSON.parse(stored) : undefined);
  } catch {
    return createHistoryTableColumnWidths();
  }
}

function applyHistoryTableColumnWidths(source: HTMLElement, widths: HistoryTableColumnWidths): void {
  const table = source.closest(".history-table");
  if (!table) return;
  const template = getHistoryTableGridTemplate(widths);
  const minWidth = `${getHistoryTableMinWidth(widths)}px`;
  table.querySelectorAll<HTMLElement>(".history-table-header-row, .history-row, .history-detail-row").forEach((row) => {
    if (!row.classList.contains("history-detail-row")) {
      row.style.gridTemplateColumns = template;
    }
    row.style.minWidth = minWidth;
  });
}

function persistHistoryTableColumnWidths(widths: HistoryTableColumnWidths): void {
  try {
    window.localStorage.setItem(HISTORY_TABLE_COLUMN_STORAGE_KEY, JSON.stringify(widths));
  } catch {
  }
}

function syncHistoryTableScroll(event: UIEvent<HTMLDivElement>): void {
  const header = event.currentTarget.parentElement?.querySelector<HTMLElement>(".history-table-header");
  if (header) {
    header.scrollLeft = event.currentTarget.scrollLeft;
  }
}

function HistoryRowDetails({
  row,
  minWidth,
  expanded,
  animationsEnabled
}: {
  row: HistoryRow;
  minWidth: number;
  expanded: boolean;
  animationsEnabled: boolean;
}): ReactElement | null {
  const [rendered, setRendered] = useState(expanded);
  const [height, setHeight] = useState<number | null>(null);
  const disclosureRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const previousExpanded = useRef(expanded);

  useRendererLayoutEffect(() => {
    const wasExpanded = previousExpanded.current;
    previousExpanded.current = expanded;
    let moveTimer: ReturnType<typeof setTimeout> | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    if (!animationsEnabled) {
      setRendered(expanded);
      setHeight(null);
      return;
    }

    if (expanded) {
      setRendered(true);
      if (wasExpanded) {
        setHeight(null);
      } else {
        const targetHeight = detailRef.current?.scrollHeight ?? contentRef.current?.scrollHeight ?? 0;
        const currentHeight = disclosureRef.current?.getBoundingClientRect().height ?? 0;
        setHeight(currentHeight);
        moveTimer = setTimeout(() => setHeight(targetHeight), 20);
        settleTimer = setTimeout(() => setHeight(null), HISTORY_DISCLOSURE_DURATION_MS + 40);
      }
    } else if (wasExpanded) {
      const currentHeight = disclosureRef.current?.getBoundingClientRect().height
        ?? detailRef.current?.scrollHeight
        ?? contentRef.current?.scrollHeight
        ?? 0;
      setHeight(currentHeight);
      moveTimer = setTimeout(() => setHeight(0), 20);
      settleTimer = setTimeout(() => {
        setRendered(false);
        setHeight(null);
      }, HISTORY_DISCLOSURE_DURATION_MS + 40);
    }

    return () => {
      if (moveTimer) clearTimeout(moveTimer);
      if (settleTimer) clearTimeout(settleTimer);
    };
  }, [animationsEnabled, expanded]);

  if (!expanded && (!animationsEnabled || !rendered)) {
    return null;
  }

  const animatedHeight = animationsEnabled && expanded && !rendered ? 0 : height;
  return (
    <div
      aria-hidden={!expanded}
      className={`history-detail-disclosure ${expanded ? "is-expanded" : "is-collapsed"}${animationsEnabled ? "" : " is-history-motion-disabled"}`}
      ref={disclosureRef}
      style={{ height: animatedHeight === null ? undefined : `${animatedHeight}px`, minWidth }}
    >
      <div className="history-detail-clip" ref={contentRef}>
        <div className="history-detail-row" ref={detailRef} role="row">
          <div className="history-detail-cell" role="cell">
            <dl className="history-details-grid">
              <div><dt>Provider</dt><dd>{row.providerLabel}</dd></div>
              <div><dt>Dateien</dt><dd>{row.fileCount}</dd></div>
              {row.hasStructuredLifecycle ? (
                <>
                  <div><dt>Download gestartet</dt><dd>{row.startedLabel}</dd></div>
                  <div><dt>Download beendet</dt><dd>{row.downloadEndedLabel}</dd></div>
                  <div><dt>Nachbearbeitung gestartet</dt><dd>{row.postProcessStartedLabel}</dd></div>
                  <div><dt>Abgeschlossen</dt><dd>{row.completedLabel}</dd></div>
                  <div><dt>Downloaddauer</dt><dd>{row.downloadDurationLabel}</dd></div>
                  <div><dt>Entpackdauer</dt><dd>{row.extractionDurationLabel}</dd></div>
                  <div><dt>Remuxdauer</dt><dd>{row.remuxDurationLabel}</dd></div>
                  <div><dt>Nachbearbeitungsdauer</dt><dd>{row.postProcessDurationLabel}</dd></div>
                  <div><dt>Gesamtdauer</dt><dd>{row.totalDurationLabel}</dd></div>
                  <div><dt>Status</dt><dd>{row.statusLabel}</dd></div>
                  <div><dt>Erfolgreich / Fehlgeschlagen / Abgebrochen</dt><dd>{row.successfulFiles ?? 0} / {row.failedFiles ?? 0} / {row.cancelledFiles ?? 0}</dd></div>
                  <div><dt>Archive / Parts / Ausgaben</dt><dd>{row.archiveCount ?? 0} / {row.partCount ?? 0} / {row.outputCount ?? 0}</dd></div>
                  <div><dt>Fehlerphase</dt><dd>{row.failurePhaseLabel}</dd></div>
                </>
              ) : (
                <div><dt>Downloaddauer (Altbestand)</dt><dd>{row.durationLabel}</dd></div>
              )}
              <div><dt>Durchschnitt</dt><dd>{row.averageSpeedLabel}</dd></div>
              <div className="history-detail-wide"><dt>Zielordner</dt><dd className="history-copyable">{row.outputDir || "—"}</dd></div>
              <div className="history-detail-wide"><dt>URLs</dt><dd className="history-copyable">{row.urls?.length ? row.urls.join("\n") : "—"}</dd></div>
            </dl>
            {row.hasStructuredLifecycle ? (
              <div className="history-operation-groups">
                <section className="history-operation-group">
                  <h3>Archivvorgänge</h3>
                  {row.archiveOperations?.length ? (
                    <ul>
                      {row.archiveOperations.map((operation) => (
                        <li key={operation.id}>
                          <strong>{operation.name}</strong>
                          <span>{operation.partCount} Parts · {formatHistoryDuration(operation.durationMs / 1000)} · {operationStatusLabel(operation.status)}{operation.errorCategory ? ` · ${operation.errorCategory}` : ""}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p>Keine Archivvorgänge</p>}
                </section>
                <section className="history-operation-group">
                  <h3>Remuxvorgänge</h3>
                  {row.remuxOperations?.length ? (
                    <ul>
                      {row.remuxOperations.map((operation) => (
                        <li key={operation.id}>
                          <strong>{operation.fileName}</strong>
                          <span>{formatHistoryDuration(operation.durationMs / 1000)} · {operationStatusLabel(operation.status)}{operation.errorCategory ? ` · ${operation.errorCategory}` : ""}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p>Keine Remuxvorgänge</p>}
                </section>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function HistorySidebar({ model, actions }: HistoryViewProps): ReactElement {
  return (
    <div aria-label="Verlaufsfilter" className="history-sidebar" data-visual-region="history-sidebar">
      <strong className="history-sidebar-heading">Verlauf</strong>
      <SlidingSelection activeKey={model.filter} axis="vertical" className="history-filter-list">
        {filterItems.map((item) => (
          <button
            aria-current={model.filter === item.id ? "page" : undefined}
            className={`history-filter${model.filter === item.id ? " is-active" : ""}`}
            data-sliding-selection-active={model.filter === item.id}
            data-sliding-selection-item="true"
            key={item.id}
            onClick={() => actions.onFilterChange(item.id)}
            type="button"
          >
            <span>{item.label}</span>
            <span>{model.counts[item.id]}</span>
          </button>
        ))}
      </SlidingSelection>
      <button
        className="history-sidebar-clear"
        disabled={model.totalCount === 0 || model.loading}
        onClick={actions.onClearHistory}
        type="button"
      >Verlauf leeren</button>
    </div>
  );
}

export function HistoryToolbar({ model, actions }: HistoryViewProps): ReactElement {
  const selectedIds = model.selectedIds;
  const selectedSet = new Set(selectedIds);
  const restorable = model.rows.some((row) => selectedSet.has(row.id) && (row.urls?.length ?? 0) > 0);
  return (
    <Toolbar className="history-workspace-toolbar" data-visual-region="history-toolbar" label="Verlaufsaktionen">
      <ToolbarGroup label="Einträge">
        <button className="history-action" disabled={selectedIds.length === 0 || !restorable} onClick={() => actions.onRestore(selectedIds)} type="button">Erneut hinzufügen</button>
        <button className="history-action" disabled={selectedIds.length !== 1} onClick={() => actions.onReveal(selectedIds[0])} type="button">Im Ordner zeigen</button>
        <button className="history-action history-action-danger" disabled={selectedIds.length === 0} onClick={() => actions.onRemove(selectedIds)} type="button">Entfernen</button>
        <button className="history-action" disabled={selectedIds.length === 0} onClick={actions.onClearSelection} type="button">Auswahl löschen</button>
        <button className="history-action history-action-danger" disabled={model.totalCount === 0 || model.loading} onClick={actions.onClearHistory} type="button">Gesamtverlauf löschen</button>
      </ToolbarGroup>
      <ToolbarSearch
        label="Verlauf durchsuchen"
        onChange={(event: ChangeEvent<HTMLInputElement>) => actions.onQueryChange(event.target.value)}
        placeholder="Name, Pfad, Hoster oder Provider"
        value={model.query}
      />
    </Toolbar>
  );
}

export function historyPageStatusLabel(page: HistoryPage): string {
  return `Seite ${page.page} von ${page.totalPages}`;
}

export function HistoryPagination({
  page,
  onPageChange
}: {
  page: HistoryPage;
  onPageChange: (page: number) => void;
}): ReactElement {
  return (
    <nav aria-label="Verlaufsseiten" className="history-pagination" data-visual-region="history-pagination">
      <span className="history-pagination-size">{page.pageSize} pro Seite</span>
      <div className="history-pagination-controls">
        <button
          aria-label="Vorherige Verlaufsseite"
          disabled={page.page <= 1}
          onClick={() => onPageChange(page.page - 1)}
          type="button"
        >Zurück</button>
        <span aria-atomic="true" aria-current="page" aria-live="polite" className="history-pagination-status">
          <span>{page.rangeLabel}</span>
          <span>{historyPageStatusLabel(page)}</span>
        </span>
        <button
          aria-label="Nächste Verlaufsseite"
          disabled={page.page >= page.totalPages}
          onClick={() => onPageChange(page.page + 1)}
          type="button"
        >Vor</button>
      </div>
    </nav>
  );
}

interface HistoryContentPageProps extends HistoryViewProps {
  page: HistoryPage;
  onPageChange: (page: number) => void;
}

export function HistoryContentPage({ model, actions, page, onPageChange }: HistoryContentPageProps): ReactElement {
  const selected = new Set(model.selectedIds);
  const expanded = new Set(model.expandedIds);
  const visibleIds = page.rows.map((row) => row.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const showEmpty = !model.loading && !model.error && model.rows.length === 0;
  const emptyTitle = model.totalCount === 0 && !model.query && model.filter === "all"
    ? "Noch kein Verlauf"
    : "Keine passenden Einträge";
  const announcement = model.loading
    ? { role: "status" as const, live: "polite" as const, message: "Verlauf wird geladen. Die gespeicherten Einträge werden geladen." }
    : model.error
      ? { role: "alert" as const, live: "assertive" as const, message: `${model.error}. Öffne die Ansicht erneut, um es noch einmal zu versuchen.` }
      : null;
  const columnWidths = loadHistoryTableColumnWidths();
  const gridTemplateColumns = getHistoryTableGridTemplate(columnWidths);
  const minWidth = getHistoryTableMinWidth(columnWidths);
  const beginResize = (event: PointerEvent<HTMLButtonElement>, column: HistoryTableColumnId): void => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    historyTableResizeSession = { column, startX: event.clientX, initial: loadHistoryTableColumnWidths() };
  };
  const continueResize = (event: PointerEvent<HTMLButtonElement>): void => {
    const active = historyTableResizeSession;
    if (!active) return;
    const next = resizeHistoryTableColumn(active.initial, active.column, event.clientX - active.startX);
    applyHistoryTableColumnWidths(event.currentTarget, next);
    persistHistoryTableColumnWidths(next);
  };
  const finishResize = (event: PointerEvent<HTMLButtonElement>): void => {
    if (!historyTableResizeSession) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    historyTableResizeSession = null;
  };
  const resizeWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>, column: HistoryTableColumnId): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    const next = resizeHistoryTableColumn(loadHistoryTableColumnWidths(), column, event.key === "ArrowRight" ? 16 : -16);
    applyHistoryTableColumnWidths(event.currentTarget, next);
    persistHistoryTableColumnWidths(next);
  };

  return (
    <section aria-label="Verlaufstabelle" className="history-content">
      <h1 className="history-main-title">Verlauf</h1>
      <DataTable className="history-table" label="Verlauf">
        <DataTableHeader className="history-table-header">
          <div className="history-table-header-row" role="row" style={{ gridTemplateColumns, minWidth }}>
            <span className="history-column-select" role="columnheader">
              <input
                aria-label="Alle sichtbaren Einträge auswählen"
                checked={allVisibleSelected}
                disabled={visibleIds.length === 0}
                onChange={() => actions.onToggleSelectAll(visibleIds)}
                type="checkbox"
              />
            </span>
            {HISTORY_TABLE_COLUMNS.map((column, index) => (
              <span className="history-resizable-header" key={column} role="columnheader">
                {column}
                <button
                  aria-label={`${column} Spaltenbreite ändern`}
                  aria-orientation="vertical"
                  className="history-column-resizer"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => resizeWithKeyboard(event, HISTORY_TABLE_COLUMN_IDS[index])}
                  onPointerCancel={finishResize}
                  onPointerDown={(event) => beginResize(event, HISTORY_TABLE_COLUMN_IDS[index])}
                  onPointerMove={continueResize}
                  onPointerUp={finishResize}
                  role="separator"
                  type="button"
                />
              </span>
            ))}
            <span role="columnheader">Aktion</span>
          </div>
        </DataTableHeader>
        <DataTableBody className="history-table-body" data-visual-region="history-table-body" onScroll={syncHistoryTableScroll}>
          {model.loading ? (
            <DataTableEmpty description="Die gespeicherten Einträge werden geladen." title="Verlauf wird geladen" />
          ) : model.error ? (
            <DataTableEmpty className="history-table-error" description="Öffne die Ansicht erneut, um es noch einmal zu versuchen." title={model.error} />
          ) : showEmpty ? (
            <DataTableEmpty description={emptyTitle === "Noch kein Verlauf" ? "Abgeschlossene und gelöschte Pakete erscheinen hier." : "Passe Filter oder Suche an."} title={emptyTitle} />
          ) : (
            page.rows.map((row) => {
              const isSelected = selected.has(row.id);
              const isExpanded = expanded.has(row.id);
              const onContextMenu = (event: MouseEvent<HTMLElement>): void => {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.querySelector<HTMLButtonElement>(".history-row-action button")?.focus({ preventScroll: true });
                actions.onContextMenu(row.id, event.clientX, event.clientY);
              };
              return (
                <div className="history-row-group" key={row.id}>
                  <div
                    className={`history-row${isSelected ? " is-selected" : ""}`}
                    data-history-row-id={row.id}
                    onContextMenu={onContextMenu}
                    role="row"
                    style={{ gridTemplateColumns, minWidth }}
                  >
                    <span className="history-column-select" role="cell">
                      <input
                        aria-label={`${row.name} auswählen`}
                        checked={isSelected}
                        onChange={() => actions.onToggleSelection(row.id)}
                        type="checkbox"
                      />
                    </span>
                    <span className="history-row-name" role="cell">
                      <button
                        aria-expanded={isExpanded}
                        aria-label={isExpanded ? "Details ausblenden" : "Details anzeigen"}
                        className="history-expand"
                        onClick={(event) => {
                          event.stopPropagation();
                          actions.onToggleExpansion(row.id);
                        }}
                        type="button"
                      >{isExpanded ? "−" : "+"}</button>
                      <span title={row.name}>{row.name}</span>
                    </span>
                    <span role="cell"><span className={`history-status history-status-${row.status}`}>{row.statusLabel}</span></span>
                    <span className="history-row-size" role="cell" title={row.sizeLabel}>{row.sizeLabel}</span>
                    <span className="history-row-hoster" role="cell" title={row.hoster}>{row.hoster}</span>
                    <span className="history-row-time" role="cell">{row.startedLabel}</span>
                    <span className="history-row-time" role="cell">{row.completedLabel}</span>
                    <span className="history-row-action" role="cell">
                      <button
                        aria-label={`Aktionen für ${row.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          const rect = event.currentTarget.getBoundingClientRect();
                          actions.onContextMenu(row.id, rect.right, rect.bottom);
                        }}
                        type="button"
                      >⋮</button>
                    </span>
                  </div>
                  <HistoryRowDetails
                    animationsEnabled={model.animationsEnabled}
                    expanded={isExpanded}
                    minWidth={minWidth}
                    row={row}
                  />
                </div>
              );
            })
          )}
        </DataTableBody>
      </DataTable>
      {announcement ? (
        <div role={announcement.role} aria-live={announcement.live} aria-atomic="true" className="history-announcement">
          {announcement.message}
        </div>
      ) : null}
      <HistoryPagination onPageChange={onPageChange} page={page} />
    </section>
  );
}

function PaginatedHistoryContent({ model, actions }: HistoryViewProps): ReactElement {
  const [requestedPage, setRequestedPage] = useState(1);
  const page = paginateHistoryRows(model.rows, requestedPage);

  useEffect(() => {
    setRequestedPage((current) => current === page.page ? current : page.page);
  }, [page.page]);

  return (
    <HistoryContentPage
      actions={actions}
      model={model}
      onPageChange={setRequestedPage}
      page={page}
    />
  );
}

export function HistoryContent({ model, actions }: HistoryViewProps): ReactElement {
  return <PaginatedHistoryContent actions={actions} key={`${model.filter}\u0000${model.query}`} model={model} />;
}

export function HistoryFooter(_props: Pick<HistoryViewProps, "model">): null {
  return null;
}

export function HistoryView({ model, actions }: HistoryViewProps): ReactElement {
  return (
    <div className="history-workspace-view">
      <HistorySidebar actions={actions} model={model} />
      <div className="history-view-main">
        <HistoryToolbar actions={actions} model={model} />
        <HistoryContent actions={actions} model={model} />
      </div>
    </div>
  );
}
