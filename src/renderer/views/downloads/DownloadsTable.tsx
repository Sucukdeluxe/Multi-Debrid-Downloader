import { memo, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactElement } from "react";
import type { DownloadItem } from "../../../shared/types";
import {
  compactProviderLabels,
  compactDownloadServiceLabel,
  extractHoster,
  formatAudioStripSummary,
  formatDateTime,
  formatHosterLabel,
  formatSpeedMbps,
  humanSize,
  normalizeDownloadServiceLabel,
  providerLabels
} from "../../download-format";
import type { DownloadPackageRow } from "./downloads-model";
import { buildPackagePresentation } from "./package-presentation";

export type DownloadSortColumn = "name" | "size" | "hoster" | "progress" | "service";

const DOWNLOAD_SELECTION_COLUMN_WIDTH = "36px";
const DOWNLOAD_ACTION_COLUMN_WIDTH = "60px";
const DOWNLOAD_COLUMN_DRAG_THRESHOLD_PX = 5;
const PACKAGE_ROW_DISCLOSURE_EXCLUSION_SELECTOR = "button, input, select, textarea, a, [contenteditable='true'], .downloads-copyable, .downloads-meter";

interface DownloadColumnPointerGesture {
  dragged: boolean;
  pointerId: number;
  sortColumn?: DownloadSortColumn;
  startX: number;
}

const downloadColumnPointerGestures = new WeakMap<HTMLDivElement, DownloadColumnPointerGesture>();

type HosterLabel = ReturnType<typeof formatHosterLabel>;

function HosterLabelContent({ label }: { label: HosterLabel }): ReactElement {
  const [iconFailed, setIconFailed] = useState(false);
  if (label.iconSrc && !iconFailed) return <img alt="" className="downloads-hoster-icon" data-hoster={label.title.toLowerCase()} onError={() => setIconFailed(true)} src={label.iconSrc} />;
  return <span>{label.compact}</span>;
}

function HosterLabels({ labels }: { labels: HosterLabel[] }): ReactElement {
  return (
    <span className="downloads-cell downloads-hoster-cell" title={labels.map((label) => label.title).join(", ")}>
      {labels.map((label) => <HosterLabelContent key={label.title} label={label} />)}
    </span>
  );
}

export function downloadGridTemplate(gridTemplate: string): string {
  return `${DOWNLOAD_SELECTION_COLUMN_WIDTH} ${gridTemplate} ${DOWNLOAD_ACTION_COLUMN_WIDTH}`;
}

export function downloadGridTemplateForOrder(columnOrder: readonly string[]): string {
  return downloadGridTemplate(columnOrder.map((column) => downloadColumnDefinitions[column]?.width ?? "100px").join(" "));
}

function isPackageRowDisclosureExcluded(target: EventTarget | null): boolean {
  const closest = (target as { closest?: (selector: string) => Element | null } | null)?.closest;
  return typeof closest === "function" && closest.call(target, PACKAGE_ROW_DISCLOSURE_EXCLUSION_SELECTOR) !== null;
}

export const downloadColumnDefinitions: Record<string, { label: string; width: string; sortable?: DownloadSortColumn }> = {
  name: { label: "Name", width: "minmax(var(--downloads-name-min, 290px), 2.3fr)", sortable: "name" },
  size: { label: "Geladen / Größe", width: "minmax(var(--downloads-size-min, 140px), 1.1fr)", sortable: "size" },
  progress: { label: "Fortschritt", width: "minmax(var(--downloads-progress-min, 105px), 0.85fr)", sortable: "progress" },
  hoster: { label: "Hoster", width: "minmax(var(--downloads-hoster-min, 90px), 0.85fr)", sortable: "hoster" },
  account: { label: "Service", width: "minmax(var(--downloads-service-min, 90px), 0.85fr)", sortable: "service" },
  prio: { label: "Priorität", width: "minmax(var(--downloads-priority-min, 85px), 0.8fr)" },
  status: { label: "Status", width: "minmax(var(--downloads-status-min, 210px), 1.2fr)" },
  speed: { label: "Geschwindigkeit", width: "minmax(var(--downloads-speed-min, 120px), 1fr)" },
  availability: { label: "Verfügbarkeit", width: "minmax(var(--downloads-availability-min, 110px), 1fr)" },
  added: { label: "Hinzugefügt am", width: "minmax(var(--downloads-added-min, 135px), 1fr)" }
};

export type AvailabilityState = "online" | "partial" | "offline" | "checking";

function effectiveItemOnlineStatus(item: DownloadItem): DownloadItem["onlineStatus"] {
  return item.onlineStatus
    ?? (item.status === "downloading" || item.status === "integrity_check" || item.status === "completed" ? "online" : undefined);
}

export function getAvailabilitySummary(items: DownloadItem[]): { online: number; total: number; state: AvailabilityState } {
  const total = items.length;
  const availability = items.map(effectiveItemOnlineStatus);
  const online = availability.filter((status) => status === "online").length;
  const offline = availability.filter((status) => status === "offline").length;
  if (total > 0 && online === total) return { online, total, state: "online" };
  if (total > 0 && offline === total) return { online, total, state: "offline" };
  if (total > 0 && online + offline === total) return { online, total, state: "partial" };
  return { online, total, state: "checking" };
}

function Availability({ online, total, state, text }: { online: number; total: number; state: AvailabilityState; text?: string }): ReactElement {
  const symbol = state === "online" ? "✓" : state === "offline" ? "×" : "●";
  const label = text ?? `${online}/${total} online`;
  if (text) {
    return <span aria-label={label} className={`downloads-cell downloads-availability is-${state}`} title={label}><span aria-hidden="true" className="downloads-availability-symbol">{symbol}</span><span className="downloads-availability-label">{text}</span></span>;
  }
  return (
    <span aria-label={label} className={`downloads-cell downloads-availability has-counts is-${state}`} title={label}>
      <span aria-hidden="true" className="downloads-availability-symbol">{symbol}</span>
      <span className="downloads-availability-count is-online-count">{online}</span>
      <span aria-hidden="true" className="downloads-availability-separator">/</span>
      <span className="downloads-availability-count is-total-count">{total}</span>
      <span className="downloads-availability-label">online</span>
    </span>
  );
}

export interface DownloadsTableActions {
  onSetVisibleSelection: (ids: string[], selected: boolean) => void;
  onToggleSelection: (id: string, ctrlKey: boolean, shiftKey: boolean) => void;
  onSelectionMouseDown: (id: string, event: ReactMouseEvent) => void;
  onSelectionMouseEnter: (id: string) => void;
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
  onColumnPointerDown: (column: string, event: DownloadColumnPointerInput) => void;
  onColumnPointerMove: (column: string, event: DownloadColumnPointerInput) => void;
  onColumnPointerUp: (column: string, event: DownloadColumnPointerInput) => void;
  onColumnPointerCancel: (column: string, event: DownloadColumnPointerInput) => void;
  onColumnContextMenu: (column: string, x: number, y: number) => void;
  onSortColumn: (column: DownloadSortColumn) => void;
}

export interface DownloadColumnPointerInput {
  clientX: number;
  currentTarget: HTMLDivElement;
  pointerId: number;
  preventDefault: () => void;
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

export function compactDownloadStatus(value: string): string {
  const status = value.trim();
  const runtimeWait = status.match(/^(Starte\.\.\.|Starting\.\.\.|Warte auf Daten|Waiting for data|Warte auf Festplatte|Waiting for disk)(?:\s+\([^)]*\))?$/i);
  if (runtimeWait) return runtimeWait[1];
  if (/Link wird umgewandelt/i.test(status)) return "Umwandeln";
  if (/Download läuft\b/i.test(status)) return "Download läuft";
  if (/Download running\b/i.test(status)) return "Download running";
  if (/^Passwort gefunden\b/i.test(status)) return "Passwort gefunden";
  if (/^Password found\b/i.test(status)) return "Password found";
  const passwordCracking = status.match(/^(Passwort knacken|Cracking password):?\s*(\d+)%\s*(?:\((\d+\/\d+)\))?/i);
  if (passwordCracking) {
    return `${passwordCracking[1]}: ${passwordCracking[2]}%${passwordCracking[3] ? ` (${passwordCracking[3]})` : ""}`;
  }
  if (/^Entpack-Fehler\b/i.test(status)) return "Entpack-Fehler";
  if (/^Extraction error\b/i.test(status)) return "Extraction error";
  const extractionPending = status.match(/^(Entpacken|Extracting)\s*-\s*(Ausstehend|Pending|Warten auf Parts|Waiting for parts)/i);
  if (extractionPending) return `${extractionPending[1]} - ${extractionPending[2]}`;
  const extracting = status.match(/Entpacken\s+(\d+)%/i);
  if (extracting) return `Entpacken - ${extracting[1]}%`;
  const extractingEnglish = status.match(/Extracting\s+(\d+)%/i);
  if (extractingEnglish) return `Extracting - ${extractingEnglish[1]}%`;
  const finalizing = status.match(/^(Finalisieren|Finalizing)\b/i);
  if (finalizing) {
    const percentage = status.match(/-\s*(-?\d+(?:\.\d+)?)%/);
    if (percentage) return `${finalizing[1]} - ${progress(Number(percentage[1]))}%`;
    const fraction = status.match(/\(([^)]*)\)/);
    if (fraction) {
      const values = fraction[1].split("/");
      if (values.length !== 2 || values.some((value) => !value.trim())) return finalizing[1];
      const current = Number(values[0]);
      const total = Number(values[1]);
      if (Number.isFinite(current) && Number.isFinite(total) && total > 0) return `${finalizing[1]} - ${progress((current / total) * 100)}%`;
      return finalizing[1];
    }
    return finalizing[1];
  }
  return status;
}

function DownloadMeter({ value, text }: { value: number; text: string }): ReactElement {
  const normalized = progress(value);
  const style = { "--downloads-progress": `${normalized}%` } as CSSProperties;
  return (
    <span aria-label={text} aria-valuemax={100} aria-valuemin={0} aria-valuenow={normalized} className="downloads-meter" role="progressbar" style={style}>
      <span className="downloads-meter-fill" />
      <b aria-hidden="true" className="downloads-meter-label is-track">{text}</b>
      <span aria-hidden="true" className="downloads-meter-filled-clip"><b className="downloads-meter-label is-filled">{text}</b></span>
    </span>
  );
}

function DownloadStatusCell({ status, title }: { status: string; title?: string }): ReactElement {
  const visibleStatus = compactDownloadStatus(status);
  const statusTitle = title || status;
  return (
    <span aria-label={visibleStatus} className="downloads-cell downloads-status-cell" title={statusTitle}>
      <span aria-hidden="true" className="downloads-status-full">{visibleStatus}</span>
      <span aria-hidden="true" className="downloads-status-compact">{visibleStatus}</span>
    </span>
  );
}

function DownloadServiceCell({ label }: { label: string }): ReactElement {
  const full = normalizeDownloadServiceLabel(label);
  const compact = compactDownloadServiceLabel(label);
  return (
    <span aria-label={full} className="downloads-cell downloads-service-cell" title={label}>
      <span aria-hidden="true" className="downloads-service-full">{full}</span>
      <span aria-hidden="true" className="downloads-service-compact">{compact}</span>
    </span>
  );
}

function itemCell(item: DownloadItem, column: string, sessionRunning: boolean): ReactElement | null {
  const displayStatus = displayedStatus(item, sessionRunning);
  const retrySuffix = item.retries > 0 ? ` (R${item.retries})` : "";
  const error = item.lastError.trim();
  const statusTitle = displayStatus
    ? error && error !== displayStatus && !displayStatus.includes(error) ? `${displayStatus}${retrySuffix}\n${error}` : `${displayStatus}${retrySuffix}`
    : error;
  if (column === "name") {
    return <span className="downloads-cell downloads-name-cell downloads-copyable" title={item.fileName}><span className={`downloads-link-state ${effectiveItemOnlineStatus(item) ?? "unknown"}`} />{item.fileName}</span>;
  }
  if (column === "size") {
    const total = item.totalBytes || item.downloadedBytes || 0;
    const value = total > 0 ? progress((item.downloadedBytes / total) * 100) : 0;
    const text = `${humanSize(item.downloadedBytes)} / ${humanSize(total)}`;
    return <span className="downloads-cell downloads-size-cell">{total > 0 ? <DownloadMeter text={text} value={value} /> : null}</span>;
  }
  if (column === "progress") {
    const value = progress(item.progressPercent);
    return <span className="downloads-cell downloads-progress-cell"><DownloadMeter text={`${value}%`} value={value} /></span>;
  }
  if (column === "hoster") {
    const hoster = extractHoster(item.url);
    const label = formatHosterLabel(hoster);
    return <HosterLabels labels={[label]} />;
  }
  if (column === "account") {
    const full = item.providerLabel || (item.provider ? providerLabels[item.provider] : "");
    return <DownloadServiceCell label={full} />;
  }
  if (column === "prio") return <span className="downloads-cell" />;
  if (column === "status") return <DownloadStatusCell status={displayStatus} title={statusTitle} />;
  if (column === "speed") return <span className="downloads-cell">{item.speedBps > 0 ? formatSpeedMbps(item.speedBps) : ""}</span>;
  if (column === "availability") {
    const effectiveStatus = effectiveItemOnlineStatus(item);
    const state = effectiveStatus === "online" ? "online" : effectiveStatus === "offline" ? "offline" : "checking";
    const text = state === "online" ? "Online" : state === "offline" ? "Offline" : item.onlineStatus === "checking" ? "Prüfung" : "Ungeprüft";
    return <Availability online={state === "online" ? 1 : 0} total={1} state={state} text={text} />;
  }
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
      style={{ gridTemplateColumns: downloadGridTemplateForOrder(columnOrder) }}
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
      <span className="downloads-selection-cell" role="cell"><input aria-label={`${item.fileName} auswählen`} checked={selected} onChange={() => {}} onClick={(event) => { event.stopPropagation(); actions.onToggleSelection(item.id, true, event.shiftKey); }} type="checkbox" /></span>
      {columnOrder.map((column) => <span className="downloads-cell-slot" data-download-column={column} key={column} role="cell">{itemCell(item, column, sessionRunning)}</span>)}
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

export function getPackageProgress(row: DownloadPackageRow): { done: number; failed: number; cancelled: number; total: number; value: number } {
  return buildPackagePresentation(row).progress;
}

export function getPackageSizeProgress(row: DownloadPackageRow): { downloaded: number; total: number; value: number } {
  const downloaded = Math.max(0, Number(row.package.cleanedDownloadedBytes || 0))
    + row.allItems.reduce((sum, item) => sum + item.downloadedBytes, 0);
  const total = Math.max(0, Number(row.package.cleanedTotalBytes || 0))
    + row.allItems.reduce((sum, item) => sum + (item.totalBytes || item.downloadedBytes || 0), 0);
  return { downloaded, total, value: total > 0 ? progress((downloaded / total) * 100) : 0 };
}

function packageCell(row: DownloadPackageRow, column: string, packageSpeedBps: number, editing: boolean, editingName: string, actions: DownloadsTableActions, finishRename: (value: string) => void): ReactElement | null {
  const entry = row.package;
  const presentation = buildPackagePresentation(row);
  const stats = presentation.progress;
  if (column === "name") {
    return (
      <span className="downloads-cell downloads-name-cell">
        <button aria-expanded={!row.collapsed} aria-label={row.collapsed ? `${entry.name} ausklappen` : `${entry.name} einklappen`} className="downloads-collapse-button" onClick={(event) => { event.stopPropagation(); actions.onTogglePackageCollapse(entry.id); }} type="button">{row.collapsed ? "+" : "−"}</button>
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
    const { downloaded, total, value } = getPackageSizeProgress(row);
    const text = `${humanSize(downloaded)} / ${humanSize(total)}`;
    return <span className="downloads-cell downloads-size-cell">{total > 0 ? <DownloadMeter text={text} value={value} /> : null}</span>;
  }
  if (column === "progress") return <span className="downloads-cell downloads-progress-cell"><DownloadMeter text={`${stats.value}%`} value={stats.value} /></span>;
  if (column === "hoster") {
    const labels = [...new Set(row.items.map((item) => extractHoster(item.url)).filter(Boolean))].map(formatHosterLabel);
    return <HosterLabels labels={labels} />;
  }
  if (column === "account") {
    const full = compactProviderLabels(row.items.map((item) => item.providerLabel || (item.provider ? providerLabels[item.provider] : "")).filter(Boolean));
    return <DownloadServiceCell label={full} />;
  }
  if (column === "prio") return <span className="downloads-cell">{entry.priority === "high" ? "Hoch" : entry.priority === "low" ? "Niedrig" : ""}</span>;
  if (column === "status") {
    const audio = entry.audioStripSummary ? formatAudioStripSummary(entry.audioStripSummary) : null;
    const rawPostProcessLabel = entry.postProcessLabel?.trim() || "";
    const compactPostProcessLabel = compactDownloadStatus(rawPostProcessLabel);
    const postProcessLabel = entry.status === "extracting" && compactPostProcessLabel === rawPostProcessLabel && /(?:^|[\\/])[^\\/]+\.(?:rar|zip|7z|tar|gz|bz2|xz)(?:\.\d+)?$/i.test(rawPostProcessLabel)
      ? "Entpacken - Ausstehend"
      : compactPostProcessLabel;
    const detailPostProcessLabel = presentation.activeOperationLabel ? rawPostProcessLabel || postProcessLabel : "";
    const details = `${presentation.details}${detailPostProcessLabel ? ` · ${detailPostProcessLabel}` : ""}${audio ? ` · ${audio.text}` : ""}`;
    const status = presentation.status;
    const statusDetails = presentation.extractFailure ? `${details}\n${presentation.extractFailure.fullStatus}` : details;
    const title = audio?.tooltip ? `${statusDetails}\n${audio.tooltip}` : statusDetails;
    return <DownloadStatusCell status={status} title={title} />;
  }
  if (column === "speed") return <span className="downloads-cell">{packageSpeedBps > 0 ? formatSpeedMbps(packageSpeedBps) : ""}</span>;
  if (column === "availability") {
    const availability = getAvailabilitySummary(row.allItems);
    const text = availability.state === "checking"
      ? row.allItems.some((item) => item.onlineStatus === "checking") ? "Prüfung" : "Ungeprüft"
      : undefined;
    return <Availability {...availability} text={text} />;
  }
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
}

export function PackageCardContent({ row, selectedIds, editing, editingName, packageSpeedBps, sessionRunning = true, columnOrder, gridTemplate, actions }: PackageCardProps): ReactElement {
  const entry = row.package;
  let renameFinished = false;
  const finishRename = (value: string): void => {
    if (renameFinished) return;
    renameFinished = true;
    actions.onCommitPackageRename(entry.id, value);
  };
  return (
    <article
      className={`downloads-package-card${entry.enabled ? "" : " is-disabled"}${selectedIds.has(entry.id) ? " is-selected" : ""}`}
      data-download-package-id={entry.id}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        actions.onOpenContextMenu(entry.id, event.clientX, event.clientY, entry.id);
      }}
      onDragStart={(event) => event.preventDefault()}
    >
      <div
        className="downloads-package-row"
        data-download-row-id={entry.id}
        role="row"
        style={{ gridTemplateColumns: downloadGridTemplateForOrder(columnOrder) }}
        onClick={(event) => {
          if (event.detail > 1) return;
          if (!event.ctrlKey && !event.metaKey && !event.shiftKey && selectedIds.size === 1 && selectedIds.has(entry.id)) return;
          actions.onToggleSelection(entry.id, event.ctrlKey || event.metaKey, event.shiftKey);
        }}
        onDoubleClick={(event) => {
          if (event.ctrlKey || event.metaKey || event.shiftKey || isPackageRowDisclosureExcluded(event.target)) return;
          event.preventDefault();
          actions.onTogglePackageCollapse(entry.id);
        }}
        onMouseDown={(event) => actions.onSelectionMouseDown(entry.id, event)}
        onMouseEnter={() => actions.onSelectionMouseEnter(entry.id)}
      >
        <span className="downloads-selection-cell" role="cell"><input aria-label={`${entry.name} auswählen`} checked={selectedIds.has(entry.id)} onChange={() => {}} onClick={(event) => { event.stopPropagation(); actions.onToggleSelection(entry.id, true, event.shiftKey); }} type="checkbox" /></span>
        {columnOrder.map((column) => <span className="downloads-cell-slot" data-download-column={column} key={column} role="cell">{packageCell(row, column, packageSpeedBps, editing, editingName, actions, finishRename)}</span>)}
        <span className="downloads-action-cell" role="cell"><button aria-label={`${entry.name} Aktionen`} onClick={(event) => { event.stopPropagation(); actions.onOpenContextMenu(entry.id, event.clientX, event.clientY, entry.id); }} type="button">⋮</button></span>
      </div>
    </article>
  );
}

export function arePackageCardPropsEqual(previous: PackageCardProps, next: PackageCardProps): boolean {
  const a = previous.row.package;
  const b = next.row.package;
  if (a.id !== b.id || a.updatedAt !== b.updatedAt || a.status !== b.status || a.enabled !== b.enabled || a.name !== b.name || a.priority !== b.priority || a.createdAt !== b.createdAt) return false;
  if (previous.packageSpeedBps !== next.packageSpeedBps || previous.editing !== next.editing || previous.editingName !== next.editingName || previous.row.collapsed !== next.row.collapsed || previous.sessionRunning !== next.sessionRunning || previous.columnOrder !== next.columnOrder || previous.gridTemplate !== next.gridTemplate || previous.actions !== next.actions) return false;
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

function moveColumnWithPointerActions(column: string, direction: -1 | 1, element: HTMLDivElement, actions: DownloadsTableActions): void {
  if (element.closest<HTMLElement>(".downloads-table")?.classList.contains("is-column-drag-settling")) return;
  const sibling = direction < 0 ? element.previousElementSibling : element.nextElementSibling;
  if (!sibling?.matches(".downloads-column-header")) return;
  const currentRect = element.getBoundingClientRect();
  const siblingRect = sibling.getBoundingClientRect();
  const startX = currentRect.left + currentRect.width / 2;
  const clientX = siblingRect.left + siblingRect.width / 2 + direction;
  const pointerId = -1;
  const pointerEvent = (x: number): DownloadColumnPointerInput => ({ clientX: x, currentTarget: element, pointerId, preventDefault: () => {} });
  actions.onColumnPointerDown(column, pointerEvent(startX));
  actions.onColumnPointerMove(column, pointerEvent(clientX));
  actions.onColumnPointerUp(column, pointerEvent(clientX));
}

function isColumnSortPointerTarget(target: EventTarget | null): boolean {
  const closest = (target as { closest?: (selector: string) => Element | null } | null)?.closest;
  return typeof closest === "function" && closest.call(target, ".downloads-column-sort") !== null;
}

export function DownloadsTableHeader({ actions, columnOrder, gridTemplate, sortColumn, sortDirection, selectedCount, visibleIds }: DownloadsTableHeaderProps): ReactElement {
  const allSelected = visibleIds.length > 0 && selectedCount === visibleIds.length;
  const mixedSelection = selectedCount > 0 && selectedCount < visibleIds.length;
  return (
    <div className="downloads-table-header" role="row" style={{ gridTemplateColumns: downloadGridTemplateForOrder(columnOrder) }}>
      <span className="downloads-selection-cell" role="columnheader"><input aria-checked={mixedSelection ? "mixed" : allSelected} aria-label="Alle sichtbaren Downloads auswählen" checked={allSelected} onChange={(event) => actions.onSetVisibleSelection(visibleIds, event.target.checked)} ref={(input) => { if (input) input.indeterminate = mixedSelection; }} type="checkbox" /></span>
      {columnOrder.map((column, index) => {
        const definition = downloadColumnDefinitions[column];
        if (!definition) return null;
        const ariaSort = definition.sortable ? sortColumn === definition.sortable ? sortDirection === "asc" ? "ascending" : "descending" : "none" : undefined;
        return (
          <div
            aria-sort={ariaSort}
            className="downloads-column-header"
            data-download-column={column}
            key={column}
            onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); actions.onColumnContextMenu(column, event.clientX, event.clientY); }}
            onPointerCancel={(event) => {
              downloadColumnPointerGestures.delete(event.currentTarget);
              actions.onColumnPointerCancel(column, event);
            }}
            onPointerDown={(event) => {
              if (event.button !== 0 || !event.isPrimary) return;
              if (event.currentTarget.closest<HTMLElement>(".downloads-table")?.classList.contains("is-column-drag-settling")) return;
              downloadColumnPointerGestures.set(event.currentTarget, {
                dragged: false,
                pointerId: event.pointerId,
                sortColumn: definition.sortable && isColumnSortPointerTarget(event.target) ? definition.sortable : undefined,
                startX: event.clientX
              });
              event.currentTarget.setPointerCapture(event.pointerId);
              actions.onColumnPointerDown(column, event);
            }}
            onPointerMove={(event) => {
              const gesture = downloadColumnPointerGestures.get(event.currentTarget);
              if (gesture?.pointerId === event.pointerId && Math.abs(event.clientX - gesture.startX) >= DOWNLOAD_COLUMN_DRAG_THRESHOLD_PX) gesture.dragged = true;
              actions.onColumnPointerMove(column, event);
            }}
            onPointerUp={(event) => {
              const gesture = downloadColumnPointerGestures.get(event.currentTarget);
              if (gesture?.pointerId === event.pointerId) {
                if (Math.abs(event.clientX - gesture.startX) >= DOWNLOAD_COLUMN_DRAG_THRESHOLD_PX) gesture.dragged = true;
                downloadColumnPointerGestures.delete(event.currentTarget);
              }
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              actions.onColumnPointerUp(column, event);
              if (gesture?.pointerId === event.pointerId && gesture.sortColumn && !gesture.dragged) actions.onSortColumn(gesture.sortColumn);
            }}
            role="columnheader"
          >
            {definition.sortable
              ? <button className="downloads-column-sort" onClick={(event) => { if (event.detail === 0) actions.onSortColumn(definition.sortable!); }} type="button">{definition.label}{sortColumn === definition.sortable ? sortDirection === "asc" ? " ↑" : " ↓" : ""}</button>
              : <span className="downloads-column-label">{definition.label}</span>}
            <span aria-label={`${definition.label} verschieben`} className="downloads-column-move-controls" onPointerDown={(event) => event.stopPropagation()} role="group">
              {index > 0 ? <button aria-label={`${definition.label} nach links verschieben`} onClick={(event) => { event.stopPropagation(); const element = event.currentTarget.closest<HTMLDivElement>(".downloads-column-header"); if (element) moveColumnWithPointerActions(column, -1, element, actions); }} type="button">←</button> : null}
              {index < columnOrder.length - 1 ? <button aria-label={`${definition.label} nach rechts verschieben`} onClick={(event) => { event.stopPropagation(); const element = event.currentTarget.closest<HTMLDivElement>(".downloads-column-header"); if (element) moveColumnWithPointerActions(column, 1, element, actions); }} type="button">→</button> : null}
            </span>
          </div>
        );
      })}
      <span className="downloads-action-cell" role="columnheader">Aktion</span>
    </div>
  );
}
