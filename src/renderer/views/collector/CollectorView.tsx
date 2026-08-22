import type { ChangeEvent, ReactElement } from "react";
import { DataTable, DataTableBody, DataTableEmpty, DataTableHeader } from "../../ui/DataTable";
import { Dialog } from "../../ui/Dialog";
import { Toolbar, ToolbarGroup, ToolbarSearch } from "../../ui/Toolbar";
import { SlidingSelection } from "../../ui/SlidingSelection";
import { formatDateTime, formatHosterLabel, humanSize } from "../../download-format";
import type { CollectorWorkspaceFilter, CollectorWorkspacePackageRow, CollectorWorkspaceViewModel } from "./collector-model";
import "./collector.css";

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
  const ready = row.allLinks.filter((link) => link.status === "ready").length;
  if (row.offlineCount === row.totalCount) return "Offline";
  if (ready === row.totalCount) return "Bereit";
  if (ready > 0 || row.onlineCount > 0) return `${ready}/${row.totalCount} geprüft`;
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
      {hoster.iconSrc ? <><img alt="" className="collector-hoster-icon" data-hoster={hoster.title.toLowerCase()} onError={(event) => { event.currentTarget.hidden = true; event.currentTarget.nextElementSibling?.removeAttribute("hidden"); }} src={hoster.iconSrc} /><span hidden>{hoster.compact}</span></> : hoster.compact}
    </span>
  );
}

export function CollectorSidebar({ model, actions }: CollectorViewProps): ReactElement {
  return (
    <div aria-label="Linksammler-Filter" className="collector-sidebar" data-visual-region="collector-sidebar">
      <div className="collector-sidebar-heading"><strong>Status</strong><span>{model.totalCount}</span></div>
      <SlidingSelection activeKey={model.filter} axis="vertical" className="collector-sidebar-list">
        {model.filters.map((filter) => (
          <button aria-current={filter.id === model.filter ? "page" : undefined} className={`collector-sidebar-filter${filter.id === model.filter ? " is-active" : ""}`} data-sliding-selection-active={filter.id === model.filter} data-sliding-selection-item="true" key={filter.id} onClick={() => actions.onFilterChange(filter.id)} type="button">
            <span>{filter.label}</span><span>{filter.count}</span>
          </button>
        ))}
      </SlidingSelection>
    </div>
  );
}

export function CollectorToolbar({ model, actions }: CollectorViewProps): ReactElement {
  return (
    <Toolbar className="collector-toolbar" data-visual-region="collector-toolbar" label="Linksammler-Aktionen">
      <ToolbarGroup label="Links erfassen">
        <button className="collector-action collector-action-primary" disabled={model.busy} onClick={actions.onOpenInput} type="button">Links hinzufügen</button>
        <button className="collector-action" disabled={model.busy} onClick={actions.onImportDlc} type="button">DLC importieren</button>
        <button className="collector-action" disabled={model.busy} onClick={actions.onImportFile} type="button">Datei importieren</button>
      </ToolbarGroup>
      <ToolbarGroup label="Downloads übergeben">
        <button className="collector-action" disabled={model.busy || model.selectedCount === 0} onClick={actions.onSubmitSelected} type="button">{`Auswahl übergeben (${model.selectedCount})`}</button>
        <button className="collector-action" disabled={model.busy || model.totalCount === 0} onClick={actions.onSubmitAll} type="button">{`Alle übergeben (${model.totalCount})`}</button>
        <button className="collector-action collector-action-danger" disabled={model.busy || model.selectedCount === 0} onClick={actions.onRemoveSelected} type="button">Auswahl entfernen</button>
      </ToolbarGroup>
      <ToolbarGroup className="collector-toolbar-tail" label="Suche und Paketdarstellung">
        <ToolbarSearch label="Links durchsuchen" onChange={(event) => actions.onQueryChange(event.target.value)} placeholder="Name, URL oder Hoster" value={model.query} />
        <button className="collector-action" disabled={model.busy || model.totalCount === 0} onClick={actions.onToggleAllPackages} type="button">Alle ein-/ausklappen</button>
      </ToolbarGroup>
    </Toolbar>
  );
}

function CollectorPackageGroup({ row, model, actions }: { row: CollectorWorkspacePackageRow; model: CollectorWorkspaceViewModel; actions: CollectorViewActions }): ReactElement {
  const selected = new Set(model.selectedIds);
  const allSelected = row.selectedCount === row.totalCount;
  const partiallySelected = row.selectedCount > 0 && !allSelected;
  const animateItems = model.animationsEnabled && row.allLinks.length <= 64;
  const renderItems = !row.collapsed || animateItems;
  return (
    <div className={`collector-package-group${row.collapsed ? " is-collapsed" : ""}${model.animationsEnabled ? " is-motion-enabled" : ""}`} role="rowgroup">
      <div className={`collector-package-row${row.selectedCount > 0 ? " is-selected" : ""}`} role="row">
        <span className="collector-column-select" role="cell"><input aria-checked={partiallySelected ? "mixed" : allSelected} aria-label={`Paket ${row.name} auswählen`} checked={allSelected} onChange={(event) => actions.onPackageSelectionChange(row.id, event.target.checked)} ref={(node) => { if (node) node.indeterminate = partiallySelected; }} type="checkbox" /></span>
        <span className="collector-name-cell" role="cell"><button aria-expanded={!row.collapsed} aria-label={row.collapsed ? `${row.name} ausklappen` : `${row.name} einklappen`} className="collector-collapse-button" onClick={() => actions.onPackageCollapseChange(row.id)} type="button">{row.collapsed ? "+" : "−"}</button><strong title={row.name}>{row.name}</strong><small>{row.totalCount} Dateien</small></span>
        <span className="collector-size-cell" role="cell">{packageSize(row)}</span>
        <span className="collector-hoster-cell" role="cell">{row.hosters.map(formatHosterLabel).map((hoster) => <CollectorHosterLabel hoster={hoster} key={hoster.title} />)}</span>
        <span className="collector-status-cell" role="cell">{packageStatus(row)}</span>
        <span className={`collector-availability-cell is-${row.offlineCount === row.totalCount ? "offline" : row.onlineCount === row.totalCount ? "online" : "unknown"}`} role="cell">{packageAvailability(row)}</span>
        <span className="collector-added-cell" role="cell">{formatDateTime(row.addedAt)}</span>
      </div>
      {renderItems ? <div className={`collector-package-items-frame${row.collapsed ? " is-collapsed" : ""}${animateItems ? " is-animated" : ""}`}><div className="collector-package-items">{row.links.map((link) => {
        const hoster = formatHosterLabel(link.hoster);
        return (
          <div className={`collector-file-row${selected.has(link.id) ? " is-selected" : ""}`} key={link.id} role="row">
            <span className="collector-column-select" role="cell"><input aria-label={`${link.fileName} auswählen`} checked={selected.has(link.id)} onChange={(event) => actions.onLinkSelectionChange(link.id, event.target.checked)} type="checkbox" /></span>
            <span className="collector-name-cell is-file" role="cell" title={link.url}><span className={`collector-link-state is-${link.availability}`} />{link.fileName}</span>
            <span className="collector-size-cell" role="cell">{link.fileSizeBytes === null ? "Unbekannt" : humanSize(link.fileSizeBytes)}</span>
            <span className="collector-hoster-cell" role="cell"><CollectorHosterLabel hoster={hoster} /></span>
            <span className="collector-status-cell" role="cell">{link.status === "ready" ? "Bereit" : link.status === "offline" ? "Offline" : "Ungeprüft"}</span>
            <span className={`collector-availability-cell is-${link.availability}`} role="cell">{link.availability === "online" ? "Online" : link.availability === "offline" ? "Offline" : "Ungeprüft"}</span>
            <span className="collector-added-cell" role="cell">{formatDateTime(link.addedAt)}</span>
          </div>
        );
      })}</div></div> : null}
    </div>
  );
}

export function CollectorContent({ model, actions }: CollectorViewProps): ReactElement {
  return (
    <section className="collector-content" aria-label="Gesammelte Downloadpakete"><DataTable className="collector-table" label="Gesammelte Downloadpakete">
      <DataTableHeader className="collector-table-header"><div className="collector-table-header-row" role="row"><span aria-label="Auswahl" className="collector-column-select" role="columnheader" /><span role="columnheader">Name</span><span role="columnheader">Größe</span><span role="columnheader">Hoster</span><span role="columnheader">Status</span><span role="columnheader">Verfügbarkeit</span><span role="columnheader">Hinzugefügt</span></div></DataTableHeader>
      <DataTableBody className="collector-table-body" data-visual-region="collector-table-body">
        {model.busy ? <DataTableEmpty title="Links werden analysiert" description="Dateinamen, Größen und Verfügbarkeit werden geprüft." /> : model.error ? <DataTableEmpty className="collector-table-error" title={model.error} description="Bereits gesammelte Pakete bleiben unverändert." /> : model.empty ? <DataTableEmpty data-visual-region="collector-empty-state" description={model.query || model.filter !== "all" ? "Passe Suche oder Statusfilter an." : "Füge Links hinzu, um Pakete vor dem Download zu prüfen."} title={model.query || model.filter !== "all" ? "Keine passenden Links" : "Noch keine Links"} /> : model.packages.map((row) => <CollectorPackageGroup actions={actions} key={row.id} model={model} row={row} />)}
      </DataTableBody>
    </DataTable></section>
  );
}

export function CollectorView({ model, actions, region = "all" }: CollectorViewProps): ReactElement {
  if (region === "sidebar") return <CollectorSidebar actions={actions} model={model} />;
  if (region === "toolbar") return <CollectorToolbar actions={actions} model={model} />;
  if (region === "content") return <CollectorContent actions={actions} model={model} />;
  return <div className="collector-view"><CollectorSidebar actions={actions} model={model} /><div className="collector-view-main"><CollectorToolbar actions={actions} model={model} /><CollectorContent actions={actions} model={model} /></div></div>;
}

export function CollectorInputDialog({ open, value, onChange, onClose, onCommit }: CollectorInputDialogProps): ReactElement | null {
  return <Dialog actions={<><button className="collector-dialog-secondary" onClick={onClose} type="button">Abbrechen</button><button className="collector-dialog-primary" onClick={onCommit} type="button">Analysieren</button></>} description="Links werden geprüft und automatisch zu Downloadpaketen gruppiert." onClose={onClose} open={open} size="wide" title="Links hinzufügen"><label className="collector-input-label"><span>Links</span><textarea aria-label="Links" autoFocus className="collector-input" onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)} placeholder="Eine URL pro Zeile" rows={12} value={value} /></label></Dialog>;
}
