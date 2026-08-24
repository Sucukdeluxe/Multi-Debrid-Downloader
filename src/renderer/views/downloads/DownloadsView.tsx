import type { ReactElement } from "react";
import { RollingMetricValue } from "../../ui/RollingMetricValue";
import { SlidingSelection } from "../../ui/SlidingSelection";
import type { DownloadsViewModelCore, DownloadDisplayMode, DownloadSidebarFilter } from "./downloads-model";
import {
  DownloadsTableHeader,
  type DownloadSortColumn,
  type DownloadsTableActions
} from "./DownloadsTable";
import { VirtualizedDownloadsBody } from "./VirtualizedDownloadsBody";
import "./downloads.css";

const integerFormatter = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });

export type DailyScheduleStartDay = "today" | "tomorrow";

export interface DownloadsStatusModel {
  packages: number;
  links: number;
  session: string;
  sessionBytes: number;
  total: string;
  totalBytes: number;
  remaining: string;
  remainingBytes: number;
  remainingTooltip?: string;
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
  scheduleTimeValid: boolean;
  scheduleStartDay: DailyScheduleStartDay;
  scheduleLabel: string;
  packageSpeedBps: Record<string, number>;
  editingPackageId: string | null;
  editingName: string;
  columnOrder: readonly string[];
  gridTemplate: string;
  sortColumn?: DownloadSortColumn;
  sortDirection?: "asc" | "desc";
  disclosureRevision: number;
  animationsEnabled: boolean;
  status: DownloadsStatusModel;
}

export interface DownloadsViewActions extends DownloadsTableActions {
  onResetColumnLayout: () => void;
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
  onScheduleStartDayChange: (value: DailyScheduleStartDay) => void;
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
      <SlidingSelection activeKey={model.filter} aria-label="Downloadfilter" as="nav" axis="vertical" className="downloads-filter-group">
        {filters.map((filter) => <button aria-current={model.filter === filter.id ? "page" : undefined} className={model.filter === filter.id ? "is-active" : ""} data-sliding-selection-active={model.filter === filter.id} data-sliding-selection-item="true" key={filter.id} onClick={() => actions.onFilterChange(filter.id)} type="button"><span>{filter.label}</span><b>{model.counts[filter.id]}</b></button>)}
      </SlidingSelection>
      <label className="downloads-provider-filter"><span>Service</span><select aria-label="Service filtern" disabled={model.providerOptions.length <= 1} onChange={(event) => actions.onProviderFilterChange(event.target.value)} value={model.providerFilter}><option value="all">Alle Services</option>{model.providerOptions.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></label>
      <label className="downloads-sidebar-search"><span>Downloads durchsuchen</span><input className="downloads-search-input" onChange={(event) => actions.onQueryChange(event.target.value)} placeholder="Paket, Datei oder Service" type="search" value={model.query} /></label>
      <div className="downloads-sidebar-actions">
        <button disabled={model.empty} onClick={actions.onClearAll} type="button">Liste leeren</button>
      </div>
      <label className="downloads-clipboard-toggle"><input checked={model.clipboardWatcher} onChange={actions.onToggleClipboardWatcher} type="checkbox" />Zwischenablage überwachen</label>
    </aside>
  );
}

export function DownloadsSidebarStatus({ model }: { model: DownloadsViewModel }): ReactElement {
  const speed = model.status.speed.replace(/^Geschwindigkeit:\s*/i, "");
  const eta = model.status.eta.replace(/^ETA:\s*/i, "");
  const entries: Array<{ label: string; metric: string; numericValue: number; value: string; tooltip?: string }> = [
    { label: "Pakete", metric: "packages", numericValue: model.status.packages, value: integerFormatter.format(model.status.packages) },
    { label: "Links", metric: "links", numericValue: model.status.links, value: integerFormatter.format(model.status.links) },
    { label: "Sitzung", metric: "session", numericValue: model.status.sessionBytes, value: model.status.session },
    { label: "Verbleibend", metric: "remaining", numericValue: model.status.remainingBytes, value: model.status.remaining, tooltip: model.status.remainingTooltip },
    { label: "Gesamt", metric: "total", numericValue: model.status.totalBytes, value: model.status.total },
    { label: "Hoster", metric: "hosters", numericValue: model.status.hosters, value: integerFormatter.format(model.status.hosters) }
  ];
  return <section className="downloads-sidebar-status" data-visual-region="downloads-sidebar-status" aria-label="Downloadstatus">{entries.map((entry) => {
    const tooltipId = entry.tooltip ? `downloads-status-${entry.metric}-tooltip` : undefined;
    return <div aria-describedby={tooltipId} className={entry.tooltip ? "has-tooltip" : undefined} key={entry.metric} title={entry.tooltip || undefined}><span>{entry.label}</span><RollingMetricValue numericValue={entry.numericValue} value={entry.value} />{entry.tooltip ? <span className="downloads-visually-hidden" id={tooltipId}>{entry.tooltip}</span> : null}</div>;
  })}<div><span>Geschwindigkeit</span><strong data-status-metric="speed">{speed}</strong></div><div><span>ETA</span><strong data-status-metric="eta">{eta}</strong></div></section>;
}

export function DownloadsToolbar({ actions, model }: { actions: DownloadsViewActions; model: DownloadsViewModel }): ReactElement {
  const hasSelection = model.actionableSelectedIds.length > 0;
  const hasSelectedPackage = model.actionableSelectedPackageIds.length > 0;
  const onePackage = model.actionableSelectedPackageIds.length === 1 && model.actionableSelectedIds.length === 1;
  const scheduleSlotOpen = model.scheduleActive || model.scheduleOpen;
  const scheduleSlotClass = `downloads-schedule-slot ${scheduleSlotOpen ? "is-open" : "is-closed"}${model.animationsEnabled ? "" : " is-motion-disabled"}`;
  return (
    <div className="downloads-toolbar" data-visual-region="downloads-toolbar">
      <button disabled={model.actionBusy || !model.canStart} onClick={actions.onStartDownloads} type="button">Start</button>
      <button disabled={!model.canPause || model.paused} onClick={actions.onPauseDownloads} type="button">Pause</button>
      <button disabled={!model.canStop || model.actionBusy} onClick={actions.onStopDownloads} type="button">Stop</button>
      {!model.scheduleActive ? <button aria-expanded={model.scheduleOpen} onClick={actions.onToggleSchedule} type="button">Zeitplan</button> : null}
      <span className={scheduleSlotClass}>
        <span {...(!scheduleSlotOpen ? { inert: "true" } : {})} aria-hidden={!scheduleSlotOpen} className="downloads-schedule-controls">
          {model.scheduleActive
            ? <><strong>Geplant: {model.scheduleLabel}</strong><button disabled={false} onClick={actions.onCancelSchedule} type="button">Abbrechen</button></>
            : <><input aria-label="Startzeit" disabled={!scheduleSlotOpen} onChange={(event) => actions.onScheduleTimeChange(event.target.value)} type="time" value={model.scheduleTime} /><select aria-label="Starttag" disabled={!scheduleSlotOpen} onChange={(event) => actions.onScheduleStartDayChange(event.target.value as DailyScheduleStartDay)} value={model.scheduleStartDay}><option value="today">Ab heute</option><option value="tomorrow">Ab morgen</option></select><button disabled={!scheduleSlotOpen || !model.scheduleTimeValid} onClick={actions.onActivateSchedule} type="button">Planen</button></>}
        </span>
      </span>
      <span className="downloads-toolbar-divider" />
      <button disabled={!hasSelectedPackage} onClick={actions.onMoveSelectionUp} type="button">Nach oben</button>
      <button disabled={!hasSelectedPackage} onClick={actions.onMoveSelectionDown} type="button">Nach unten</button>
      <button disabled={!onePackage} onClick={actions.onRenameSelection} type="button">Umbenennen</button>
      <button disabled={!hasSelection} onClick={actions.onRemoveSelection} type="button">Entfernen</button>
      <span aria-label="Paketdarstellung" className="downloads-toolbar-tail" role="group">
        <button className="downloads-toolbar-toggle-all" disabled={model.empty} onClick={actions.onToggleAllPackages} type="button">Alle ein-/ausklappen</button>
      </span>
    </div>
  );
}

function tableState(model: DownloadsViewModel): ReactElement | null {
  if (model.empty) return <div className="downloads-empty-state" data-visual-region="downloads-empty-state" role="row"><div role="cell"><strong>Noch keine Downloads</strong><span>Füge Links hinzu, um den ersten Download zu starten.</span></div></div>;
  if (model.filteredEmpty) return <div className="downloads-table-message" role="row"><div role="cell"><strong>Keine passenden Downloads</strong><span>Passe Filter oder Suche an.</span></div></div>;
  return null;
}

export function DownloadsContent({ actions, model }: { actions: DownloadsViewActions; model: DownloadsViewModel }): ReactElement {
  const state = tableState(model);
  return (
    <main className="downloads-content">
      <div className="downloads-table" role="table" aria-label="Downloads">
        <DownloadsTableHeader actions={actions} columnOrder={model.columnOrder} gridTemplate={model.gridTemplate} selectedCount={model.actionableSelectedIds.length} sortColumn={model.sortColumn ?? "name"} sortDirection={model.sortDirection ?? "asc"} visibleIds={model.visibleRowIds} />
        <VirtualizedDownloadsBody actions={actions} model={model} state={state} />
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
