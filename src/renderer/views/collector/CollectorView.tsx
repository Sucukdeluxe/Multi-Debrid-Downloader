import type { ChangeEvent, ReactElement } from "react";
import {
  DataTable,
  DataTableBody,
  DataTableEmpty,
  DataTableHeader
} from "../../ui/DataTable";
import { Dialog } from "../../ui/Dialog";
import { Toolbar, ToolbarGroup, ToolbarSearch } from "../../ui/Toolbar";
import { SlidingSelection } from "../../ui/SlidingSelection";
import type { CollectorViewModel } from "./collector-model";
import "./collector.css";

export interface CollectorViewActions {
  onTabSelect: (tabId: string) => void;
  onTabAdd: () => void;
  onTabRemove: (tabId: string) => void;
  onOpenInput: () => void;
  onImportDlc: () => void;
  onImportFile: () => void;
  onExportQueue: () => void;
  onSubmit: () => void;
  onQueryChange: (value: string) => void;
  onSelectionChange: (rowId: string) => void;
  onRemoveSelected: () => void;
}

export type CollectorViewRegion = "all" | "sidebar" | "toolbar" | "content";

export interface CollectorViewProps {
  model: CollectorViewModel;
  actions: CollectorViewActions;
  region?: CollectorViewRegion;
}

export interface CollectorInputDialogProps {
  open: boolean;
  tabName: string;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onCommit: () => void;
}

export function CollectorSidebar({ model, actions }: CollectorViewProps): ReactElement {
  return (
    <div aria-label="Sammlungen" className="collector-sidebar" data-visual-region="collector-sidebar">
      <div className="collector-sidebar-heading">
        <strong>Sammlungen</strong>
        <span>{model.tabs.length}</span>
      </div>
      <SlidingSelection activeKey={model.activeTabId} axis="vertical" className="collector-sidebar-list">
        {model.tabs.map((tab) => (
          <div className={`collector-sidebar-item${tab.id === model.activeTabId ? " is-active" : ""}`} data-sliding-selection-active={tab.id === model.activeTabId} data-sliding-selection-item="true" key={tab.id}>
            <button
              aria-current={tab.id === model.activeTabId ? "page" : undefined}
              className="collector-sidebar-select"
              onClick={() => actions.onTabSelect(tab.id)}
              type="button"
            >
              <span>{tab.name}</span>
              <span className="collector-sidebar-count">{tab.linkCount}</span>
            </button>
            {model.tabs.length > 1 ? (
              <button
                aria-label={`${tab.name} entfernen`}
                className="collector-sidebar-remove"
                onClick={() => actions.onTabRemove(tab.id)}
                type="button"
              >×</button>
            ) : null}
          </div>
        ))}
      </SlidingSelection>
      <button className="collector-sidebar-add" onClick={actions.onTabAdd} type="button">Neue Sammlung</button>
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
      <ToolbarGroup label="Sammlung verarbeiten">
        <button className="collector-action" disabled={model.busy} onClick={actions.onExportQueue} type="button">Queue exportieren</button>
        <button className="collector-action" disabled={model.busy || model.tabs.length === 0} onClick={actions.onSubmit} type="button">An Downloads übergeben</button>
        <button className="collector-action collector-action-danger" disabled={model.busy || model.selectedIds.length === 0} onClick={actions.onRemoveSelected} type="button">Auswahl entfernen</button>
      </ToolbarGroup>
      <ToolbarSearch
        label="Links durchsuchen"
        onChange={(event) => actions.onQueryChange(event.target.value)}
        placeholder="Links durchsuchen"
        value={model.query}
      />
    </Toolbar>
  );
}

export function CollectorContent({ model, actions }: CollectorViewProps): ReactElement {
  const selected = new Set(model.selectedIds);
  return (
    <section className="collector-content" aria-label="Gesammelte Links">
      <DataTable className="collector-table" label="Gesammelte Links">
        <DataTableHeader className="collector-table-header">
          <div className="collector-table-header-row" role="row">
            <span aria-label="Auswahl" className="collector-column-select" role="columnheader" />
            <span role="columnheader">Sammlung</span>
            <span role="columnheader">URL oder Rohzeile</span>
            <span role="columnheader">Zeile</span>
            <span role="columnheader">Status</span>
          </div>
        </DataTableHeader>
        <DataTableBody className="collector-table-body" data-visual-region="collector-table-body">
          {model.busy ? (
            <DataTableEmpty title="Links werden verarbeitet" description="Die laufende Aktion wird abgeschlossen." />
          ) : model.error ? (
            <DataTableEmpty className="collector-table-error" title={model.error} description="Die lokale Sammlung bleibt unverändert." />
          ) : model.empty ? (
            <DataTableEmpty
              data-visual-region="collector-empty-state"
              description={model.query ? "Passe die Suche an oder lösche den Filter." : "Füge Links hinzu oder importiere eine vorhandene Liste."}
              title={model.query ? "Keine passenden Links" : "Noch keine Links"}
            />
          ) : (
            model.rows.map((row) => (
              <div className={`collector-row${selected.has(row.id) ? " is-selected" : ""}`} key={row.id} role="row">
                <span className="collector-column-select" role="cell">
                  <input
                    aria-label="Link auswählen"
                    checked={selected.has(row.id)}
                    onChange={() => actions.onSelectionChange(row.id)}
                    type="checkbox"
                  />
                </span>
                <span className="collector-row-source" role="cell">{row.tabName}</span>
                <span className="collector-row-value" role="cell" title={row.value}>{row.value}</span>
                <span className="collector-row-line" role="cell">{row.lineNumber}</span>
                <span className="collector-row-status" role="cell">Lokal</span>
              </div>
            ))
          )}
        </DataTableBody>
      </DataTable>
    </section>
  );
}

export function CollectorView({ model, actions, region = "all" }: CollectorViewProps): ReactElement {
  if (region === "sidebar") {
    return <CollectorSidebar actions={actions} model={model} />;
  }
  if (region === "toolbar") {
    return <CollectorToolbar actions={actions} model={model} />;
  }
  if (region === "content") {
    return <CollectorContent actions={actions} model={model} />;
  }
  return (
    <div className="collector-view">
      <CollectorSidebar actions={actions} model={model} />
      <div className="collector-view-main">
        <CollectorToolbar actions={actions} model={model} />
        <CollectorContent actions={actions} model={model} />
      </div>
    </div>
  );
}

export function CollectorInputDialog({
  open,
  tabName,
  value,
  onChange,
  onClose,
  onCommit
}: CollectorInputDialogProps): ReactElement | null {
  return (
    <Dialog
      actions={(
        <>
          <button className="collector-dialog-secondary" onClick={onClose} type="button">Abbrechen</button>
          <button className="collector-dialog-primary" onClick={onCommit} type="button">Übernehmen</button>
        </>
      )}
      description={`Links für ${tabName} lokal erfassen.`}
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
          placeholder="Eine URL oder Rohzeile pro Zeile"
          rows={12}
          value={value}
        />
      </label>
    </Dialog>
  );
}
