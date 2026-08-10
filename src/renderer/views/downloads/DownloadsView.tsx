import type { ReactElement } from "react";
import type { DownloadPackageRow, DownloadsViewModelCore, DownloadDisplayMode, DownloadSidebarFilter } from "./downloads-model";
import {
  DownloadsTableHeader,
  ItemRow,
  PackageCard,
  type DownloadSortColumn,
  type DownloadsTableActions
} from "./DownloadsTable";
import "./downloads.css";

export interface DownloadsStatusModel {
  packages: number;
  links: number;
  session: string;
  total: string;
  hosters: number;
  speed: string;
  eta: string;
}

export interface DownloadsViewModel extends DownloadsViewModelCore {
  running: boolean;
  paused: boolean;
  canStart: boolean;
  canPause: boolean;
  canStop: boolean;
  actionBusy: boolean;
  reconnectSeconds: number;
  reconnectReason: string;
  clipboardWatcher: boolean;
  scheduleActive: boolean;
  scheduleOpen: boolean;
  scheduleTime: string;
  scheduleLabel: string;
  packageSpeedBps: Record<string, number>;
  editingPackageId: string | null;
  editingName: string;
  columnOrder: readonly string[];
  gridTemplate: string;
  sortColumn?: DownloadSortColumn;
  sortDirection?: "asc" | "desc";
  status: DownloadsStatusModel;
}

export interface DownloadsViewActions extends DownloadsTableActions {
  onDisplayModeChange: (mode: DownloadDisplayMode) => void;
  onFilterChange: (filter: DownloadSidebarFilter) => void;
  onProviderFilterChange: (provider: string) => void;
  onQueryChange: (query: string) => void;
  onAddLinks: () => void;
  onStartDownloads: () => void;
  onPauseDownloads: () => void;
  onStopDownloads: () => void;
  onToggleSchedule: () => void;
  onScheduleTimeChange: (value: string) => void;
  onActivateSchedule: () => void;
  onCancelSchedule: () => void;
  onMoveSelectionUp: () => void;
  onMoveSelectionDown: () => void;
  onRenameSelection: () => void;
  onRemoveSelection: () => void;
  onToggleClipboardWatcher: () => void;
  onClearAll: () => void;
  onToggleAllPackages: () => void;
  onShowAllPackages: () => void;
  onPackageDragStart: (packageId: string) => void;
  onPackageDrop: (packageId: string) => void;
  onPackageDragEnd: () => void;
}

const filters: Array<{ id: DownloadSidebarFilter; label: string }> = [
  { id: "all", label: "Alle" },
  { id: "active", label: "Aktiv" },
  { id: "queued", label: "Wartend" },
  { id: "paused", label: "Pausiert" },
  { id: "completed", label: "Fertig" },
  { id: "failed", label: "Fehler" }
];

export function DownloadsSidebar({ actions, model }: { actions: DownloadsViewActions; model: DownloadsViewModel }): ReactElement {
  return (
    <aside className="downloads-sidebar" data-visual-region="downloads-sidebar">
      <div className="downloads-mode-switch" role="group" aria-label="Downloadansicht">
        <button className={model.displayMode === "packages" ? "is-active" : ""} onClick={() => actions.onDisplayModeChange("packages")} type="button">Pakete</button>
        <button className={model.displayMode === "files" ? "is-active" : ""} onClick={() => actions.onDisplayModeChange("files")} type="button">Dateien</button>
      </div>
      <nav aria-label="Downloadfilter">
        {filters.map((filter) => <button className={model.filter === filter.id ? "is-active" : ""} key={filter.id} onClick={() => actions.onFilterChange(filter.id)} type="button"><span>{filter.label}</span><b>{model.counts[filter.id]}</b></button>)}
      </nav>
      <label className="downloads-provider-filter"><span>Service</span><select aria-label="Service filtern" onChange={(event) => actions.onProviderFilterChange(event.target.value)} value={model.providerFilter}><option value="all">Alle Services</option>{model.providerOptions.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></label>
      <label className="downloads-sidebar-search"><span>Downloads durchsuchen</span><input className="downloads-search-input" onChange={(event) => actions.onQueryChange(event.target.value)} placeholder="Paket, Datei oder Service" type="search" value={model.query} /></label>
      <div className="downloads-sidebar-actions">
        <button onClick={actions.onToggleAllPackages} type="button">Alle ein-/ausklappen</button>
        <button disabled={model.empty} onClick={actions.onClearAll} type="button">Liste leeren</button>
        <label><input checked={model.clipboardWatcher} onChange={actions.onToggleClipboardWatcher} type="checkbox" />Zwischenablage überwachen</label>
      </div>
    </aside>
  );
}

export function DownloadsSidebarStatus({ model }: { model: DownloadsViewModel }): ReactElement {
  const entries = [
    ["Pakete", String(model.status.packages)],
    ["Links", String(model.status.links)],
    ["Sitzung", model.status.session],
    ["Gesamt", model.status.total],
    ["Hoster", String(model.status.hosters)],
    ["Geschwindigkeit", model.status.speed],
    ["ETA", model.status.eta]
  ];
  return <section className="downloads-sidebar-status" data-visual-region="downloads-sidebar-status" aria-label="Downloadstatus">{entries.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</section>;
}

export function DownloadsToolbar({ actions, model }: { actions: DownloadsViewActions; model: DownloadsViewModel }): ReactElement {
  const hasSelection = model.actionableSelectedIds.length > 0;
  const hasSelectedPackage = model.actionableSelectedPackageIds.length > 0;
  const onePackage = model.actionableSelectedPackageIds.length === 1 && model.actionableSelectedIds.length === 1;
  return (
    <div className="downloads-toolbar" data-visual-region="downloads-toolbar">
      <button className="ui-primary-button" onClick={actions.onAddLinks} type="button">Links hinzufügen</button>
      <span className="downloads-toolbar-divider" />
      <button disabled={model.actionBusy || (!model.canStart && !model.paused)} onClick={actions.onStartDownloads} type="button">Start</button>
      <button disabled={!model.canPause || model.paused} onClick={actions.onPauseDownloads} type="button">Pause</button>
      <button disabled={!model.canStop || model.actionBusy} onClick={actions.onStopDownloads} type="button">Stop</button>
      {model.scheduleActive
        ? <span className="downloads-schedule-controls"><strong>Geplant: {model.scheduleLabel}</strong><button disabled={false} onClick={actions.onCancelSchedule} type="button">Abbrechen</button></span>
        : <><button aria-expanded={model.scheduleOpen} onClick={actions.onToggleSchedule} type="button">Zeitplan</button>{model.scheduleOpen ? <span className="downloads-schedule-controls"><input aria-label="Startzeit" onChange={(event) => actions.onScheduleTimeChange(event.target.value)} type="time" value={model.scheduleTime} /><button onClick={actions.onActivateSchedule} type="button">Planen</button></span> : null}</>}
      <span className="downloads-toolbar-divider" />
      <button disabled={!hasSelectedPackage} onClick={actions.onMoveSelectionUp} type="button">Nach oben</button>
      <button disabled={!hasSelectedPackage} onClick={actions.onMoveSelectionDown} type="button">Nach unten</button>
      <button disabled={!onePackage} onClick={actions.onRenameSelection} type="button">Umbenennen</button>
      <button disabled={!hasSelection} onClick={actions.onRemoveSelection} type="button">Entfernen</button>
    </div>
  );
}

function tableState(model: DownloadsViewModel): ReactElement | null {
  if (model.empty) return <div className="downloads-empty-state" data-visual-region="downloads-empty-state" role="row"><div role="cell"><strong>Noch keine Downloads</strong><span>Füge Links hinzu, um den ersten Download zu starten.</span></div></div>;
  if (model.filteredEmpty) return <div className="downloads-table-message" role="row"><div role="cell"><strong>Keine passenden Downloads</strong><span>Passe Filter oder Suche an.</span></div></div>;
  return null;
}

function packageRows(model: DownloadsViewModel, actions: DownloadsViewActions): ReactElement[] {
  return model.packageRows.map((row: DownloadPackageRow) => (
    <PackageCard
      actions={actions}
      columnOrder={model.columnOrder}
      editing={model.editingPackageId === row.package.id}
      editingName={model.editingName}
      gridTemplate={model.gridTemplate}
      key={row.package.id}
      packageSpeedBps={model.packageSpeedBps[row.package.id] ?? 0}
      onDragEnd={actions.onPackageDragEnd}
      onDragStart={actions.onPackageDragStart}
      onDrop={actions.onPackageDrop}
      row={row}
      selectedIds={model.selectedIds}
      selectedVersion={model.actionableSelectedIds.length}
      sessionRunning={model.running}
    />
  ));
}

export function DownloadsContent({ actions, model }: { actions: DownloadsViewActions; model: DownloadsViewModel }): ReactElement {
  return (
    <main className="downloads-content">
      <div className="downloads-table" role="table" aria-label="Downloads">
        <DownloadsTableHeader actions={actions} columnOrder={model.columnOrder} gridTemplate={model.gridTemplate} selectedCount={model.actionableSelectedIds.length} sortColumn={model.sortColumn ?? "name"} sortDirection={model.sortDirection ?? "asc"} visibleIds={model.visibleRowIds} />
        <div className="downloads-table-body" data-visual-region="downloads-table-body" role="rowgroup">
          {tableState(model)}
          {!model.empty && !model.filteredEmpty && model.displayMode === "packages" ? packageRows(model, actions) : null}
          {!model.empty && !model.filteredEmpty && model.displayMode === "files" ? model.fileRows.map((item) => <ItemRow actions={actions} columnOrder={model.columnOrder} gridTemplate={model.gridTemplate} item={item} key={item.id} selected={model.selectedIds.has(item.id)} sessionRunning={model.running} />) : null}
        </div>
      </div>
    </main>
  );
}

export function DownloadsFooter({ actions, model }: { actions: DownloadsViewActions; model: DownloadsViewModel }): ReactElement {
  return (
    <footer className="downloads-footer" data-visual-region="downloads-pagination">
      <span>{model.paginationLabel}</span>
      {model.limited ? <button onClick={actions.onShowAllPackages} type="button">Alle anzeigen</button> : null}
      <span>{model.running ? model.paused ? "Pausiert" : "Download läuft" : "Bereit"}</span>
    </footer>
  );
}

export function DownloadsView({ actions, model }: { actions: DownloadsViewActions; model: DownloadsViewModel }): ReactElement {
  return (
    <div className="downloads-view">
      <div className="downloads-side-column"><DownloadsSidebar actions={actions} model={model} /><DownloadsSidebarStatus model={model} /></div>
      <div className="downloads-main-column"><DownloadsToolbar actions={actions} model={model} /><DownloadsContent actions={actions} model={model} /><DownloadsFooter actions={actions} model={model} /></div>
    </div>
  );
}
