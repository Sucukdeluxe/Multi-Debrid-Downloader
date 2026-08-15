import {
  cloneElement,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type UIEvent
} from "react";
import { SlidingSelection } from "../../ui/SlidingSelection";
import {
  DataTable,
  DataTableBody,
  DataTableEmpty,
  DataTableHeader
} from "../../ui/DataTable";
import { Dialog } from "../../ui/Dialog";
import {
  ACCOUNT_COLUMNS,
  ACCOUNT_TABLE_COLUMN_IDS,
  createAccountTableColumnWidths,
  getAccountTableGridTemplate,
  getAccountTableMinWidth,
  getSettingsSelectNavigationIndex,
  resizeAccountTableColumn,
  type AccountAddFilter,
  type AccountAddOption,
  type AccountRowViewModel,
  type AccountTableColumnId,
  type AccountTableColumnWidths
} from "./settings-model";

export type AccountWorkspacePanel = "overview" | "rules";

const ACCOUNT_WORKSPACE_PANELS: readonly { id: AccountWorkspacePanel; label: string }[] = [
  { id: "overview", label: "Übersicht" },
  { id: "rules", label: "Verwendungsregeln" }
];

const ACCOUNT_TABLE_COLUMN_STORAGE_KEY = "mdd.account-table-columns.v1";
let accountTableResizeSession: { column: AccountTableColumnId; startX: number; initial: AccountTableColumnWidths } | null = null;

function loadAccountTableColumnWidths(): AccountTableColumnWidths {
  try {
    const stored = typeof window === "undefined" ? null : window.localStorage.getItem(ACCOUNT_TABLE_COLUMN_STORAGE_KEY);
    return createAccountTableColumnWidths(stored ? JSON.parse(stored) : undefined);
  } catch {
    return createAccountTableColumnWidths();
  }
}

function applyAccountTableColumnWidths(source: HTMLElement, widths: AccountTableColumnWidths): void {
  const table = source.closest(".settings-account-table");
  if (!table) return;
  const template = getAccountTableGridTemplate(widths);
  const minWidth = `${getAccountTableMinWidth(widths)}px`;
  table.querySelectorAll<HTMLElement>(".settings-account-table-grid, .settings-account-row").forEach((row) => {
    row.style.gridTemplateColumns = template;
    row.style.minWidth = minWidth;
  });
}

function persistAccountTableColumnWidths(widths: AccountTableColumnWidths): void {
  try {
    window.localStorage.setItem(ACCOUNT_TABLE_COLUMN_STORAGE_KEY, JSON.stringify(widths));
  } catch {
  }
}

function getAccountPanelNavigationIndex(currentIndex: number, key: string): number | null {
  if (key === "ArrowRight") {
    return getSettingsSelectNavigationIndex(currentIndex, ACCOUNT_WORKSPACE_PANELS.length, "ArrowDown");
  }
  if (key === "ArrowLeft") {
    return getSettingsSelectNavigationIndex(currentIndex, ACCOUNT_WORKSPACE_PANELS.length, "ArrowUp");
  }
  if (key === "Home" || key === "End") {
    return getSettingsSelectNavigationIndex(currentIndex, ACCOUNT_WORKSPACE_PANELS.length, key);
  }
  return null;
}

export interface AccountRulesViewModel {
  providerOrder: readonly string[];
  routing: readonly string[];
  autoFallback: boolean;
  rememberCredentials?: boolean;
  rotationEvents?: readonly { id: string; title: string; detail: string }[];
  routingEntries?: readonly {
    hosterId: string;
    hosterLabel: string;
    provider: string;
    providers: readonly { value: string; label: string }[];
  }[];
  availableRoutingHosters?: readonly { value: string; label: string }[];
}

export interface AccountWorkspaceViewModel {
  activePanel: AccountWorkspacePanel;
  rows: readonly AccountRowViewModel[];
  selectedIds: readonly string[];
  busy: boolean;
  error?: string;
  statusSort?: "none" | "desc" | "asc";
  rules: AccountRulesViewModel;
}

export interface AccountWorkspaceActions {
  onPanelChange: (panel: AccountWorkspacePanel) => void;
  onSelect: (rowId: string, additive: boolean) => void;
  onToggleEnabled: (rowId: string) => void;
  onEdit: (rowId: string) => void;
  onContextMenu: (rowId: string, x: number, y: number) => void;
  onCopyIdentity: (label: "Benutzername" | "E-Mail", value: string) => void;
  onAdd: () => void;
  onRemoveSelected: () => void;
  onCheckActive: () => void;
  onCheckAll: () => void;
  onStatusSort?: () => void;
  onMoveProvider?: (index: number, direction: -1 | 1) => void;
  onProviderDragStart?: (event: DragEvent<HTMLElement>, index: number) => void;
  onProviderDragOver?: (event: DragEvent<HTMLElement>, index: number) => void;
  onProviderDrop?: (event: DragEvent<HTMLElement>, index: number) => void;
  onProviderDragEnd?: () => void;
  onToggleAutoFallback?: (enabled: boolean) => void;
  onToggleRememberCredentials?: (enabled: boolean) => void;
  onRoutingProviderChange?: (hosterId: string, provider: string) => void;
  onRoutingRemove?: (hosterId: string) => void;
  onRoutingAdd?: (hosterId: string) => void;
}

function renderAccountIdentityCell({
  className,
  label,
  value,
  onCopy
}: {
  className: string;
  label: "Benutzername" | "E-Mail";
  value: string;
  onCopy: (label: "Benutzername" | "E-Mail", value: string) => void;
}): ReactElement {
  const copyable = value.trim() !== "" && value !== "—";
  return (
    <span className={className} role="cell" title={copyable ? "Klicken zum Kopieren" : value}>
      {copyable ? (
        <button
          aria-label={`${label} kopieren`}
          className="settings-account-copy-button"
          onClick={(event) => {
            event.stopPropagation();
            onCopy(label, value);
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          type="button"
        >{value}</button>
      ) : value}
    </span>
  );
}

export interface AccountWorkspaceProps {
  model: AccountWorkspaceViewModel;
  actions: AccountWorkspaceActions;
}

export interface AccountDialogField {
  id: string;
  label: string;
  type: "text" | "password" | "number" | "textarea";
  value: string;
  placeholder?: string;
  help?: string;
  storedSecret?: boolean;
  secretVisible?: boolean;
  secretBusy?: boolean;
}

export interface AccountAddDialogModel {
  open: boolean;
  query: string;
  filter: AccountAddFilter;
  options: readonly AccountAddOption[];
  selectedOptionId: string | null;
  fields: readonly AccountDialogField[];
  error: string;
  busy: boolean;
}

export interface AccountAddDialogActions {
  onQueryChange: (value: string) => void;
  onFilterChange: (filter: AccountAddFilter) => void;
  onOptionSelect: (optionId: string) => void;
  onFieldChange: (fieldId: string, value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}

export interface AccountEditDialogModel {
  open: boolean;
  hoster: string;
  mode: string;
  identity: string;
  enabled: boolean;
  fields: readonly AccountDialogField[];
  error: string;
  busy: boolean;
}

export interface AccountEditDialogActions {
  onFieldChange: (fieldId: string, value: string) => void;
  onClose: () => void;
  onCheck: () => void;
  onSave: () => void;
  onRemove: () => void;
  onToggleEnabled: () => void;
  onToggleSecret: (fieldId: string) => void;
  onCopySecret: (fieldId: string) => void;
}

function AccountDialogFields({
  fields,
  onChange,
  onToggleSecret,
  onCopySecret
}: {
  fields: readonly AccountDialogField[];
  onChange: (fieldId: string, value: string) => void;
  onToggleSecret?: (fieldId: string) => void;
  onCopySecret?: (fieldId: string) => void;
}): ReactElement {
  return (
    <div className="settings-account-dialog-fields">
      {fields.map((field) => (
        <label className="settings-account-dialog-field" key={field.id}>
          <span>{field.label}</span>
          {field.type === "textarea" ? (
            <textarea
              className="settings-control settings-account-dialog-textarea"
              onChange={(event) => onChange(field.id, event.target.value)}
              placeholder={field.placeholder}
              rows={4}
              value={field.value}
            />
          ) : field.storedSecret ? (
            <span className="settings-account-secret-control">
              <input
                autoComplete="off"
                className="settings-control"
                onChange={(event) => onChange(field.id, event.target.value)}
                placeholder="••••••••••••"
                type={field.secretVisible ? "text" : "password"}
                value={field.value}
              />
              <button
                aria-label={`${field.label} ${field.secretVisible ? "ausblenden" : "anzeigen"}`}
                className="settings-account-secret-button"
                disabled={field.secretBusy}
                onClick={() => onToggleSecret?.(field.id)}
                type="button"
              >{field.secretVisible ? "◉" : "◎"}</button>
              <button
                aria-label={`${field.label} kopieren`}
                className="settings-account-secret-button"
                disabled={!field.value || field.secretBusy}
                onClick={() => onCopySecret?.(field.id)}
                type="button"
              >⧉</button>
            </span>
          ) : (
            <input
              autoComplete={field.type === "password" ? "off" : undefined}
              className="settings-control"
              inputMode={field.type === "number" ? "decimal" : undefined}
              onChange={(event) => onChange(field.id, event.target.value)}
              placeholder={field.placeholder}
              type={field.type}
              value={field.value}
            />
          )}
          {field.help ? <span className="settings-field-help">{field.help}</span> : null}
        </label>
      ))}
    </div>
  );
}

function AccountRow({
  row,
  selected,
  busy,
  actions,
  gridTemplateColumns,
  minWidth
}: {
  row: AccountRowViewModel;
  selected: boolean;
  busy: boolean;
  actions: AccountWorkspaceActions;
  gridTemplateColumns: string;
  minWidth: number;
}): ReactElement {
  const selectRow = (additive = false): void => actions.onSelect(row.id, additive);
  const onClick = (event: MouseEvent<HTMLDivElement>): void => selectRow(event.ctrlKey || event.metaKey);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) {
      return;
    }
    event.preventDefault();
    selectRow(event.ctrlKey || event.metaKey);
  };
  const openContextMenu = (event: MouseEvent<HTMLElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    actions.onContextMenu(row.id, event.clientX, event.clientY);
  };
  return (
    <div
      aria-selected={selected}
      className={`settings-account-row${selected ? " is-selected" : ""}${row.problem ? " has-problem" : ""}${!row.enabled ? " is-disabled" : ""}`}
      onClick={onClick}
      onContextMenu={openContextMenu}
      onDoubleClick={() => actions.onEdit(row.id)}
      onKeyDown={onKeyDown}
      role="row"
      style={{ gridTemplateColumns, minWidth }}
      tabIndex={0}
    >
      <span className="settings-account-column-enable" role="cell">
        <input
          aria-label={`${row.hoster} ${row.enabled ? "deaktivieren" : "aktivieren"}`}
          checked={row.enabled}
          disabled={busy}
          onChange={() => actions.onToggleEnabled(row.id)}
          onClick={(event) => event.stopPropagation()}
          type="checkbox"
        />
      </span>
      <span className="settings-account-hoster" role="cell" title={`${row.hoster} · ${row.mode}`}>
        <img alt="" aria-hidden="true" draggable={false} height="20" src={row.icon} width="20" />
        <span>
          <strong>{row.hoster}</strong>
          <small>{row.mode}</small>
        </span>
      </span>
      <span className="settings-account-status" role="cell">
        <span className={`settings-account-status-badge is-${row.status.tone}`}>{row.status.text}</span>
      </span>
      <span className="settings-account-traffic" role="cell">{row.traffic}</span>
      {renderAccountIdentityCell({ className: "settings-account-username", label: "Benutzername", onCopy: actions.onCopyIdentity, value: row.username })}
      {renderAccountIdentityCell({ className: "settings-account-email", label: "E-Mail", onCopy: actions.onCopyIdentity, value: row.email })}
      <span className="settings-account-expires" role="cell">{row.expires}</span>
      <span className="settings-account-credential" role="cell">{row.credential}</span>
      <span className="settings-account-column-actions" role="cell">
        <button
          aria-label={`${row.hoster} Aktionen`}
          className="settings-account-action-button"
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            actions.onContextMenu(row.id, rect.right, rect.bottom);
          }}
          type="button"
        >⋯</button>
      </span>
    </div>
  );
}

function syncAccountTableScroll(event: UIEvent<HTMLDivElement>): void {
  const header = event.currentTarget.parentElement?.querySelector<HTMLElement>(".settings-account-table-header");
  if (header) {
    header.scrollLeft = event.currentTarget.scrollLeft;
  }
}

function AccountOverview({ model, actions }: AccountWorkspaceProps): ReactElement {
  const selectedIds = new Set(model.selectedIds);
  const columnWidths = loadAccountTableColumnWidths();
  const gridTemplateColumns = getAccountTableGridTemplate(columnWidths);
  const minWidth = getAccountTableMinWidth(columnWidths);
  const beginResize = (event: PointerEvent<HTMLButtonElement>, column: AccountTableColumnId): void => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    accountTableResizeSession = { column, startX: event.clientX, initial: loadAccountTableColumnWidths() };
  };
  const continueResize = (event: PointerEvent<HTMLButtonElement>): void => {
    const active = accountTableResizeSession;
    if (!active) return;
    const next = resizeAccountTableColumn(active.initial, active.column, event.clientX - active.startX);
    applyAccountTableColumnWidths(event.currentTarget, next);
    persistAccountTableColumnWidths(next);
  };
  const finishResize = (event: PointerEvent<HTMLButtonElement>): void => {
    if (!accountTableResizeSession) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    accountTableResizeSession = null;
  };
  const resizeWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>, column: AccountTableColumnId): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    const next = resizeAccountTableColumn(loadAccountTableColumnWidths(), column, event.key === "ArrowRight" ? 16 : -16);
    applyAccountTableColumnWidths(event.currentTarget, next);
    persistAccountTableColumnWidths(next);
  };
  return (
    <>
      <DataTable aria-busy={model.busy} className="settings-account-table" label="Accounts">
        <DataTableHeader className="settings-account-table-header">
          <div className="settings-account-table-grid" role="row" style={{ gridTemplateColumns, minWidth }}>
            <span aria-label="Aktiviert" className="settings-account-column-enable" role="columnheader" />
            {ACCOUNT_COLUMNS.map((column, index) => (
              <span className="settings-account-resizable-header" key={column} role="columnheader">
                {column === "Status" && actions.onStatusSort ? (
                  <button className="settings-account-sort" onClick={actions.onStatusSort} type="button">
                    {column}{model.statusSort === "desc" ? " ▼" : model.statusSort === "asc" ? " ▲" : ""}
                  </button>
                ) : column}
                <button
                  aria-label={`${column} Spaltenbreite ändern`}
                  aria-orientation="vertical"
                  className="settings-account-column-resizer"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => resizeWithKeyboard(event, ACCOUNT_TABLE_COLUMN_IDS[index])}
                  onPointerCancel={finishResize}
                  onPointerDown={(event) => beginResize(event, ACCOUNT_TABLE_COLUMN_IDS[index])}
                  onPointerMove={continueResize}
                  onPointerUp={finishResize}
                  role="separator"
                  type="button"
                />
              </span>
            ))}
            <span aria-label="Aktionen" className="settings-account-column-actions" role="columnheader" />
          </div>
        </DataTableHeader>
        <DataTableBody className="settings-account-table-body" data-visual-region="accounts-table-body" onScroll={syncAccountTableScroll}>
          {model.busy && model.rows.length === 0 ? (
            <DataTableEmpty description="Die Accountdaten werden aktualisiert." title="Accounts werden geladen" />
          ) : model.error ? (
            <DataTableEmpty className="settings-account-table-error" description="Die gespeicherten Accounts bleiben unverändert." title={model.error} />
          ) : model.rows.length === 0 ? (
            <DataTableEmpty description="Füge einen Account hinzu, um Downloads über einen Anbieter zu starten." title="Noch keine Accounts" />
          ) : model.rows.map((row) => cloneElement(
            AccountRow({ actions, busy: model.busy, gridTemplateColumns, minWidth, row, selected: selectedIds.has(row.id) }),
            { key: row.id }
          ))}
        </DataTableBody>
      </DataTable>
      <div className="settings-account-local-actions">
        <div>
          <button className="settings-button settings-button-secondary" disabled={model.busy} onClick={actions.onAdd} type="button">＋ Hinzufügen</button>
          <button className="settings-button settings-button-secondary" disabled={model.busy || model.selectedIds.length === 0} onClick={actions.onRemoveSelected} type="button">− Entfernen{model.selectedIds.length > 1 ? ` (${model.selectedIds.length})` : ""}</button>
          <button className="settings-button settings-button-secondary" disabled={model.busy || !model.rows.some((row) => row.enabled && row.canCheck)} onClick={actions.onCheckActive} title="Prüft nur aktivierte Accounts." type="button">↻ Aktive aktualisieren</button>
          <button className="settings-button settings-button-secondary" disabled={model.busy} onClick={actions.onCheckAll} title="Prüft alle angelegten Accounts, auch deaktivierte." type="button">↻ Alle aktualisieren</button>
        </div>
        <span>{model.rows.length} {model.rows.length === 1 ? "Account" : "Accounts"}</span>
      </div>
    </>
  );
}

function AccountRules({ model, actions }: AccountWorkspaceProps): ReactElement {
  return (
    <div className="settings-account-rules">
      <section className="settings-rule-section">
        <h3>Provider-Reihenfolge</h3>
        <p>Lege fest, in welcher Reihenfolge verfügbare Provider verwendet werden.</p>
        {model.rules.providerOrder.length === 0 ? (
          <span className="settings-rule-empty">Keine Provider konfiguriert.</span>
        ) : (
          <ol className="settings-provider-order">
            {model.rules.providerOrder.map((provider, index) => (
              <li
                draggable={Boolean(actions.onProviderDragStart)}
                key={`${provider}-${index}`}
                onDragEnd={actions.onProviderDragEnd}
                onDragOver={(event) => actions.onProviderDragOver?.(event, index)}
                onDragStart={(event) => actions.onProviderDragStart?.(event, index)}
                onDrop={(event) => actions.onProviderDrop?.(event, index)}
              >
                <span>{provider}</span>
                {actions.onMoveProvider ? (
                  <span className="settings-provider-order-actions">
                    <button aria-label={`${provider} nach oben`} disabled={index === 0} onClick={() => actions.onMoveProvider?.(index, -1)} type="button">↑</button>
                    <button aria-label={`${provider} nach unten`} disabled={index === model.rules.providerOrder.length - 1} onClick={() => actions.onMoveProvider?.(index, 1)} type="button">↓</button>
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        <label className="settings-rule-toggle">
          <input
            checked={model.rules.autoFallback}
            disabled={!actions.onToggleAutoFallback}
            onChange={(event) => actions.onToggleAutoFallback?.(event.target.checked)}
            type="checkbox"
          />
          <span>Automatischer Fallback</span>
        </label>
        {typeof model.rules.rememberCredentials === "boolean" ? (
          <label className="settings-rule-toggle">
            <input
              checked={model.rules.rememberCredentials}
              disabled={!actions.onToggleRememberCredentials}
              onChange={(event) => actions.onToggleRememberCredentials?.(event.target.checked)}
              type="checkbox"
            />
            <span>Zugangsdaten lokal speichern</span>
          </label>
        ) : null}
      </section>
      <section className="settings-rule-section">
        <h3>Hoster-Routing</h3>
        <p>Eigene Zuordnungen überschreiben für den jeweiligen Hoster die Standardreihenfolge.</p>
        {model.rules.routingEntries ? (
          <>
            {model.rules.routingEntries.length === 0 ? <span className="settings-rule-empty">Keine eigenen Zuordnungen.</span> : (
              <div className="settings-routing-editor">
                {model.rules.routingEntries.map((entry) => (
                  <div className="settings-routing-editor-row" key={entry.hosterId}>
                    <span>{entry.hosterLabel}</span>
                    <select
                      aria-label={`Provider für ${entry.hosterLabel}`}
                      className="settings-control"
                      onChange={(event) => actions.onRoutingProviderChange?.(entry.hosterId, event.target.value)}
                      value={entry.provider}
                    >
                      {entry.providers.map((provider) => <option key={provider.value} value={provider.value}>{provider.label}</option>)}
                    </select>
                    <button aria-label={`${entry.hosterLabel} Zuordnung entfernen`} className="settings-button settings-button-danger" onClick={() => actions.onRoutingRemove?.(entry.hosterId)} type="button">Entfernen</button>
                  </div>
                ))}
              </div>
            )}
            {model.rules.availableRoutingHosters ? (
              <select
                aria-label="Hoster-Routing hinzufügen"
                className="settings-control settings-routing-add"
                onChange={(event) => {
                  if (event.target.value) {
                    actions.onRoutingAdd?.(event.target.value);
                  }
                  event.target.value = "";
                }}
                value=""
              >
                <option disabled value="">Hoster hinzufügen…</option>
                {model.rules.availableRoutingHosters.map((hoster) => <option key={hoster.value} value={hoster.value}>{hoster.label}</option>)}
                <option value="__custom">Eigener Hoster…</option>
              </select>
            ) : null}
          </>
        ) : model.rules.routing.length === 0 ? (
          <span className="settings-rule-empty">Keine eigenen Zuordnungen.</span>
        ) : (
          <ul className="settings-routing-list">
            {model.rules.routing.map((route, index) => <li className="settings-copyable" key={`${route}-${index}`}>{route}</li>)}
          </ul>
        )}
      </section>
      {model.rules.rotationEvents ? (
        <section className="settings-rule-section">
          <h3>Rotations-Verlauf</h3>
          {model.rules.rotationEvents.length === 0 ? (
            <span className="settings-rule-empty">Noch keine Rotations-Ereignisse.</span>
          ) : model.rules.rotationEvents.map((event) => (
            <div className="settings-rotation-event" key={event.id}>
              <strong>{event.title}</strong>
              <span>{event.detail}</span>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

export function AccountWorkspace({ model, actions }: AccountWorkspaceProps): ReactElement {
  return (
    <div className="settings-account-workspace">
      {model.busy ? <span aria-live="polite" className="settings-visually-hidden" role="status">Accountdaten werden aktualisiert.</span> : null}
      {model.error ? <span className="settings-visually-hidden" role="alert">{model.error}</span> : null}
      <header className="settings-account-heading">
        <div>
          <h2>Accountverwaltung</h2>
          <p>Accounts hinzufügen, prüfen und verwalten.</p>
        </div>
      </header>
      <SlidingSelection activeKey={model.activePanel} aria-label="Accountverwaltung" aria-orientation="horizontal" axis="horizontal" className="settings-account-tabs" role="tablist">
        {ACCOUNT_WORKSPACE_PANELS.map((panel, index) => (
          <button
            aria-controls={`settings-account-${panel.id}`}
            aria-selected={model.activePanel === panel.id}
            data-sliding-selection-active={model.activePanel === panel.id}
            data-sliding-selection-item="true"
            id={`settings-account-${panel.id}-tab`}
            key={panel.id}
            onClick={() => actions.onPanelChange(panel.id)}
            onKeyDown={(event) => {
              const nextIndex = getAccountPanelNavigationIndex(index, event.key);
              if (nextIndex === null) {
                return;
              }
              event.preventDefault();
              const tablist = event.currentTarget.closest('[role="tablist"]');
              const tabs = tablist?.querySelectorAll<HTMLElement>('[role="tab"]');
              tabs?.[nextIndex]?.focus();
              actions.onPanelChange(ACCOUNT_WORKSPACE_PANELS[nextIndex].id);
            }}
            role="tab"
            tabIndex={model.activePanel === panel.id ? 0 : -1}
            type="button"
          >{panel.label}</button>
        ))}
      </SlidingSelection>
      <div
        aria-labelledby="settings-account-overview-tab"
        className="settings-account-panel"
        hidden={model.activePanel !== "overview"}
        id="settings-account-overview"
        role="tabpanel"
      >
        {AccountOverview({ actions, model })}
      </div>
      <div
        aria-labelledby="settings-account-rules-tab"
        className="settings-account-panel"
        hidden={model.activePanel !== "rules"}
        id="settings-account-rules"
        role="tabpanel"
      >
        {AccountRules({ actions, model })}
      </div>
    </div>
  );
}

export function AccountAddDialog({
  model,
  actions
}: {
  model: AccountAddDialogModel;
  actions: AccountAddDialogActions;
}): ReactElement | null {
  const selectedOption = model.options.find((option) => option.id === model.selectedOptionId);
  return (
    <Dialog
      actions={(
        <>
          <button className="settings-button settings-button-secondary" disabled={model.busy} onClick={actions.onClose} type="button">Abbrechen</button>
          <button className="settings-button settings-button-primary" disabled={model.busy || !model.selectedOptionId} onClick={actions.onSubmit} type="button">Prüfen und speichern</button>
        </>
      )}
      actionsClassName="settings-account-dialog-actions"
      bodyClassName="settings-account-dialog-body"
      description="Wähle einen Dienst und trage die passenden Zugangsdaten ein."
      onClose={actions.onClose}
      open={model.open}
      size="account"
      title="Account hinzufügen"
    >
      <div className="settings-account-picker-selector">
        <span>Dienst / Zugangstyp</span>
        <input
          aria-controls={model.options.length === 0 ? "settings-account-picker-empty" : "settings-account-picker-results"}
          aria-describedby={model.options.length === 0 ? "settings-account-picker-empty" : undefined}
          aria-label="Dienst oder Zugangstyp suchen"
          className="settings-control"
          onChange={(event) => actions.onQueryChange(event.target.value)}
          placeholder="Dienst oder Zugangstyp suchen"
          type="search"
          value={model.query}
        />
      </div>
      <div className="settings-account-picker-table">
        <div aria-hidden="true" className="settings-account-picker-header">
          <span>Dienst</span>
          <span>Typ/Funktion</span>
        </div>
        {model.options.length === 0 ? (
          <div aria-live="polite" className="settings-account-picker-empty" id="settings-account-picker-empty" role="status">
            Keine passenden Dienste oder Zugangstypen gefunden.
          </div>
        ) : (
          <div aria-label="Dienst / Zugangstyp" className="settings-account-picker-list" id="settings-account-picker-results" role="listbox">
            {model.options.map((option) => (
            <button
              aria-selected={option.id === model.selectedOptionId}
              className={`settings-account-picker-row${option.id === model.selectedOptionId ? " is-selected" : ""}`}
              data-account-option-id={option.id}
              key={option.id}
              onClick={() => actions.onOptionSelect(option.id)}
              role="option"
              type="button"
            >
              <span className="settings-account-picker-service">
                {option.icon ? <img alt="" aria-hidden="true" draggable={false} height="18" src={option.icon} width="18" /> : null}
                <span>{option.title}</span>
              </span>
              <span>{option.functionLabel}</span>
            </button>
            ))}
          </div>
        )}
      </div>
      {selectedOption ? (
        <>
          <div className="settings-account-option-summary">
            <strong>Zugangsdaten für {selectedOption.title}</strong>
            <span>{selectedOption.description}</span>
          </div>
          <AccountDialogFields fields={model.fields} onChange={actions.onFieldChange} />
        </>
      ) : null}
      {model.error ? <p className="settings-account-dialog-error" role="alert">{model.error}</p> : null}
    </Dialog>
  );
}

export function AccountEditDialog({
  model,
  actions
}: {
  model: AccountEditDialogModel;
  actions: AccountEditDialogActions;
}): ReactElement | null {
  return (
    <Dialog
      actions={(
        <>
          <button className="settings-button settings-button-danger" disabled={model.busy} onClick={actions.onRemove} type="button">Entfernen</button>
          <span className="settings-account-dialog-action-spacer" />
          <button className="settings-button settings-button-secondary" disabled={model.busy} onClick={actions.onClose} type="button">Abbrechen</button>
          <button className="settings-button settings-button-secondary" disabled={model.busy} onClick={actions.onCheck} type="button">Prüfen</button>
          <button className="settings-button settings-button-primary" disabled={model.busy} onClick={actions.onSave} type="button">Speichern</button>
        </>
      )}
      actionsClassName="settings-account-dialog-actions"
      bodyClassName="settings-account-dialog-body"
      description="Bearbeite ausschließlich den ausgewählten Account."
      onClose={actions.onClose}
      open={model.open}
      size="account"
      title="Account bearbeiten"
    >
      <div className="settings-account-edit-identity">
        <span>{model.hoster} · {model.mode}</span>
        <strong className="settings-copyable">{model.identity}</strong>
      </div>
      <AccountDialogFields
        fields={model.fields}
        onChange={actions.onFieldChange}
        onCopySecret={actions.onCopySecret}
        onToggleSecret={actions.onToggleSecret}
      />
      <div className="settings-account-edit-enabled-row">
        <label className="settings-rule-toggle settings-account-edit-enabled">
          <input checked={model.enabled} disabled={model.busy} onChange={actions.onToggleEnabled} type="checkbox" />
          <span>Account aktiviert</span>
        </label>
      </div>
      {model.error ? <p className="settings-account-dialog-error" role="alert">{model.error}</p> : null}
    </Dialog>
  );
}
