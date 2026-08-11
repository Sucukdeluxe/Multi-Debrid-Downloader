import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactElement } from "react";
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

export type DownloadSortColumn = "name" | "size" | "hoster" | "progress";

const DOWNLOAD_SELECTION_COLUMN_WIDTH = "36px";
const DOWNLOAD_ACTION_COLUMN_WIDTH = "60px";
const PACKAGE_ROW_DISCLOSURE_EXCLUSION_SELECTOR = "button, input, select, textarea, a, [contenteditable='true'], .downloads-copyable, .downloads-meter";
const useRendererLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

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

function downloadGridTemplate(gridTemplate: string): string {
  return `${DOWNLOAD_SELECTION_COLUMN_WIDTH} ${gridTemplate} ${DOWNLOAD_ACTION_COLUMN_WIDTH}`;
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
  account: { label: "Service", width: "minmax(var(--downloads-service-min, 90px), 0.85fr)" },
  prio: { label: "Priorität", width: "minmax(var(--downloads-priority-min, 85px), 0.8fr)" },
  status: { label: "Status", width: "minmax(var(--downloads-status-min, 210px), 1.2fr)" },
  speed: { label: "Geschwindigkeit", width: "minmax(var(--downloads-speed-min, 120px), 1fr)" },
  availability: { label: "Verfügbarkeit", width: "minmax(var(--downloads-availability-min, 110px), 1fr)" },
  added: { label: "Hinzugefügt am", width: "minmax(var(--downloads-added-min, 135px), 1fr)" }
};

export type AvailabilityState = "online" | "partial" | "offline" | "checking";

export function getAvailabilitySummary(items: DownloadItem[]): { online: number; total: number; state: AvailabilityState } {
  const total = items.length;
  const online = items.filter((item) => item.onlineStatus === "online").length;
  const offline = items.filter((item) => item.onlineStatus === "offline").length;
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
    const fraction = status.match(/\(([^)]*)\)/);
    if (fraction) {
      const values = fraction[1].split("/");
      if (values.length !== 2 || values.some((value) => !value.trim())) return finalizing[1];
      const current = Number(values[0]);
      const total = Number(values[1]);
      if (Number.isFinite(current) && Number.isFinite(total) && total > 0) return `${finalizing[1]} - ${progress((current / total) * 100)}%`;
      return finalizing[1];
    }
    const percentage = status.match(/-\s*(-?\d+(?:\.\d+)?)%/);
    if (percentage) return `${finalizing[1]} - ${progress(Number(percentage[1]))}%`;
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
  const statusTitle = /^(Finalisieren|Finalizing)\b/i.test(status) ? visibleStatus : title || status;
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
    return <span className="downloads-cell downloads-name-cell downloads-copyable" title={item.fileName}><span className={`downloads-link-state ${item.onlineStatus ?? "unknown"}`} />{item.fileName}</span>;
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
    const state = item.onlineStatus === "online" ? "online" : item.onlineStatus === "offline" ? "offline" : "checking";
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
      style={{ gridTemplateColumns: downloadGridTemplate(gridTemplate) }}
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

interface PackageItemsTransitionProps {
  actions: DownloadsTableActions;
  collapsed: boolean;
  columnOrder: readonly string[];
  gridTemplate: string;
  id: string;
  items: DownloadItem[];
  selectedIds: ReadonlySet<string>;
  sessionRunning: boolean;
}

function PackageItemsTransition({ actions, collapsed, columnOrder, gridTemplate, id, items, selectedIds, sessionRunning }: PackageItemsTransitionProps): ReactElement | null {
  const [renderItems, setRenderItems] = useState(!collapsed);
  const animationRef = useRef<Animation | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const initialRenderRef = useRef(true);

  useRendererLayoutEffect(() => {
    if (initialRenderRef.current) {
      initialRenderRef.current = false;
      return;
    }
    if (!renderItems) {
      if (!collapsed) setRenderItems(true);
      return;
    }
    const container = containerRef.current;
    const inner = innerRef.current;
    if (!container || !inner) return;
    animationRef.current?.cancel();
    const targetHeight = inner.scrollHeight;
    const animation = collapsed
      ? container.animate([{ height: `${targetHeight}px`, opacity: 1 }, { height: "0px", opacity: 0 }], { duration: 300, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" })
      : container.animate([{ height: "0px", opacity: 0 }, { height: `${targetHeight}px`, opacity: 1 }], { duration: 300, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" });
    animationRef.current = animation;
    animation.onfinish = () => {
      if (animationRef.current !== animation) return;
      animationRef.current = null;
      if (collapsed) {
        setRenderItems(false);
      } else {
        animation.cancel();
      }
    };
    return () => {
      animation.onfinish = null;
      animation.cancel();
      if (animationRef.current === animation) animationRef.current = null;
    };
  }, [collapsed, renderItems]);

  if (!renderItems) return null;
  return (
    <div
      aria-hidden={collapsed}
      className={`downloads-package-items ${collapsed ? "is-collapsed" : "is-expanded"}`}
      id={id}
      ref={containerRef}
    >
      <div className="downloads-package-items-inner" ref={innerRef}>
        {items.map((item) => <ItemRow actions={actions} columnOrder={columnOrder} gridTemplate={gridTemplate} item={item} key={item.id} selected={selectedIds.has(item.id)} sessionRunning={sessionRunning} />)}
      </div>
    </div>
  );
}

export function getPackageProgress(row: DownloadPackageRow): { done: number; failed: number; cancelled: number; total: number; value: number } {
  let done = Math.max(0, Number(row.package.cleanedCompletedItemCount || 0));
  let failed = 0;
  let cancelled = 0;
  let extracted = Math.max(0, Number(row.package.cleanedExtractedItemCount || 0));
  let extracting = false;
  let activeProgress = 0;
  let extractingProgress = 0;
  for (const item of row.allItems) {
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
  const total = Math.max(1, Math.max(0, Number(row.package.cleanedCompletedItemCount || 0)) + row.allItems.length);
  const allDownloaded = done + failed + cancelled >= total;
  const allExtracted = extracted >= total;
  const useExtractSplit = extracting || row.package.status === "extracting" || (allDownloaded && !allExtracted && done > 0 && extracted > 0 && failed === 0 && cancelled === 0);
  const downloadProgress = Math.min(useExtractSplit ? 50 : 100, Math.floor(((done + activeProgress) / total) * (useExtractSplit ? 50 : 100)));
  const extractionProgress = Math.min(50, Math.floor(((extracted + extractingProgress) / total) * 50));
  const value = Math.min(100, useExtractSplit ? downloadProgress + extractionProgress : downloadProgress);
  return { done, failed, cancelled, total, value };
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
  const stats = getPackageProgress(row);
  if (column === "name") {
    return (
      <span className="downloads-cell downloads-name-cell">
        <button aria-controls={`downloads-package-items-${entry.id}`} aria-expanded={!row.collapsed} aria-label={row.collapsed ? `${entry.name} ausklappen` : `${entry.name} einklappen`} className="downloads-collapse-button" onClick={(event) => { event.stopPropagation(); actions.onTogglePackageCollapse(entry.id); }} type="button">{row.collapsed ? "+" : "−"}</button>
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
    const extractFailure = row.allItems.find((item) => /^Entpack-Fehler\b/i.test(item.fullStatus || ""));
    const waitsForDisk = row.allItems.some((item) => compactDownloadStatus(item.fullStatus || "") === "Warte auf Festplatte");
    const details = `${stats.done}/${stats.total}${stats.failed > 0 ? ` · ${stats.failed} Fehler` : ""}${stats.cancelled > 0 ? ` · ${stats.cancelled} abgebrochen` : ""}${postProcessLabel ? ` · ${postProcessLabel}` : ""}${extractFailure ? " · Entpack-Fehler" : ""}${audio ? ` · ${audio.text}` : ""}`;
    const downloading = entry.status === "downloading" || entry.status === "validating" || row.items.some((item) => item.status === "downloading" || item.status === "validating");
    const status = postProcessLabel && (/Entpacken\s+\d+%/i.test(postProcessLabel) || entry.status === "extracting")
      ? postProcessLabel
      : extractFailure ? "Entpack-Fehler"
        : waitsForDisk ? "Warte auf Festplatte"
          : downloading ? "Download läuft" : details;
    const statusDetails = extractFailure ? `${details}\n${extractFailure.fullStatus}` : details;
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
        style={{ gridTemplateColumns: downloadGridTemplate(gridTemplate) }}
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
      <PackageItemsTransition actions={actions} collapsed={row.collapsed} columnOrder={columnOrder} gridTemplate={gridTemplate} id={`downloads-package-items-${entry.id}`} items={row.items} selectedIds={selectedIds} sessionRunning={sessionRunning} />
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

export function DownloadsTableHeader({ actions, columnOrder, gridTemplate, sortColumn, sortDirection, selectedCount, visibleIds }: DownloadsTableHeaderProps): ReactElement {
  const allSelected = visibleIds.length > 0 && selectedCount === visibleIds.length;
  const mixedSelection = selectedCount > 0 && selectedCount < visibleIds.length;
  return (
    <div className="downloads-table-header" role="row" style={{ gridTemplateColumns: downloadGridTemplate(gridTemplate) }}>
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
            onContextMenu={(event) => { event.preventDefault(); actions.onColumnContextMenu(column, event.clientX, event.clientY); }}
            onPointerCancel={(event) => actions.onColumnPointerCancel(column, event)}
            onPointerDown={(event) => {
              if (event.button !== 0 || !event.isPrimary) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              actions.onColumnPointerDown(column, event);
            }}
            onPointerMove={(event) => actions.onColumnPointerMove(column, event)}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              actions.onColumnPointerUp(column, event);
            }}
            role="columnheader"
          >
            {definition.sortable
              ? <button className="downloads-column-sort" onClick={() => actions.onSortColumn(definition.sortable!)} type="button">{definition.label}{sortColumn === definition.sortable ? sortDirection === "asc" ? " ↑" : " ↓" : ""}</button>
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
