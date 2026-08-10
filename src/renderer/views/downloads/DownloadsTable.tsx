import { memo, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactElement } from "react";
import type { DownloadItem } from "../../../shared/types";
import {
  compactProviderLabels,
  extractHoster,
  formatAudioStripSummary,
  formatDateTime,
  formatSpeedMbps,
  humanSize,
  providerLabels
} from "../../download-format";
import type { DownloadPackageRow } from "./downloads-model";

export type DownloadSortColumn = "name" | "size" | "hoster" | "progress";

export const downloadColumnDefinitions: Record<string, { label: string; width: string; sortable?: DownloadSortColumn }> = {
  name: { label: "Name", width: "minmax(0, 0.92fr)", sortable: "name" },
  size: { label: "Geladen / Größe", width: "160px", sortable: "size" },
  progress: { label: "Fortschritt", width: "80px", sortable: "progress" },
  hoster: { label: "Hoster", width: "110px", sortable: "hoster" },
  account: { label: "Service", width: "132px" },
  prio: { label: "Priorität", width: "70px" },
  status: { label: "Status", width: "160px" },
  speed: { label: "Geschwindigkeit", width: "90px" },
  added: { label: "Hinzugefügt am", width: "155px" }
};

export interface DownloadsTableActions {
  onSetVisibleSelection: (ids: string[], selected: boolean) => void;
  onToggleSelection: (id: string, ctrlKey: boolean, shiftKey: boolean) => void;
  onSelectionMouseDown: (id: string, event: ReactMouseEvent) => void;
  onSelectionMouseEnter: (id: string) => void;
  onTogglePackage: (packageId: string) => void;
  onTogglePackageCollapse: (packageId: string) => void;
  onStartPackageRename: (packageId: string, packageName: string) => void;
  onPackageRenameChange: (name: string) => void;
  onCommitPackageRename: (packageId: string, value: string) => void;
  onCancelPackageRename: (packageId: string) => void;
  onCancelPackage: (packageId: string) => void;
  onMovePackageUp: (packageId: string) => void;
  onMovePackageDown: (packageId: string) => void;
  onRemoveItem: (itemId: string) => void;
  onOpenContextMenu: (id: string, x: number, y: number, packageId?: string) => void;
  onColumnDragStart: (column: string, event: DragEvent<HTMLDivElement>) => void;
  onColumnDragOver: (column: string, event: DragEvent<HTMLDivElement>) => void;
  onColumnDragLeave: () => void;
  onColumnDrop: (column: string, event: DragEvent<HTMLDivElement>) => void;
  onColumnDragEnd: () => void;
  onColumnContextMenu: (column: string, x: number, y: number) => void;
  onSortColumn: (column: DownloadSortColumn) => void;
}

function displayedStatus(item: DownloadItem, sessionRunning: boolean): string {
  const value = item.fullStatus.trim();
  if (value === "Wartet") return "";
  if (sessionRunning) return value;
  if (item.status !== "queued" && item.status !== "reconnect_wait") return value;
  if (value === "Paket gestoppt") return value;
  if (/^Entpacken\b/i.test(value) || /^Entpackt\b/i.test(value) || /^Entpack-Fehler\b/i.test(value) || /^Fertig\b/i.test(value)) return value;
  return "";
}

function progress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value || 0)));
}

function itemCell(item: DownloadItem, column: string, sessionRunning: boolean): ReactElement | null {
  const displayStatus = displayedStatus(item, sessionRunning);
  const retrySuffix = item.retries > 0 ? ` (R${item.retries})` : "";
  const error = item.lastError.trim();
  const statusTitle = displayStatus
    ? error && error !== displayStatus && !displayStatus.includes(error) ? `${displayStatus}${retrySuffix}\n${error}` : `${displayStatus}${retrySuffix}`
    : error;
  if (column === "name") {
    return <span className="downloads-cell downloads-name-cell downloads-copyable" title={item.fileName}><span className={`downloads-link-state ${item.onlineStatus ?? "unknown"}`} />{item.fileName}</span>;
  }
  if (column === "size") {
    const total = item.totalBytes || item.downloadedBytes || 0;
    const value = total > 0 ? progress((item.downloadedBytes / total) * 100) : 0;
    return <span className="downloads-cell downloads-size-cell">{total > 0 ? <span className="downloads-meter"><span style={{ width: `${value}%` }} /><b>{humanSize(item.downloadedBytes)} / {humanSize(total)}</b></span> : null}</span>;
  }
  if (column === "progress") {
    const value = progress(item.progressPercent);
    return <span className="downloads-cell downloads-progress-cell"><span className="downloads-meter"><span style={{ width: `${value}%` }} /><b>{value}%</b></span></span>;
  }
  if (column === "hoster") {
    const hoster = extractHoster(item.url);
    return <span className="downloads-cell" title={hoster}>{hoster}</span>;
  }
  if (column === "account") return <span className="downloads-cell">{item.providerLabel || (item.provider ? providerLabels[item.provider] : "")}</span>;
  if (column === "prio") return <span className="downloads-cell" />;
  if (column === "status") return <span className="downloads-cell" title={statusTitle}>{displayStatus}</span>;
  if (column === "speed") return <span className="downloads-cell">{item.speedBps > 0 ? formatSpeedMbps(item.speedBps) : ""}</span>;
  if (column === "added") return <span className="downloads-cell">{formatDateTime(item.createdAt)}</span>;
  return null;
}

export interface ItemRowProps {
  item: DownloadItem;
  selected: boolean;
  sessionRunning?: boolean;
  columnOrder: readonly string[];
  gridTemplate: string;
  actions: DownloadsTableActions;
}

export function ItemRowContent({ item, selected, sessionRunning = true, columnOrder, gridTemplate, actions }: ItemRowProps): ReactElement {
  return (
    <div
      className={`downloads-item-row${selected ? " is-selected" : ""}`}
      data-download-row-id={item.id}
      role="row"
      style={{ gridTemplateColumns: `36px ${gridTemplate} 44px` }}
      onClick={(event) => {
        event.stopPropagation();
        actions.onToggleSelection(item.id, event.ctrlKey || event.metaKey, event.shiftKey);
      }}
      onMouseDown={(event) => {
        event.stopPropagation();
        actions.onSelectionMouseDown(item.id, event);
      }}
      onMouseEnter={() => actions.onSelectionMouseEnter(item.id)}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        actions.onOpenContextMenu(item.id, event.clientX, event.clientY, item.packageId);
      }}
    >
      <span className="downloads-selection-cell" role="cell"><input aria-label={`${item.fileName} auswählen`} checked={selected} onChange={() => actions.onToggleSelection(item.id, true, false)} onClick={(event) => event.stopPropagation()} type="checkbox" /></span>
      {columnOrder.map((column) => <span className="downloads-cell-slot" key={column} role="cell">{itemCell(item, column, sessionRunning)}</span>)}
      <span className="downloads-action-cell" role="cell"><button aria-label={`${item.fileName} Aktionen`} onClick={(event) => { event.stopPropagation(); actions.onOpenContextMenu(item.id, event.clientX, event.clientY, item.packageId); }} type="button">⋮</button></span>
    </div>
  );
}

export function areItemRowPropsEqual(previous: ItemRowProps, next: ItemRowProps): boolean {
  const a = previous.item;
  const b = next.item;
  return a.id === b.id
    && a.updatedAt === b.updatedAt
    && a.status === b.status
    && a.fileName === b.fileName
    && a.url === b.url
    && a.provider === b.provider
    && a.providerLabel === b.providerLabel
    && a.providerAccountId === b.providerAccountId
    && a.providerAccountLabel === b.providerAccountLabel
    && a.fullStatus === b.fullStatus
    && a.lastError === b.lastError
    && a.onlineStatus === b.onlineStatus
    && a.progressPercent === b.progressPercent
    && a.speedBps === b.speedBps
    && a.downloadedBytes === b.downloadedBytes
    && a.totalBytes === b.totalBytes
    && a.retries === b.retries
    && a.createdAt === b.createdAt
    && previous.selected === next.selected
    && previous.sessionRunning === next.sessionRunning
    && previous.columnOrder === next.columnOrder
    && previous.gridTemplate === next.gridTemplate
    && previous.actions === next.actions;
}

export const ItemRow = memo(ItemRowContent, areItemRowPropsEqual);

function packageProgress(row: DownloadPackageRow): { done: number; failed: number; cancelled: number; total: number; value: number } {
  let done = 0;
  let failed = 0;
  let cancelled = 0;
  let extracted = 0;
  let extracting = false;
  let activeProgress = 0;
  let extractingProgress = 0;
  for (const item of row.items) {
    if (item.status === "completed") done += 1;
    else if (item.status === "failed") failed += 1;
    else if (item.status === "cancelled") cancelled += 1;
    const fullStatus = item.fullStatus || "";
    if (fullStatus.startsWith("Entpackt")) {
      extracted += 1;
    } else if (fullStatus.startsWith("Entpacken")) {
      extracting = true;
      const match = fullStatus.match(/^Entpacken\s+(\d+)%/);
      if (match) extractingProgress += Number(match[1]) / 100;
    }
    if (item.status === "downloading" || (item.status === "queued" && (item.progressPercent || 0) > 0)) {
      activeProgress += (item.progressPercent || 0) / 100;
    }
  }
  const total = Math.max(1, row.items.length);
  const allDownloaded = done + failed + cancelled >= total;
  const allExtracted = extracted >= total;
  const useExtractSplit = extracting || row.package.status === "extracting" || (allDownloaded && !allExtracted && done > 0 && extracted > 0 && failed === 0 && cancelled === 0);
  const downloadProgress = Math.min(useExtractSplit ? 50 : 100, Math.floor(((done + activeProgress) / total) * (useExtractSplit ? 50 : 100)));
  const extractionProgress = Math.min(50, Math.floor(((extracted + extractingProgress) / total) * 50));
  const value = Math.min(100, useExtractSplit ? downloadProgress + extractionProgress : downloadProgress);
  return { done, failed, cancelled, total, value };
}

function packageCell(row: DownloadPackageRow, column: string, packageSpeedBps: number, editing: boolean, editingName: string, actions: DownloadsTableActions, finishRename: (value: string) => void): ReactElement | null {
  const entry = row.package;
  const stats = packageProgress(row);
  if (column === "name") {
    return (
      <span className="downloads-cell downloads-name-cell">
        <button aria-label={row.collapsed ? `${entry.name} ausklappen` : `${entry.name} einklappen`} className="downloads-collapse-button" onClick={(event) => { event.stopPropagation(); actions.onTogglePackageCollapse(entry.id); }} type="button">{row.collapsed ? "+" : "−"}</button>
        <input aria-label={`${entry.name} aktivieren`} checked={entry.enabled} onChange={() => actions.onTogglePackage(entry.id)} onClick={(event) => event.stopPropagation()} type="checkbox" />
        {editing
          ? <input autoFocus className="downloads-rename-input" value={editingName} onBlur={() => finishRename(editingName)} onChange={(event) => actions.onPackageRenameChange(event.target.value)} onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Enter") {
              event.preventDefault();
              finishRename(editingName);
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.preventDefault();
              actions.onCancelPackageRename(entry.id);
            }
          }} />
          : <strong className="downloads-copyable" onDoubleClick={(event) => { event.stopPropagation(); actions.onStartPackageRename(entry.id, entry.name); }} title={entry.name}>{entry.name}</strong>}
      </span>
    );
  }
  if (column === "size") {
    const total = row.items.reduce((sum, item) => sum + (item.totalBytes || item.downloadedBytes || 0), 0);
    const downloaded = row.items.reduce((sum, item) => sum + item.downloadedBytes, 0);
    const value = total > 0 ? progress((downloaded / total) * 100) : 0;
    return <span className="downloads-cell downloads-size-cell">{total > 0 ? <span className="downloads-meter"><span style={{ width: `${value}%` }} /><b>{humanSize(downloaded)} / {humanSize(total)}</b></span> : null}</span>;
  }
  if (column === "progress") return <span className="downloads-cell downloads-progress-cell"><span className="downloads-meter"><span style={{ width: `${stats.value}%` }} /><b>{stats.value}%</b></span></span>;
  if (column === "hoster") {
    const value = [...new Set(row.items.map((item) => extractHoster(item.url)).filter(Boolean))].join(", ");
    return <span className="downloads-cell" title={value}>{value}</span>;
  }
  if (column === "account") {
    const value = compactProviderLabels(row.items.map((item) => item.providerLabel || (item.provider ? providerLabels[item.provider] : "")).filter(Boolean));
    return <span className="downloads-cell" title={value}>{value}</span>;
  }
  if (column === "prio") return <span className="downloads-cell">{entry.priority === "high" ? "Hoch" : entry.priority === "low" ? "Niedrig" : ""}</span>;
  if (column === "status") {
    const audio = entry.audioStripSummary ? formatAudioStripSummary(entry.audioStripSummary) : null;
    return <span className="downloads-cell" title={audio?.tooltip}>{stats.done}/{stats.total}{stats.failed > 0 ? ` · ${stats.failed} Fehler` : ""}{stats.cancelled > 0 ? ` · ${stats.cancelled} abgebrochen` : ""}{entry.postProcessLabel ? ` · ${entry.postProcessLabel}` : ""}{audio ? ` · ${audio.text}` : ""}</span>;
  }
  if (column === "speed") return <span className="downloads-cell">{packageSpeedBps > 0 ? formatSpeedMbps(packageSpeedBps) : ""}</span>;
  if (column === "added") return <span className="downloads-cell">{formatDateTime(entry.createdAt)}</span>;
  return null;
}

export interface PackageCardProps {
  row: DownloadPackageRow;
  selectedIds: Set<string>;
  selectedVersion: number;
  editing: boolean;
  editingName: string;
  packageSpeedBps: number;
  sessionRunning?: boolean;
  columnOrder: readonly string[];
  gridTemplate: string;
  actions: DownloadsTableActions;
  draggable?: boolean;
  onDragStart?: (packageId: string) => void;
  onDrop?: (packageId: string) => void;
  onDragEnd?: () => void;
}

export function PackageCardContent({ row, selectedIds, editing, editingName, packageSpeedBps, sessionRunning = true, columnOrder, gridTemplate, actions, draggable = true, onDragStart, onDrop, onDragEnd }: PackageCardProps): ReactElement {
  const entry = row.package;
  let renameFinished = false;
  const finishRename = (value: string): void => {
    if (renameFinished) return;
    renameFinished = true;
    actions.onCommitPackageRename(entry.id, value);
  };
  return (
    <article
      className={`package-card downloads-package-card${entry.enabled ? "" : " is-disabled"}${selectedIds.has(entry.id) ? " is-selected" : ""}`}
      data-download-package-id={entry.id}
      draggable={draggable}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        actions.onOpenContextMenu(entry.id, event.clientX, event.clientY, entry.id);
      }}
      onDragStart={(event) => { event.stopPropagation(); onDragStart?.(entry.id); }}
      onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onDrop={(event) => { event.preventDefault(); event.stopPropagation(); onDrop?.(entry.id); }}
      onDragEnd={(event) => { event.stopPropagation(); onDragEnd?.(); }}
    >
      <div
        className="downloads-package-row"
        data-download-row-id={entry.id}
        role="row"
        style={{ gridTemplateColumns: `36px ${gridTemplate} 44px` }}
        onClick={(event) => {
          const target = event.target as HTMLElement;
          if (event.ctrlKey || event.metaKey || event.shiftKey) {
            actions.onToggleSelection(entry.id, event.ctrlKey || event.metaKey, event.shiftKey);
            return;
          }
          if (target.closest("button, input, select")) return;
          actions.onTogglePackageCollapse(entry.id);
        }}
        onMouseDown={(event) => actions.onSelectionMouseDown(entry.id, event)}
        onMouseEnter={() => actions.onSelectionMouseEnter(entry.id)}
      >
        <span className="downloads-selection-cell" role="cell"><input aria-label={`${entry.name} auswählen`} checked={selectedIds.has(entry.id)} onChange={() => actions.onToggleSelection(entry.id, true, false)} onClick={(event) => event.stopPropagation()} type="checkbox" /></span>
        {columnOrder.map((column) => <span className="downloads-cell-slot" key={column} role="cell">{packageCell(row, column, packageSpeedBps, editing, editingName, actions, finishRename)}</span>)}
        <span className="downloads-action-cell" role="cell"><button aria-label={`${entry.name} Aktionen`} onClick={(event) => { event.stopPropagation(); actions.onOpenContextMenu(entry.id, event.clientX, event.clientY, entry.id); }} type="button">⋮</button></span>
      </div>
      {!row.collapsed && row.items.map((item) => <ItemRow actions={actions} columnOrder={columnOrder} gridTemplate={gridTemplate} item={item} key={item.id} selected={selectedIds.has(item.id)} sessionRunning={sessionRunning} />)}
    </article>
  );
}

export function arePackageCardPropsEqual(previous: PackageCardProps, next: PackageCardProps): boolean {
  const a = previous.row.package;
  const b = next.row.package;
  if (a.id !== b.id || a.updatedAt !== b.updatedAt || a.status !== b.status || a.enabled !== b.enabled || a.name !== b.name || a.priority !== b.priority || a.createdAt !== b.createdAt) return false;
  if (previous.packageSpeedBps !== next.packageSpeedBps || previous.editing !== next.editing || previous.editingName !== next.editingName || previous.row.collapsed !== next.row.collapsed || previous.sessionRunning !== next.sessionRunning || previous.columnOrder !== next.columnOrder || previous.gridTemplate !== next.gridTemplate || previous.actions !== next.actions || previous.draggable !== next.draggable || previous.onDragStart !== next.onDragStart || previous.onDrop !== next.onDrop || previous.onDragEnd !== next.onDragEnd) return false;
  if (previous.selectedVersion !== next.selectedVersion || previous.selectedIds !== next.selectedIds) {
    if (previous.selectedIds.has(a.id) !== next.selectedIds.has(a.id)) return false;
    for (const itemId of b.itemIds) {
      if (previous.selectedIds.has(itemId) !== next.selectedIds.has(itemId)) return false;
    }
  }
  if (previous.row.items.length !== next.row.items.length) return false;
  for (let index = 0; index < previous.row.items.length; index += 1) {
    const oldItem = previous.row.items[index];
    const newItem = next.row.items[index];
    if (!oldItem || !newItem || !areItemRowPropsEqual({ actions: previous.actions, columnOrder: previous.columnOrder, gridTemplate: previous.gridTemplate, item: oldItem, selected: previous.selectedIds.has(oldItem.id), sessionRunning: previous.sessionRunning }, { actions: next.actions, columnOrder: next.columnOrder, gridTemplate: next.gridTemplate, item: newItem, selected: next.selectedIds.has(newItem.id), sessionRunning: next.sessionRunning })) return false;
  }
  return true;
}

export const PackageCard = memo(PackageCardContent, arePackageCardPropsEqual);

export interface DownloadsTableHeaderProps {
  actions: DownloadsTableActions;
  columnOrder: readonly string[];
  gridTemplate: string;
  sortColumn: DownloadSortColumn;
  sortDirection: "asc" | "desc";
  selectedCount: number;
  visibleIds: string[];
}

export function DownloadsTableHeader({ actions, columnOrder, gridTemplate, sortColumn, sortDirection, selectedCount, visibleIds }: DownloadsTableHeaderProps): ReactElement {
  return (
    <div className="downloads-table-header" role="row" style={{ gridTemplateColumns: `36px ${gridTemplate} 44px` }}>
      <span className="downloads-selection-cell" role="columnheader"><input aria-label="Alle sichtbaren Downloads auswählen" checked={visibleIds.length > 0 && selectedCount === visibleIds.length} onChange={(event) => actions.onSetVisibleSelection(visibleIds, event.target.checked)} type="checkbox" /></span>
      {columnOrder.map((column) => {
        const definition = downloadColumnDefinitions[column];
        if (!definition) return null;
        return (
          <div
            className="downloads-column-header"
            draggable
            key={column}
            onContextMenu={(event) => { event.preventDefault(); actions.onColumnContextMenu(column, event.clientX, event.clientY); }}
            onDragEnd={actions.onColumnDragEnd}
            onDragLeave={actions.onColumnDragLeave}
            onDragOver={(event) => actions.onColumnDragOver(column, event)}
            onDragStart={(event) => actions.onColumnDragStart(column, event)}
            onDrop={(event) => actions.onColumnDrop(column, event)}
            role="columnheader"
          >
            {definition.sortable
              ? <button onClick={() => actions.onSortColumn(definition.sortable!)} type="button">{definition.label}{sortColumn === definition.sortable ? sortDirection === "asc" ? " ↑" : " ↓" : ""}</button>
              : definition.label}
          </div>
        );
      })}
      <span className="downloads-action-cell" role="columnheader">Aktion</span>
    </div>
  );
}
