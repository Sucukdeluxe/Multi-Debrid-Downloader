import { DragEvent, ReactElement, memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { parseDebridLinkApiKeys } from "../shared/debrid-link-keys";
import type { RealDebridLoginRequest } from "../shared/preload-api";
import type {
  AccountCreateCommand,
  AllDebridHostInfo,
  AppTheme,
  BandwidthScheduleEntry,
  DebugSetupCheckResult,
  DebridFallbackProvider,
  DebridLinkHostLimitInfo,
  DebridProvider,
  DownloadItem,
  DownloadStats,
  DuplicatePolicy,
  HistoryEntry,
  PackageEntry,
  RemoteDiagnosticsInfo,
  RendererAccount,
  RendererSettings,
  RendererSettingsUpdate,
  StartConflictEntry,
  UiSnapshot,
  UpdateCheckResult,
  UpdateInstallProgress
} from "../shared/types";
import {
  getDebridLinkApiKeyTotalUsageBytes,
  getDebridLinkApiKeyDailyLimitBytes,
  getDebridLinkApiKeyDailyRemainingBytes,
  getDebridLinkApiKeyDailyUsageBytes,
  getMegaDebridAccountDailyLimitBytes,
  getMegaDebridAccountDailyUsageBytes,
  getMegaDebridAccountTotalUsageBytes,
  getProviderDailyLimitBytes,
  getProviderDailyRemainingBytes,
  getProviderTotalUsageBytes,
  getProviderDailyUsageBytes,
  getProviderUsageDayKey
} from "../shared/provider-daily-limits";
import { preservePackageOrderForDisplay, sortPackageOrderByAvailability, sortPackageOrderByName } from "./package-order";
import { createPackageOrderState } from "./package-order-state";
import { getPackagesWithOfflineLinks } from "../shared/offline-packages";
import { pruneSelection, releaseAccountSelectionFocus, resolveEscapeSelectionScope, resolveSelectAllSelectionScope, shouldClearDownloadSelection } from "./selection";
import { buildConfiguredProviderOrder, createAccountToggleQueue, enqueueAccountToggleIntent, filterAccountDialogOptions, formatAccountOperationError, getAccountDialogSelectableOptions, getAvailableAccountOptions, mergeAccountToggleSettings, pruneAccountRowSelections, resolveAccountStatusState, resolveAccountToggleIntentEnabled, resolveAccountUsername, resolveVisibleAccountKind, sortAccountServices, updateAccountRowSelection, type AccountToggleTarget } from "./account-ui";
import { buildAccountDeleteCommand, buildAccountReplaceCommand, buildAccountSecretRequest, createAccountEditState, validateAccountEdit } from "./account-edit";
import type { AccountEditState, AccountEditTarget, AccountKind, AccountService, SingleAccountKind } from "./account-edit";
import { ACCOUNT_SERVICE_ICONS } from "./account-service-icons";
import { DOWNLOAD_SPEED_MAX_SAMPLES, updateDownloadSpeedHistory } from "./download-speed-state";
import { createUiLocalizer, normalizeLanguage } from "./i18n";
import { runLocalBackupExport, runLocalBackupImport, type BackupPassphraseMode } from "./backup-flow";
import type { DownloadSpeedHistoryState } from "./download-speed-state";
import { extractHoster, formatDateTime, formatSpeedMbps, humanSize, providerLabels } from "./download-format";
import { AppShell } from "./shell/AppShell";
import { AvatarMenu } from "./shell/AvatarMenu";
import { OverlayHost } from "./shell/OverlayHost";
import { UpdateExperience } from "./shell/UpdateExperience";
import type { MainView } from "./shell/shell-model";
import { ContextMenu } from "./ui/ContextMenu";
import { BackupPassphraseDialog } from "./ui/BackupPassphraseDialog";
import { Dialog } from "./ui/Dialog";
import { Icon } from "./ui/Icon";
import { Toast } from "./ui/Toast";
import { LinkAddressesDialog } from "./ui/LinkAddressesDialog";
import { serializeCollectorPackages, type CollectorEnrichmentProgress, type CollectorInspectionResult, type CollectorPackage } from "../shared/collector";
import { routeDroppedDlcFiles } from "./collector-drop";
import { beginCollectorEnrichment, filterCurrentCollectorEnrichment, pruneCollectorEnrichmentGenerations } from "./collector-enrichment";
import {
  buildCollectorTransferPackages,
  buildCollectorWorkspaceViewModel,
  mergeCollectorPackagesWithinCapacity,
  removeCollectorLinks,
  reconcileCollectorCollapsedPackageIds,
  reconcileCollectorCollapsedPackageIdsWithPackages,
  reconcileCollectorSelectionWithPackages,
  setCollectorVisibleSelection,
  selectCollectorPackageLinks,
  type CollectorWorkspaceFilter
} from "./views/collector/collector-model";
import { guardCollectorBeforeUnload, resolveCollectorLateHydration } from "./views/collector/collector-hydration";
import { createCollectorPersistenceCoordinator, type CollectorPersistenceCoordinator } from "./views/collector/collector-persistence";
import { advanceCollectorPersistenceBudget, createCollectorPersistenceBudget, type CollectorPersistenceBudget } from "./views/collector/collector-persistence-budget";
import {
  CollectorInputDialog,
  MemoizedCollectorContent,
  CollectorSidebar,
  CollectorSidebarStatus,
  CollectorToolbar,
  type CollectorViewActions
} from "./views/collector/CollectorView";
import {
  buildHistoryViewModel,
  mergeLiveHistoryEntry,
  pruneHistoryIds,
  toggleHistoryPageSelection,
  type HistoryFilter
} from "./views/history/history-model";
import {
  HistoryContent,
  HistoryFooter,
  HistorySidebar,
  HistoryToolbar,
  type HistoryViewActions
} from "./views/history/HistoryView";
import {
  buildStatisticsViewModel,
  type StatisticsRange
} from "./views/statistics/statistics-model";
import {
  StatisticsContent,
  StatisticsSidebar,
  StatisticsSidebarStatus,
  type StatisticsViewActions
} from "./views/statistics/StatisticsView";
import { buildDownloadsViewModel, formatDownloadEta, formatRemainingDownloadBytes, formatRemainingDownloadTooltip, getDownloadQueueStatusMetrics, getDownloadSpeedBps, getPackageErrorItemIds, isDownloadItemError, type DownloadDisplayMode, type DownloadSidebarFilter } from "./views/downloads/downloads-model";
import { downloadColumnDefinitions, type DownloadSortColumn } from "./views/downloads/DownloadsTable";
import { DeleteConfirmationDialog } from "./views/downloads/DeleteConfirmationDialog";
import { beginDownloadColumnDrag, clearDownloadColumnDrag, commitDownloadColumnDrag, createDownloadColumnOrderPersistence, DOWNLOAD_COLUMN_MOVE_DURATION_MS, updateDownloadColumnDrag, type DownloadColumnDragSession, type DownloadColumnOrderPersistence } from "./views/downloads/column-drag";
import {
  DownloadContextStartActions,
  DownloadsContent,
  DownloadsFooter,
  DownloadsSidebar,
  DownloadsSidebarStatus,
  DownloadsToolbar,
  runPauseDownloadAction,
  runResumeDownloadAction,
  runDownloadStartAction,
  type DailyScheduleStartDay,
  type DownloadsViewActions,
  type DownloadsViewModel
} from "./views/downloads/DownloadsView";
import {
  buildAccountRowId,
  buildSettingsFormViewModel,
  buildTargetedAccountCheck,
  projectAccountRows,
  resolveHistoryRetentionSelection,
  normalizeNotificationNumberField,
  sortAccountRows,
  formatAccountContextHeading,
  type AccountAddOption,
  type AccountRowSource,
  type SettingsFormViewModel,
  type SettingsSaveState,
  type SettingsSection,
  type SettingsThemeChoice
} from "./views/settings/settings-model";
import {
  AccountAddDialog,
  AccountEditDialog,
  type AccountDialogField,
  type AccountWorkspaceActions,
  type AccountWorkspaceViewModel
} from "./views/settings/AccountWorkspace";
import {
  SettingsContent,
  SettingsSidebar,
  type SettingsViewActions,
  type SettingsViewModel
} from "./views/settings/SettingsView";

type Tab = MainView;

const appIntegerFormatter = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });

export function formatHistorySidebarCounts(entries: number, visible: number, selected: number): {
  entries: string;
  visible: string;
  selected: string;
} {
  return {
    entries: `Einträge: ${appIntegerFormatter.format(entries)}`,
    visible: `Sichtbar: ${appIntegerFormatter.format(visible)}`,
    selected: `Ausgewählt: ${appIntegerFormatter.format(selected)}`
  };
}

function mergeSnapshotWireState(master: UiSnapshot, wireState: UiSnapshot): UiSnapshot {
  if (wireState.payloadKind !== "delta") return wireState;
  const items: Record<string, DownloadItem> = { ...master.session.items, ...wireState.session.items };
  for (const id of wireState.removedItemIds ?? []) delete items[id];
  const packages: Record<string, PackageEntry> = { ...master.session.packages, ...wireState.session.packages };
  for (const id of wireState.removedPackageIds ?? []) delete packages[id];
  return {
    ...wireState,
    session: {
      ...wireState.session,
      items,
      packages
    }
  };
}

function getSnapshotRevision(snapshot: UiSnapshot): number | null {
  const revision = snapshot.snapshotRevision;
  return typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 0
    ? revision
    : null;
}

function mergeNewerSnapshot(master: UiSnapshot, incoming: UiSnapshot): UiSnapshot | null {
  const masterRevision = getSnapshotRevision(master);
  const incomingRevision = getSnapshotRevision(incoming);
  if (masterRevision !== null && (incomingRevision === null || incomingRevision <= masterRevision)) {
    return null;
  }
  return mergeSnapshotWireState(master, incoming);
}

export interface SnapshotBootstrapCoordinator {
  initialize: (snapshot: UiSnapshot) => UiSnapshot;
  push: (snapshot: UiSnapshot) => UiSnapshot | null;
  getStatus: () => SnapshotBootstrapStatus;
  fail: (message: string) => SnapshotBootstrapStatus;
  retry: () => SnapshotBootstrapStatus;
}

export type SnapshotBootstrapStatus = {
  phase: "loading" | "ready" | "error";
  message: string;
};

export function createSnapshotBootstrapCoordinator(): SnapshotBootstrapCoordinator {
  let initialized = false;
  let current: UiSnapshot | null = null;
  let pending: UiSnapshot[] = [];
  let status: SnapshotBootstrapStatus = { phase: "loading", message: "" };
  return {
    initialize: (snapshot) => {
      if (initialized && current) {
        const currentRevision = getSnapshotRevision(current);
        const snapshotRevision = getSnapshotRevision(snapshot);
        if (snapshotRevision !== null && (currentRevision === null || snapshotRevision > currentRevision)) {
          current = snapshot;
        }
        return current;
      }
      current = pending.reduce((master, incoming) => mergeNewerSnapshot(master, incoming) ?? master, snapshot);
      pending = [];
      initialized = true;
      status = { phase: "ready", message: "" };
      return current;
    },
    push: (snapshot) => {
      if (!initialized) {
        if (snapshot.payloadKind === "delta") {
          pending.push(snapshot);
          return null;
        }
        current = snapshot;
        pending = [];
        initialized = true;
        status = { phase: "ready", message: "" };
        return current;
      }
      const merged = mergeNewerSnapshot(current as UiSnapshot, snapshot);
      if (!merged) {
        return null;
      }
      current = merged;
      return current;
    },
    getStatus: () => ({ ...status }),
    fail: (message) => {
      if (!initialized) {
        status = { phase: "error", message };
      }
      return { ...status };
    },
    retry: () => {
      if (!initialized) {
        status = { phase: "loading", message: "" };
      }
      return { ...status };
    }
  };
}

interface CollectorInputState {
  draft: string;
}

interface StartConflictPromptState {
  entry: StartConflictEntry;
  applyToAll: boolean;
}

interface ConfirmPromptState {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  details?: string;
  detailsLabel?: string;
}

interface OnlineBackupDialogState {
  mode: "export" | "import";
  key: string;
  busy: boolean;
  error: string;
}

interface ContextMenuState {
  x: number;
  y: number;
  packageId: string;
  itemId?: string;
}

interface LinkPopupState {
  title: string;
  links: { name: string; url: string }[];
  isPackage: boolean;
}

type AccountQuickAction = "realdebrid-login" | "bestdebrid-cookies" | "alldebrid-login" | "alldebrid-status";
interface AccountOption {
  kind: AccountKind;
  service: AccountService;
  serviceLabel: string;
  title: string;
  modeLabel: string;
  pickerDescription: string;
  needsToken?: boolean;
  needsCredentials?: boolean;
}

interface MegaDialogAccount {
  login: string;
  password: string;
}

export interface AccountDialogState {
  mode: "create" | "edit";
  kind: AccountKind | null;
  service: AccountService | null;
  token: string;
  login: string;
  password: string;
  dailyLimitGb: string;
  keyDailyLimitGbById: Record<string, string>;
  megaAccounts: MegaDialogAccount[];
  megaNewLogin: string;
  megaNewPassword: string;
  megaDisabledIds: string[];
}

interface DebridLinkAccountKeyEntry {
  id: string;
  label: string;
  token: string;
  masked: string;
  disabled: boolean;
  dailyUsedBytes: number;
  totalUsedBytes: number;
  dailyLimitBytes: number;
  dailyRemainingBytes: number | null;
  dailyLimitReached: boolean;
}

interface ConfiguredAccountEntry {
  kind: AccountKind;
  service: AccountService;
  provider: DebridProvider;
  serviceLabel: string;
  modeLabel: string;
  statusLabel: string;
  summary: string;
  summaryLines: string[];
  note: string;
  disabled: boolean;
  dailyUsedBytes: number;
  totalUsedBytes: number;
  dailyLimitBytes: number;
  dailyRemainingBytes: number | null;
  dailyLimitReached: boolean;
  debridLinkKeys: DebridLinkAccountKeyEntry[];
}

interface AccountTableRow {
  rowKey: string;
  entry: ConfiguredAccountEntry;
  hosterLabel: string;
  modeLabel: string;
  username: string;
  credentialLabel: string;
  accountId: string | null;
  checkable: boolean;
  disabled: boolean;
  dailyUsedBytes: number;
  dailyLimitBytes: number;
  dailyRemainingBytes: number;
  totalUsedBytes: number;
  toggleKind: "rd" | "mega" | "dl" | "single";
  dlKey?: DebridLinkAccountKeyEntry;
  editTarget: AccountEditTarget;
}

interface AccountContextMenuState {
  x: number;
  y: number;
  rowId: string;
}

function getAccountToggleTarget(account: AccountTableRow): AccountToggleTarget {
  if (account.toggleKind === "rd" && account.accountId) return { type: "realdebrid", accountId: account.accountId };
  if (account.toggleKind === "mega" && account.accountId) {
    return { type: "megadebrid", provider: account.entry.kind as "megadebrid-api" | "megadebrid-web", accountId: account.accountId };
  }
  if (account.toggleKind === "dl" && account.dlKey) return { type: "debridlink", accountId: account.dlKey.id };
  return { type: "provider", provider: account.entry.provider };
}

interface RendererSettingsDraft extends RendererSettings {
  archivePasswordList: string;
  notifyUrl: string;
}

export function createSettingsDraft(settings: RendererSettings, current?: RendererSettingsDraft): RendererSettingsDraft {
  return {
    ...settings,
    archivePasswordList: current?.archivePasswordList || "",
    notifyUrl: current?.notifyUrl || ""
  };
}

export function createDiscardedSettingsState(settings: RendererSettings, themeChoice: SettingsThemeChoice = settings.themePreference): {
  draft: RendererSettingsDraft;
  themeChoice: SettingsThemeChoice;
  speedLimitInput: string;
  scheduleSpeedInputs: Record<string, string>;
} {
  return {
    draft: createSettingsDraft(settings),
    themeChoice,
    speedLimitInput: formatMbpsInputFromKbps(settings.speedLimitKbps),
    scheduleSpeedInputs: Object.fromEntries(
      (settings.bandwidthSchedules || []).map((schedule) => [schedule.id, formatMbpsInputFromKbps(schedule.speedLimitKbps)])
    )
  };
}

export function resolveSettingsSaveCompletion(revisionAtStart: number, currentRevision: number): {
  saveState: Extract<SettingsSaveState, "saved" | "dirty">;
  applyPersistedTheme: boolean;
  toast: string;
} {
  const unchanged = revisionAtStart === currentRevision;
  return unchanged
    ? { saveState: "saved", applyPersistedTheme: true, toast: "Einstellungen gespeichert" }
    : { saveState: "dirty", applyPersistedTheme: false, toast: "Zwischenstand gespeichert – weitere Änderungen sind ungespeichert" };
}

export function captureSettingsSaveIntent<T>(revision: number, draft: T): { revision: number; draft: T } {
  return { revision, draft: structuredClone(draft) };
}

export function resolveSettingsThemeChoice(choice: SettingsThemeChoice, prefersLight: boolean): AppTheme {
  return choice === "system" ? (prefersLight ? "light" : "dark") : choice;
}

function getAccountQuickActionMeta(kind: AccountKind): { label: string; action: AccountQuickAction } | null {
  switch (kind) {
    case "realdebrid-web":
      return { label: "Login", action: "realdebrid-login" };
    case "bestdebrid-web":
      return { label: "Cookies", action: "bestdebrid-cookies" };
    case "alldebrid-api":
      return { label: "Status", action: "alldebrid-status" };
    case "alldebrid-web":
      return { label: "Login", action: "alldebrid-login" };
    default:
      return null;
  }
}

function buildDebugSetupDetails(setup: DebugSetupCheckResult): string {
  const formatDiskLine = (label: string, value: DebugSetupCheckResult["diskSpace"]["runtime"]): string => {
    if (value.freeBytes === null || value.totalBytes === null) {
      return `${label}: unbekannt (${value.path})`;
    }
    return `${label}: ${humanSize(value.freeBytes)} frei von ${humanSize(value.totalBytes)} (${value.freePercent ?? "?"}% frei) | ${value.path}`;
  };

  const formatFileLine = (label: string, bytes: number): string => `${label}: ${humanSize(bytes)}`;
  const lines: string[] = [
    `Status: ${setup.status === "ok" ? "OK" : "Warnung"}`,
    `Debug-Server aktiv: ${setup.enabled ? "ja" : "nein"}`,
    `Runtime-Ordner: ${setup.runtimeBaseDir}`,
    `Host: ${setup.host}`,
    `Port: ${setup.port}`,
    `Token-Datei: ${setup.tokenPath}`,
    `Support-Manifest: ${setup.supportManifestPresent ? "vorhanden" : "fehlt"} (${setup.supportManifestPath})`,
    `Trace aktiv: ${setup.traceEnabled ? "ja" : "nein"}`,
    `Trace-Auto-Ende: ${setup.traceAutoDisableAt || "nicht gesetzt"}`,
    "",
    "Freier Speicherplatz:",
    formatDiskLine("Runtime", setup.diskSpace.runtime),
    formatDiskLine("Download-Ziel", setup.diskSpace.output),
    formatDiskLine("Entpack-Ziel", setup.diskSpace.extract),
    "",
    "Support-Logs:",
    formatFileLine("Gesamt", setup.logSummary.totalBytes),
    formatFileLine("Hauptlog", setup.logSummary.main.bytes + setup.logSummary.mainBackup.bytes),
    formatFileLine("Audit", setup.logSummary.audit.bytes + setup.logSummary.auditBackup.bytes),
    formatFileLine("Rename", setup.logSummary.rename.bytes + setup.logSummary.renameBackup.bytes),
    formatFileLine("Trace", setup.logSummary.trace.bytes + setup.logSummary.traceBackup.bytes),
    `${formatFileLine("Session-Logs", setup.logSummary.session.bytes + setup.logSummary.sessionLogs.bytes)} | Dateien: ${setup.logSummary.sessionLogs.fileCount}`,
    `${formatFileLine("Paket-Logs", setup.logSummary.packageLogs.bytes)} | Dateien: ${setup.logSummary.packageLogs.fileCount}`,
    `${formatFileLine("Item-Logs", setup.logSummary.itemLogs.bytes)} | Dateien: ${setup.logSummary.itemLogs.fileCount}`,
    "",
    "Support-Bundle:",
    `${formatFileLine("Schätzwert", setup.supportBundle.estimatedBytes)} | Einträge: ${setup.supportBundle.estimatedEntries}`,
    formatFileLine("Doppelte Live-Log-Spiegelung", setup.supportBundle.duplicatedLiveLogBytes),
    setup.supportBundle.note,
    "",
    "Lokale URLs:",
    setup.localUrls.health,
    setup.localUrls.meta,
    setup.localUrls.diagnostics,
    "",
    "Remote-Vorlagen:",
    setup.remoteUrlTemplates.health,
    setup.remoteUrlTemplates.meta,
    setup.remoteUrlTemplates.diagnostics
  ];

  if (setup.warnings.length > 0) {
    lines.push("", "Warnungen:");
    for (const warning of setup.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  if (setup.notes.length > 0) {
    lines.push("", "Hinweise:");
    for (const note of setup.notes) {
      lines.push(`- ${note}`);
    }
  }

  return lines.join("\n");
}

const ACCOUNT_OPTIONS: AccountOption[] = [
  {
    kind: "realdebrid-api",
    service: "realdebrid",
    serviceLabel: "Real-Debrid",
    title: "Real-Debrid API",
    modeLabel: "API",
    pickerDescription: "Direkter Zugriff über API-Token.",
    needsToken: true
  },
  {
    kind: "realdebrid-web",
    service: "realdebrid",
    serviceLabel: "Real-Debrid",
    title: "Real-Debrid Web-Login",
    modeLabel: "Web-Login",
    pickerDescription: "Login über Browserfenster statt Token."
  },
  {
    kind: "megadebrid-api",
    service: "megadebrid-api",
    serviceLabel: "Mega-Debrid",
    title: "Mega-Debrid API",
    modeLabel: "API",
    pickerDescription: "Login:Passwort-Paare für Mega-Debrid (API). Mehrere Accounts zeilenweise für Multi-Account."
  },
  {
    kind: "megadebrid-web",
    service: "megadebrid-web",
    serviceLabel: "Mega-Debrid",
    title: "Mega-Debrid Web-Login",
    modeLabel: "Web-Login",
    pickerDescription: "Login:Passwort-Paare für Mega-Debrid (Web). Mehrere Accounts zeilenweise für Multi-Account."
  },
  {
    kind: "bestdebrid-api",
    service: "bestdebrid",
    serviceLabel: "BestDebrid",
    title: "BestDebrid API",
    modeLabel: "API",
    pickerDescription: "Direkter Zugriff über API-Token.",
    needsToken: true
  },
  {
    kind: "bestdebrid-web",
    service: "bestdebrid",
    serviceLabel: "BestDebrid",
    title: "BestDebrid Web-Login",
    modeLabel: "Web-Login",
    pickerDescription: "Cookie-Import aus dem Browser statt API-Token."
  },
  {
    kind: "alldebrid-api",
    service: "alldebrid",
    serviceLabel: "AllDebrid",
    title: "AllDebrid API",
    modeLabel: "API",
    pickerDescription: "Direkter Zugriff über API-Key.",
    needsToken: true
  },
  {
    kind: "alldebrid-web",
    service: "alldebrid",
    serviceLabel: "AllDebrid",
    title: "AllDebrid Web-Login",
    modeLabel: "Web-Login",
    pickerDescription: "Login über Browserfenster für reCAPTCHA.",
  },
  {
    kind: "deepbrid-api",
    service: "deepbrid",
    serviceLabel: "Deepbrid",
    title: "Deepbrid API",
    modeLabel: "API",
    pickerDescription: "Direkter Zugriff über API-Key.",
    needsToken: true
  },
  {
    kind: "ddownload-login",
    service: "ddownload",
    serviceLabel: "DDownload",
    title: "DDownload Login",
    modeLabel: "Login",
    pickerDescription: "Direkter Login für ddownload.com und ddl.to.",
    needsCredentials: true
  },
  {
    kind: "onefichier-api",
    service: "onefichier",
    serviceLabel: "1Fichier",
    title: "1Fichier API",
    modeLabel: "API",
    pickerDescription: "API-Key für 1fichier.com.",
    needsToken: true
  },
  {
    kind: "debridlink-api",
    service: "debridlink",
    serviceLabel: "Debrid-Link",
    title: "Debrid-Link API",
    modeLabel: "API",
    pickerDescription: "API-Key(s) für debrid-link.com. Mehrere Keys zeilenweise für Multi-Account.",
    needsToken: true
  },
  {
    kind: "linksnappy-login",
    service: "linksnappy",
    serviceLabel: "LinkSnappy",
    title: "LinkSnappy Web-Login",
    modeLabel: "Web-Login",
    pickerDescription: "Login für linksnappy.com mit Benutzername und Passwort.",
    needsCredentials: true
  }
];

const ACCOUNT_SERVICES: AccountService[] = ["realdebrid", "megadebrid-api", "megadebrid-web", "bestdebrid", "alldebrid", "deepbrid", "ddownload", "onefichier", "debridlink", "linksnappy"];
const ACCOUNT_LIMIT_BYTES_PER_GIB = 1024 * 1024 * 1024;
function findAccountOption(kind: AccountKind): AccountOption {
  const option = ACCOUNT_OPTIONS.find((entry) => entry.kind === kind);
  if (!option) {
    throw new Error(`Unbekannter Account-Typ: ${kind}`);
  }
  return option;
}

function getAccountServiceProvider(service: AccountService): DebridProvider {
  return service as DebridProvider;
}

function parseAccountDailyLimitInputBytes(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed * ACCOUNT_LIMIT_BYTES_PER_GIB);
}

function getAccountPickerFunctionLabel(option: AccountOption): string {
  switch (option.kind) {
    case "realdebrid-api":
    case "bestdebrid-api":
      return "API-Token";
    case "realdebrid-web":
    case "alldebrid-web":
      return "Browser-Login";
    case "megadebrid-api":
      return "Login:Passwort (API)";
    case "megadebrid-web":
      return "Login:Passwort (Web)";
    case "bestdebrid-web":
      return "Cookies.txt-Import";
    case "alldebrid-api":
    case "deepbrid-api":
    case "onefichier-api":
      return "API-Key";
    case "ddownload-login":
      return "Login + Passwort";
    default:
      return option.modeLabel;
  }
}

function getAccountCredentialLabel(kind: AccountKind): string {
  switch (kind) {
    case "megadebrid-api":
    case "megadebrid-web":
    case "ddownload-login":
    case "linksnappy-login":
      return "••••••";
    case "bestdebrid-web":
    case "realdebrid-web":
    case "alldebrid-web":
      return "Login gespeichert";
    case "realdebrid-api":
    case "bestdebrid-api":
    case "alldebrid-api":
    case "deepbrid-api":
    case "onefichier-api":
    case "debridlink-api":
      return "API-Key gespeichert";
    default:
      return "Zugang gespeichert";
  }
}

function getConfiguredProvidersFromSettings(settings: RendererSettings): DebridProvider[] {
  return [...settings.configuredProviders];
}

function getActiveProvidersFromSettings(settings: RendererSettings): DebridProvider[] {
  const disabled = new Set(settings.disabledProviders || []);
  return getConfiguredProvidersFromSettings(settings).filter((provider) => !disabled.has(provider));
}

const DIRECT_HOSTERS: ReadonlySet<DebridProvider> = new Set(["onefichier", "ddownload"]);

function normalizeProviderOrderForSettings(settings: RendererSettings): DebridProvider[] {
  const configured = getConfiguredProvidersFromSettings(settings).filter((provider) => !DIRECT_HOSTERS.has(provider));
  return buildConfiguredProviderOrder(settings.providerOrder || [], configured);
}

function normalizeProviderSelectionForSettings(
  settings: RendererSettings
): Pick<RendererSettings, "providerOrder" | "providerPrimary" | "providerSecondary" | "providerTertiary"> {
  const providerOrder = normalizeProviderOrderForSettings(settings);
  return {
    providerOrder,
    providerPrimary: providerOrder[0] ?? settings.providerPrimary,
    providerSecondary: (providerOrder[1] ?? "none") as DebridFallbackProvider,
    providerTertiary: (providerOrder[2] ?? "none") as DebridFallbackProvider
  };
}

export function buildAccountCreateProviderOrderUpdate(
  settings: RendererSettings
): Pick<RendererSettings, "providerOrder" | "providerPrimary" | "providerSecondary" | "providerTertiary"> {
  return normalizeProviderSelectionForSettings(settings);
}

function getConfiguredAccountKind(settings: RendererSettings, service: AccountService): AccountKind | null {
  const configured = new Set(settings.configuredProviders);
  switch (service) {
    case "realdebrid":
      if (settings.realDebridUseWebLogin) return "realdebrid-web";
      return configured.has("realdebrid") ? "realdebrid-api" : null;
    case "megadebrid-api":
      return configured.has("megadebrid-api") ? "megadebrid-api" : null;
    case "megadebrid-web":
      return configured.has("megadebrid-web") ? "megadebrid-web" : null;
    case "bestdebrid":
      if (settings.bestDebridUseWebLogin) return "bestdebrid-web";
      return configured.has("bestdebrid") ? "bestdebrid-api" : null;
    case "alldebrid":
      if (settings.allDebridUseWebLogin) return "alldebrid-web";
      return configured.has("alldebrid") ? "alldebrid-api" : null;
    case "deepbrid":
      return configured.has("deepbrid") ? "deepbrid-api" : null;
    case "ddownload":
      return configured.has("ddownload") ? "ddownload-login" : null;
    case "onefichier":
      return configured.has("onefichier") ? "onefichier-api" : null;
    case "debridlink":
      return configured.has("debridlink") ? "debridlink-api" : null;
    case "linksnappy":
      return configured.has("linksnappy") ? "linksnappy-login" : null;
    default:
      return null;
  }
}

function accountsOfKind(kind: AccountKind, accounts: readonly RendererAccount[]): RendererAccount[] {
  return accounts.filter((account) => account.kind === kind);
}

function summarizeAccount(kind: AccountKind, accounts: readonly RendererAccount[]): string {
  const matching = accountsOfKind(kind, accounts);
  if (matching.length > 1) return kind === "debridlink-api" ? `${matching.length} API-Keys` : `${matching.length} Accounts`;
  return matching[0]?.maskedIdentity || "Konfiguriert";
}

function summarizeAccountLines(kind: AccountKind, accounts: readonly RendererAccount[], detailed: boolean): string[] {
  const matching = accountsOfKind(kind, accounts);
  if (matching.length > 1 && (kind !== "debridlink-api" || detailed)) {
    return matching.map((entry, index) => `${kind === "debridlink-api" ? "Key" : "Account"} ${index + 1}: ${entry.maskedIdentity}`);
  }
  return [summarizeAccount(kind, accounts)];
}

function getStoredAccountUsername(kind: AccountKind, accounts: readonly RendererAccount[]): string {
  return accountsOfKind(kind, accounts)[0]?.identity || "";
}

export function createAccountDialogState(mode: "create" | "edit", kind: AccountKind | null, _settings: RendererSettings): AccountDialogState {
  const baseMega: Pick<AccountDialogState, "megaAccounts" | "megaNewLogin" | "megaNewPassword" | "megaDisabledIds"> = { megaAccounts: [], megaNewLogin: "", megaNewPassword: "", megaDisabledIds: [] };
  return {
    mode,
    kind,
    service: kind ? findAccountOption(kind).service : null,
    token: "",
    login: "",
    password: "",
    dailyLimitGb: "",
    keyDailyLimitGbById: {},
    ...baseMega
  };
}

export function buildAccountAddFields(dialog: AccountDialogState | null): AccountDialogField[] {
  if (!dialog?.kind) {
    return [];
  }
  const option = findAccountOption(dialog.kind);
  return [
    ...((dialog.kind === "megadebrid-api" || dialog.kind === "megadebrid-web") ? [
      { id: "megaNewLogin", label: "Login / E-Mail", type: "text" as const, value: dialog.megaNewLogin },
      { id: "megaNewPassword", label: "Passwort", type: "password" as const, value: dialog.megaNewPassword }
    ] : option.needsCredentials ? [
      { id: "login", label: "Login / E-Mail", type: "text" as const, value: dialog.login },
      { id: "password", label: "Passwort", type: "password" as const, value: dialog.password }
    ] : []),
    ...(option.needsToken ? [
      { id: "token", label: dialog.kind === "debridlink-api" ? "API-Key" : "Token / API-Key", type: "password" as const, value: dialog.token }
    ] : []),
    {
      id: "dailyLimitGb",
      label: "Tageslimit (GB, optional)",
      type: "number" as const,
      value: dialog.dailyLimitGb,
      placeholder: "Kein Limit",
      help: "Der Zähler wird täglich um 00:00 Uhr zurückgesetzt."
    }
  ];
}

function validateAccountDialog(dialog: AccountDialogState): string | null {
  if (!dialog.kind) {
    return "Bitte zuerst einen Account-Typ auswählen.";
  }
  const option = findAccountOption(dialog.kind);
  if (dialog.kind === "megadebrid-api" || dialog.kind === "megadebrid-web") {
    if (!dialog.megaNewLogin.trim()) return `${option.title}: Bitte Login oder E-Mail eintragen.`;
    if (!dialog.megaNewPassword) return `${option.title}: Bitte Passwort eintragen.`;
  } else if (option.needsToken && !dialog.token.trim()) {
    return `${option.title}: Bitte Zugangstoken eintragen.`;
  }
  if (option.needsCredentials) {
    if (!dialog.login.trim()) {
      return `${option.title}: Bitte Login oder E-Mail eintragen.`;
    }
    if (!dialog.password) {
      return `${option.title}: Bitte Passwort eintragen.`;
    }
  }
  if (dialog.dailyLimitGb.trim()) {
    const parsed = Number(dialog.dailyLimitGb.trim().replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 0) {
      return `${option.title}: Tageslimit muss eine Zahl >= 0 sein.`;
    }
  }
  if (dialog.kind === "debridlink-api") {
    if (parseDebridLinkApiKeys(dialog.token).length === 0) {
      return `${option.title}: Bitte mindestens einen gültigen API-Key eintragen.`;
    }
    for (const key of parseDebridLinkApiKeys(dialog.token)) {
      const raw = dialog.keyDailyLimitGbById?.[key.id] || "";
      if (!raw.trim()) {
        continue;
      }
      const parsed = Number(raw.trim().replace(",", "."));
      if (!Number.isFinite(parsed) || parsed < 0) {
        return `${option.title}: ${key.label} Limit muss eine Zahl >= 0 sein.`;
      }
    }
  }
  return null;
}

export function buildAccountCreateCommand(dialog: AccountDialogState): AccountCreateCommand | null {
  if (!dialog.kind) return null;
  const option = findAccountOption(dialog.kind);
  return {
    action: "create",
    kind: dialog.kind,
    identity: dialog.kind === "megadebrid-api" || dialog.kind === "megadebrid-web" ? dialog.megaNewLogin.trim() : dialog.login.trim(),
    secret: dialog.kind === "megadebrid-api" || dialog.kind === "megadebrid-web" ? dialog.megaNewPassword : option.needsToken ? dialog.token : dialog.password,
    dailyLimitBytes: parseAccountDailyLimitInputBytes(dialog.dailyLimitGb) || 0
  };
}

export function buildRealDebridWebCreateLoginRequest(dialog: AccountDialogState, accountId: string): RealDebridLoginRequest | null {
  if (dialog.kind !== "realdebrid-web") return null;
  return {
    accountId,
    create: true,
    dailyLimitBytes: parseAccountDailyLimitInputBytes(dialog.dailyLimitGb) || 0
  };
}

const emptyStats = (): DownloadStats => ({
  totalDownloaded: 0,
  totalDownloadedAllTime: 0,
  totalFiles: 0,
  totalFilesSession: 0,
  totalFilesAllTime: 0,
  totalPackages: 0,
  sessionStartedAt: 0,
  appSessionStartedAt: 0,
  sessionRuntimeMs: 0,
  totalRuntimeMs: 0,
  runtimeMeasuredAt: 0
});

const emptySnapshot = (): UiSnapshot => ({
  settings: {
    language: "en", realDebridUseWebLogin: false, realDebridDisabledAccountIds: [], realDebridAccountDailyLimitBytes: {}, realDebridAccountDailyUsageBytes: {}, realDebridAccountTotalUsageBytes: {}, megaDebridApiEnabled: false, megaDebridWebEnabled: false, megaDebridPreferApi: true, bestDebridUseWebLogin: false, allDebridUseWebLogin: false,
    debridLinkDisabledKeyIds: [],
    archivePasswordListConfigured: false, notifyUrlConfigured: false,
    rememberToken: true, configuredProviders: [], providerOrder: [], providerPrimary: "realdebrid", providerSecondary: "none",
    providerTertiary: "none", autoProviderFallback: true, outputDir: "", createWorkDirectoriesOnStartup: false, packageName: "",
    autoExtract: true, autoRename4sf4sj: false, keepGermanAudioOnly: false, germanAudioMode: "tag", extractDir: "", createExtractSubfolder: true, hybridExtract: true,
    collectMkvToLibrary: false, mkvLibraryDir: "",
    cleanupMode: "none", extractConflictMode: "overwrite", removeLinkFilesAfterExtract: false,
    removeSamplesAfterExtract: false, enableIntegrityCheck: true, autoResumeOnStart: true,
    autoReconnect: false, reconnectWaitSeconds: 45, completedCleanupPolicy: "never",
    maxParallel: 4, maxParallelExtract: 2, extractCpuPriority: "high", retryLimit: 0, offlineSkipScope: "archive", speedLimitEnabled: false, speedLimitKbps: 0, speedLimitMode: "global",
    proxyDownloadEnabled: false, proxyListPath: "", proxyApiProxyIndex: 1, proxyConnectionsPerDownload: 32,
    updateRepo: "", autoUpdateCheck: true, clipboardWatch: false, minimizeToTray: false,
    theme: "dark", themePreference: "dark", logStorageLocation: "appdata", collapseNewPackages: true, animatePackageDisclosure: true, historyRetentionMode: "permanent", historyMaxEntries: 500, historyMaxAgeDays: 0, autoSortPackagesByProgress: false, autoSkipExtracted: false, hideExtractedItems: true, confirmDeleteSelection: true, backupIncludeDownloads: false, backupIncludeRemoteDiagnostics: false,
    notifyMention: "", notifyOnPackageCompleted: false, notifyOnPackageFailed: false, notifyOnRunFinished: false,
    notifyPackageSuccessMode: "digest", notifyOnRemainingBelow: false, notifyRemainingThresholdGb: 50,
    notifyOnDownloadStall: false, notifyStallAfterSeconds: 90, notifyStallCooldownMinutes: 10, notifyOnDownloadRecovery: true,
    accountListShowDetailedDebridLinkKeys: false,
    bandwidthSchedules: [], totalDownloadedAllTime: 0, totalCompletedFilesAllTime: 0, totalRuntimeAllTimeMs: 0,
    columnOrder: ["name", "size", "progress", "hoster", "account", "prio", "status", "speed", "availability"],
    columnOrderVersion: 3,
    autoExtractWhenStopped: true,
    disabledProviders: [],
    hosterRouting: {},
    providerDailyLimitBytes: {},
    providerDailyUsageBytes: {},
    providerTotalUsageBytes: {},
    debridLinkApiKeyDailyLimitBytes: {},
    debridLinkApiKeyDailyUsageBytes: {},
    debridLinkApiKeyTotalUsageBytes: {},
    megaDebridDisabledAccountIds: [],
    megaDebridApiDisabledAccountIds: [],
    megaDebridWebDisabledAccountIds: [],
    megaDebridAccountDailyLimitBytes: {},
    megaDebridAccountDailyUsageBytes: {},
    megaDebridAccountTotalUsageBytes: {},
    debridAccountStatuses: {},
    providerDailyUsageDay: getProviderUsageDayKey(),
    dailyStartEnabled: false,
    dailyStartMinuteOfDay: 0,
    dailyStartFirstLocalDate: "",
    dailyStartLastHandledLocalDate: "",
    dailyStartPendingLocalDate: "",
    dailyStartLastOutcome: "",
    scheduledStartEpochMs: 0,
    nextDailyStartEpochMs: 0
  },
  accounts: [],
  session: {
    version: 2, packageOrder: [], packages: {}, items: {}, runStartedAt: 0,
    totalDownloadedBytes: 0, summaryText: "", reconnectUntil: 0, reconnectReason: "",
    paused: false, running: false, updatedAt: Date.now()
  },
  summary: null, stats: emptyStats(), speedText: "Geschwindigkeit: 0 B/s", etaText: "ETA: --",
    canStart: false, canStop: false, canPause: false, clipboardActive: false, reconnectSeconds: 0, packageSpeedBps: {}, runRemainingBytes: 0, runRemainingUnknownItems: 0
});

const cleanupLabels: Record<string, string> = {
  never: "Nie", immediate: "Sofort", on_start: "Beim App-Start", package_done: "Sobald Paket fertig ist"
};

const historyRetentionLabels: Record<RendererSettings["historyRetentionMode"], string> = {
  never: "Nie",
  session: "Nur aktuelle Session",
  permanent: "Dauerhaft"
};

const AUTO_RENDER_PACKAGE_LIMIT = 260;

export function getSnapshotRenderDelay(itemCount: number, running: boolean, activeTab: MainView): number {
  let delay = running && activeTab === "downloads" ? 0 : itemCount >= 250 ? 0 : 100;
  if (!running) delay = Math.min(delay, 200);
  if (activeTab !== "downloads") delay = Math.max(delay, 800);
  return delay;
}

const KNOWN_HOSTERS: { id: string; label: string }[] = [
  { id: "rapidgator", label: "Rapidgator" },
  { id: "uploaded", label: "Uploaded" },
  { id: "1fichier", label: "1Fichier" },
  { id: "ddownload", label: "DDownload" },
  { id: "ddl", label: "DDL.to" },
  { id: "turbobit", label: "Turbobit" },
  { id: "nitroflare", label: "Nitroflare" },
  { id: "filefactory", label: "FileFactory" },
  { id: "katfile", label: "Katfile" },
  { id: "hitfile", label: "Hitfile" },
  { id: "alfafile", label: "Alfafile" },
  { id: "k2s", label: "Keep2Share" },
  { id: "keep2share", label: "Keep2Share (alt)" },
  { id: "tezfiles", label: "Tezfiles" },
  { id: "fileboom", label: "Fileboom" },
  { id: "mexashare", label: "Mexashare" },
  { id: "wdupload", label: "WDUpload" },
  { id: "rosefile", label: "Rosefile" },
  { id: "filejoker", label: "FileJoker" },
  { id: "worldbytez", label: "Worldbytez" },
  { id: "fileland", label: "Fileland" },
  { id: "depositfiles", label: "DepositFiles" },
  { id: "mediafire", label: "MediaFire" },
  { id: "mega", label: "Mega.nz" },
  { id: "frdl", label: "FreeDownload" },
  { id: "hexupload", label: "HexUpload" },
  { id: "isra", label: "Isra.cloud" }
];

export function buildProviderOrderEntry(provider: DebridProvider, settings: RendererSettings): {
  id: DebridProvider;
  label: string;
  icon: string;
} {
  const legacyMegaService = settings.megaDebridPreferApi ? "megadebrid-api" : "megadebrid-web";
  const service = provider === "megadebrid" ? legacyMegaService : provider as AccountService;
  const kind = getConfiguredAccountKind(settings, service);
  const option = kind ? ACCOUNT_OPTIONS.find((entry) => entry.kind === kind) : null;
  const modeLabel = option?.modeLabel || (provider === "megadebrid" ? (settings.megaDebridPreferApi ? "API" : "Web-Login") : "");
  const serviceLabel = option?.serviceLabel || providerLabels[provider];
  return {
    id: provider,
    label: modeLabel ? `${serviceLabel} (${modeLabel})` : serviceLabel,
    icon: ACCOUNT_SERVICE_ICONS[option?.service || service]
  };
}

function providerLabelWithMode(provider: DebridProvider, settings: RendererSettings): string {
  return buildProviderOrderEntry(provider, settings).label;
}

function formatAllDebridSourceLabel(source: AllDebridHostInfo["source"]): string {
  return source === "web" ? "Web-Login" : "API-Key";
}

function formatAllDebridQuota(info: AllDebridHostInfo): string {
  const suffix = info.quotaType ? ` (${info.quotaType})` : "";
  if (info.quota !== null && info.quotaMax !== null) {
    return `${info.quota} / ${info.quotaMax}${suffix}`;
  }
  if (info.quota !== null) {
    return `${info.quota}${suffix}`;
  }
  if (info.quotaMax !== null) {
    return `max. ${info.quotaMax}${suffix}`;
  }
  return info.source === "web" ? "Nur per API-Key sichtbar" : "Nicht angegeben";
}

function formatAllDebridSimuLimit(info: AllDebridHostInfo): string {
  if (info.limitSimuDl === null) {
    return info.source === "web" ? "Nur per API-Key sichtbar" : "Nicht angegeben";
  }
  return String(info.limitSimuDl);
}

function formatAllDebridTimestamp(info: AllDebridHostInfo): string {
  return formatDateTime(info.lastCheckedAt || info.fetchedAt);
}

function formatDebridLinkTraffic(info: DebridLinkHostLimitInfo | null | undefined): string {
  if (!info) {
    return "Lade...";
  }
  const toGb = (bytes: number): string => `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (info.trafficCurrentBytes !== null && info.trafficMaxBytes !== null) {
    return `${toGb(info.trafficCurrentBytes)} / ${toGb(info.trafficMaxBytes)}`;
  }
  if (info.trafficMaxBytes !== null) {
    return `max. ${toGb(info.trafficMaxBytes)}`;
  }
  if (info.trafficCurrentBytes !== null) {
    return toGb(info.trafficCurrentBytes);
  }
  return info.note || "Nicht verfügbar";
}

function formatDebridLinkCountQuota(info: DebridLinkHostLimitInfo | null | undefined): string {
  if (!info) {
    return "Lade...";
  }
  if (info.linksCurrent !== null && info.linksMax !== null) {
    return `${info.linksCurrent} / ${info.linksMax}`;
  }
  if (info.linksMax !== null) {
    return `max. ${info.linksMax}`;
  }
  if (info.linksCurrent !== null) {
    return String(info.linksCurrent);
  }
  return info.note || "Nicht verfügbar";
}

function rotationEventText(ev: { event: string; cooldownSec?: number; next?: string; reason?: string }): string {
  const untilRestart = /bis zum Tagesreset gesperrt/i.test(ev.reason || "");
  switch (ev.event) {
    case "OK": return "erfolgreich";
    case "FAILED": {
      if (untilRestart) {
        const nx = ev.next && ev.next !== "ENDE" ? ` → ${ev.next}` : "";
        return `Tageslimit erreicht, bis zum Tagesreset gesperrt${nx}`;
      }
      const cd = ev.cooldownSec ? `, Cooldown ${ev.cooldownSec}s` : "";
      const nx = ev.next && ev.next !== "ENDE" ? ` → ${ev.next}` : "";
      return `fehlgeschlagen${cd}${nx}`;
    }
    case "FATAL": return "abgebrochen (fataler Fehler)";
    case "TIMEOUT_COOLDOWN": {
      const cd = ev.cooldownSec ? `, Cooldown ${ev.cooldownSec}s` : "";
      return `Timeout/Abbruch${cd} → nächster Account beim Retry`;
    }
    case "SKIP_COOLDOWN": return untilRestart ? "übersprungen (bis zum Tagesreset gesperrt)" : "übersprungen (Cooldown aktiv)";
    case "SKIP_DISABLED": return "übersprungen (deaktiviert)";
    case "SKIP_DAILY_LIMIT": return "übersprungen (Tageslimit erreicht)";
    case "SKIP_HOST_COOLDOWN": return "übersprungen (Host-Cooldown)";
    case "PROVIDER_WIDE": return "Provider-weiter Fehler, restliche Keys übersprungen";
    case "TRANSPORT_CASCADE": return "Netzwerk-Kaskade, restliche Keys übersprungen";
    default: return ev.event;
  }
}

function getDebridLinkKeyStatusDisplay(
  key: DebridLinkAccountKeyEntry,
  info: DebridLinkHostLimitInfo | null | undefined
): { label: string; tone: "ok" | "warn" | "bad" | "muted"; title: string } {
  if (key.disabled) {
    return {
      label: "Deaktiviert",
      tone: "muted",
      title: "Key ist manuell deaktiviert."
    };
  }
  if (key.dailyLimitReached) {
    return {
      label: "Lokales Limit",
      tone: "warn",
      title: key.dailyLimitBytes > 0
        ? `Lokales Tageslimit erreicht (${humanSize(key.dailyUsedBytes)} / ${humanSize(key.dailyLimitBytes)}).`
        : "Lokales Tageslimit erreicht."
    };
  }
  if (!info) {
    return {
      label: "Pruefe...",
      tone: "muted",
      title: "Live-Status wird geladen."
    };
  }

  const title = [info.stateDetail, info.note, info.hostNote]
    .filter((value) => Boolean(String(value || "").trim()))
    .join("\n");

  if (info.state === "ready") {
    if (info.hostState === "down") {
      return {
        label: "Host offline",
        tone: "warn",
        title: title || "Der Hoster ist laut Debrid-Link aktuell offline."
      };
    }
    return {
      label: "Bereit",
      tone: "ok",
      title: title || "Key ist nutzbar."
    };
  }

  if (info.state === "invalid" || info.state === "error") {
    return {
      label: info.stateLabel,
      tone: "bad",
      title: title || info.stateLabel
    };
  }

  if (info.state === "quota" || info.state === "rate_limit" || info.state === "cooldown") {
    return {
      label: info.stateLabel,
      tone: "warn",
      title: title || info.stateLabel
    };
  }

  return {
    label: info.stateLabel || "Unbekannt",
    tone: "muted",
    title: title || info.stateLabel || "Unbekannt"
  };
}

export function readBandwidthChartPalette(
  readProperty: (property: string) => string,
  fontFamily: string
): { grid: string; text: string; accent: string; fontFamily: string } {
  return {
    grid: readProperty("--ui-border").trim(),
    text: readProperty("--ui-text-muted").trim(),
    accent: readProperty("--ui-speed-accent").trim(),
    fontFamily: fontFamily.trim()
  };
}

export function readDownloadSpeedSparklinePalette(
  readProperty: (property: string) => string
): { accent: string } {
  return {
    accent: readProperty("--ui-speed-accent").trim()
  };
}

export function getIdleSparklineStroke(cssHeight: number, devicePixelRatio: number): { y: number; lineWidth: number } {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const baseline = Math.max(0, cssHeight - 2);
  return {
    y: (Math.floor(baseline * dpr) + 0.5) / dpr,
    lineWidth: 1 / dpr
  };
}

export function appendBandwidthSample(
  history: { time: number; speed: number }[],
  speed: number,
  now = Date.now()
): { time: number; speed: number }[] {
  const next = [...history, { time: now, speed: Number.isFinite(speed) ? Math.max(0, speed) : 0 }];
  const cutoff = now - 60000;
  const firstVisible = next.findIndex((point) => point.time >= cutoff);
  return firstVisible > 0 ? next.slice(firstVisible) : next;
}

interface BandwidthChartProps {
  running: boolean;
  paused: boolean;
  speedHistoryRef: React.MutableRefObject<{ time: number; speed: number }[]>;
}

const BandwidthChart = memo(function BandwidthChart({ running, paused, speedHistoryRef }: BandwidthChartProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const animationFrameRef = useRef<number>(0);

  const drawChart = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width <= 0 || height <= 0) return;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    const rootStyle = getComputedStyle(document.documentElement);
    const bodyStyle = getComputedStyle(document.body);
    const palette = readBandwidthChartPalette(
      (property) => rootStyle.getPropertyValue(property),
      bodyStyle.fontFamily || rootStyle.fontFamily
    );

    const history = speedHistoryRef.current;
    const now = Date.now();
    const maxTime = now;
    const minTime = now - 60000;

    let maxSpeed = 0;
    for (const point of history) {
      if (point.speed > maxSpeed) maxSpeed = point.speed;
    }
    maxSpeed = Math.max(maxSpeed, 1024 * 1024);
    const niceMax = Math.pow(2, Math.ceil(Math.log2(maxSpeed)));

    ctx.font = `11px ${palette.fontFamily}`;
    let maxLabelWidth = 0;
    for (let i = 0; i <= 5; i += 1) {
      const speedVal = niceMax * (1 - i / 5);
      const w = ctx.measureText(formatSpeedMbps(speedVal)).width;
      if (w > maxLabelWidth) maxLabelWidth = w;
    }
    const padding = { top: 20, right: 20, bottom: 30, left: Math.ceil(maxLabelWidth) + 16 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i += 1) {
      const y = padding.top + (chartHeight / 5) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
    }

    ctx.fillStyle = palette.text;
    ctx.font = `11px ${palette.fontFamily}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    for (let i = 0; i <= 5; i += 1) {
      const y = padding.top + (chartHeight / 5) * i;
      const speedVal = niceMax * (1 - i / 5);
      ctx.fillText(formatSpeedMbps(speedVal), padding.left - 8, y);
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("60s", padding.left, height - padding.bottom + 8);
    ctx.fillText("30s", padding.left + chartWidth / 2, height - padding.bottom + 8);
    ctx.fillText("0s", width - padding.right, height - padding.bottom + 8);

    if (history.length < 2) {
      ctx.fillStyle = palette.text;
      ctx.font = `13px ${palette.fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(running ? (paused ? "Pausiert" : "Sammle Daten...") : "Download starten für Statistiken", width / 2, height / 2);
      return;
    }

    const points: { x: number; y: number }[] = [];
    for (const point of history) {
      const x = padding.left + ((point.time - minTime) / 60000) * chartWidth;
      const y = padding.top + chartHeight - (point.speed / niceMax) * chartHeight;
      points.push({ x, y });
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.lineTo(points[points.length - 1].x, padding.top + chartHeight);
    ctx.lineTo(points[0].x, padding.top + chartHeight);
    ctx.closePath();
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = palette.accent;
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 2;
    ctx.stroke();

    const lastPoint = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(lastPoint.x, lastPoint.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = palette.accent;
    ctx.fill();
  }, [running, paused]);

  useEffect(() => {
    drawChart();
    if (!running || paused) {
      return;
    }
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const interval = setInterval(() => {
      drawChart();
    }, reducedMotion ? 1000 : 750);
    return () => clearInterval(interval);
  }, [drawChart, running, paused]);

  useEffect(() => {
    const handleResize = () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = requestAnimationFrame(drawChart);
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [drawChart]);

  useEffect(() => {
    drawChart();
  }, [drawChart, paused]);

  return (
    <div ref={containerRef} className="bandwidth-chart-container">
      <canvas aria-label="Bandbreitenverlauf der letzten 60 Sekunden" ref={canvasRef} role="img">
        Bandbreitenverlauf der letzten 60 Sekunden
      </canvas>
    </div>
  );
});

interface DownloadSpeedSparklineProps {
  speedBps: number;
  speedStateRef: React.MutableRefObject<DownloadSpeedHistoryState>;
  hidden?: boolean;
}

const DownloadSpeedSparkline = memo(function DownloadSpeedSparkline({ speedBps, speedStateRef, hidden = false }: DownloadSpeedSparklineProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const speedRef = useRef(speedBps);
  speedRef.current = speedBps;

  useEffect(() => {
    const draw = (): void => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (cssW <= 0 || cssH <= 0) return;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      const hist = speedStateRef.current.history;
      if (hist.length < 2) return;

      const rootStyle = getComputedStyle(document.documentElement);
      const palette = readDownloadSpeedSparklinePalette((property) => rootStyle.getPropertyValue(property));

      let maxV = 0;
      for (const v of hist) if (v > maxV) maxV = v;
      const idle = maxV <= 0;
      maxV = Math.max(maxV, 1024 * 1024);

      const pad = 2;
      const h = cssH - pad * 2;
      const step = cssW / (DOWNLOAD_SPEED_MAX_SAMPLES - 1);
      const startIdx = DOWNLOAD_SPEED_MAX_SAMPLES - hist.length;
      const px = (i: number): number => (startIdx + i) * step;
      const py = (v: number): number => pad + h - (v / maxV) * h;

      if (idle) {
        const stroke = getIdleSparklineStroke(cssH, dpr);
        ctx.beginPath();
        ctx.moveTo(px(0), stroke.y);
        ctx.lineTo(px(hist.length - 1), stroke.y);
        ctx.strokeStyle = palette.accent;
        ctx.lineWidth = stroke.lineWidth;
        ctx.lineCap = "butt";
        ctx.stroke();
        return;
      }

      ctx.beginPath();
      ctx.moveTo(px(0), py(hist[0]));
      for (let i = 1; i < hist.length; i += 1) ctx.lineTo(px(i), py(hist[i]));
      ctx.lineTo(px(hist.length - 1), pad + h);
      ctx.lineTo(px(0), pad + h);
      ctx.closePath();
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = palette.accent;
      ctx.fill();
      ctx.restore();

      ctx.beginPath();
      ctx.moveTo(px(0), py(hist[0]));
      for (let i = 1; i < hist.length; i += 1) ctx.lineTo(px(i), py(hist[i]));
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      ctx.stroke();
    };

    const tick = (): void => {
      const target = speedRef.current;
      speedStateRef.current = updateDownloadSpeedHistory(speedStateRef.current, target);
      draw();
    };

    const id = window.setInterval(tick, 750);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className={`speed-sparkline${hidden ? " speed-sparkline-hidden" : ""}`} aria-hidden={hidden} title="Aktuelle Download-Geschwindigkeit (geglättet)">
      <div className="speed-sparkline-graph">
        <canvas ref={canvasRef} className="speed-sparkline-canvas" />
      </div>
      <span className="speed-sparkline-value">{speedBps > 0 ? formatSpeedMbps(speedBps) : "0 B/s"}</span>
    </div>
  );
});

function createScheduleId(): string {
  return `schedule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sortPackageOrderBySize(order: string[], packages: Record<string, PackageEntry>, items: Record<string, DownloadItem>, descending: boolean): string[] {
  const sorted = [...order];
  sorted.sort((a, b) => {
    const sizeA = (packages[a]?.itemIds ?? []).reduce((sum, id) => sum + (items[id]?.totalBytes || items[id]?.downloadedBytes || 0), 0);
    const sizeB = (packages[b]?.itemIds ?? []).reduce((sum, id) => sum + (items[id]?.totalBytes || items[id]?.downloadedBytes || 0), 0);
    const cmp = sizeA - sizeB;
    return descending ? -cmp : cmp;
  });
  return sorted;
}

function sortPackageOrderByHoster(order: string[], packages: Record<string, PackageEntry>, items: Record<string, DownloadItem>, descending: boolean): string[] {
  const sorted = [...order];
  sorted.sort((a, b) => {
    const hosterA = [...new Set((packages[a]?.itemIds ?? []).map((id) => extractHoster(items[id]?.url || "")).filter(Boolean))].join(",").toLowerCase();
    const hosterB = [...new Set((packages[b]?.itemIds ?? []).map((id) => extractHoster(items[id]?.url || "")).filter(Boolean))].join(",").toLowerCase();
    const cmp = hosterA.localeCompare(hosterB);
    return descending ? -cmp : cmp;
  });
  return sorted;
}

function sortPackageOrderByProgress(order: string[], packages: Record<string, PackageEntry>, items: Record<string, DownloadItem>, descending: boolean): string[] {
  const sorted = [...order];
  sorted.sort((a, b) => {
    const progressA = computePackageProgress(packages[a], items);
    const progressB = computePackageProgress(packages[b], items);
    const cmp = progressA - progressB;
    return descending ? -cmp : cmp;
  });
  return sorted;
}

export function sortPackageOrderByService(
  order: string[],
  packages: Record<string, PackageEntry>,
  items: Record<string, DownloadItem>,
  descending: boolean,
  visibleItemsByPackage: Record<string, readonly DownloadItem[]> = {}
): string[] {
  const sorted = [...order];
  const itemsFor = (packageId: string): readonly DownloadItem[] => visibleItemsByPackage[packageId]
    ?? (packages[packageId]?.itemIds ?? []).map((id) => items[id]).filter((item): item is DownloadItem => Boolean(item));
  sorted.sort((a, b) => {
    const serviceA = [...new Set(itemsFor(a).map((item) => item.providerLabel || (item.provider ? providerLabels[item.provider] : "")).filter(Boolean))].join(",").toLocaleLowerCase("de-DE");
    const serviceB = [...new Set(itemsFor(b).map((item) => item.providerLabel || (item.provider ? providerLabels[item.provider] : "")).filter(Boolean))].join(",").toLocaleLowerCase("de-DE");
    const comparison = serviceA.localeCompare(serviceB, "de");
    return descending ? -comparison : comparison;
  });
  return sorted;
}

function computePackageProgress(pkg: PackageEntry | undefined, items: Record<string, DownloadItem>): number {
  if (!pkg) return 0;
  const ids = pkg.itemIds ?? [];
  if (ids.length === 0) return 0;
  let totalDown = 0;
  let totalSize = 0;
  for (const id of ids) {
    const item = items[id];
    if (!item) continue;
    totalDown += item.downloadedBytes || 0;
    totalSize += item.totalBytes || item.downloadedBytes || 0;
  }
  return totalSize > 0 ? totalDown / totalSize : 0;
}

const DEFAULT_COLUMN_ORDER = ["name", "size", "progress", "hoster", "account", "prio", "status", "speed", "availability"];
const ALL_COLUMN_KEYS = ["name", "size", "progress", "hoster", "account", "prio", "status", "speed", "availability", "added"];
const COLUMN_DEFS = downloadColumnDefinitions;

function formatMbpsInputFromKbps(kbps: number): string {
  const mbps = Math.max(0, Number(kbps) || 0) / 1024;
  return String(Number(mbps.toFixed(2)));
}

function parseMbpsInput(value: string): number | null {
  const normalized = String(value || "").trim().replace(/,/g, ".");
  if (!normalized) {
    return 0;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function formatUpdateInstallProgress(progress: UpdateInstallProgress): string {
  if (progress.stage === "downloading") {
    if (progress.totalBytes && progress.totalBytes > 0 && progress.percent !== null) {
      return `Update-Download: ${progress.percent}% (${humanSize(progress.downloadedBytes)} / ${humanSize(progress.totalBytes)})`;
    }
    return `Update-Download: ${humanSize(progress.downloadedBytes)}`;
  }
  if (progress.stage === "starting") {
    return "Update wird vorbereitet...";
  }
  if (progress.stage === "verifying") {
    return "Download fertig | Prüfe Integrität...";
  }
  if (progress.stage === "launching") {
    return "Starte Installer...";
  }
  if (progress.stage === "done") {
    return "Installer gestartet";
  }
  return `Update-Fehler: ${progress.message}`;
}

export function shouldApplyUpdateCheckResult(
  completedGeneration: number,
  currentGeneration: number
): boolean {
  return completedGeneration === currentGeneration;
}

export function shouldOpenUpdatePrompt(
  source: "manual" | "startup",
  latestTag: string,
  dismissedTag: string
): boolean {
  return source === "manual" || !latestTag || latestTag !== dismissedTag;
}

export async function runLatestUpdateCheck(
  generationRef: { current: number },
  check: () => Promise<UpdateCheckResult>,
  apply: (result: UpdateCheckResult, generation: number) => Promise<void> | void
): Promise<void> {
  const generation = ++generationRef.current;
  const result = await check();
  if (!shouldApplyUpdateCheckResult(generation, generationRef.current)) {
    return;
  }
  await apply(result, generation);
}

interface DailySchedulePersistenceDependencies {
  updateSettings: (update: RendererSettingsUpdate) => Promise<RendererSettings>;
  getSnapshot: () => Promise<UiSnapshot>;
  applySettings: (settings: RendererSettings) => void;
  applySnapshot: (snapshot: UiSnapshot) => void;
  showError: (message: string) => void;
}

function formatDailyScheduleLocalDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDailyScheduleTime(minuteOfDay: number): string {
  const minute = Math.max(0, Math.min(1_439, Math.floor(minuteOfDay)));
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export function resolveDailyScheduleInitialTime(
  settings: Pick<RendererSettings, "dailyStartMinuteOfDay" | "dailyStartFirstLocalDate">,
  now = new Date()
): string {
  const minuteOfDay = settings.dailyStartFirstLocalDate
    ? settings.dailyStartMinuteOfDay
    : now.getHours() * 60 + now.getMinutes();
  return formatDailyScheduleTime(minuteOfDay);
}

export function buildDailyScheduleSettingsUpdate(
  time: string,
  startDay: DailyScheduleStartDay,
  now = new Date()
): RendererSettingsUpdate | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) {
    return null;
  }
  const firstDate = new Date(now);
  if (startDay === "tomorrow") {
    firstDate.setDate(firstDate.getDate() + 1);
  }
  return {
    dailyStartEnabled: true,
    dailyStartMinuteOfDay: Number(match[1]) * 60 + Number(match[2]),
    dailyStartFirstLocalDate: formatDailyScheduleLocalDate(firstDate)
  };
}

export function buildScheduleCancellationSettingsUpdate(
  settings: Pick<RendererSettings, "dailyStartEnabled" | "scheduledStartEpochMs">
): RendererSettingsUpdate {
  return settings.dailyStartEnabled
    ? { dailyStartEnabled: false }
    : { scheduledStartEpochMs: 0 };
}

export async function activateDailyScheduleSettings(
  time: string,
  startDay: DailyScheduleStartDay,
  persist: (update: RendererSettingsUpdate) => Promise<boolean>,
  showError: (message: string) => void,
  now = new Date()
): Promise<boolean> {
  const update = buildDailyScheduleSettingsUpdate(time, startDay, now);
  if (!update) {
    showError("Bitte eine gültige Startzeit auswählen.");
    return false;
  }
  return persist(update);
}

export async function persistDailyScheduleSettingsUpdate(
  update: RendererSettingsUpdate,
  operation: "activate" | "cancel",
  dependencies: DailySchedulePersistenceDependencies
): Promise<boolean> {
  try {
    const settings = await dependencies.updateSettings(update);
    dependencies.applySettings(settings);
    return true;
  } catch (error) {
    const action = operation === "activate" ? "aktiviert" : "abgebrochen";
    dependencies.showError(`Zeitplan konnte nicht ${action} werden: ${String(error)}`);
    try {
      dependencies.applySnapshot(await dependencies.getSnapshot());
    } catch (snapshotError) {
      dependencies.showError(`Zeitplan konnte nicht abgeglichen werden: ${String(snapshotError)}`);
    }
    return false;
  }
}

export function routeHistoryLiveEntry(
  entry: HistoryEntry,
  loadFailed: boolean,
  actions: { reload: () => void; accept: (entry: HistoryEntry) => void }
): void {
  if (loadFailed) {
    actions.reload();
    return;
  }
  actions.accept(entry);
}

export function selectHistoryPageFromShortcut(current: ReadonlySet<string>, visibleIds: readonly string[]): Set<string> {
  return toggleHistoryPageSelection(current, visibleIds);
}

export function resolveHistoryContextSelection(current: ReadonlySet<string>, entryId: string): Set<string> {
  return current.has(entryId) ? new Set(current) : new Set([entryId]);
}

export function App(): ReactElement {
  const [snapshot, setSnapshot] = useState<UiSnapshot>(emptySnapshot);
  const [snapshotBootstrapStatus, setSnapshotBootstrapStatus] = useState<SnapshotBootstrapStatus>({ phase: "loading", message: "" });
  const [appVersion, setAppVersion] = useState("");
  const [tab, setTab] = useState<Tab>("downloads");
  const [statusToast, setStatusToast] = useState("");
  const [availableUpdate, setAvailableUpdate] = useState<UpdateCheckResult | null>(null);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [updateInstallProgress, setUpdateInstallProgress] = useState<UpdateInstallProgress | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<RendererSettingsDraft>(() => createSettingsDraft(emptySnapshot().settings));
  const [settingsThemeChoice, setSettingsThemeChoice] = useState<SettingsThemeChoice>(emptySnapshot().settings.themePreference);
  const [speedLimitInput, setSpeedLimitInput] = useState(() => formatMbpsInputFromKbps(emptySnapshot().settings.speedLimitKbps));
  const [scheduleSpeedInputs, setScheduleSpeedInputs] = useState<Record<string, string>>({});
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsSaveState, setSettingsSaveState] = useState<SettingsSaveState>("clean");
  const [settingsSaveInFlight, setSettingsSaveInFlight] = useState(false);
  const [schedulePickerOpen, setSchedulePickerOpen] = useState(false);
  const [scheduleTimeInput, setScheduleTimeInput] = useState("");
  const [scheduleStartDay, setScheduleStartDay] = useState<DailyScheduleStartDay>("today");
  const [scheduleCountdown, setScheduleCountdown] = useState("");
  const [runtimeNow, setRuntimeNow] = useState(() => Date.now());
  const updateCheckGenerationRef = useRef(0);
  const dismissedUpdateTagRef = useRef("");
  const settingsDirtyRef = useRef(false);
  const settingsSaveInFlightRef = useRef(false);
  const writeOnlySettingsDirtyRef = useRef(new Set<"archivePasswordList" | "notifyUrl">());
  const archivePasswordLoadGenerationRef = useRef(0);
  const settingsDraftRevisionRef = useRef(0);

  useEffect(() => {
    const localizer = createUiLocalizer(document, normalizeLanguage(settingsDraft.language));
    return () => localizer.disconnect();
  }, [settingsDraft.language]);
  const panelDirtyRevisionRef = useRef(0);
  const latestStateRef = useRef<UiSnapshot | null>(null);
  const masterSnapshotRef = useRef<UiSnapshot | null>(null);
  const snapshotRef = useRef(snapshot);
  const retrySnapshotBootstrapRef = useRef<() => void>(() => {});
  const persistedSettingsRef = useRef<RendererSettings>(emptySnapshot().settings);
  const settingsThemeChoiceRef = useRef<SettingsThemeChoice>(settingsThemeChoice);
  const persistedThemeChoiceRef = useRef<SettingsThemeChoice>(emptySnapshot().settings.themePreference);
  snapshotRef.current = snapshot;
  settingsThemeChoiceRef.current = settingsThemeChoice;
  useEffect(() => {
    const systemTheme = window.matchMedia("(prefers-color-scheme: light)");
    const onSystemThemeChange = (): void => {
      if (settingsThemeChoiceRef.current !== "system") {
        return;
      }
      const next = resolveSettingsThemeChoice("system", systemTheme.matches);
      setSettingsDraft((current) => ({ ...current, theme: next }));
      applyTheme(next);
    };
    systemTheme.addEventListener("change", onSystemThemeChange);
    return () => systemTheme.removeEventListener("change", onSystemThemeChange);
  }, []);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const stateFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onImportDlcRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const [dragOver, setDragOver] = useState(false);
  const [draggedProvider, setDraggedProvider] = useState<DebridProvider | null>(null);
  const [providerDropTarget, setProviderDropTarget] = useState<DebridProvider | null>(null);
  const [editingPackageId, setEditingPackageId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [collectorPackages, setCollectorPackages] = useState<CollectorPackage[]>([]);
  const [collectorFilter, setCollectorFilter] = useState<CollectorWorkspaceFilter>("all");
  const [collectorQuery, setCollectorQuery] = useState("");
  const [selectedCollectorLinkIds, setSelectedCollectorLinkIds] = useState<Set<string>>(() => new Set());
  const [collapsedCollectorPackageIds, setCollapsedCollectorPackageIds] = useState<Set<string>>(() => new Set());
  const [collectorAnalyzingCount, setCollectorAnalyzingCount] = useState(0);
  const [collectorError, setCollectorError] = useState("");
  const [collectorInput, setCollectorInput] = useState<CollectorInputState | null>(null);
  const collectorPackagesRef = useRef<CollectorPackage[]>(collectorPackages);
  const collapsedCollectorPackageIdsRef = useRef<Set<string>>(collapsedCollectorPackageIds);
  const collectorVisibleIdsRef = useRef<string[]>([]);
  const collectorPersistenceHydratedRef = useRef(false);
  const collectorPersistenceCoordinatorRef = useRef<CollectorPersistenceCoordinator | null>(null);
  const collectorPersistenceBudgetRef = useRef<CollectorPersistenceBudget | null>(null);
  const collectorEnrichmentGenerationsRef = useRef(new Map<string, number>());
  const collectorEnrichmentRequestsRef = useRef(new Map<string, ReturnType<typeof beginCollectorEnrichment>>());
  const importCollectorTextRef = useRef<(rawText: string) => Promise<void>>(() => Promise.resolve());
  const activeTabRef = useRef<Tab>(tab);
  const packageOrderRef = useRef<string[]>([]);
  const packageOrderStateRef = useRef(createPackageOrderState());
  const [collapsedPackages, setCollapsedPackages] = useState<Record<string, boolean>>({});
  const [downloadDisclosureRevision, setDownloadDisclosureRevision] = useState(0);
  const [downloadSearch, setDownloadSearch] = useState("");
  const [downloadDisplayMode, setDownloadDisplayMode] = useState<DownloadDisplayMode>("packages");
  const [downloadFilter, setDownloadFilter] = useState<DownloadSidebarFilter>("all");
  const [downloadProviderFilter, setDownloadProviderFilter] = useState("all");
  const [downloadsSortColumn, setDownloadsSortColumn] = useState<DownloadSortColumn>("name");
  const [downloadsSortRevision, setDownloadsSortRevision] = useState(0);
  const [downloadsSortDescending, setDownloadsSortDescending] = useState(false);
  const [showAllPackages, setShowAllPackages] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [accountCheckBusy, setAccountCheckBusy] = useState(false);
  const actionBusyRef = useRef(false);
  const actionUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const [supportTraceEnabled, setSupportTraceEnabled] = useState(false);
  const dragOverRef = useRef(false);
  const dragDepthRef = useRef(0);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsSubTab, setSettingsSubTab] = useState<SettingsSection>("allgemein");
  const [accountManagementTab, setAccountManagementTab] = useState<"overview" | "rules" | "runtime">("overview");
  const [selectedAccountRowKeys, setSelectedAccountRowKeys] = useState<Set<string>>(() => new Set());
  const settingsSubTabRef = useRef(settingsSubTab);
  const accountManagementTabRef = useRef(accountManagementTab);
  const visibleAccountRowKeysRef = useRef<string[]>([]);
  settingsSubTabRef.current = settingsSubTab;
  accountManagementTabRef.current = accountManagementTab;
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const [startConflictPrompt, setStartConflictPrompt] = useState<StartConflictPromptState | null>(null);
  const startConflictResolverRef = useRef<((result: { policy: Extract<DuplicatePolicy, "skip" | "overwrite">; applyToAll: boolean } | null) => void) | null>(null);
  const [confirmPrompt, setConfirmPrompt] = useState<ConfirmPromptState | null>(null);
  const [backupPassphraseMode, setBackupPassphraseMode] = useState<BackupPassphraseMode | null>(null);
  const [onlineBackupDialog, setOnlineBackupDialog] = useState<OnlineBackupDialogState | null>(null);
  const [remoteDiag, setRemoteDiag] = useState<RemoteDiagnosticsInfo | null>(null);
  const [remoteDiagOpen, setRemoteDiagOpen] = useState(false);
  const [remoteDiagBusy, setRemoteDiagBusy] = useState(false);
  const [rdHostMode, setRdHostMode] = useState<"local" | "network">("local");
  const [rdPublicHost, setRdPublicHost] = useState("");
  const [rdPort, setRdPort] = useState("9868");
  const [rdAllowlist, setRdAllowlist] = useState("");
  const [rdName, setRdName] = useState("");
  const confirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const backupPassphraseResolverRef = useRef<((passphrase: string | null) => void) | null>(null);
  const confirmQueueRef = useRef<Array<{ prompt: ConfirmPromptState; resolve: (confirmed: boolean) => void }>>([]);
  const importQueueFocusHandlerRef = useRef<(() => void) | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const [accountContextMenu, setAccountContextMenu] = useState<AccountContextMenuState | null>(null);
  const accountContextMenuRef = useRef<HTMLDivElement>(null);
  const [linkPopup, setLinkPopup] = useState<LinkPopupState | null>(null);
  const [accountDialog, setAccountDialog] = useState<AccountDialogState | null>(null);
  const [accountEditDialog, setAccountEditDialog] = useState<AccountEditState | null>(null);
  const [accountEditSecretVisible, setAccountEditSecretVisible] = useState<Record<string, boolean>>({});
  const [accountEditSecretBusy, setAccountEditSecretBusy] = useState<string | null>(null);
  const [accountDialogSearch, setAccountDialogSearch] = useState("");
  const [accountDialogServiceFilter, setAccountDialogServiceFilter] = useState("all");
  const [pendingAccountToggles, setPendingAccountToggles] = useState<Record<string, { enabled: boolean; sequence: number }>>({});
  const pendingAccountTogglesRef = useRef<Record<string, { enabled: boolean; sequence: number }>>({});
  const accountToggleQueueRef = useRef(createAccountToggleQueue());
  const accountToggleSequenceRef = useRef(0);
  const settingsMutationSequenceRef = useRef(0);
  const [keyStatsPopup, setKeyStatsPopup] = useState<string | null>(null);
  const [debridLinkHostLimits, setDebridLinkHostLimits] = useState<Record<string, DebridLinkHostLimitInfo>>({});
  const [debridLinkHostLimitsLoading, setDebridLinkHostLimitsLoading] = useState(false);
  const [debridLinkHostLimitsError, setDebridLinkHostLimitsError] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<{ ids: Set<string>; dontAsk: boolean } | null>(null);
  const [columnOrder, setColumnOrder] = useState<string[]>(() => DEFAULT_COLUMN_ORDER);
  const columnOrderPersistenceRef = useRef<DownloadColumnOrderPersistence | null>(null);
  if (!columnOrderPersistenceRef.current) {
    columnOrderPersistenceRef.current = createDownloadColumnOrderPersistence(
      DEFAULT_COLUMN_ORDER,
      async (order) => {
        const settings = await window.rd.updateSettings({ columnOrder: order });
        return settings.columnOrder?.length ? settings.columnOrder : order;
      },
      setColumnOrder
    );
  }
  const columnDragSessionRef = useRef<DownloadColumnDragSession | null>(null);
  const columnDragSettleTimerRef = useRef<number | null>(null);
  const columnDragAnimationsRef = useRef<Animation[]>([]);
  const suppressColumnSortRef = useRef(false);
  const cancelColumnDragAnimations = useCallback((): void => {
    columnDragAnimationsRef.current.forEach((animation) => animation.cancel());
    columnDragAnimationsRef.current = [];
  }, []);
  useEffect(() => () => {
    if (columnDragSettleTimerRef.current !== null) window.clearTimeout(columnDragSettleTimerRef.current);
    cancelColumnDragAnimations();
    if (columnDragSessionRef.current) clearDownloadColumnDrag(columnDragSessionRef.current);
  }, [cancelColumnDragAnimations]);
  const [colHeaderCtx, setColHeaderCtx] = useState<{ x: number; y: number } | null>(null);
  const colHeaderCtxRef = useRef<HTMLDivElement>(null);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const historyEntriesRef = useRef<HistoryEntry[]>([]);
  const [historyExpandedIds, setHistoryExpandedIds] = useState<Set<string>>(() => new Set());
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(new Set());
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyVisiblePageCount, setHistoryVisiblePageCount] = useState(0);
  const [statisticsRange, setStatisticsRange] = useState<StatisticsRange>("session");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyCtxMenu, setHistoryCtxMenu] = useState<{ x: number; y: number; entryId: string } | null>(null);
  const historyCtxMenuRef = useRef<HTMLDivElement>(null);
  const historyLoadGenerationRef = useRef(0);
  const historyLoadActiveRef = useRef(false);
  const historyLoadFailedRef = useRef(false);
  const pendingLiveHistoryEntriesRef = useRef<HistoryEntry[]>([]);
  const historyVisibleIdsRef = useRef<string[]>([]);
  const [allDebridHostInfo, setAllDebridHostInfo] = useState<AllDebridHostInfo | null>(null);
  const [allDebridHostLoading, setAllDebridHostLoading] = useState(false);
  const allDebridHostRequestRef = useRef(0);
  const debridLinkHostLimitsRequestRef = useRef(0);

  const persistColumnOrder = useCallback((order: string[]): void => {
    columnOrderPersistenceRef.current?.enqueue(order);
  }, []);

  const collectorViewModel = useMemo(() => buildCollectorWorkspaceViewModel(
    collectorPackages,
    collectorFilter,
    collectorQuery,
    collectorAnalyzingCount > 0,
    [...selectedCollectorLinkIds],
    [...collapsedCollectorPackageIds],
    collectorError,
    snapshot.settings.animatePackageDisclosure
  ), [collapsedCollectorPackageIds, collectorAnalyzingCount, collectorError, collectorFilter, collectorPackages, collectorQuery, selectedCollectorLinkIds, snapshot.settings.animatePackageDisclosure]);
  collectorVisibleIdsRef.current = collectorViewModel.visibleIds;

  const historyCalendarDate = new Date(runtimeNow);
  historyCalendarDate.setHours(0, 0, 0, 0);
  const historyCalendarDayStart = historyCalendarDate.getTime();

  const historyViewModel = useMemo(() => buildHistoryViewModel(
    historyEntries,
    historyFilter,
    historyQuery,
    selectedHistoryIds,
    historyExpandedIds,
    historyLoading,
    historyError,
    historyCalendarDayStart,
    snapshot.settings.animatePackageDisclosure,
    normalizeLanguage(settingsDraft.language)
  ), [historyCalendarDayStart, historyEntries, historyError, historyExpandedIds, historyFilter, historyLoading, historyQuery, selectedHistoryIds, settingsDraft.language, snapshot.settings.animatePackageDisclosure]);
  const historySidebarCounts = formatHistorySidebarCounts(
    historyViewModel.totalCount,
    historyViewModel.loading || historyViewModel.error ? 0 : historyVisiblePageCount,
    historyViewModel.selectedIds.length
  );
  const statisticsViewModel = useMemo(
    () => buildStatisticsViewModel(snapshot, statisticsRange, runtimeNow),
    [runtimeNow, snapshot, statisticsRange]
  );

  collectorPackagesRef.current = collectorPackages;
  collapsedCollectorPackageIdsRef.current = collapsedCollectorPackageIds;

  useEffect(() => {
    activeTabRef.current = tab;
  }, [tab]);

  useEffect(() => {
    packageOrderRef.current = snapshot.session.packageOrder;
  }, [snapshot.session.packageOrder]);

  useEffect(() => {
    setSpeedLimitInput(formatMbpsInputFromKbps(settingsDraft.speedLimitKbps));
  }, [settingsDraft.speedLimitKbps]);

  useEffect(() => {
    const schedMs = snapshot.settings.dailyStartEnabled
      ? snapshot.settings.nextDailyStartEpochMs
      : snapshot.settings.scheduledStartEpochMs || 0;
    if (schedMs <= 0) { setScheduleCountdown(""); return; }
    const update = (): void => {
      const remaining = schedMs - Date.now();
      if (remaining <= 0) { setScheduleCountdown(""); return; }
      const totalSec = Math.ceil(remaining / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      setScheduleCountdown(h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`);
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [snapshot.settings.dailyStartEnabled, snapshot.settings.nextDailyStartEpochMs, snapshot.settings.scheduledStartEpochMs]);

  useEffect(() => {
    const timer = setInterval(() => setRuntimeNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const showToast = useCallback((message: string, timeoutMs = 2200): void => {
    setStatusToast(message);
    if (toastTimerRef.current) { clearTimeout(toastTimerRef.current); }
    toastTimerRef.current = setTimeout(() => {
      setStatusToast("");
      toastTimerRef.current = null;
    }, timeoutMs);
  }, []);

  useEffect(() => {
    if (settingsSubTab !== "extract" || writeOnlySettingsDirtyRef.current.has("archivePasswordList")) {
      archivePasswordLoadGenerationRef.current += 1;
      return;
    }
    const generation = archivePasswordLoadGenerationRef.current + 1;
    archivePasswordLoadGenerationRef.current = generation;
    void window.rd.getArchivePasswordList().then(({ passwords }) => {
      if (archivePasswordLoadGenerationRef.current !== generation || writeOnlySettingsDirtyRef.current.has("archivePasswordList")) {
        return;
      }
      setSettingsDraft((current) => current.archivePasswordList === passwords
        ? current
        : { ...current, archivePasswordList: passwords });
    }).catch(() => {
      if (archivePasswordLoadGenerationRef.current === generation) {
        showToast("Archiv-Passwortliste konnte nicht geladen werden", 2800);
      }
    });
    return () => {
      if (archivePasswordLoadGenerationRef.current === generation) {
        archivePasswordLoadGenerationRef.current += 1;
      }
    };
  }, [settingsSubTab, snapshot.settings.archivePasswordListConfigured, showToast]);

  const applyHistoryEntries = useCallback((entries: HistoryEntry[]): void => {
    const availableIds = entries.map((entry) => entry.id);
    const availableSet = new Set(availableIds);
    historyEntriesRef.current = entries;
    setHistoryEntries(entries);
    setSelectedHistoryIds((current) => pruneHistoryIds(current, availableIds));
    setHistoryExpandedIds((current) => pruneHistoryIds(current, availableIds));
    setHistoryCtxMenu((current) => current && availableSet.has(current.entryId) ? current : null);
  }, []);

  const loadHistoryEntries = useCallback(async (): Promise<void> => {
    const generation = ++historyLoadGenerationRef.current;
    historyLoadActiveRef.current = true;
    historyLoadFailedRef.current = false;
    pendingLiveHistoryEntriesRef.current = [];
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const entries = await window.rd.getHistory();
      if (!mountedRef.current || generation !== historyLoadGenerationRef.current) {
        return;
      }
      const settings = snapshotRef.current.settings;
      const merged = [...pendingLiveHistoryEntriesRef.current].reverse().reduce(
        (current, entry) => mergeLiveHistoryEntry(current, entry, {
          maxEntries: settings.historyMaxEntries,
          maxAgeDays: settings.historyMaxAgeDays
        }),
        entries
      );
      pendingLiveHistoryEntriesRef.current = [];
      applyHistoryEntries(merged);
    } catch {
      if (mountedRef.current && generation === historyLoadGenerationRef.current) {
        historyLoadFailedRef.current = true;
        pendingLiveHistoryEntriesRef.current = [];
        applyHistoryEntries([]);
        setHistoryError("Verlauf konnte nicht geladen werden");
      }
    } finally {
      if (mountedRef.current && generation === historyLoadGenerationRef.current) {
        historyLoadActiveRef.current = false;
        pendingLiveHistoryEntriesRef.current = [];
        setHistoryLoading(false);
      }
    }
  }, [applyHistoryEntries]);

  useEffect(() => {
    if (tab !== "history") {
      return;
    }
    void loadHistoryEntries();
    return () => {
      historyLoadGenerationRef.current += 1;
      historyLoadActiveRef.current = false;
      pendingLiveHistoryEntriesRef.current = [];
    };
  }, [loadHistoryEntries, tab]);

  useEffect(() => {
    const unsubscribeHistoryEntryAdded = window.rd.onHistoryEntryAdded((entry) => {
      if (activeTabRef.current !== "history") {
        return;
      }
      routeHistoryLiveEntry(entry, historyLoadFailedRef.current, {
        reload: () => { void loadHistoryEntries(); },
        accept: (liveEntry) => {
          if (historyLoadActiveRef.current) {
            pendingLiveHistoryEntriesRef.current = [
              liveEntry,
              ...pendingLiveHistoryEntriesRef.current.filter((pending) => pending.id !== liveEntry.id)
            ];
          }
          const settings = snapshotRef.current.settings;
          applyHistoryEntries(mergeLiveHistoryEntry(historyEntriesRef.current, liveEntry, {
            maxEntries: settings.historyMaxEntries,
            maxAgeDays: settings.historyMaxAgeDays
          }));
          setHistoryError("");
        }
      });
    });
    return unsubscribeHistoryEntryAdded;
  }, [applyHistoryEntries, loadHistoryEntries]);

  const loadAllDebridHostInfo = useCallback(async (silent = false): Promise<void> => {
    const requestId = allDebridHostRequestRef.current + 1;
    allDebridHostRequestRef.current = requestId;
    setAllDebridHostLoading(true);
    try {
      const info = await window.rd.getAllDebridHostInfo();
      if (!mountedRef.current || allDebridHostRequestRef.current !== requestId) {
        return;
      }
      setAllDebridHostInfo(info);
    } catch (error) {
      if (!mountedRef.current || allDebridHostRequestRef.current !== requestId) {
        return;
      }
      setAllDebridHostInfo(null);
      if (!silent) {
        showToast(`AllDebrid Status fehlgeschlagen: ${String(error)}`, 3200);
      }
    } finally {
      if (mountedRef.current && allDebridHostRequestRef.current === requestId) {
        setAllDebridHostLoading(false);
      }
    }
  }, [showToast]);

  const loadDebridLinkHostLimits = useCallback(async (silent = false): Promise<void> => {
    const requestId = debridLinkHostLimitsRequestRef.current + 1;
    debridLinkHostLimitsRequestRef.current = requestId;
    setDebridLinkHostLimitsLoading(true);
    setDebridLinkHostLimitsError("");
    setDebridLinkHostLimits({});
    try {
      const apiKeys = snapshot.accounts.filter((account) => account.kind === "debridlink-api");
      if (apiKeys.length === 0) {
        throw new Error("Debrid-Link ist nicht konfiguriert");
      }
      const limits = await window.rd.getDebridLinkHostLimits();
      if (!mountedRef.current || debridLinkHostLimitsRequestRef.current !== requestId) {
        return;
      }
      setDebridLinkHostLimits(
        Object.fromEntries(limits.map((info) => [info.keyId, info]))
      );
    } catch (error) {
      if (!mountedRef.current || debridLinkHostLimitsRequestRef.current !== requestId) {
        return;
      }
      setDebridLinkHostLimits({});
      setDebridLinkHostLimitsError(String(error));
      if (!silent) {
        showToast(`Debrid-Link Quota fehlgeschlagen: ${String(error)}`, 3200);
      }
    } finally {
      if (mountedRef.current && debridLinkHostLimitsRequestRef.current === requestId) {
        setDebridLinkHostLimitsLoading(false);
      }
    }
  }, [snapshot.accounts, showToast]);

  useEffect(() => {
    if (keyStatsPopup !== "debridlink") {
      setDebridLinkHostLimits({});
      setDebridLinkHostLimitsError("");
      setDebridLinkHostLimitsLoading(false);
      return;
    }
    void loadDebridLinkHostLimits(true);
  }, [keyStatsPopup, loadDebridLinkHostLimits]);

  const clearImportQueueFocusListener = useCallback((): void => {
    const handler = importQueueFocusHandlerRef.current;
    if (!handler) {
      return;
    }
    window.removeEventListener("focus", handler);
    importQueueFocusHandlerRef.current = null;
  }, []);

  useEffect(() => {
    document.title = `Multi Debrid Downloader${appVersion ? ` - v${appVersion}` : ""}`;
  }, [appVersion]);

  useEffect(() => {
    mountedRef.current = true;
    let unsubscribe: (() => void) | null = null;
    let unsubClipboard: (() => void) | null = null;
    let unsubUpdateInstallProgress: (() => void) | null = null;
    let snapshotRequestGeneration = 0;
    let authoritativeSnapshotApplied = false;
    const snapshotCoordinator = createSnapshotBootstrapCoordinator();
    const applyStreamSnapshot = (merged: UiSnapshot): void => {
      masterSnapshotRef.current = merged;
      persistedSettingsRef.current = merged.settings;
      latestStateRef.current = merged;
      if (stateFlushTimerRef.current) return;
      const itemCount = Object.keys(merged.session.items).length;
      const flushDelay = getSnapshotRenderDelay(itemCount, merged.session.running, activeTabRef.current);
      stateFlushTimerRef.current = setTimeout(() => {
        stateFlushTimerRef.current = null;
        if (!latestStateRef.current) return;
        const next = latestStateRef.current;
        const packageOrder = packageOrderStateRef.current.accept(next.session.packageOrder);
        setSnapshot(packageOrder === next.session.packageOrder ? next : { ...next, session: { ...next.session, packageOrder } });
        if (!settingsDirtyRef.current) {
          setSettingsDraft((current) => createSettingsDraft(next.settings, current));
        }
        latestStateRef.current = null;
      }, flushDelay);
    };
    const applyAuthoritativeSnapshot = (
      state: UiSnapshot,
      storedThemeChoice: SettingsThemeChoice = state.settings.themePreference
    ): void => {
      if (authoritativeSnapshotApplied) {
        return;
      }
      authoritativeSnapshotApplied = true;
      packageOrderStateRef.current.accept(state.session.packageOrder);
      masterSnapshotRef.current = state;
      persistedSettingsRef.current = state.settings;
      const resolvedTheme = resolveSettingsThemeChoice(
        storedThemeChoice,
        window.matchMedia("(prefers-color-scheme: light)").matches
      );
      persistedThemeChoiceRef.current = storedThemeChoice;
      setSnapshot(state);
      setSnapshotBootstrapStatus(snapshotCoordinator.getStatus());
      if (state.settings.columnOrder?.length > 0) {
        columnOrderPersistenceRef.current?.applyAuthoritative(state.settings.columnOrder);
      }
      setSettingsDraft((current) => createSettingsDraft({ ...state.settings, theme: resolvedTheme }, current));
      writeOnlySettingsDirtyRef.current.clear();
      settingsDirtyRef.current = false;
      panelDirtyRevisionRef.current = 0;
      setSettingsDirty(false);
      setSettingsSaveState("clean");
      setSettingsThemeChoice(storedThemeChoice);
      settingsThemeChoiceRef.current = storedThemeChoice;
      applyTheme(resolvedTheme);
      if (state.settings.autoUpdateCheck) {
        void runLatestUpdateCheck(
          updateCheckGenerationRef,
          () => window.rd.checkUpdates(),
          (result, generation) => handleUpdateResult(result, "startup", generation)
        ).catch(() => undefined);
      }
    };
    unsubscribe = window.rd.onStateUpdate((wireState) => {
      const merged = snapshotCoordinator.push(wireState);
      if (!merged) {
        return;
      }
      if (!authoritativeSnapshotApplied && snapshotCoordinator.getStatus().phase === "ready") {
        applyAuthoritativeSnapshot(merged);
        return;
      }
      applyStreamSnapshot(merged);
    });
    void window.rd.getVersion().then((v) => { if (mountedRef.current) { setAppVersion(v); } }).catch(() => undefined);
    void window.rd.getTraceConfig().then((config) => {
      if (mountedRef.current) {
        setSupportTraceEnabled(config.enabled);
      }
    }).catch(() => undefined);
    const loadInitialSnapshot = (): void => {
      const generation = ++snapshotRequestGeneration;
      setSnapshotBootstrapStatus(snapshotCoordinator.retry());
      void window.rd.getSnapshot().then((initialState) => {
        if (!mountedRef.current || generation !== snapshotRequestGeneration) {
          return;
        }
        const state = snapshotCoordinator.initialize(initialState);
        if (authoritativeSnapshotApplied) {
          if (state !== masterSnapshotRef.current) {
            applyStreamSnapshot(state);
          }
        } else {
          applyAuthoritativeSnapshot(state, state.settings.themePreference);
        }
      }).catch((error) => {
        if (!mountedRef.current || generation !== snapshotRequestGeneration) {
          return;
        }
        const message = `Snapshot konnte nicht geladen werden: ${String(error)}`;
        setSnapshotBootstrapStatus(snapshotCoordinator.fail(message));
      });
    };
    retrySnapshotBootstrapRef.current = loadInitialSnapshot;
    loadInitialSnapshot();
    unsubClipboard = window.rd.onClipboardDetected((links) => {
      showToast(`Zwischenablage: ${links.length} Link(s) erkannt`, 3000);
      void importCollectorTextRef.current(links.join("\n"));
    });
    unsubUpdateInstallProgress = window.rd.onUpdateInstallProgress((progress) => {
      if (!mountedRef.current) {
        return;
      }
      setUpdateInstallProgress(progress);
    });
    return () => {
      mountedRef.current = false;
      if (stateFlushTimerRef.current) { clearTimeout(stateFlushTimerRef.current); }
      if (toastTimerRef.current) { clearTimeout(toastTimerRef.current); }
      if (actionUnlockTimerRef.current) { clearTimeout(actionUnlockTimerRef.current); }
      clearImportQueueFocusListener();
      if (startConflictResolverRef.current) {
        const resolver = startConflictResolverRef.current;
        startConflictResolverRef.current = null;
        resolver(null);
      }
      if (confirmResolverRef.current) {
        const resolver = confirmResolverRef.current;
        confirmResolverRef.current = null;
        resolver(false);
      }
      if (backupPassphraseResolverRef.current) {
        const resolver = backupPassphraseResolverRef.current;
        backupPassphraseResolverRef.current = null;
        resolver(null);
      }
      while (confirmQueueRef.current.length > 0) {
        const request = confirmQueueRef.current.shift();
        request?.resolve(false);
      }
      if (unsubscribe) { unsubscribe(); }
      if (unsubClipboard) { unsubClipboard(); }
      if (unsubUpdateInstallProgress) { unsubUpdateInstallProgress(); }
      retrySnapshotBootstrapRef.current = () => {};
    };
  }, [clearImportQueueFocusListener]);

  const downloadsTabActive = tab === "downloads";
  const deferredDownloadSearch = useDeferredValue(downloadSearch);
  const gridTemplate = useMemo(() => columnOrder.map((col) => COLUMN_DEFS[col]?.width ?? "100px").join(" "), [columnOrder]);
  const totalPackageCount = snapshot.session.packageOrder.length;

  const packageOrderKey = useMemo(() => {
    if (!downloadsTabActive) {
      return "";
    }
    return snapshot.session.packageOrder.join("|");
  }, [downloadsTabActive, snapshot.session.packageOrder]);

  const packages = useMemo(() => {
    if (!downloadsTabActive) {
      return [] as PackageEntry[];
    }
    return snapshot.session.packageOrder
      .map((id) => snapshot.session.packages[id])
      .filter((pkg): pkg is PackageEntry => Boolean(pkg));
  }, [downloadsTabActive, packageOrderKey, snapshot.session.packageOrder, snapshot.session.packages]);

  const packagePosition = useMemo(() => {
    if (!downloadsTabActive) {
      return new Map<string, number>();
    }
    const map = new Map<string, number>();
    snapshot.session.packageOrder.forEach((id, index) => {
      map.set(id, index);
    });
    return map;
  }, [downloadsTabActive, snapshot.session.packageOrder]);

  useEffect(() => {
    if (!downloadsTabActive) {
      return;
    }
    setCollapsedPackages((prev) => {
      let changed = false;
      const next: Record<string, boolean> = { ...prev };
      const defaultCollapsed = totalPackageCount >= 24;
      for (const packageId of snapshot.session.packageOrder) {
        if (!(packageId in prev)) {
          next[packageId] = defaultCollapsed;
          changed = true;
        }
      }
      for (const packageId of Object.keys(next)) {
        if (!snapshot.session.packages[packageId]) {
          delete next[packageId];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [downloadsTabActive, packageOrderKey, snapshot.session.packageOrder, snapshot.session.packages, totalPackageCount]);

  // Prune selection when its packages/items disappear (e.g. via delta-removal or
  // a backup-driven session swap). selectedIds holds BOTH package and item ids;
  // a stale id would otherwise inflate the selection count and the "(N)" labels.
  useEffect(() => {
    setSelectedIds((prev) => pruneSelection(prev, snapshot.session));
  }, [snapshot.session.packages, snapshot.session.items]);

  const visiblePackages = useMemo(() => {
    return preservePackageOrderForDisplay(packages);
  }, [packages]);

  const downloadsViewCore = useMemo(() => buildDownloadsViewModel({
    packageOrder: visiblePackages.map((entry) => entry.id),
    packages: snapshot.session.packages,
    items: snapshot.session.items,
    displayMode: downloadDisplayMode,
    filter: downloadFilter,
    providerFilter: downloadProviderFilter,
    query: deferredDownloadSearch,
    collapsedPackageIds: Object.entries(collapsedPackages).filter(([, value]) => value).map(([id]) => id),
    selectedIds,
    hideExtractedItems: snapshot.settings.hideExtractedItems,
    showAllPackages: showAllPackages || !snapshot.session.running,
    renderLimit: AUTO_RENDER_PACKAGE_LIMIT
  }), [collapsedPackages, deferredDownloadSearch, downloadDisplayMode, downloadFilter, downloadProviderFilter, selectedIds, showAllPackages, snapshot.session.items, snapshot.session.packages, snapshot.session.running, snapshot.settings.hideExtractedItems, visiblePackages]);

  useEffect(() => {
    if (downloadsTabActive && downloadProviderFilter !== downloadsViewCore.providerFilter) {
      setDownloadProviderFilter(downloadsViewCore.providerFilter);
    }
  }, [downloadProviderFilter, downloadsTabActive, downloadsViewCore.providerFilter]);

  const hasSavedAllDebridAccount = snapshot.accounts.some((account) => account.provider === "alldebrid");
  const allDebridSettingsDirty = snapshot.settings.allDebridUseWebLogin !== settingsDraft.allDebridUseWebLogin;

  useEffect(() => {
    if (!snapshot.session.running) {
      setShowAllPackages(false);
    }
  }, [snapshot.session.running]);

  useEffect(() => {
    if (settingsSubTab !== "accounts") {
      return;
    }
    if (!hasSavedAllDebridAccount) {
      setAllDebridHostInfo(null);
      setAllDebridHostLoading(false);
      return;
    }
    void loadAllDebridHostInfo(true);
  }, [settingsSubTab, hasSavedAllDebridAccount, snapshot.settings.allDebridUseWebLogin, loadAllDebridHostInfo]);

  const allPackagesCollapsed = useMemo(() => (
    packages.length > 0 && packages.every((pkg) => collapsedPackages[pkg.id])
  ), [packages, collapsedPackages]);

  const configuredProviders = useMemo(() => getActiveProvidersFromSettings(settingsDraft), [settingsDraft]);

  const totalConfiguredAccounts = snapshot.accounts.length;

  const activeProviderOrder = useMemo(() => normalizeProviderOrderForSettings(settingsDraft), [settingsDraft]);

  const setProviderOrder = useCallback((newOrder: DebridProvider[]) => {
    settingsDraftRevisionRef.current += 1;
    panelDirtyRevisionRef.current += 1;
    settingsDirtyRef.current = true;
    setSettingsDirty(true);
    setSettingsSaveState("dirty");
    setSettingsDraft((prev) => ({
      ...prev,
      providerOrder: newOrder,
      providerPrimary: newOrder[0] ?? prev.providerPrimary,
      providerSecondary: newOrder[1] ?? "none",
      providerTertiary: newOrder[2] ?? "none"
    }));
  }, []);

  const onProviderDragStart = useCallback((event: DragEvent<HTMLElement>, provider: DebridProvider): void => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", provider);
    setDraggedProvider(provider);
    setProviderDropTarget(provider);
  }, []);

  const onProviderDragOver = useCallback((event: DragEvent<HTMLElement>, provider: DebridProvider): void => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (providerDropTarget !== provider) {
      setProviderDropTarget(provider);
    }
  }, [providerDropTarget]);

  const onProviderDrop = useCallback((event: DragEvent<HTMLElement>, provider: DebridProvider): void => {
    event.preventDefault();
    if (!draggedProvider || draggedProvider === provider) {
      return;
    }
    const currentOrder = [...activeProviderOrder];
    const fromIndex = currentOrder.indexOf(draggedProvider);
    const toIndex = currentOrder.indexOf(provider);
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
      return;
    }
    currentOrder.splice(fromIndex, 1);
    currentOrder.splice(toIndex, 0, draggedProvider);
    setProviderOrder(currentOrder);
    setProviderDropTarget(provider);
  }, [activeProviderOrder, draggedProvider, setProviderOrder]);

  const onProviderDragEnd = useCallback((): void => {
    setDraggedProvider(null);
    setProviderDropTarget(null);
  }, []);

  const normalizedSettingsDraft: RendererSettingsDraft = useMemo(() => ({
    ...settingsDraft,
    ...normalizeProviderSelectionForSettings(settingsDraft)
  }), [settingsDraft]);

  const configuredAccounts = useMemo(() => {
    const entries: ConfiguredAccountEntry[] = [];
    for (const service of ACCOUNT_SERVICES) {
      const kind = getConfiguredAccountKind(settingsDraft, service);
      if (!kind) {
        continue;
      }
      const option = findAccountOption(kind);
      let statusLabel = "Aktiviert";
      let note = "";
      if (kind === "megadebrid-api") {
        const megaAccountCount = accountsOfKind(kind, snapshot.accounts).length;
        statusLabel = megaAccountCount > 1 ? `${megaAccountCount} Accounts` : "Aktiviert";
        note = "Nur API aktiv. Kein Web-Fallback.";
      } else if (kind === "megadebrid-web") {
        const megaAccountCount = accountsOfKind(kind, snapshot.accounts).length;
        statusLabel = megaAccountCount > 1 ? `${megaAccountCount} Accounts` : "Aktiviert";
        note = "Nur Web aktiv. Kein API-Fallback.";
      } else if (kind === "realdebrid-web") {
        note = "Login kann bei Bedarf direkt aus der Liste geöffnet werden.";
      } else if (kind === "bestdebrid-web") {
        note = "Cookie-Import lässt sich direkt aus der Liste erneut starten.";
      } else if (service === "alldebrid") {
        if (allDebridHostLoading) {
          statusLabel = "Lade Status";
          note = "Rapidgator-Status wird aktualisiert.";
        } else if (allDebridHostInfo) {
          statusLabel = allDebridHostInfo.statusLabel;
          note = allDebridHostInfo.note || `Update: ${formatAllDebridTimestamp(allDebridHostInfo)}`;
        } else if (hasSavedAllDebridAccount) {
          note = "Rapidgator-Status kann direkt aus der Liste geladen werden.";
        }
        if (allDebridSettingsDirty && hasSavedAllDebridAccount) {
          note = "Status basiert auf den zuletzt gespeicherten AllDebrid-Daten.";
        }
      }
      if (kind === "debridlink-api") {
        const keyCount = accountsOfKind(kind, snapshot.accounts).length;
        statusLabel = keyCount > 1 ? `${keyCount} API-Keys` : "Aktiviert";
      }
      const provider = getAccountServiceProvider(service);
      const dailyUsedBytes = getProviderDailyUsageBytes(snapshot.settings, provider);
      const totalUsedBytes = getProviderTotalUsageBytes(snapshot.settings, provider);
      const dailyLimitBytes = getProviderDailyLimitBytes(settingsDraft, provider);
      const dailyRemainingBytes = getProviderDailyRemainingBytes({
        providerDailyLimitBytes: settingsDraft.providerDailyLimitBytes,
        providerDailyUsageBytes: snapshot.settings.providerDailyUsageBytes,
        providerDailyUsageDay: snapshot.settings.providerDailyUsageDay
      }, provider);
      let dailyLimitReached = dailyLimitBytes > 0 && dailyUsedBytes >= dailyLimitBytes;
      const isDisabled = (settingsDraft.disabledProviders || []).includes(provider);
      const debridLinkKeys = kind === "debridlink-api"
        ? accountsOfKind(kind, snapshot.accounts).map((account, index) => {
          const keyDailyUsedBytes = account.dailyUsageBytes;
          const keyDailyLimitBytes = account.dailyLimitBytes;
          const keyDailyRemainingBytes = getDebridLinkApiKeyDailyRemainingBytes({
            debridLinkApiKeyDailyLimitBytes: settingsDraft.debridLinkApiKeyDailyLimitBytes,
            debridLinkApiKeyDailyUsageBytes: snapshot.settings.debridLinkApiKeyDailyUsageBytes,
            providerDailyLimitBytes: settingsDraft.providerDailyLimitBytes,
            providerDailyUsageBytes: snapshot.settings.providerDailyUsageBytes,
            providerDailyUsageDay: snapshot.settings.providerDailyUsageDay
          }, account.accountId);
          return {
            id: account.accountId,
            label: `Key ${index + 1}`,
            token: "",
            masked: account.maskedIdentity,
            disabled: settingsDraft.debridLinkDisabledKeyIds.includes(account.accountId),
            dailyUsedBytes: keyDailyUsedBytes,
            totalUsedBytes: account.totalUsageBytes,
            dailyLimitBytes: keyDailyLimitBytes,
            dailyRemainingBytes: keyDailyRemainingBytes,
            dailyLimitReached: keyDailyLimitBytes > 0 && keyDailyUsedBytes >= keyDailyLimitBytes
          };
        })
        : [];
      if (kind === "debridlink-api" && debridLinkKeys.length > 0) {
        const limitedCount = debridLinkKeys.filter((entry) => entry.dailyLimitReached).length;
        const disabledKeyCount = debridLinkKeys.filter((entry) => entry.disabled).length;
        const keyNotes: string[] = [];
        if (limitedCount > 0) {
          keyNotes.push(`${limitedCount}/${debridLinkKeys.length} API-Keys am Limit.`);
        }
        if (disabledKeyCount > 0) {
          keyNotes.push(`${disabledKeyCount}/${debridLinkKeys.length} API-Keys deaktiviert.`);
        }
        if (keyNotes.length > 0) {
          const combinedKeyNote = keyNotes.join(" ");
          note = note ? `${combinedKeyNote} ${note}` : combinedKeyNote;
        }
        if (debridLinkKeys.every((entry) => entry.disabled || entry.dailyLimitReached)) {
          dailyLimitReached = true;
        }
      }
      if (dailyLimitReached) {
        note = note
          ? `Tageslimit erreicht. Neue Links wechseln auf den nächsten Hoster. ${note}`
          : "Tageslimit erreicht. Neue Links wechseln auf den nächsten Hoster.";
      }
      entries.push({
        kind,
        service,
        provider,
        serviceLabel: option.serviceLabel,
        modeLabel: option.modeLabel,
        statusLabel: isDisabled ? "Deaktiviert" : statusLabel,
        summary: summarizeAccount(kind, snapshot.accounts),
        summaryLines: summarizeAccountLines(kind, snapshot.accounts, settingsDraft.accountListShowDetailedDebridLinkKeys),
        note,
        disabled: isDisabled,
        dailyUsedBytes,
        totalUsedBytes,
        dailyLimitBytes,
        dailyRemainingBytes,
        dailyLimitReached,
        debridLinkKeys
      });
    }
    return entries;
  }, [settingsDraft, snapshot.accounts, snapshot.settings, allDebridHostInfo, allDebridHostLoading, hasSavedAllDebridAccount, allDebridSettingsDirty]);

  const configuredAccountServices = useMemo(() => new Set(configuredAccounts.map((entry) => entry.service)), [configuredAccounts]);

  const accountRows = useMemo(() => {
    const rows: AccountTableRow[] = [];
    for (const entry of configuredAccounts) {
      if (entry.service === "realdebrid") {
        const accounts = snapshot.accounts.filter((account): account is RendererAccount & { kind: "realdebrid-api" | "realdebrid-web" } => (
          account.provider === "realdebrid" && (account.kind === "realdebrid-api" || account.kind === "realdebrid-web")
        ));
        for (const account of accounts) {
          const option = findAccountOption(account.kind);
          const disabled = (settingsDraft.disabledProviders || []).includes("realdebrid")
            || (settingsDraft.realDebridDisabledAccountIds || []).includes(account.accountId);
          const rowEntry: ConfiguredAccountEntry = {
            ...entry,
            kind: account.kind,
            modeLabel: option.modeLabel,
            statusLabel: disabled ? "Deaktiviert" : "Aktiviert",
            summary: account.maskedIdentity,
            summaryLines: [account.maskedIdentity],
            disabled,
            dailyUsedBytes: account.dailyUsageBytes,
            totalUsedBytes: account.totalUsageBytes,
            dailyLimitBytes: account.dailyLimitBytes,
            dailyRemainingBytes: account.dailyLimitBytes > 0 ? Math.max(0, account.dailyLimitBytes - account.dailyUsageBytes) : 0,
            dailyLimitReached: account.dailyLimitBytes > 0 && account.dailyUsageBytes >= account.dailyLimitBytes
          };
          rows.push({
            rowKey: `rd-${account.accountId}`,
            entry: rowEntry,
            hosterLabel: option.serviceLabel,
            modeLabel: option.modeLabel,
            username: account.identity,
            credentialLabel: getAccountCredentialLabel(account.kind),
            accountId: account.accountId,
            checkable: true,
            disabled,
            dailyUsedBytes: account.dailyUsageBytes,
            dailyLimitBytes: account.dailyLimitBytes,
            dailyRemainingBytes: account.dailyLimitBytes > 0 ? Math.max(0, account.dailyLimitBytes - account.dailyUsageBytes) : 0,
            totalUsedBytes: account.totalUsageBytes,
            toggleKind: "rd",
            editTarget: {
              type: "single",
              rowKey: `rd-${account.accountId}`,
              kind: account.kind,
              service: "realdebrid",
              provider: "realdebrid",
              accountId: account.accountId
            }
          });
        }
      } else if (entry.kind === "megadebrid-api" || entry.kind === "megadebrid-web") {
        const accounts = accountsOfKind(entry.kind, snapshot.accounts);
        for (const acc of accounts) {
          const used = acc.dailyUsageBytes;
          const limit = acc.dailyLimitBytes;
          rows.push({
            rowKey: `mega-${entry.kind}-${acc.accountId}`,
            entry,
            hosterLabel: entry.serviceLabel,
            modeLabel: entry.modeLabel,
            username: acc.identity,
            credentialLabel: "••••••",
            accountId: acc.accountId,
            checkable: true,
            disabled: entry.disabled || (entry.kind === "megadebrid-api"
              ? !settingsDraft.megaDebridApiEnabled || settingsDraft.megaDebridApiDisabledAccountIds.includes(acc.accountId)
              : !settingsDraft.megaDebridWebEnabled || settingsDraft.megaDebridWebDisabledAccountIds.includes(acc.accountId)),
            dailyUsedBytes: used,
            dailyLimitBytes: limit,
            dailyRemainingBytes: limit > 0 ? Math.max(0, limit - used) : 0,
            totalUsedBytes: acc.totalUsageBytes,
            toggleKind: "mega",
            editTarget: {
              type: "mega",
              rowKey: `mega-${entry.kind}-${acc.accountId}`,
              kind: entry.kind,
              service: entry.service as "megadebrid-api" | "megadebrid-web",
              accountId: acc.accountId
            }
          });
        }
      } else if (entry.kind === "debridlink-api") {
        for (const key of entry.debridLinkKeys) {
          rows.push({
            rowKey: `dl-${key.id}`,
            entry,
            hosterLabel: entry.serviceLabel,
            modeLabel: entry.modeLabel,
            username: "",
            credentialLabel: "API-Key",
            accountId: key.id,
            checkable: true,
            disabled: entry.disabled || settingsDraft.debridLinkDisabledKeyIds.includes(key.id),
            dailyUsedBytes: key.dailyUsedBytes,
            dailyLimitBytes: key.dailyLimitBytes,
            dailyRemainingBytes: key.dailyLimitBytes > 0 ? Math.max(0, key.dailyLimitBytes - key.dailyUsedBytes) : 0,
            totalUsedBytes: key.totalUsedBytes,
            toggleKind: "dl",
            dlKey: key,
            editTarget: {
              type: "debridlink",
              rowKey: `dl-${key.id}`,
              kind: "debridlink-api",
              service: "debridlink",
              keyId: key.id
            }
          });
        }
      } else {
        const serviceAccountId = entry.kind === "deepbrid-api"
          ? accountsOfKind(entry.kind, snapshot.accounts)[0]?.accountId || "svc-deepbrid"
          : null;
        rows.push({
          rowKey: `svc-${entry.service}`,
          entry,
          hosterLabel: entry.serviceLabel,
          modeLabel: entry.modeLabel,
          username: getStoredAccountUsername(entry.kind, snapshot.accounts),
          credentialLabel: getAccountCredentialLabel(entry.kind),
          accountId: serviceAccountId,
          checkable: serviceAccountId !== null,
          disabled: entry.disabled,
          dailyUsedBytes: entry.dailyUsedBytes,
          dailyLimitBytes: entry.dailyLimitBytes,
          dailyRemainingBytes: entry.dailyLimitBytes > 0 ? Math.max(0, entry.dailyRemainingBytes ?? 0) : 0,
          totalUsedBytes: entry.totalUsedBytes,
          toggleKind: "single",
          editTarget: {
            type: "single",
            rowKey: `svc-${entry.service}`,
            kind: entry.kind as SingleAccountKind,
            service: entry.service,
            provider: entry.provider,
            accountId: serviceAccountId || undefined
          }
        });
      }
    }
    return rows.map((row) => {
      const pending = pendingAccountToggles[row.rowKey];
      if (!pending) return row;
      const disabled = !pending.enabled;
      return {
        ...row,
        disabled,
        entry: {
          ...row.entry,
          disabled,
          statusLabel: disabled ? "Deaktiviert" : "Aktiviert"
        }
      };
    });
  }, [configuredAccounts, pendingAccountToggles, settingsDraft, snapshot.accounts]);

  const [accountStatusSort, setAccountStatusSort] = useState<"none" | "desc" | "asc">("none");
  const cycleAccountStatusSort = (): void => setAccountStatusSort((s) => (s === "none" ? "desc" : s === "desc" ? "asc" : "none"));

  useEffect(() => {
    const existingRowKeys = accountRows.map((row) => row.rowKey);
    setSelectedAccountRowKeys((current) => {
      const next = pruneAccountRowSelections([...current], existingRowKeys);
      if (next.length === current.size && next.every((rowKey) => current.has(rowKey))) {
        return current;
      }
      return new Set(next);
    });
  }, [accountRows]);
  const availableAccountOptions = useMemo(() => (
    getAvailableAccountOptions(ACCOUNT_OPTIONS, [...configuredAccountServices])
  ), [configuredAccountServices]);
  const accountEditOption = accountEditDialog ? findAccountOption(accountEditDialog.target.kind) : null;
  const accountEditRow = accountEditDialog ? accountRows.find((row) => row.rowKey === accountEditDialog.target.rowKey) ?? null : null;
  const accountEditStatus = accountEditRow?.accountId ? snapshot.settings.debridAccountStatuses?.[accountEditRow.accountId] ?? null : null;
  const accountEditQuickAction = accountEditOption ? getAccountQuickActionMeta(accountEditOption.kind) : null;
  const accountDialogOption = accountDialog?.kind ? findAccountOption(accountDialog.kind) : null;
  const accountDialogSelectableOptions = useMemo(() => {
    if (!accountDialog) {
      return [];
    }
    return getAccountDialogSelectableOptions(
      ACCOUNT_OPTIONS,
      availableAccountOptions,
      accountDialog.mode,
      accountDialog.service
    );
  }, [accountDialog, availableAccountOptions]);
  const accountDialogServiceFilters = useMemo(() => (
    sortAccountServices(accountDialogSelectableOptions.map((option) => option.serviceLabel))
  ), [accountDialogSelectableOptions]);
  const filteredAccountDialogOptions = useMemo(() => (
    filterAccountDialogOptions(accountDialogSelectableOptions, accountDialogSearch, accountDialogServiceFilter)
  ), [accountDialogSearch, accountDialogSelectableOptions, accountDialogServiceFilter]);
  const handleUpdateResult = async (
    result: UpdateCheckResult,
    source: "manual" | "startup",
    generation: number
  ): Promise<void> => {
    if (!mountedRef.current || !shouldApplyUpdateCheckResult(generation, updateCheckGenerationRef.current)) {
      return;
    }
    if (result.error) {
      if (source === "manual") { showToast(`Update-Check fehlgeschlagen: ${result.error}`, 2800); }
      return;
    }
    if (!result.updateAvailable) {
      setAvailableUpdate(null);
      setUpdateDialogOpen(false);
      setUpdateInstallProgress(null);
      if (source === "manual") { showToast(`Kein Update verfügbar (v${result.currentVersion})`, 2000); }
      return;
    }
    let changelogText = "";
    if (result.releaseNotes) {
      changelogText = result.releaseNotes
        .split("\n")
        .filter((line) => !/^#{1,6}\s/.test(line))
        .map((line) => line
          .replace(/\*\*([^*]+)\*\*/g, "$1")
          .replace(/\*([^*]+)\*/g, "$1")
          .replace(/`([^`]+)`/g, "$1"))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }
    setAvailableUpdate({
      ...result,
      releaseNotes: changelogText
    });
    setUpdateInstallProgress(null);
    setUpdateDialogOpen(shouldOpenUpdatePrompt(source, result.latestTag, dismissedUpdateTagRef.current));
  };

  const dismissUpdatePrompt = (): void => {
    if (availableUpdate?.latestTag) {
      dismissedUpdateTagRef.current = availableUpdate.latestTag;
    }
    setUpdateDialogOpen(false);
    setUpdateInstallProgress(null);
  };

  const installUpdate = async (): Promise<void> => {
    if (!availableUpdate) {
      return;
    }
    setUpdateDialogOpen(true);
    setUpdateInstallProgress({
      stage: "starting",
      percent: 0,
      downloadedBytes: 0,
      totalBytes: null,
      message: "Update wird vorbereitet"
    });
    try {
      const install = await window.rd.installUpdate();
      if (!mountedRef.current) {
        return;
      }
      if (install.started) {
        showToast("Stilles Update gestartet - App wird neu gestartet", 2600);
        return;
      }
      setUpdateInstallProgress({
        stage: "error",
        percent: null,
        downloadedBytes: 0,
        totalBytes: null,
        message: install.message
      });
      showToast(`Auto-Update fehlgeschlagen: ${install.message}`, 3200);
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }
      const message = String(error);
      setUpdateInstallProgress({
        stage: "error",
        percent: null,
        downloadedBytes: 0,
        totalBytes: null,
        message
      });
      showToast(`Auto-Update fehlgeschlagen: ${message}`, 3200);
    }
  };

  const onSaveSettings = async (): Promise<void> => {
    if (actionBusyRef.current) {
      return;
    }
    const revisionAtStart = settingsDraftRevisionRef.current;
    const themeChoiceAtStart = settingsThemeChoiceRef.current;
    const saveIntent = captureSettingsSaveIntent(revisionAtStart, normalizedSettingsDraft);
    const writeOnlyFieldsAtStart = new Set(writeOnlySettingsDirtyRef.current);
    settingsSaveInFlightRef.current = true;
    setSettingsSaveInFlight(true);
    setSettingsSaveState("saving");
    try {
      await performQuickAction(async () => {
        const result = await persistDraftSettings(themeChoiceAtStart, saveIntent, writeOnlyFieldsAtStart);
        const completion = resolveSettingsSaveCompletion(revisionAtStart, settingsDraftRevisionRef.current);
        if (completion.applyPersistedTheme) {
          applyTheme(resolveSettingsThemeChoice(
            themeChoiceAtStart,
            window.matchMedia("(prefers-color-scheme: light)").matches
          ));
        }
        setSettingsSaveState(completion.saveState);
        showToast(completion.toast, 1800);
      }, (error) => {
        setSettingsSaveState("error");
        showToast(`Einstellungen konnten nicht gespeichert werden: ${String(error)}`, 2800);
      });
    } finally {
      settingsSaveInFlightRef.current = false;
      setSettingsSaveInFlight(false);
    }
  };

  const discardSettingsChanges = (): void => {
    if (settingsSaveInFlightRef.current || actionBusyRef.current || settingsSaveState === "saving" || !settingsDirtyRef.current) {
      return;
    }
    const restored = createDiscardedSettingsState(persistedSettingsRef.current, persistedThemeChoiceRef.current);
    settingsDraftRevisionRef.current += 1;
    archivePasswordLoadGenerationRef.current += 1;
    panelDirtyRevisionRef.current = 0;
    writeOnlySettingsDirtyRef.current.clear();
    settingsDirtyRef.current = false;
    setSettingsDirty(false);
    setSettingsSaveState("clean");
    setSettingsDraft(restored.draft);
    setSettingsThemeChoice(restored.themeChoice);
    settingsThemeChoiceRef.current = restored.themeChoice;
    setSpeedLimitInput(restored.speedLimitInput);
    setScheduleSpeedInputs(restored.scheduleSpeedInputs);
    applyTheme(resolveSettingsThemeChoice(
      restored.themeChoice,
      window.matchMedia("(prefers-color-scheme: light)").matches
    ));
    showToast("Ungespeicherte Änderungen verworfen", 1800);
    if (settingsSubTab === "extract") {
      const generation = archivePasswordLoadGenerationRef.current;
      void window.rd.getArchivePasswordList().then(({ passwords }) => {
        if (archivePasswordLoadGenerationRef.current !== generation || writeOnlySettingsDirtyRef.current.has("archivePasswordList")) {
          return;
        }
        setSettingsDraft((current) => ({ ...current, archivePasswordList: passwords }));
      }).catch(() => undefined);
    }
  };

  const onOpenRealDebridLogin = async (): Promise<void> => {
    await performQuickAction(async () => {
      await persistDraftSettings();
      await window.rd.openRealDebridLogin();
      showToast("Real-Debrid Login-Fenster geöffnet", 2200);
    }, (error) => {
      showToast(formatAccountOperationError("Real-Debrid Login fehlgeschlagen", error), 3200);
    });
  };

  const onOpenAllDebridLogin = async (): Promise<void> => {
    await performQuickAction(async () => {
      await persistDraftSettings();
      await window.rd.openAllDebridLogin();
      showToast("AllDebrid Login-Fenster geöffnet", 2200);
    }, (error) => {
      showToast(formatAccountOperationError("AllDebrid Login fehlgeschlagen", error), 3200);
    });
  };

  const onImportBestDebridCookies = async (): Promise<void> => {
    await performQuickAction(async () => {
      await persistDraftSettings();
      const count = await window.rd.importBestDebridCookies();
      if (count > 0) {
        showToast(`${count} BestDebrid-Cookies importiert`, 2200);
      } else {
        showToast("Keine Cookie-Datei ausgewählt", 2200);
      }
    }, (error) => {
      showToast(`BestDebrid Cookie-Import fehlgeschlagen: ${String(error)}`, 2800);
    });
  };

  const applyPersistedSettings = (
    result: RendererSettings,
    preserveWriteOnlyValues = true,
    themeChoice: SettingsThemeChoice = result.themePreference
  ): void => {
    persistedSettingsRef.current = result;
    persistedThemeChoiceRef.current = themeChoice;
    if (!preserveWriteOnlyValues) {
      archivePasswordLoadGenerationRef.current += 1;
    }
    setSettingsDraft((current) => createSettingsDraft(result, preserveWriteOnlyValues ? current : undefined));
    if (result.columnOrder?.length) {
      columnOrderPersistenceRef.current?.applyAuthoritative(result.columnOrder);
    }
    writeOnlySettingsDirtyRef.current.clear();
    settingsDirtyRef.current = false;
    panelDirtyRevisionRef.current = 0;
    setSettingsDirty(false);
    setSettingsSaveState("clean");
    setSettingsThemeChoice(themeChoice);
    settingsThemeChoiceRef.current = themeChoice;
    applyTheme(resolveSettingsThemeChoice(
      themeChoice,
      window.matchMedia("(prefers-color-scheme: light)").matches
    ));
  };

  const syncLiveProviderUsageSettings = (result: RendererSettings): void => {
    persistedSettingsRef.current = result;
    setSnapshot((prev) => ({ ...prev, settings: result }));
    if (!settingsDirtyRef.current) {
      applyPersistedSettings(result);
      return;
    }
    setSettingsDraft((prev) => ({
      ...prev,
      totalDownloadedAllTime: Math.max(prev.totalDownloadedAllTime, result.totalDownloadedAllTime),
      providerDailyUsageDay: result.providerDailyUsageDay,
      providerDailyUsageBytes: { ...(result.providerDailyUsageBytes || {}) },
      providerTotalUsageBytes: { ...(result.providerTotalUsageBytes || {}) },
      debridLinkApiKeyDailyUsageBytes: { ...(result.debridLinkApiKeyDailyUsageBytes || {}) },
      debridLinkApiKeyTotalUsageBytes: { ...(result.debridLinkApiKeyTotalUsageBytes || {}) },
      megaDebridAccountDailyUsageBytes: { ...(result.megaDebridAccountDailyUsageBytes || {}) },
      megaDebridAccountTotalUsageBytes: { ...(result.megaDebridAccountTotalUsageBytes || {}) }
    }));
  };

  const runAccountQuickAction = async (action: AccountQuickAction, accountId?: string | null): Promise<void> => {
    switch (action) {
      case "realdebrid-login":
        if (!accountId) throw new Error("Der ausgewählte Real-Debrid-Account wurde nicht gefunden.");
        await window.rd.openRealDebridLogin({ accountId });
        showToast("Real-Debrid Login-Fenster geöffnet", 2200);
        return;
      case "bestdebrid-cookies": {
        const count = await window.rd.importBestDebridCookies();
        showToast(count > 0 ? `${count} BestDebrid-Cookies importiert` : "Keine Cookie-Datei ausgewählt", 2200);
        return;
      }
      case "alldebrid-login":
        await window.rd.openAllDebridLogin();
        showToast("AllDebrid Login-Fenster geöffnet", 2200);
        return;
      case "alldebrid-status":
        await loadAllDebridHostInfo(false);
        return;
      default:
        return;
    }
  };

  const checkAccounts = useCallback(async (scope: "active" | "all"): Promise<void> => {
    setAccountCheckBusy(true);
    try {
      const statuses = await window.rd.checkDebridAccounts(scope);
      if (!statuses || statuses.length === 0) {
        showToast(scope === "active" ? "Keine aktiven prüfbaren Accounts konfiguriert." : "Keine prüfbaren Accounts konfiguriert.", 3200);
      } else {
        const valid = statuses.filter((st) => st.valid).length;
        const premium = statuses.filter((st) => st.isPremium).length;
        const label = scope === "active" ? "Aktive Accounts" : "Alle Accounts";
        showToast(`${label}: ${valid}/${statuses.length} Login gültig, ${premium} mit Premium.`, 3600);
      }
    } catch (error) {
      showToast(formatAccountOperationError("Account-Check fehlgeschlagen", error), 3600);
    } finally {
      setAccountCheckBusy(false);
    }
  }, [showToast]);

  const openCreateAccountDialog = (): void => {
    setAccountDialogSearch("");
    setAccountDialogServiceFilter("all");
    setAccountDialog(createAccountDialogState("create", availableAccountOptions[0]?.kind ?? null, settingsDraft));
  };

  const openEditAccountDialog = (row: AccountTableRow): void => {
    try {
      setAccountEditSecretVisible({});
      setAccountEditSecretBusy(null);
      setAccountEditDialog(createAccountEditState(row.editTarget, snapshot.accounts));
    } catch (error) {
      showToast(String(error), 3200);
    }
  };

  const updateAccountDialogKind = useCallback((kind: AccountKind): void => {
    setAccountDialog((prev) => createAccountDialogState(prev?.mode ?? "create", kind, settingsDraft));
  }, [settingsDraft]);

  useEffect(() => {
    if (!accountDialog) {
      return;
    }
    const visibleKind = resolveVisibleAccountKind(
      accountDialog.kind,
      filteredAccountDialogOptions.map((option) => option.kind)
    );
    if (visibleKind === accountDialog.kind) {
      return;
    }
    if (visibleKind) {
      updateAccountDialogKind(visibleKind);
      return;
    }
    setAccountDialog((current) => current ? createAccountDialogState(current.mode, null, settingsDraft) : current);
  }, [accountDialog?.kind, filteredAccountDialogOptions, updateAccountDialogKind]);

  const closeAccountDialog = useCallback((): void => {
    setAccountDialog(null);
    setAccountDialogSearch("");
    setAccountDialogServiceFilter("all");
  }, []);

  const closeAccountEditDialog = useCallback((): void => {
    setAccountEditDialog(null);
    setAccountEditSecretVisible({});
    setAccountEditSecretBusy(null);
  }, []);

  const onSaveAccountEditDialog = async (quickAction?: AccountQuickAction): Promise<void> => {
    if (!accountEditDialog) {
      return;
    }
    const editSnapshot = accountEditDialog;
    const validationError = validateAccountEdit(editSnapshot, snapshot.accounts);
    if (validationError) {
      showToast(validationError, 2800);
      return;
    }
    await performQuickAction(async () => {
      await runQueuedSettingsMutation(async () => {
        await persistDraftSettingsDirect();
        const result = await window.rd.replaceAccount(buildAccountReplaceCommand(editSnapshot));
        setSnapshot((current) => ({ ...current, settings: result.settings, accounts: result.accounts }));
        applyPersistedSettings(result.settings);
        closeAccountEditDialog();
        if (quickAction) {
          await runAccountQuickAction(quickAction, editSnapshot.target.type === "single" ? editSnapshot.target.accountId : null);
        } else {
          showToast(`${findAccountOption(editSnapshot.target.kind).title} gespeichert`, 2200);
        }
      });
    }, (error) => {
      showToast(formatAccountOperationError("Account konnte nicht gespeichert werden", error), 3600);
    });
  };

  const onSaveAccountDialog = async (quickAction?: AccountQuickAction): Promise<void> => {
    if (!accountDialog) {
      return;
    }
    const dialogSnapshot = accountDialog;
    if (dialogSnapshot.kind === "debridlink-api" && parseDebridLinkApiKeys(dialogSnapshot.token).length !== 1) {
        showToast("Debrid-Link: Bitte genau einen API-Key eintragen.", 2800);
        return;
    }
    const validationError = validateAccountDialog(dialogSnapshot);
    if (validationError) {
      showToast(validationError, 2800);
      return;
    }
    const selectedOption = dialogSnapshot.kind ? findAccountOption(dialogSnapshot.kind) : null;
    await performQuickAction(async () => {
      await runQueuedSettingsMutation(async () => {
        await persistDraftSettingsDirect();
        if (dialogSnapshot.kind === "realdebrid-web") {
          const accountId = `rdw_${crypto.randomUUID().replace(/-/g, "")}`;
          const request = buildRealDebridWebCreateLoginRequest(dialogSnapshot, accountId);
          if (!request) throw new Error("Account-Payload ist ungültig");
          await window.rd.openRealDebridLogin(request);
          closeAccountDialog();
          showToast("Real-Debrid Login-Fenster geöffnet", 2200);
          return;
        }
        const command = buildAccountCreateCommand(dialogSnapshot);
        if (!command) throw new Error("Account-Payload ist ungültig");
        const result = await window.rd.createAccount(command);
        const persistedSettings = await window.rd.updateSettings(buildAccountCreateProviderOrderUpdate(result.settings));
        setSnapshot((current) => ({ ...current, settings: persistedSettings, accounts: result.accounts }));
        applyPersistedSettings(persistedSettings);
        closeAccountDialog();
        if (quickAction) {
          await runAccountQuickAction(quickAction, result.accountId);
        } else if (selectedOption) {
          showToast(`${selectedOption.title} gespeichert`, 2200);
        }
        void checkAccounts("active");
      });
    }, (error) => {
      showToast(formatAccountOperationError("Account konnte nicht gespeichert werden", error), 3600);
    });
  };

  const onResetAccountDailyUsage = async (entry: ConfiguredAccountEntry): Promise<void> => {
    await performQuickAction(async () => {
      const result = await window.rd.resetProviderDailyUsage(getAccountServiceProvider(entry.service));
      syncLiveProviderUsageSettings(result);
      showToast(`${entry.serviceLabel}: Tageszähler zurückgesetzt`, 2200);
    }, (error) => {
      showToast(`${entry.serviceLabel}: Reset fehlgeschlagen: ${String(error)}`, 3200);
    });
  };

  const onResetDebridLinkApiKeyDailyUsage = async (entry: ConfiguredAccountEntry, keyId: string, keyLabel: string): Promise<void> => {
    await performQuickAction(async () => {
      const result = await window.rd.resetDebridLinkApiKeyDailyUsage(keyId);
      syncLiveProviderUsageSettings(result);
      showToast(`${entry.serviceLabel} ${keyLabel}: Tageszähler zurückgesetzt`, 2200);
    }, (error) => {
      showToast(`${entry.serviceLabel} ${keyLabel}: Reset fehlgeschlagen: ${String(error)}`, 3200);
    });
  };

  const requestAccountToggle = (row: AccountTableRow, enabled: boolean): void => {
    const sequence = ++accountToggleSequenceRef.current;
    const requestedEnabled = resolveAccountToggleIntentEnabled(pendingAccountTogglesRef.current[row.rowKey]?.enabled, enabled);
    const subject = row.toggleKind === "dl" && row.dlKey
      ? `${row.entry.serviceLabel} ${row.dlKey.label}`
      : row.entry.serviceLabel;
    const check = requestedEnabled
      ? row.toggleKind === "rd" && row.accountId
        ? () => window.rd.checkAccountCredentials({ kind: row.entry.kind as "realdebrid-api" | "realdebrid-web", accountId: row.accountId || undefined })
        : row.toggleKind === "mega" && row.accountId
          ? () => window.rd.checkAccountCredentials({ kind: row.entry.kind as "megadebrid-api" | "megadebrid-web", accountId: row.accountId || undefined })
          : row.toggleKind === "dl" && row.dlKey
            ? () => window.rd.checkAccountCredentials({ kind: "debridlink-api", accountId: row.dlKey?.id })
            : row.entry.kind === "deepbrid-api"
              ? () => window.rd.checkAccountCredentials({ kind: "deepbrid-api", accountId: "svc-deepbrid" })
              : undefined
      : undefined;
    const nextPending = {
      ...pendingAccountTogglesRef.current,
      [row.rowKey]: { enabled: requestedEnabled, sequence }
    };
    pendingAccountTogglesRef.current = nextPending;
    setPendingAccountToggles(nextPending);
    void enqueueAccountToggleIntent(accountToggleQueueRef.current, {
      key: row.rowKey,
      target: getAccountToggleTarget(row),
      enabled: requestedEnabled,
      check
    }, {
      getSettings: () => persistedSettingsRef.current,
      persist: async (patch) => {
        const result = await window.rd.updateSettings(patch);
        persistedSettingsRef.current = result;
        setSnapshot((current) => ({ ...current, settings: result }));
        setSettingsDraft((current) => mergeAccountToggleSettings(current, result));
        return result;
      }
    }).then((result) => {
      if (result.status === "superseded") return;
      if (pendingAccountTogglesRef.current[row.rowKey]?.sequence !== sequence) return;
      const settledPending = { ...pendingAccountTogglesRef.current };
      delete settledPending[row.rowKey];
      pendingAccountTogglesRef.current = settledPending;
      setPendingAccountToggles(settledPending);
      if (result.status === "failed") {
        showToast(formatAccountOperationError(`${subject}: Umschalten fehlgeschlagen`, result.error), 3600);
        return;
      }
      showToast(`${subject} ${requestedEnabled ? "aktiviert" : "deaktiviert"}`, 2200);
    });
  };

  const onAccountRowQuickAction = async (row: AccountTableRow): Promise<void> => {
    const meta = getAccountQuickActionMeta(row.entry.kind);
    if (!meta) {
      return;
    }
    await performQuickAction(async () => {
      await runAccountQuickAction(meta.action, row.accountId);
    }, (error) => {
      showToast(formatAccountOperationError(`${row.entry.serviceLabel}: Aktion fehlgeschlagen`, error), 3600);
    });
  };

  const onRemoveDebridLinkKey = async (key: DebridLinkAccountKeyEntry): Promise<void> => {
    const confirmed = await askConfirmPrompt({ title: "Key entfernen", message: `Soll der Debrid-Link-Key ${key.masked} wirklich entfernt werden?`, confirmLabel: "Entfernen", danger: true });
    if (!confirmed) return;
    await performQuickAction(async () => {
      await runQueuedSettingsMutation(async () => {
        await persistDraftSettingsDirect();
        const result = await window.rd.deleteAccount({ action: "delete", kind: "debridlink-api", accountId: key.id });
        setSnapshot((current) => ({ ...current, settings: result.settings, accounts: result.accounts }));
        applyPersistedSettings(result.settings);
        showToast("Key entfernt", 2000);
      });
    }, (error) => { showToast(`Entfernen fehlgeschlagen: ${String(error)}`, 3200); });
  };

  const toggleAccountTableRow = (row: AccountTableRow, enabled = row.disabled): void => {
    setAccountContextMenu(null);
    requestAccountToggle(row, enabled);
  };

  const removeAccountTableRows = (rows: readonly AccountTableRow[]): void => {
    if (rows.length === 0) {
      return;
    }
    setAccountContextMenu(null);
    void (async () => {
      const row = rows[0];
      const checkedStatus = row.accountId ? snapshot.settings.debridAccountStatuses?.[row.accountId] : undefined;
      const username = rows.length === 1
        ? resolveAccountUsername(row.username, checkedStatus?.username || checkedStatus?.email)
        : "—";
      const confirmed = await askConfirmPrompt({
        title: rows.length === 1 ? `${row.hosterLabel} entfernen` : `${rows.length} Accounts entfernen`,
        message: rows.length === 1
          ? `Soll ${row.hosterLabel}${username !== "—" ? ` (${username})` : ""} wirklich entfernt werden?`
          : `Sollen die ausgewählten ${rows.length} Accounts wirklich entfernt werden?`,
        confirmLabel: "Entfernen",
        danger: true
      });
      if (!confirmed) {
        return;
      }
      await performQuickAction(async () => {
        await runQueuedSettingsMutation(async () => {
          await persistDraftSettingsDirect();
          for (const selectedRow of rows) {
            const result = await window.rd.deleteAccount(buildAccountDeleteCommand(selectedRow.editTarget));
            setSnapshot((current) => ({ ...current, settings: result.settings, accounts: result.accounts }));
            applyPersistedSettings(result.settings);
            if (selectedRow.entry.service === "alldebrid") {
              setAllDebridHostInfo(null);
            }
          }
          const removedRowKeys = new Set(rows.map((selectedRow) => selectedRow.rowKey));
          setSelectedAccountRowKeys((current) => new Set([...current].filter((rowKey) => !removedRowKeys.has(rowKey))));
          showToast(rows.length === 1 ? `${row.hosterLabel} entfernt` : `${rows.length} Accounts entfernt`, 2200);
        });
      }, (error) => {
        showToast(`${rows.length === 1 ? "Account" : "Accounts"} konnte${rows.length === 1 ? "" : "n"} nicht entfernt werden: ${String(error)}`, 3200);
      });
    })();
  };

  const removeAccountTableRow = (row: AccountTableRow): void => removeAccountTableRows([row]);

  const checkAccountTableRow = (row: AccountTableRow): void => {
    setAccountContextMenu(null);
    if ((row.entry.kind === "realdebrid-api" || row.entry.kind === "realdebrid-web") && row.accountId) {
      const kind = row.entry.kind;
      const accountId = row.accountId;
      void performQuickAction(async () => {
        const status = await window.rd.checkAccountCredentials({ kind, accountId });
        showToast(status.valid ? "Account erfolgreich geprüft" : status.message || "Zugangsdaten ungültig", 2600);
      }, (error) => showToast(formatAccountOperationError("Prüfung fehlgeschlagen", error), 3600));
      return;
    }
    if (row.checkable) {
      void checkAccounts("all");
      return;
    }
    if (getAccountQuickActionMeta(row.entry.kind)) {
      void onAccountRowQuickAction(row);
      return;
    }
    showToast("Für diesen Account ist keine direkte Statusprüfung verfügbar.", 2800);
  };

  const onCheckUpdates = async (): Promise<void> => {
    await performQuickAction(() => runLatestUpdateCheck(
      updateCheckGenerationRef,
      () => window.rd.checkUpdates(),
      (result, generation) => handleUpdateResult(result, "manual", generation)
    ), (error) => {
      showToast(`Update-Check fehlgeschlagen: ${String(error)}`, 2800);
    });
  };

  const runQueuedSettingsMutation = async <T,>(task: () => Promise<T>): Promise<T> => {
    const result = await accountToggleQueueRef.current.enqueue(`settings-mutation-${++settingsMutationSequenceRef.current}`, async () => task());
    if (result.status === "failed") throw result.error;
    if (result.status === "superseded") throw new Error("Einstellungsänderung wurde ersetzt");
    return result.value;
  };

  const persistDraftSettingsDirect = async (
    themeChoiceAtStart: SettingsThemeChoice = settingsThemeChoiceRef.current,
    intent = captureSettingsSaveIntent(settingsDraftRevisionRef.current, normalizedSettingsDraft),
    writeOnlyFields = new Set(writeOnlySettingsDirtyRef.current)
  ): Promise<RendererSettings> => {
    const rebasedDraft = mergeAccountToggleSettings(intent.draft, persistedSettingsRef.current);
    const update: RendererSettingsUpdate = {
      ...rebasedDraft,
      theme: resolveSettingsThemeChoice(themeChoiceAtStart, window.matchMedia("(prefers-color-scheme: light)").matches),
      themePreference: themeChoiceAtStart
    };
    if (!writeOnlyFields.has("archivePasswordList")) delete update.archivePasswordList;
    if (!writeOnlyFields.has("notifyUrl")) delete update.notifyUrl;
    const result = await window.rd.updateSettings(update);
    persistedSettingsRef.current = result;
    persistedThemeChoiceRef.current = result.themePreference;
    if (settingsDraftRevisionRef.current === intent.revision) {
      applyPersistedSettings(result);
    }
    return result;
  };

  const persistDraftSettings = async (
    themeChoiceAtStart: SettingsThemeChoice = settingsThemeChoiceRef.current,
    intent = captureSettingsSaveIntent(settingsDraftRevisionRef.current, normalizedSettingsDraft),
    writeOnlyFields = new Set(writeOnlySettingsDirtyRef.current)
  ): Promise<RendererSettings> => (
    runQueuedSettingsMutation(() => persistDraftSettingsDirect(themeChoiceAtStart, intent, writeOnlyFields))
  );

  const closeStartConflictPrompt = (result: { policy: Extract<DuplicatePolicy, "skip" | "overwrite">; applyToAll: boolean } | null): void => {
    const resolver = startConflictResolverRef.current;
    startConflictResolverRef.current = null;
    setStartConflictPrompt(null);
    if (resolver) {
      resolver(result);
    }
  };

  const askStartConflictDecision = (entry: StartConflictEntry): Promise<{ policy: Extract<DuplicatePolicy, "skip" | "overwrite">; applyToAll: boolean } | null> => {
    return new Promise((resolve) => {
      startConflictResolverRef.current = resolve;
      setStartConflictPrompt({
        entry,
        applyToAll: false
      });
    });
  };

  const pumpConfirmQueue = useCallback((): void => {
    if (confirmResolverRef.current) {
      return;
    }
    const next = confirmQueueRef.current.shift();
    if (!next) {
      return;
    }
    confirmResolverRef.current = next.resolve;
    setConfirmPrompt(next.prompt);
  }, []);

  const closeConfirmPrompt = useCallback((confirmed: boolean): void => {
    const resolver = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmPrompt(null);
    if (resolver) {
      resolver(confirmed);
    }
    pumpConfirmQueue();
  }, [pumpConfirmQueue]);

  const askConfirmPrompt = useCallback((prompt: ConfirmPromptState): Promise<boolean> => {
    return new Promise((resolve) => {
      confirmQueueRef.current.push({ prompt, resolve });
      pumpConfirmQueue();
    });
  }, [pumpConfirmQueue]);

  const closeBackupPassphraseDialog = useCallback((passphrase: string | null): void => {
    const resolver = backupPassphraseResolverRef.current;
    backupPassphraseResolverRef.current = null;
    setBackupPassphraseMode(null);
    resolver?.(passphrase);
  }, []);

  const askBackupPassphrase = useCallback((mode: BackupPassphraseMode): Promise<string | null> => {
    return new Promise((resolve) => {
      backupPassphraseResolverRef.current = resolve;
      setBackupPassphraseMode(mode);
    });
  }, []);

  const restoreHistoryEntries = useCallback(async (entryIds: string[]): Promise<void> => {
    const requested = new Set(entryIds);
    const entries = historyEntriesRef.current.filter((entry) => requested.has(entry.id));
    const urls = entries.flatMap((entry) => entry.urls ?? []);
    if (urls.length === 0) {
      showToast("Keine gespeicherten Links vorhanden");
      return;
    }
    try {
      const result = await window.rd.addLinks({
        rawText: urls.join("\n"),
        packageName: entries.length === 1 ? entries[0].name : "Verlaufsauswahl"
      });
      showToast(result.addedLinks > 0 ? `${result.addedLinks} Link(s) zur Queue hinzugefügt` : "Keine Links hinzugefügt");
    } catch {
      showToast("Fehler beim Hinzufügen");
    }
  }, [showToast]);

  const removeHistoryEntries = useCallback(async (entryIds: string[]): Promise<void> => {
    const requested = new Set(entryIds);
    const ids = historyEntriesRef.current.filter((entry) => requested.has(entry.id)).map((entry) => entry.id);
    if (ids.length === 0) {
      return;
    }
    const confirmed = await askConfirmPrompt({
      title: ids.length === 1 ? "Verlaufseintrag entfernen" : "Verlaufseinträge entfernen",
      message: ids.length === 1 ? "Diesen Eintrag aus dem Verlauf entfernen?" : `${ids.length} Einträge aus dem Verlauf entfernen?`,
      confirmLabel: "Entfernen",
      danger: true
    });
    if (!confirmed) {
      return;
    }
    try {
      await window.rd.removeHistoryEntries(ids);
    } catch {
      showToast(ids.length === 1 ? "Verlaufseintrag konnte nicht entfernt werden" : "Verlaufseinträge konnten nicht entfernt werden");
      await loadHistoryEntries();
      return;
    }
    const removed = new Set(ids);
    applyHistoryEntries(historyEntriesRef.current.filter((entry) => !removed.has(entry.id)));
    showToast(ids.length === 1 ? "Verlaufseintrag entfernt" : `${ids.length} Verlaufseinträge entfernt`);
  }, [applyHistoryEntries, askConfirmPrompt, loadHistoryEntries, showToast]);

  const clearHistoryEntries = useCallback(async (): Promise<void> => {
    if (historyEntriesRef.current.length === 0) {
      return;
    }
    const confirmed = await askConfirmPrompt({
      title: "Verlauf leeren",
      message: "Wirklich alle Einträge aus dem Verlauf entfernen?",
      confirmLabel: "Verlauf leeren",
      danger: true
    });
    if (!confirmed) {
      return;
    }
    try {
      await window.rd.clearHistory();
      applyHistoryEntries([]);
      showToast("Verlauf geleert");
    } catch {
      showToast("Verlauf konnte nicht geleert werden");
      await loadHistoryEntries();
    }
  }, [applyHistoryEntries, askConfirmPrompt, loadHistoryEntries, showToast]);

  const revealHistoryEntry = useCallback(async (entryId: string): Promise<void> => {
    try {
      const result = await window.rd.revealHistoryEntry(entryId);
      if (result.ok) {
        showToast("Zielordner geöffnet");
        return;
      }
      const messages = {
        "entry-not-found": "Verlaufseintrag wurde nicht gefunden",
        "invalid-output-dir": "Der gespeicherte Zielordner ist ungültig",
        "output-dir-missing": "Der gespeicherte Zielordner existiert nicht mehr",
        "output-dir-not-directory": "Das gespeicherte Ziel ist kein Ordner",
        "open-failed": "Zielordner konnte nicht geöffnet werden"
      } as const;
      showToast(messages[result.reason]);
    } catch {
      showToast("Zielordner konnte nicht geöffnet werden");
    }
  }, [showToast]);

  const historyActions = useMemo<HistoryViewActions>(() => ({
    onFilterChange: setHistoryFilter,
    onQueryChange: setHistoryQuery,
    onToggleSelection: (entryId) => {
      setSelectedHistoryIds((current) => {
        const next = new Set(current);
        if (next.has(entryId)) {
          next.delete(entryId);
        } else {
          next.add(entryId);
        }
        return next;
      });
    },
    onToggleSelectAll: (visibleIds) => {
      setSelectedHistoryIds((current) => toggleHistoryPageSelection(current, visibleIds));
    },
    onToggleExpansion: (entryId) => {
      setHistoryExpandedIds((current) => {
        const next = new Set(current);
        if (next.has(entryId)) {
          next.delete(entryId);
        } else {
          next.add(entryId);
        }
        return next;
      });
    },
    onRestore: (entryIds) => { void restoreHistoryEntries(entryIds); },
    onReveal: (entryId) => { void revealHistoryEntry(entryId); },
    onRemove: (entryIds) => { void removeHistoryEntries(entryIds); },
    onClearSelection: () => setSelectedHistoryIds(new Set()),
    onClearHistory: () => { void clearHistoryEntries(); },
    onVisiblePageChange: (ids) => {
      historyVisibleIdsRef.current = ids;
      setHistoryVisiblePageCount(ids.length);
    },
    onContextMenu: (entryId, x, y) => {
      setSelectedHistoryIds((current) => resolveHistoryContextSelection(current, entryId));
      setHistoryCtxMenu({ entryId, x, y });
    }
  }), [clearHistoryEntries, removeHistoryEntries, restoreHistoryEntries, revealHistoryEntry]);

  const onStartDownloads = async (): Promise<void> => {
    await performQuickAction(async () => {
      if (totalConfiguredAccounts === 0) {
        setTab("settings");
        showToast("Bitte zuerst mindestens einen Hoster-Account eintragen", 3000);
        return;
      }

      await persistDraftSettings();
      const conflicts = await window.rd.getStartConflicts();
      let skipped = 0;
      let overwritten = 0;
      let rememberedPolicy: Extract<DuplicatePolicy, "skip" | "overwrite"> | null = null;

      if (settingsDraft.autoSkipExtracted && conflicts.length > 0) {
        rememberedPolicy = "skip";
      }

      for (const conflict of conflicts) {
        let decisionPolicy = rememberedPolicy;
        if (!decisionPolicy) {
          const decision = await askStartConflictDecision(conflict);
          if (!decision) {
            showToast("Start abgebrochen", 1800);
            return;
          }
          decisionPolicy = decision.policy;
          if (decision.applyToAll) {
            rememberedPolicy = decision.policy;
          }
        }

        const result = await window.rd.resolveStartConflict(conflict.packageId, decisionPolicy);
        if (result.skipped) {
          skipped += 1;
        }
        if (result.overwritten) {
          overwritten += 1;
        }
      }

      if (conflicts.length > 0 && !settingsDraft.autoSkipExtracted) {
        showToast(`Konflikte gelöst: ${overwritten} überschrieben, ${skipped} übersprungen`, 2800);
      }

      await window.rd.start();
    });
  };

  const collapseNewPackages = async (existingIds: Set<string>): Promise<void> => {
    const fresh = await window.rd.getSnapshot();
    const newIds = Object.keys(fresh.session.packages).filter((id) => !existingIds.has(id));
    if (newIds.length > 0) {
      setCollapsedPackages((prev) => {
        const next = { ...prev };
        for (const id of newIds) { next[id] = true; }
        return next;
      });
    }
  };

  const mergeCollectorResult = (result: CollectorInspectionResult, enrichment = false): boolean => {
    const current = collectorPackagesRef.current;
    const decision = mergeCollectorPackagesWithinCapacity(current, result.packages, enrichment);
    if (!decision.ok) {
      setCollectorError(decision.message);
      if (!enrichment) showToast(decision.message, 3200);
      return false;
    }
    const merged = decision.value;
    const nextCollapsed = reconcileCollectorCollapsedPackageIds(
      collapsedCollectorPackageIdsRef.current,
      current,
      merged.packages,
      result.packages,
      !enrichment
    );
    const nextState = {
      packages: merged.packages,
      collapsedPackageIds: [...nextCollapsed]
    };
    const persistenceBudget = enrichment && collectorPersistenceBudgetRef.current
      ? advanceCollectorPersistenceBudget(
        collectorPersistenceBudgetRef.current,
        merged.persistenceDelta,
        nextState.collapsedPackageIds
      )
      : createCollectorPersistenceBudget(nextState);
    if (!persistenceBudget.ok) {
      setCollectorError(persistenceBudget.message);
      if (!enrichment) showToast(persistenceBudget.message, 3200);
      return false;
    }
    collectorPersistenceBudgetRef.current = persistenceBudget.nextBudget;
    collectorPackagesRef.current = merged.packages;
    collapsedCollectorPackageIdsRef.current = nextCollapsed;
    setCollectorPackages(merged.packages);
    setCollapsedCollectorPackageIds(nextCollapsed);
    return true;
  };

  const reconcileCollectorDependentState = (packages: CollectorPackage[]): void => {
    setSelectedCollectorLinkIds((current) => reconcileCollectorSelectionWithPackages(current, packages));
    const nextCollapsed = reconcileCollectorCollapsedPackageIdsWithPackages(collapsedCollectorPackageIdsRef.current, packages);
    collapsedCollectorPackageIdsRef.current = nextCollapsed;
    setCollapsedCollectorPackageIds(nextCollapsed);
    pruneCollectorEnrichmentGenerations(
      collectorEnrichmentGenerationsRef.current,
      packages,
      collectorEnrichmentRequestsRef.current.values()
    );
    const budget = createCollectorPersistenceBudget({
      packages,
      collapsedPackageIds: [...nextCollapsed]
    });
    collectorPersistenceBudgetRef.current = budget.ok ? budget.nextBudget : null;
  };

  const applyCollectorCollapsedPackageIds = (next: Set<string>): boolean => {
    const state = {
      packages: collectorPackagesRef.current,
      collapsedPackageIds: [...next]
    };
    const budget = collectorPersistenceBudgetRef.current
      ? advanceCollectorPersistenceBudget(
        collectorPersistenceBudgetRef.current,
        {
          links: [],
          packages: [],
          removedPackageIds: [],
          packageCount: collectorPersistenceBudgetRef.current.packageCount
        },
        state.collapsedPackageIds
      )
      : createCollectorPersistenceBudget(state);
    if (!budget.ok) {
      setCollectorError(budget.message);
      return false;
    }
    collectorPersistenceBudgetRef.current = budget.nextBudget;
    collapsedCollectorPackageIdsRef.current = next;
    setCollapsedCollectorPackageIds(next);
    return true;
  };

  const enrichCollectorResult = (packages: CollectorPackage[]): void => {
    if (packages.length === 0) {
      return;
    }
    const generations = beginCollectorEnrichment(packages, collectorEnrichmentGenerationsRef.current);
    const requestId = `collector-${Date.now().toString(36)}-${crypto.randomUUID()}`;
    collectorEnrichmentRequestsRef.current.set(requestId, generations);
    setCollectorAnalyzingCount((current) => current + 1);
    void window.rd.enrichCollectorPackages({ requestId, packages }).then((result) => {
      mergeCollectorResult({
        ...result,
        packages: filterCurrentCollectorEnrichment(
          result.packages,
          generations,
          collectorEnrichmentGenerationsRef.current
        )
      }, true);
    }).catch((error) => {
      if (filterCurrentCollectorEnrichment(packages, generations, collectorEnrichmentGenerationsRef.current).length > 0) {
        setCollectorError(`Metadatenprüfung fehlgeschlagen: ${String(error)}`);
      }
    }).finally(() => {
      collectorEnrichmentRequestsRef.current.delete(requestId);
      pruneCollectorEnrichmentGenerations(
        collectorEnrichmentGenerationsRef.current,
        collectorPackagesRef.current,
        collectorEnrichmentRequestsRef.current.values()
      );
      setCollectorAnalyzingCount((current) => Math.max(0, current - 1));
    });
  };

  useEffect(() => window.rd.onCollectorEnrichmentProgress((progress: CollectorEnrichmentProgress) => {
    const generations = collectorEnrichmentRequestsRef.current.get(progress.requestId);
    if (!generations) return;
    mergeCollectorResult({
      ...progress.result,
      packages: filterCurrentCollectorEnrichment(
        progress.result.packages,
        generations,
        collectorEnrichmentGenerationsRef.current
      )
    }, true);
  }), []);

  useEffect(() => {
    let cancelled = false;
    const coordinator = createCollectorPersistenceCoordinator(
      (state) => window.rd.saveCollectorState(state),
      300,
      (failure) => {
        if (cancelled) return;
        setCollectorError(`Linksammler konnte nicht gespeichert werden: ${String(failure.error)}`);
        if (!failure.rollbackState) return;
        collectorPackagesRef.current = failure.rollbackState.packages;
        collapsedCollectorPackageIdsRef.current = new Set(failure.rollbackState.collapsedPackageIds);
        setCollectorPackages(failure.rollbackState.packages);
        setCollapsedCollectorPackageIds(new Set(failure.rollbackState.collapsedPackageIds));
        setSelectedCollectorLinkIds((current) => reconcileCollectorSelectionWithPackages(current, failure.rollbackState?.packages ?? []));
        pruneCollectorEnrichmentGenerations(
          collectorEnrichmentGenerationsRef.current,
          failure.rollbackState.packages,
          collectorEnrichmentRequestsRef.current.values()
        );
        const rollbackBudget = createCollectorPersistenceBudget(failure.rollbackState);
        collectorPersistenceBudgetRef.current = rollbackBudget.ok ? rollbackBudget.nextBudget : null;
      }
    );
    collectorPersistenceCoordinatorRef.current = coordinator;
    const saveBeforeUnload = (event: BeforeUnloadEvent): void => {
      const saved = guardCollectorBeforeUnload(event, {
        hydrated: collectorPersistenceHydratedRef.current,
        currentState: {
          packages: collectorPackagesRef.current,
          collapsedPackageIds: [...collapsedCollectorPackageIdsRef.current]
        },
        getPersistedStateSync: window.rd.getCollectorStateSync,
        saveStateSync: window.rd.saveCollectorStateSync
      });
      if (!saved) setCollectorError("Linksammler konnte nicht gespeichert werden: Speichern fehlgeschlagen");
    };
    window.addEventListener("beforeunload", saveBeforeUnload);
    void window.rd.getCollectorState().then((persisted) => {
      if (cancelled) return;
      const hydration = resolveCollectorLateHydration(persisted, {
        packages: collectorPackagesRef.current,
        collapsedPackageIds: [...collapsedCollectorPackageIdsRef.current]
      });
      const restored = hydration.ok ? hydration.state : hydration.rollbackState;
      collectorPackagesRef.current = restored.packages;
      collapsedCollectorPackageIdsRef.current = new Set(restored.collapsedPackageIds);
      setCollectorPackages(restored.packages);
      setCollapsedCollectorPackageIds(new Set(restored.collapsedPackageIds));
      setSelectedCollectorLinkIds((current) => reconcileCollectorSelectionWithPackages(current, restored.packages));
      pruneCollectorEnrichmentGenerations(
        collectorEnrichmentGenerationsRef.current,
        restored.packages,
        collectorEnrichmentRequestsRef.current.values()
      );
      const restoredBudget = createCollectorPersistenceBudget(restored);
      collectorPersistenceBudgetRef.current = restoredBudget.ok ? restoredBudget.nextBudget : null;
      collectorPersistenceHydratedRef.current = true;
      coordinator.setBaseline(persisted);
      if (!hydration.ok) {
        setCollectorError(hydration.message);
        if (restored.packages.length > 0) enrichCollectorResult(restored.packages);
        return;
      }
      coordinator.schedule(restored);
      if (restored.packages.length > 0) enrichCollectorResult(restored.packages);
    }).catch((error) => {
      if (cancelled) return;
      setCollectorError(`Linksammler konnte nicht wiederhergestellt werden: ${String(error)}`);
    });
    return () => {
      cancelled = true;
      window.removeEventListener("beforeunload", saveBeforeUnload);
      if (!collectorPersistenceHydratedRef.current) {
        coordinator.dispose();
        return;
      }
      coordinator.schedule({
        packages: collectorPackagesRef.current,
        collapsedPackageIds: [...collapsedCollectorPackageIdsRef.current]
      });
      void coordinator.flush().finally(() => coordinator.dispose());
    };
  }, []);

  useEffect(() => {
    collapsedCollectorPackageIdsRef.current = collapsedCollectorPackageIds;
    if (!collectorPersistenceHydratedRef.current) return;
    collectorPersistenceCoordinatorRef.current?.schedule({
      packages: collectorPackages,
      collapsedPackageIds: [...collapsedCollectorPackageIds]
    });
  }, [collapsedCollectorPackageIds, collectorPackages]);

  const importCollectorText = async (rawText: string): Promise<void> => {
    if (!rawText.trim()) {
      showToast("Keine Links eingegeben", 2200);
      return;
    }
    setCollectorError("");
    setCollectorAnalyzingCount((current) => current + 1);
    try {
      const prepared = await window.rd.prepareCollectorText({ rawText, addedAt: Date.now() });
      if (prepared.packages.length === 0) {
        const message = "Keine gültigen Links gefunden";
        setCollectorError(message);
        showToast(message, 2600);
        return;
      }
      if (!mergeCollectorResult(prepared)) return;
      setCollectorFilter("all");
      setTab("collector");
      const linkCount = prepared.packages.reduce((sum, pkg) => sum + pkg.links.length, 0);
      showToast(`${prepared.packages.length} Paket(e), ${linkCount} Link(s) gesammelt`);
      enrichCollectorResult(prepared.packages);
    } catch (error) {
      const message = `Links konnten nicht vorbereitet werden: ${String(error)}`;
      setCollectorError(message);
      showToast(message, 2800);
    } finally {
      setCollectorAnalyzingCount((current) => Math.max(0, current - 1));
    }
  };

  importCollectorTextRef.current = importCollectorText;

  const importCollectorContainers = async (filePaths: string[]): Promise<CollectorInspectionResult | null> => {
    if (filePaths.length === 0) {
      return null;
    }
    setCollectorError("");
    setCollectorAnalyzingCount((current) => current + 1);
    try {
      const prepared = await window.rd.prepareCollectorContainers(filePaths, Date.now());
      if (prepared.packages.length === 0) {
        const message = "Keine gültigen Links in den DLC-Dateien gefunden";
        setCollectorError(message);
        showToast(message, 3000);
        return prepared;
      }
      if (!mergeCollectorResult(prepared)) return prepared;
      setCollectorFilter("all");
      setTab("collector");
      const linkCount = prepared.packages.reduce((sum, pkg) => sum + pkg.links.length, 0);
      showToast(`DLC gesammelt: ${prepared.packages.length} Paket(e), ${linkCount} Link(s)`);
      enrichCollectorResult(prepared.packages);
      return prepared;
    } catch (error) {
      const message = `Fehler beim DLC-Import: ${String(error)}`;
      setCollectorError(message);
      showToast(message, 2800);
      return null;
    } finally {
      setCollectorAnalyzingCount((current) => Math.max(0, current - 1));
    }
  };

  const onImportDlc = async (): Promise<void> => {
    const files = await window.rd.pickContainers();
    if (files.length > 0) {
      await importCollectorContainers(files);
    }
  };

  const submitCollectorPackages = async (packages: CollectorPackage[]): Promise<void> => {
    const transferable = packages.flatMap((pkg) => {
      const links = pkg.links.filter((link) => link.availability !== "offline");
      return links.length > 0 ? [{ ...pkg, links }] : [];
    });
    const linkIds = new Set(transferable.flatMap((pkg) => pkg.links.map((link) => link.id)));
    if (linkIds.size === 0) {
      showToast("Keine übertragbaren Links ausgewählt", 2400);
      return;
    }
    await performQuickAction(async () => {
      const existingIds = new Set(Object.keys(snapshotRef.current.session.packages));
      const result = await window.rd.addLinks({ rawText: serializeCollectorPackages(transferable), packageName: "" });
      if (result.addedLinks !== linkIds.size) {
        showToast(`${result.addedLinks} von ${linkIds.size} Link(s) übergeben; Sammlung bleibt erhalten`, 3200);
        return;
      }
      const nextCollectorPackages = removeCollectorLinks(collectorPackagesRef.current, linkIds);
      collectorPackagesRef.current = nextCollectorPackages;
      setCollectorPackages(nextCollectorPackages);
      reconcileCollectorDependentState(nextCollectorPackages);
      setTab("downloads");
      showToast(`${result.addedPackages} Paket(e), ${result.addedLinks} Link(s) übergeben`);
      if (snapshotRef.current.settings.collapseNewPackages) {
        await collapseNewPackages(existingIds);
      }
    }, (error) => {
      const message = `Übergabe fehlgeschlagen: ${String(error)}`;
      setCollectorError(message);
      showToast(message, 2800);
    });
  };

  const onExportPackageSelection = async (packageIds: string[]): Promise<void> => {
    closeMenus();
    await performQuickAction(async () => {
      const result = await window.rd.exportPackageSelection(packageIds);
      if (result.saved) {
        showToast(`${result.packageCount} Paket(e), ${result.linkCount} Link(s) exportiert`, 2800);
      }
    }, (error) => {
      showToast(`Export fehlgeschlagen: ${String(error)}`, 2600);
    });
  };

  const onExportItemSelection = async (itemIds: string[]): Promise<void> => {
    closeMenus();
    await performQuickAction(async () => {
      const result = await window.rd.exportItemSelection(itemIds);
      if (result.saved) {
        showToast(`${result.packageCount} Paket(e), ${result.linkCount} Link(s) exportiert`, 2800);
      }
    }, (error) => {
      showToast(`Export fehlgeschlagen: ${String(error)}`, 2600);
    });
  };

  onImportDlcRef.current = onImportDlc;

  const onDrop = async (event: DragEvent<HTMLElement>): Promise<void> => {
    event.preventDefault();
    dragDepthRef.current = 0;
    dragOverRef.current = false;
    setDragOver(false);
    const hasFiles = event.dataTransfer.types.includes("Files");
    const hasUri = event.dataTransfer.types.includes("text/uri-list");
    if (!hasFiles && !hasUri) { return; }
    const files = Array.from(event.dataTransfer.files ?? []) as File[];
    const hasDlc = files.some((file) => file.name.toLowerCase().endsWith(".dlc"));
    const importFiles = files.filter((f) => /\.(json|txt)$/i.test(f.name));
    const droppedText = event.dataTransfer.getData("text/plain") || event.dataTransfer.getData("text/uri-list") || "";
    if (hasDlc) {
      try {
        const mode = tabRef.current === "collector" ? "collector" : "downloads";
        const existingIds = new Set(Object.keys(snapshotRef.current.session.packages));
        const routed = await routeDroppedDlcFiles(files, mode, window.rd.getPathForDroppedFile, {
          addContainers: window.rd.addContainers,
          inspectContainers: (filePaths) => importCollectorContainers(filePaths)
        });
        if (routed.kind === "empty") {
          showToast("DLC-Dateipfad konnte nicht gelesen werden", 2800);
        } else if (routed.kind === "downloads" && routed.result.addedLinks > 0) {
          setTab("downloads");
          showToast(`Drag-and-Drop: ${routed.result.addedPackages} Paket(e), ${routed.result.addedLinks} Link(s)`);
          if (snapshotRef.current.settings.collapseNewPackages) { await collapseNewPackages(existingIds); }
        } else if (routed.kind === "downloads") {
          showToast("Keine gültigen Links in den DLC-Dateien gefunden", 3000);
        }
      } catch (error) {
        showToast(`Fehler bei Drag-and-Drop: ${String(error)}`, 2600);
      }
    } else if (importFiles.length > 0) {
      try {
        const text = (await Promise.all(importFiles.map((file) => file.text()))).join("\n");
        await importCollectorText(text);
      } catch (error) {
        showToast(`Fehler bei Drag-and-Drop: ${String(error)}`, 2600);
      }
    } else if (droppedText.trim()) {
      await importCollectorText(droppedText);
    }
  };

  const onExportQueue = async (): Promise<void> => {
    await performQuickAction(async () => {
      const result = await window.rd.exportQueue();
      if (result.saved) {
        showToast("Queue exportiert");
      }
    }, (error) => {
      showToast(`Export fehlgeschlagen: ${String(error)}`, 2600);
    });
  };

  const onImportQueue = async (): Promise<void> => {
    if (actionBusyRef.current) {
      return;
    }

    setCollectorError("");
    actionBusyRef.current = true;
    setActionBusy(true);

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.txt";

    const releasePickerBusy = (): void => {
      actionBusyRef.current = false;
      setActionBusy(false);
    };

    const onWindowFocus = (): void => {
      clearImportQueueFocusListener();
      if (!input.files || input.files.length === 0) {
        releasePickerBusy();
      }
    };

    input.onchange = async () => {
      clearImportQueueFocusListener();
      const file = input.files?.[0];
      if (!file) {
        releasePickerBusy();
        return;
      }
      releasePickerBusy();
      try {
        const text = await file.text();
        await importCollectorText(text);
      } catch (error) {
        showToast(`Import fehlgeschlagen: ${String(error)}`, 2600);
      }
    };

    clearImportQueueFocusListener();
    importQueueFocusHandlerRef.current = onWindowFocus;
    window.addEventListener("focus", onWindowFocus, { once: true });
    input.click();
  };

  const setBool = (key: keyof RendererSettingsDraft, value: boolean): void => {
    settingsDraftRevisionRef.current += 1;
    panelDirtyRevisionRef.current += 1;
    settingsDirtyRef.current = true;
    setSettingsDirty(true);
    setSettingsSaveState("dirty");
    setSettingsDraft((prev) => ({ ...prev, [key]: value }));
  };
  const setText = (key: keyof RendererSettingsDraft, value: string): void => {
    if (key === "archivePasswordList" || key === "notifyUrl") writeOnlySettingsDirtyRef.current.add(key);
    settingsDraftRevisionRef.current += 1;
    panelDirtyRevisionRef.current += 1;
    settingsDirtyRef.current = true;
    setSettingsDirty(true);
    setSettingsSaveState("dirty");
    setSettingsDraft((prev) => ({ ...prev, [key]: value }));
  };
  const setNum = (key: keyof RendererSettingsDraft, value: number): void => {
    settingsDraftRevisionRef.current += 1;
    panelDirtyRevisionRef.current += 1;
    settingsDirtyRef.current = true;
    setSettingsDirty(true);
    setSettingsSaveState("dirty");
    setSettingsDraft((prev) => ({ ...prev, [key]: value }));
  };
  const setSpeedLimitMbps = (value: number): void => {
    const mbps = Number.isFinite(value) ? Math.max(0, value) : 0;
    settingsDraftRevisionRef.current += 1;
    panelDirtyRevisionRef.current += 1;
    settingsDirtyRef.current = true;
    setSettingsDirty(true);
    setSettingsSaveState("dirty");
    setSettingsDraft((prev) => ({ ...prev, speedLimitKbps: Math.floor(mbps * 1024) }));
  };

  const performQuickAction = async (
    action: () => Promise<unknown>,
    onError?: (error: unknown) => void
  ): Promise<void> => {
    if (actionBusyRef.current) {
      return;
    }
    actionBusyRef.current = true;
    setActionBusy(true);
    try {
      await action();
    } catch (error) {
      if (onError) {
        onError(error);
      } else {
        showToast(`Fehler: ${String(error)}`, 2600);
      }
    } finally {
      if (actionUnlockTimerRef.current) {
        clearTimeout(actionUnlockTimerRef.current);
      }
      actionUnlockTimerRef.current = setTimeout(() => {
        if (!mountedRef.current) {
          actionUnlockTimerRef.current = null;
          return;
        }
        actionBusyRef.current = false;
        setActionBusy(false);
        actionUnlockTimerRef.current = null;
      }, 80);
    }
  };

  const commitPackageOrder = useCallback((order: string[]): void => {
    const requestId = packageOrderStateRef.current.begin(order);
    packageOrderRef.current = [...order];
    setSnapshot((current) => ({ ...current, session: { ...current.session, packageOrder: [...order] } }));
    void window.rd.reorderPackages(order).then(() => {
      packageOrderStateRef.current.confirm(requestId);
    }).catch((error) => {
      const restoredOrder = packageOrderStateRef.current.reject(requestId);
      if (!restoredOrder) return;
      packageOrderRef.current = restoredOrder;
      setDownloadsSortRevision((revision) => revision + 1);
      setSnapshot((current) => ({ ...current, session: { ...current.session, packageOrder: restoredOrder } }));
      showToast(`Sortierung fehlgeschlagen: ${String(error)}`, 2400);
    });
  }, [showToast]);

  const movePackage = useCallback((packageId: string, direction: "up" | "down") => {
    const currentOrder = packageOrderRef.current;
    const order = [...currentOrder];
    const idx = order.indexOf(packageId);
    if (idx < 0) { return; }
    const target = direction === "up" ? idx - 1 : idx + 1;
    if (target < 0 || target >= order.length) { return; }
    [order[idx], order[target]] = [order[target], order[idx]];
    setDownloadsSortDescending(false);
    commitPackageOrder(order);
  }, [commitPackageOrder]);

  const openCollectorInput = (): void => {
    setCollectorError("");
    setCollectorInput({ draft: "" });
  };

  const commitCollectorInput = (): void => {
    if (!collectorInput) {
      return;
    }
    const draft = collectorInput.draft;
    setCollectorInput(null);
    void importCollectorText(draft);
  };

  const setCollectorLinkSelection = (linkId: string, selected: boolean): void => {
    setSelectedCollectorLinkIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(linkId);
      else next.delete(linkId);
      return next;
    });
  };

  const setCollectorPackageSelection = (packageId: string, selected: boolean): void => {
    const row = collectorViewModel.packages.find((entry) => entry.id === packageId);
    if (row) {
      setSelectedCollectorLinkIds((current) => selectCollectorPackageLinks(current, row, selected));
    }
  };

  const toggleCollectorPackageCollapse = (packageId: string): void => {
    const next = new Set(collapsedCollectorPackageIdsRef.current);
    if (next.has(packageId)) next.delete(packageId);
    else next.add(packageId);
    applyCollectorCollapsedPackageIds(next);
  };

  const toggleAllCollectorPackages = (): void => {
    const packageIds = collectorPackagesRef.current.map((pkg) => pkg.id);
    applyCollectorCollapsedPackageIds(packageIds.some((id) => !collapsedCollectorPackageIdsRef.current.has(id))
      ? new Set(packageIds)
      : new Set());
  };

  const removeSelectedCollectorLinks = (): void => {
    const removedIds = new Set(collectorViewModel.selectedIds);
    if (removedIds.size === 0) {
      return;
    }
    void askConfirmPrompt({
      title: "Ausgewählte Links löschen",
      message: "Die ausgewählten Links werden aus der Sammlung entfernt. Dieser Schritt kann nicht rückgängig gemacht werden.",
      confirmLabel: "Links löschen",
      danger: true
    }).then((confirmed) => {
      if (!confirmed) {
        return;
      }
      const nextCollectorPackages = removeCollectorLinks(collectorPackagesRef.current, removedIds);
      collectorPackagesRef.current = nextCollectorPackages;
      setCollectorPackages(nextCollectorPackages);
      reconcileCollectorDependentState(nextCollectorPackages);
      setCollectorError("");
    });
  };

  const onPackageStartEdit = useCallback((packageId: string, packageName: string): void => {
    setEditingPackageId(packageId);
    setEditingName(packageName);
  }, []);

  const onPackageFinishEdit = useCallback((packageId: string, currentName: string, nextName: string): void => {
    let shouldRename = false;
    setEditingPackageId((prev) => {
      if (prev !== packageId) return prev;
      shouldRename = true;
      return null;
    });
    if (shouldRename) {
      const normalized = nextName.trim();
      if (normalized && normalized !== currentName.trim()) {
        void window.rd.renamePackage(packageId, normalized).catch((error) => {
          showToast(`Umbenennen fehlgeschlagen: ${String(error)}`, 2400);
        });
      }
    }
  }, [showToast]);

  const onPackageToggleCollapse = useCallback((packageId: string): void => {
    setDownloadDisclosureRevision((current) => current + 1);
    setCollapsedPackages((prev) => {
      const nextCollapsed = !(prev[packageId] ?? false);
      return { ...prev, [packageId]: nextCollapsed };
    });
  }, []);

  const onPackageCancel = useCallback((packageId: string): void => {
    setSnapshot((prev) => {
      if (!prev) { return prev; }
      const nextPackages = { ...prev.session.packages };
      const nextItems = { ...prev.session.items };
      const pkg = nextPackages[packageId];
      if (pkg) {
        for (const itemId of pkg.itemIds) {
          delete nextItems[itemId];
        }
        delete nextPackages[packageId];
      }
      return {
        ...prev,
        session: {
          ...prev.session,
          packages: nextPackages,
          items: nextItems,
          packageOrder: prev.session.packageOrder.filter((id) => id !== packageId)
        }
      };
    });
    void window.rd.cancelPackage(packageId).catch((error) => {
      showToast(`Paket-Löschung fehlgeschlagen: ${String(error)}`, 2400);
    });
  }, [showToast]);

  const onPackageMoveUp = useCallback((packageId: string): void => {
    movePackage(packageId, "up");
  }, [movePackage]);

  const onPackageMoveDown = useCallback((packageId: string): void => {
    movePackage(packageId, "down");
  }, [movePackage]);

  const moveSelectedPackages = useCallback((direction: "up" | "down", ids: Iterable<string> = selectedIds) => {
    const currentOrder = packageOrderRef.current;
    const selPkgs = new Set([...ids].filter((id) => snapshot.session.packages[id]));
    if (selPkgs.size === 0) return;
    const order = [...currentOrder];
    if (direction === "up") {
      for (let i = 0; i < order.length; i++) {
        if (selPkgs.has(order[i]) && i > 0 && !selPkgs.has(order[i - 1])) {
          [order[i - 1], order[i]] = [order[i], order[i - 1]];
        }
      }
    } else {
      for (let i = order.length - 1; i >= 0; i--) {
        if (selPkgs.has(order[i]) && i < order.length - 1 && !selPkgs.has(order[i + 1])) {
          [order[i], order[i + 1]] = [order[i + 1], order[i]];
        }
      }
    }
    const unchanged = order.length === currentOrder.length && order.every((id, idx) => id === currentOrder[idx]);
    if (unchanged) return;
    setDownloadsSortDescending(false);
    commitPackageOrder(order);
  }, [commitPackageOrder, selectedIds, snapshot.session.packages]);

  const onPackageToggle = useCallback((packageId: string): void => {
    let previousEnabled: boolean | null = null;
    setSnapshot((prev) => {
      const pkg = prev.session.packages[packageId];
      if (!pkg) {
        return prev;
      }
      previousEnabled = pkg.enabled;
      const nextEnabled = !pkg.enabled;
      const nextItems = { ...prev.session.items };
      if (!nextEnabled) {
        for (const itemId of pkg.itemIds) {
          const item = nextItems[itemId];
          if (!item) {
            continue;
          }
          if (item.status === "queued" || item.status === "reconnect_wait") {
            nextItems[itemId] = {
              ...item,
              fullStatus: "Paket gestoppt",
              updatedAt: Date.now()
            };
          }
        }
      } else {
        for (const itemId of pkg.itemIds) {
          const item = nextItems[itemId];
          if (!item) {
            continue;
          }
          if (item.status === "queued" && item.fullStatus === "Paket gestoppt") {
            nextItems[itemId] = {
              ...item,
              fullStatus: "Wartet",
              updatedAt: Date.now()
            };
          }
        }
      }
      const nextPkgStatus = !nextEnabled
        ? (pkg.status === "downloading" || pkg.status === "extracting" ? "paused" : pkg.status)
        : (pkg.status === "paused" ? "queued" : pkg.status);
      const nextSnapshot: UiSnapshot = {
        ...prev,
        session: {
          ...prev.session,
          items: nextItems,
          packages: {
            ...prev.session.packages,
            [packageId]: {
              ...pkg,
              enabled: nextEnabled,
              status: nextPkgStatus,
              updatedAt: Date.now()
            }
          },
          updatedAt: Date.now()
        }
      };
      latestStateRef.current = nextSnapshot;
      return nextSnapshot;
    });
    void window.rd.togglePackage(packageId).catch((error) => {
      if (previousEnabled !== null) {
        const revertedEnabled = previousEnabled;
        setSnapshot((prev) => {
          const pkg = prev.session.packages[packageId];
          if (!pkg) {
            return prev;
          }
          const revertedSnapshot: UiSnapshot = {
            ...prev,
            session: {
              ...prev.session,
              packages: {
                ...prev.session.packages,
                [packageId]: {
                  ...pkg,
                  enabled: revertedEnabled,
                  status: revertedEnabled && pkg.status === "paused" ? "queued" : pkg.status,
                  updatedAt: Date.now()
                }
              },
              updatedAt: Date.now()
            }
          };
          latestStateRef.current = revertedSnapshot;
          return revertedSnapshot;
        });
      }
      showToast(`Paket-Umschalten fehlgeschlagen: ${String(error)}`, 2400);
    });
  }, [showToast]);

  const onPackageRemoveItem = useCallback((itemId: string): void => {
    setSnapshot((prev) => {
      if (!prev) { return prev; }
      const item = prev.session.items[itemId];
      if (!item) { return prev; }
      const nextItems = { ...prev.session.items };
      delete nextItems[itemId];
      const nextPackages = { ...prev.session.packages };
      const pkg = nextPackages[item.packageId];
      if (pkg) {
        const nextItemIds = pkg.itemIds.filter((id) => id !== itemId);
        if (nextItemIds.length === 0) {
          delete nextPackages[item.packageId];
          return {
            ...prev,
            session: {
              ...prev.session,
              packages: nextPackages,
              items: nextItems,
              packageOrder: prev.session.packageOrder.filter((id) => id !== item.packageId)
            }
          };
        }
        nextPackages[item.packageId] = { ...pkg, itemIds: nextItemIds };
      }
      return { ...prev, session: { ...prev.session, packages: nextPackages, items: nextItems } };
    });
    void window.rd.removeItem(itemId).catch((error) => {
      showToast(`Entfernen fehlgeschlagen: ${String(error)}`, 2400);
    });
  }, [showToast]);

  const onPackageContextMenu = useCallback((packageId: string, itemId: string | undefined, x: number, y: number): void => {
    const clickedId = itemId ?? packageId;
    setSelectedIds((prev) => {
      if (prev.has(clickedId)) return prev;
      return new Set([clickedId]);
    });
    setContextMenu({ x, y, packageId, itemId });
  }, []);

  const speedHistoryRef = useRef<{ time: number; speed: number }[]>([]);
  const speedSparklineStateRef = useRef<DownloadSpeedHistoryState>({ history: [], display: 0 });
  const dragSelectRef = useRef(false);
  const dragAnchorRef = useRef<string | null>(null);
  const dragDidMoveRef = useRef(false);
  const lastClickedIdRef = useRef<string | null>(null);
  const dragMouseUpRef = useRef<(() => void) | null>(null);

  const visibleOrderIds = downloadsViewCore.visibleRowIds;

  // Keep a ref of the currently VISIBLE ids so the (deps-[]) Ctrl+A keyboard
  // handler can select exactly what the user sees — not the whole unfiltered map.
  const visibleOrderIdsRef = useRef<string[]>(visibleOrderIds);
  visibleOrderIdsRef.current = visibleOrderIds;

  const onSelectId = useCallback((id: string, ctrlKey: boolean, shiftKey: boolean): void => {
    if (dragDidMoveRef.current) return;
    if (shiftKey && lastClickedIdRef.current) {
      const anchorIdx = visibleOrderIds.indexOf(lastClickedIdRef.current);
      const targetIdx = visibleOrderIds.indexOf(id);
      if (anchorIdx !== -1 && targetIdx !== -1) {
        const from = Math.min(anchorIdx, targetIdx);
        const to = Math.max(anchorIdx, targetIdx);
        const rangeIds = visibleOrderIds.slice(from, to + 1);
        setSelectedIds((prev) => {
          const next = ctrlKey ? new Set(prev) : new Set<string>();
          for (const rid of rangeIds) next.add(rid);
          return next;
        });
        return;
      }
    }
    lastClickedIdRef.current = id;
    setSelectedIds((prev) => {
      if (ctrlKey) {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      }
      if (prev.size === 1 && prev.has(id)) return new Set();
      return new Set([id]);
    });
  }, [visibleOrderIds]);

  const onSelectMouseDown = useCallback((id: string, e: React.MouseEvent): void => {
    if (!e.ctrlKey || e.button !== 0) return;
    e.preventDefault();
    if (dragMouseUpRef.current) {
      window.removeEventListener("mouseup", dragMouseUpRef.current);
    }
    dragSelectRef.current = true;
    dragAnchorRef.current = id;
    dragDidMoveRef.current = false;
    const onUp = (): void => {
      dragSelectRef.current = false;
      dragAnchorRef.current = null;
      dragDidMoveRef.current = false;
      window.removeEventListener("mouseup", onUp);
      if (dragMouseUpRef.current === onUp) {
        dragMouseUpRef.current = null;
      }
    };
    dragMouseUpRef.current = onUp;
    window.addEventListener("mouseup", onUp);
  }, []);

  useEffect(() => () => {
    if (dragMouseUpRef.current) {
      window.removeEventListener("mouseup", dragMouseUpRef.current);
      dragMouseUpRef.current = null;
    }
  }, []);

  const onSelectMouseEnter = useCallback((id: string): void => {
    if (!dragSelectRef.current) return;
    if (!dragDidMoveRef.current) {
      dragDidMoveRef.current = true;
      const anchor = dragAnchorRef.current;
      if (anchor) {
        setSelectedIds((prev) => { if (prev.has(anchor)) return prev; const next = new Set(prev); next.add(anchor); return next; });
      }
    }
    setSelectedIds((prev) => { if (prev.has(id)) return prev; const next = new Set(prev); next.add(id); return next; });
  }, []);

  const showLinksPopup = useCallback((packageId: string, itemId?: string): void => {
    const sel = selectedIds;
    const currentPackages = snapshotRef.current.session.packages;
    const currentItems = snapshotRef.current.session.items;
    if (sel.size > 1) {
      const allLinks: { name: string; url: string }[] = [];
      for (const id of sel) {
        const pkg = currentPackages[id];
        if (pkg) {
          for (const iid of pkg.itemIds) {
            const item = currentItems[iid];
            if (item) allLinks.push({ name: item.fileName, url: item.url });
          }
        } else {
          const item = currentItems[id];
          if (item) allLinks.push({ name: item.fileName, url: item.url });
        }
      }
      setLinkPopup({ title: `${sel.size} ausgewählt`, links: allLinks, isPackage: allLinks.length > 1 });
      setContextMenu(null);
      return;
    }
    const pkg = currentPackages[packageId];
    if (!pkg) { return; }
    if (itemId) {
      const item = currentItems[itemId];
      if (item) {
        setLinkPopup({ title: item.fileName, links: [{ name: item.fileName, url: item.url }], isPackage: false });
      }
    } else {
      const links = pkg.itemIds
        .map((id) => currentItems[id])
        .filter(Boolean)
        .map((item) => ({ name: item.fileName, url: item.url }));
      setLinkPopup({ title: pkg.name, links, isPackage: true });
    }
    setContextMenu(null);
  }, [selectedIds]);

  const schedules = settingsDraft.bandwidthSchedules ?? [];

  useEffect(() => {
    setScheduleSpeedInputs((prev) => {
      const syncFromSettings = !settingsDirtyRef.current;
      let changed = false;
      const next: Record<string, string> = {};
      for (let index = 0; index < schedules.length; index += 1) {
        const schedule = schedules[index];
        const key = schedule.id || `schedule-${index}`;
        const normalized = formatMbpsInputFromKbps(schedule.speedLimitKbps);
        if (syncFromSettings || !Object.prototype.hasOwnProperty.call(prev, key)) {
          next[key] = normalized;
          if (prev[key] !== normalized) {
            changed = true;
          }
        } else {
          next[key] = prev[key];
        }
      }
      const prevKeys = Object.keys(prev);
      if (prevKeys.length !== Object.keys(next).length) {
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [schedules, settingsDirty]);

  const addSchedule = (): void => {
    settingsDraftRevisionRef.current += 1;
    panelDirtyRevisionRef.current += 1;
    settingsDirtyRef.current = true;
    setSettingsDirty(true);
    setSettingsSaveState("dirty");
    setSettingsDraft((prev) => ({
      ...prev,
      bandwidthSchedules: [...(prev.bandwidthSchedules ?? []), { id: createScheduleId(), startHour: 0, endHour: 8, speedLimitKbps: 0, enabled: true }]
    }));
  };
  const removeSchedule = (idx: number): void => {
    settingsDraftRevisionRef.current += 1;
    panelDirtyRevisionRef.current += 1;
    settingsDirtyRef.current = true;
    setSettingsDirty(true);
    setSettingsSaveState("dirty");
    setSettingsDraft((prev) => ({
      ...prev,
      bandwidthSchedules: (prev.bandwidthSchedules ?? []).filter((_, i) => i !== idx)
    }));
  };
  const updateSchedule = (idx: number, field: keyof BandwidthScheduleEntry, value: number | boolean): void => {
    settingsDraftRevisionRef.current += 1;
    panelDirtyRevisionRef.current += 1;
    settingsDirtyRef.current = true;
    setSettingsDirty(true);
    setSettingsSaveState("dirty");
    setSettingsDraft((prev) => ({
      ...prev,
      bandwidthSchedules: (prev.bandwidthSchedules ?? []).map((s, i) => i === idx ? { ...s, [field]: value } : s)
    }));
  };

  const applyTheme = (theme: AppTheme): void => {
    document.documentElement.setAttribute("data-theme", theme);
  };

  const closeMenus = (): void => {
    setOpenMenu(null);
    setOpenSubmenu(null);
  };

  const executeDeleteSelection = useCallback((ids: Set<string>): void => {
    const current = snapshotRef.current;
    const promises: Promise<void>[] = [];
    for (const id of ids) {
      if (current.session.items[id]) promises.push(window.rd.removeItem(id));
      else if (current.session.packages[id]) promises.push(window.rd.cancelPackage(id));
    }
    void Promise.all(promises).catch(() => {});
    setSelectedIds(new Set());
  }, []);

  const requestRemoveOfflinePackages = useCallback((): void => {
    setContextMenu(null);
    void performQuickAction(async () => {
      const { session, settings } = snapshotRef.current;
      const candidates = getPackagesWithOfflineLinks(session.packageOrder, session.packages, session.items);
      if (candidates.length === 0) return;
      const english = normalizeLanguage(settings.language) === "en";
      const count = candidates.length.toLocaleString(english ? "en-US" : "de-DE");
      const packageLabel = english ? (candidates.length === 1 ? "package" : "packages") : (candidates.length === 1 ? "Paket" : "Pakete");
      const confirmed = await askConfirmPrompt({
        title: english ? "Remove packages with offline links" : "Pakete mit Offline-Links entfernen",
        message: english
          ? `Remove ${count} ${packageLabel} with at least one offline link from the entire download queue?\n\nEach package is removed in full, including its online links. This applies regardless of filters or selection. Active downloads in these packages will stop. Downloaded files are kept.`
          : `${count} ${packageLabel} mit mindestens einem Offline-Link aus der gesamten Downloadliste entfernen?\n\nDie Pakete werden vollständig entfernt, einschließlich ihrer Online-Links. Das gilt unabhängig von Filtern und Auswahl. Laufende Downloads in diesen Paketen werden gestoppt. Bereits heruntergeladene Dateien bleiben erhalten.`,
        confirmLabel: english ? "Remove packages" : "Pakete entfernen",
        cancelLabel: english ? "Cancel" : "Abbrechen",
        danger: true
      });
      if (!confirmed) return;
      const removed = await window.rd.removeOfflinePackages(candidates);
      const removedCount = removed.toLocaleString(english ? "en-US" : "de-DE");
      showToast(english ? `${removedCount} ${removed === 1 ? "package" : "packages"} removed. Downloaded files were kept.` : `${removedCount} ${removed === 1 ? "Paket" : "Pakete"} entfernt. Heruntergeladene Dateien wurden behalten.`, 3200);
    });
  }, [askConfirmPrompt, performQuickAction, showToast]);

  const requestDeleteSelection = useCallback((): void => {
    if (selectedIds.size === 0) return;
    if (!settingsDraft.confirmDeleteSelection) {
      executeDeleteSelection(selectedIds);
      return;
    }
    setDeleteConfirm({ ids: new Set(selectedIds), dontAsk: false });
  }, [selectedIds, settingsDraft.confirmDeleteSelection, executeDeleteSelection]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === "Escape") {
        const target = e.target as HTMLElement;
        const inputType = target.tagName === "INPUT" ? (target as HTMLInputElement).type : "";
        const selectionScope = resolveEscapeSelectionScope(tabRef.current, settingsSubTab, target.tagName, inputType);
        if (selectionScope) {
          if (document.querySelector(".ctx-menu") || document.querySelector(".modal-backdrop")) return;
          if (selectionScope === "downloads") setSelectedIds(new Set());
          else if (selectionScope === "collector") setSelectedCollectorLinkIds(new Set());
          else if (selectionScope === "history") setSelectedHistoryIds(new Set());
          else if (selectedAccountRowKeys.size > 0) {
            setSelectedAccountRowKeys(new Set());
            releaseAccountSelectionFocus(document.activeElement instanceof HTMLElement ? document.activeElement : null);
          }
        }
      }
      if (e.key === "Delete" && tabRef.current === "downloads" && selectedIds.size > 0) {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        e.preventDefault();
        requestDeleteSelection();
      }
    };
    const onDown = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;
      if (!shouldClearDownloadSelection(target)) return;
      setSelectedIds(new Set());
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); };
  }, [requestDeleteSelection, selectedAccountRowKeys, selectedIds, settingsSubTab]);

  const onExportBackup = async (): Promise<void> => {
    closeMenus();
    await performQuickAction(async () => {
      const result = await runLocalBackupExport(window.rd, askBackupPassphrase);
      if (result.saved) {
        showToast("Sicherung exportiert");
      }
    }, (error) => {
      showToast(`Sicherung fehlgeschlagen: ${String(error)}`, 2600);
    });
  };

  const onImportBackup = async (): Promise<void> => {
    closeMenus();
    await performQuickAction(async () => {
      await runQueuedSettingsMutation(async () => {
        const result = await runLocalBackupImport(window.rd, askBackupPassphrase);
        if (result.restored) {
          showToast(result.message, 4000);
          if (!result.relaunch) {
            const fresh = await window.rd.getSnapshot();
            applyPersistedSettings(fresh.settings, false);
          }
        } else if (result.message !== "Abgebrochen") {
          showToast(`Sicherung laden fehlgeschlagen: ${result.message}`, 3000);
        }
      });
    }, (error) => {
      showToast(`Sicherung laden fehlgeschlagen: ${String(error)}`, 2600);
    });
  };

  const onCreateOnlineBackup = async (): Promise<void> => {
    closeMenus();
    setOnlineBackupDialog({ mode: "export", key: "", busy: true, error: "" });
    try {
      const result = await window.rd.exportOnlineBackup();
      setOnlineBackupDialog({ mode: "export", key: result.key, busy: false, error: "" });
      showToast("Online-Schlüssel erstellt", 2600);
    } catch {
      setOnlineBackupDialog({ mode: "export", key: "", busy: false, error: "Online-Sicherung konnte nicht erstellt werden." });
    }
  };

  const onOpenOnlineBackupImport = (): void => {
    closeMenus();
    setOnlineBackupDialog({ mode: "import", key: "", busy: false, error: "" });
  };

  const onImportOnlineBackup = async (): Promise<void> => {
    const key = onlineBackupDialog?.mode === "import" ? onlineBackupDialog.key.trim() : "";
    if (!key) return;
    setOnlineBackupDialog((current) => current ? { ...current, busy: true, error: "" } : current);
    try {
      await runQueuedSettingsMutation(async () => {
        const result = await window.rd.importOnlineBackup(key);
        const fresh = await window.rd.getSnapshot();
        applyPersistedSettings(fresh.settings, false);
        setOnlineBackupDialog(null);
        showToast(result.message, 4000);
      });
    } catch {
      setOnlineBackupDialog((current) => current ? { ...current, busy: false, error: "Online-Sicherung konnte nicht geladen werden. Schlüssel prüfen und erneut versuchen." } : current);
    }
  };

  const onCopyOnlineBackupKey = async (): Promise<void> => {
    if (!onlineBackupDialog?.key) return;
    try {
      if (!(await window.rd.writeClipboardText(onlineBackupDialog.key))) throw new Error("clipboard_write_rejected");
      showToast("Online-Schlüssel kopiert", 2200);
    } catch {
      showToast("Schlüssel konnte nicht kopiert werden", 2600);
    }
  };

  const onExportSupportBundle = async (): Promise<void> => {
    closeMenus();
    await performQuickAction(async () => {
      const result = await window.rd.exportSupportBundle();
      if (result.saved) {
        showToast("Support-Bundle exportiert", 2600);
      }
    }, (error) => {
      showToast(`Support-Bundle fehlgeschlagen: ${String(error)}`, 2800);
    });
  };

  const onToggleSupportTrace = async (): Promise<void> => {
    closeMenus();
    const nextEnabled = !supportTraceEnabled;
    await performQuickAction(async () => {
      const result = await window.rd.setTraceEnabled(nextEnabled, "UI support toggle", 120);
      setSupportTraceEnabled(result.enabled);
      showToast(result.enabled ? "Support-Trace für 2 Stunden aktiviert" : "Support-Trace deaktiviert", 2600);
    }, (error) => {
      showToast(`Support-Trace fehlgeschlagen: ${String(error)}`, 2800);
    });
  };

  const onRunDebugSetupCheck = async (): Promise<void> => {
    closeMenus();
    try {
      const setup = await window.rd.getDebugSetupCheck();
      const warningText = setup.warnings.length > 0 ? `Warnungen: ${setup.warnings.length}` : "Keine akuten Warnungen";
      const reachabilityText = setup.localOnly ? "Nur lokal gebunden" : "Remote-fähig konfiguriert";
      const details = buildDebugSetupDetails(setup);
      await askConfirmPrompt({
        title: "Debug-Setup prüfen",
        message: `${warningText}\n${reachabilityText}\nHost: ${setup.host}:${setup.port}`,
        confirmLabel: "Schließen",
        cancelLabel: "Schließen",
        details,
        detailsLabel: "Details anzeigen"
      });
    } catch (error) {
      showToast(`Debug-Setup-Check fehlgeschlagen: ${String(error)}`, 3000);
    }
  };

  const onShowRecentErrors = async (): Promise<void> => {
    closeMenus();
    try {
      const entries = await window.rd.getRecentErrors();
      const errorCount = entries.filter((e) => e.level === "ERROR").length;
      const warnCount = entries.filter((e) => e.level === "WARN").length;
      const details = entries.map((e) => `${e.ts} [${e.level}] ${e.message}`).join("\n");
      const copy = await askConfirmPrompt({
        title: "Letzte Fehler",
        message: entries.length === 0
          ? "Keine Fehler oder Warnungen seit dem App-Start aufgezeichnet."
          : `${errorCount} Fehler, ${warnCount} Warnungen (letzte ${entries.length})`,
        confirmLabel: entries.length > 0 ? "In Zwischenablage kopieren" : "Schließen",
        cancelLabel: "Schließen",
        details: details || undefined,
        detailsLabel: "Einträge anzeigen"
      });
      if (copy && entries.length > 0) {
        if (!(await window.rd.writeClipboardText(details))) throw new Error("clipboard_write_rejected");
        showToast("Fehlerliste kopiert", 2600);
      }
    } catch (error) {
      showToast(String(error).includes("clipboard_write_rejected") ? "Kopieren fehlgeschlagen" : `Fehler-Ansicht fehlgeschlagen: ${String(error)}`, 3000);
    }
  };

  const onRotateDebugToken = async (): Promise<void> => {
    closeMenus();
    const confirmed = await askConfirmPrompt({
      title: "Debug-Token rotieren",
      message: "Das aktuelle Debug-Token wird ersetzt. Externe Debug-Links mit altem Token funktionieren danach nicht mehr.",
      confirmLabel: "Token rotieren",
      danger: true
    });
    if (!confirmed) {
      return;
    }
    await performQuickAction(async () => {
      const result = await window.rd.rotateDebugToken();
      showToast(`Debug-Token rotiert: ${result.path}`, 4200);
    }, (error) => {
      showToast(`Token-Rotation fehlgeschlagen: ${String(error)}`, 3000);
    });
  };

  const applyRemoteDiagInfo = (info: RemoteDiagnosticsInfo): void => {
    setRemoteDiag(info);
    setRdHostMode(info.status.localOnly ? "local" : "network");
    setRdPublicHost(info.publicHost || (info.status.localOnly ? "" : (info.suggestedHosts[0] || "")));
    setRdPort(String(info.status.port || 9868));
    setRdAllowlist(info.allowlist.join("\n"));
    setRdName(info.name || "");
  };

  const onOpenRemoteDiagnostics = async (): Promise<void> => {
    closeMenus();
    try {
      const info = await window.rd.getRemoteDiagnostics();
      applyRemoteDiagInfo(info);
      setRemoteDiagOpen(true);
    } catch (error) {
      showToast(`Ferndiagnose-Status fehlgeschlagen: ${String(error)}`, 3000);
    }
  };

  const onSubmitRemoteDiagnostics = async (): Promise<void> => {
    const port = Number(rdPort) || 9868;
    const allowlist = rdAllowlist.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
    if (rdHostMode === "network" && allowlist.length === 0) {
      showToast("Netzwerkmodus braucht mindestens eine IP oder CIDR in der Allowlist", 3600);
      return;
    }
    setRemoteDiagBusy(true);
    try {
      const info = await window.rd.enableRemoteDiagnostics({
        hostMode: rdHostMode,
        publicHost: rdPublicHost,
        port,
        allowlist,
        name: rdName
      });
      applyRemoteDiagInfo(info);
      showToast(info.status.running ? "Ferndiagnose aktiv" : "Ferndiagnose konfiguriert", 2600);
    } catch (error) {
      showToast(`Aktivieren fehlgeschlagen: ${String(error)}`, 3600);
    } finally {
      setRemoteDiagBusy(false);
    }
  };

  const onDisableRemoteDiagnostics = async (): Promise<void> => {
    setRemoteDiagBusy(true);
    try {
      const info = await window.rd.disableRemoteDiagnostics();
      applyRemoteDiagInfo(info);
      showToast("Ferndiagnose deaktiviert", 2400);
    } catch (error) {
      showToast(`Deaktivieren fehlgeschlagen: ${String(error)}`, 3000);
    } finally {
      setRemoteDiagBusy(false);
    }
  };

  const onRotateRemoteDiagnosticsToken = async (): Promise<void> => {
    setRemoteDiagBusy(true);
    try {
      const info = await window.rd.rotateRemoteDiagnosticsToken();
      applyRemoteDiagInfo(info);
      showToast("Neues Token - alter Verbindungscode ist ungueltig", 3000);
    } catch (error) {
      showToast(`Token-Rotation fehlgeschlagen: ${String(error)}`, 3000);
    } finally {
      setRemoteDiagBusy(false);
    }
  };

  const onCopyRemoteDiagnosticsCode = async (): Promise<void> => {
    if (!remoteDiag?.code) {
      return;
    }
    try {
      if (!(await window.rd.writeClipboardText(remoteDiag.code))) throw new Error("clipboard_write_rejected");
      showToast("Verbindungscode kopiert", 2200);
    } catch {
      showToast("Kopieren fehlgeschlagen", 2200);
    }
  };

  const onMenuRestart = (): void => {
    closeMenus();
    void window.rd.restart();
  };

  const onMenuQuit = (): void => {
    closeMenus();
    void window.rd.quit();
  };

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent): void => {
      if (e.ctrlKey && !e.altKey && !e.metaKey) {
        const target = e.target as HTMLElement;
        const inInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
        if (e.shiftKey && e.key.toLowerCase() === "r") {
          if (inInput) return;
          e.preventDefault();
          void window.rd.restart();
          return;
        }
        if (!e.shiftKey && e.key.toLowerCase() === "q") {
          if (inInput) return;
          e.preventDefault();
          void window.rd.quit();
          return;
        }
        if (!e.shiftKey && e.key.toLowerCase() === "l") {
          if (inInput) return;
          e.preventDefault();
          setTab("collector");
          setOpenMenu(null);
          return;
        }
        if (!e.shiftKey && e.key.toLowerCase() === "p") {
          if (inInput) return;
          e.preventDefault();
          setTab("settings");
          setOpenMenu(null);
          return;
        }
        if (!e.shiftKey && e.key.toLowerCase() === "o") {
          if (inInput) return;
          e.preventDefault();
          setOpenMenu(null);
          void onImportDlcRef.current();
          return;
        }
        if (!e.shiftKey && e.key.toLowerCase() === "a") {
          const inputType = target.tagName === "INPUT" ? (target as HTMLInputElement).type : "";
          const selectionScope = resolveSelectAllSelectionScope(
            tabRef.current,
            settingsSubTabRef.current,
            accountManagementTabRef.current,
            target.tagName,
            inputType
          );
          if (!selectionScope) return;
          e.preventDefault();
          if (selectionScope === "downloads") {
            setSelectedIds(new Set(visibleOrderIdsRef.current));
          } else if (selectionScope === "collector") {
            setSelectedCollectorLinkIds((current) => setCollectorVisibleSelection(current, collectorVisibleIdsRef.current, true));
          } else if (selectionScope === "history") {
            setSelectedHistoryIds((current) => selectHistoryPageFromShortcut(current, historyVisibleIdsRef.current));
          } else {
            setSelectedAccountRowKeys(new Set(visibleAccountRowKeysRef.current));
          }
          return;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!openMenu) { return; }
    const handler = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;
      if (!target.closest(".md-application-menu-tree")) {
        setOpenMenu(null);
        setOpenSubmenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMenu]);

  const packageSpeedMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const [pid, bps] of Object.entries(snapshot.packageSpeedBps)) {
      if (bps > 0) map.set(pid, bps);
    }
    return map;
  }, [snapshot.packageSpeedBps]);

  const sortDownloadsByColumn = useCallback((column: DownloadSortColumn): void => {
    const nextDescending = downloadsSortColumn === column ? !downloadsSortDescending : false;
    setDownloadsSortColumn(column);
    setDownloadsSortDescending(nextDescending);
    setDownloadsSortRevision((revision) => revision + 1);
    const baseOrder = packageOrderRef.current.length > 0 ? packageOrderRef.current : snapshot.session.packageOrder;
    const sorted = column === "progress"
      ? sortPackageOrderByProgress(baseOrder, snapshot.session.packages, snapshot.session.items, nextDescending)
      : column === "size"
        ? sortPackageOrderBySize(baseOrder, snapshot.session.packages, snapshot.session.items, nextDescending)
        : column === "hoster"
          ? sortPackageOrderByHoster(baseOrder, snapshot.session.packages, snapshot.session.items, nextDescending)
          : column === "service"
            ? sortPackageOrderByService(
              baseOrder,
              snapshot.session.packages,
              snapshot.session.items,
              nextDescending,
              Object.fromEntries(downloadsViewCore.packageRows.map((row) => [row.package.id, row.items]))
            )
            : column === "availability"
              ? sortPackageOrderByAvailability(baseOrder, snapshot.session.packages, snapshot.session.items, nextDescending)
              : sortPackageOrderByName(baseOrder, snapshot.session.packages, nextDescending);
    commitPackageOrder(sorted);
  }, [commitPackageOrder, downloadsSortColumn, downloadsSortDescending, downloadsViewCore.packageRows, snapshot.session.items, snapshot.session.packageOrder, snapshot.session.packages]);

  const clearDownloadQueue = useCallback((): void => {
    void performQuickAction(async () => {
      const confirmed = await askConfirmPrompt({ title: "Queue löschen", message: "Wirklich alle Einträge aus der Queue löschen?", confirmLabel: "Alles löschen", danger: true });
      if (confirmed) await window.rd.clearAll();
    });
  }, [askConfirmPrompt, performQuickAction]);

  const setClipboardWatcherActive = useCallback((active: boolean): void => {
    const update = (current: UiSnapshot): UiSnapshot => ({
      ...current,
      clipboardActive: active,
      settings: { ...current.settings, clipboardWatch: active }
    });
    const next = update(snapshotRef.current);
    snapshotRef.current = next;
    masterSnapshotRef.current = masterSnapshotRef.current ? update(masterSnapshotRef.current) : next;
    if (latestStateRef.current) {
      latestStateRef.current = update(latestStateRef.current);
    }
    setSnapshot(next);
    setSettingsDraft((current) => ({ ...current, clipboardWatch: active }));
  }, []);

  const toggleClipboardWatcher = useCallback((): void => {
    const previous = snapshotRef.current.clipboardActive;
    const next = !previous;
    setClipboardWatcherActive(next);
    void window.rd.toggleClipboard()
      .then(setClipboardWatcherActive)
      .catch((error) => {
        setClipboardWatcherActive(previous);
        showToast(`Zwischenablage konnte nicht umgeschaltet werden: ${String(error)}`, 2600);
      });
  }, [setClipboardWatcherActive, showToast]);

  const applyDailyScheduleSettings = useCallback((settings: RendererSettings): void => {
    const apply = (current: UiSnapshot): UiSnapshot => ({ ...current, settings });
    const next = apply(snapshotRef.current);
    snapshotRef.current = next;
    masterSnapshotRef.current = masterSnapshotRef.current ? apply(masterSnapshotRef.current) : next;
    if (latestStateRef.current) {
      latestStateRef.current = apply(latestStateRef.current);
    }
    setSnapshot(next);
  }, []);

  const applyAuthoritativeDailyScheduleSnapshot = useCallback((state: UiSnapshot): void => {
    masterSnapshotRef.current = state;
    persistedSettingsRef.current = state.settings;
    latestStateRef.current = null;
    snapshotRef.current = state;
    setSnapshot(state);
  }, []);

  const persistDownloadSchedule = useCallback((update: RendererSettingsUpdate, operation: "activate" | "cancel"): Promise<boolean> => (
    persistDailyScheduleSettingsUpdate(update, operation, {
      updateSettings: (value) => window.rd.updateSettings(value),
      getSnapshot: () => window.rd.getSnapshot(),
      applySettings: applyDailyScheduleSettings,
      applySnapshot: applyAuthoritativeDailyScheduleSnapshot,
      showError: (message) => showToast(message, 3200)
    })
  ), [applyAuthoritativeDailyScheduleSnapshot, applyDailyScheduleSettings, showToast]);

  const activateDownloadSchedule = useCallback((): void => {
    void activateDailyScheduleSettings(
      scheduleTimeInput,
      scheduleStartDay,
      (update) => persistDownloadSchedule(update, "activate"),
      (message) => showToast(message, 2800)
    ).then((persisted) => {
      if (persisted) {
        setSchedulePickerOpen(false);
      }
    });
  }, [persistDownloadSchedule, scheduleStartDay, scheduleTimeInput, showToast]);

  const removeActionableDownloads = useCallback((): void => {
    const ids = new Set(downloadsViewCore.actionableSelectedIds);
    if (ids.size === 0) return;
    if (settingsDraft.confirmDeleteSelection) {
      setDeleteConfirm({ ids, dontAsk: false });
    } else {
      executeDeleteSelection(ids);
    }
  }, [downloadsViewCore.actionableSelectedIds, executeDeleteSelection, settingsDraft.confirmDeleteSelection]);

  const downloadPackageSpeeds = useMemo(() => Object.fromEntries(packageSpeedMap), [packageSpeedMap]);
  const liveDownloadSpeedBps = useMemo(() => getDownloadSpeedBps(snapshot.packageSpeedBps), [snapshot.packageSpeedBps]);
  useEffect(() => {
    if (!snapshot.session.running || snapshot.session.paused) return;
    speedHistoryRef.current = appendBandwidthSample(speedHistoryRef.current, liveDownloadSpeedBps);
  }, [liveDownloadSpeedBps, snapshot.packageSpeedBps, snapshot.session.paused, snapshot.session.running]);
  const downloadQueueMetrics = useMemo(() => getDownloadQueueStatusMetrics(downloadsViewCore.eligibleItems), [downloadsViewCore.eligibleItems]);
  const downloadQueueTotal = downloadQueueMetrics.total;
  const downloadRemaining = downloadQueueMetrics.remaining;
  const downloadRunRemaining = useMemo(() => ({
    bytes: snapshot.runRemainingBytes ?? 0,
    unknownItems: snapshot.runRemainingUnknownItems ?? 0
  }), [snapshot.runRemainingBytes, snapshot.runRemainingUnknownItems]);
  const downloadsViewModel = useMemo<DownloadsViewModel>(() => ({
    ...downloadsViewCore,
    query: downloadSearch,
    running: snapshot.session.running,
    paused: snapshot.session.paused,
    canStart: snapshot.canStart,
    canPause: snapshot.canPause,
    canStop: snapshot.canStop,
    actionBusy,
    reconnectSeconds: snapshot.reconnectSeconds,
    reconnectReason: snapshot.session.reconnectReason,
    clipboardWatcher: snapshot.clipboardActive,
    scheduleActive: snapshot.settings.dailyStartEnabled || snapshot.settings.scheduledStartEpochMs > 0,
    scheduleOpen: schedulePickerOpen,
    scheduleTime: scheduleTimeInput,
    scheduleTimeValid: buildDailyScheduleSettingsUpdate(scheduleTimeInput, scheduleStartDay) !== null,
    scheduleStartDay,
    scheduleLabel: scheduleCountdown || (snapshot.settings.dailyStartEnabled
      ? formatDailyScheduleTime(snapshot.settings.dailyStartMinuteOfDay)
      : snapshot.settings.scheduledStartEpochMs > 0
        ? new Date(snapshot.settings.scheduledStartEpochMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : ""),
    packageSpeedBps: downloadPackageSpeeds,
    editingPackageId,
    editingName,
    columnOrder,
    gridTemplate,
    sortColumn: downloadsSortColumn,
    sortDirection: downloadsSortDescending ? "desc" : "asc",
    packageOrderSortRevision: downloadsSortRevision,
    disclosureRevision: downloadDisclosureRevision,
    animationsEnabled: snapshot.settings.animatePackageDisclosure,
    status: {
      packages: downloadQueueMetrics.packageCount,
      links: downloadQueueMetrics.pendingItemCount,
      session: humanSize(snapshot.stats.totalDownloaded),
      sessionBytes: snapshot.stats.totalDownloaded,
      total: formatRemainingDownloadBytes(downloadQueueTotal, normalizeLanguage(settingsDraft.language)),
      totalBytes: downloadQueueTotal.bytes,
      remaining: formatRemainingDownloadBytes(downloadRemaining, normalizeLanguage(settingsDraft.language)),
      remainingBytes: downloadRemaining.bytes,
      remainingTooltip: formatRemainingDownloadTooltip(downloadRemaining),
      hosters: downloadQueueMetrics.hosterCount,
      speed: liveDownloadSpeedBps > 0 ? formatSpeedMbps(liveDownloadSpeedBps) : "0 B/s",
      eta: `ETA: ${formatDownloadEta(downloadRunRemaining, liveDownloadSpeedBps, snapshot.session.running, snapshot.session.paused)}`
    }
  }), [actionBusy, columnOrder, downloadDisclosureRevision, downloadPackageSpeeds, downloadQueueMetrics.hosterCount, downloadQueueMetrics.packageCount, downloadQueueMetrics.pendingItemCount, downloadQueueTotal, downloadRemaining, downloadRunRemaining, downloadSearch, downloadsSortColumn, downloadsSortDescending, downloadsViewCore, editingName, editingPackageId, gridTemplate, liveDownloadSpeedBps, scheduleCountdown, schedulePickerOpen, scheduleStartDay, scheduleTimeInput, snapshot.canPause, snapshot.canStart, snapshot.canStop, snapshot.clipboardActive, snapshot.reconnectSeconds, snapshot.session.paused, snapshot.session.reconnectReason, snapshot.session.running, snapshot.settings.animatePackageDisclosure, snapshot.settings.dailyStartEnabled, snapshot.settings.dailyStartMinuteOfDay, snapshot.settings.scheduledStartEpochMs, snapshot.stats.totalDownloaded]);

  const resetColumnLayout = useCallback((): void => {
    if (columnDragSettleTimerRef.current !== null) {
      window.clearTimeout(columnDragSettleTimerRef.current);
      columnDragSettleTimerRef.current = null;
    }
    cancelColumnDragAnimations();
    if (columnDragSessionRef.current) {
      clearDownloadColumnDrag(columnDragSessionRef.current);
      columnDragSessionRef.current = null;
    }
    setColumnOrder(DEFAULT_COLUMN_ORDER);
    persistColumnOrder(DEFAULT_COLUMN_ORDER);
    showToast("Spaltenlayout zurückgesetzt", 1800);
  }, [cancelColumnDragAnimations, persistColumnOrder, showToast]);

  const downloadsActions: DownloadsViewActions = {
    onResetColumnLayout: resetColumnLayout,
    onDisplayModeChange: setDownloadDisplayMode,
    onFilterChange: setDownloadFilter,
    onProviderFilterChange: setDownloadProviderFilter,
    onQueryChange: setDownloadSearch,
    onAddLinks: () => {
      setTab("collector");
      openCollectorInput();
    },
    onStartDownloads: () => {
      const onBlocked = (): void => showToast("Downloads können derzeit nicht gestartet werden", 2400);
      const onError = (error: unknown): void => showToast(`Start fehlgeschlagen: ${String(error)}`, 2800);
      if (snapshot.session.paused) {
        void runResumeDownloadAction(
          performQuickAction,
          snapshot.canStart,
          () => window.rd.togglePause(),
          (paused) => setSnapshot((current) => ({ ...current, session: { ...current.session, paused } })),
          onBlocked,
          onError
        );
        return;
      }
      void runDownloadStartAction(snapshot.canStart, onStartDownloads, onBlocked, onError);
    },
    onPauseDownloads: () => {
      void runPauseDownloadAction(
        performQuickAction,
        () => window.rd.togglePause(),
        (paused) => setSnapshot((current) => ({ ...current, session: { ...current.session, paused } })),
        (error) => showToast(`Pause fehlgeschlagen: ${String(error)}`, 2800)
      );
    },
    onStopDownloads: () => { void performQuickAction(() => window.rd.stop()); },
    onToggleSchedule: () => {
      if (!schedulePickerOpen) {
        const now = new Date();
        setScheduleTimeInput(resolveDailyScheduleInitialTime(snapshot.settings, now));
        setScheduleStartDay("today");
      }
      setSchedulePickerOpen(!schedulePickerOpen);
    },
    onScheduleTimeChange: setScheduleTimeInput,
    onScheduleStartDayChange: setScheduleStartDay,
    onActivateSchedule: activateDownloadSchedule,
    onCancelSchedule: () => { void persistDownloadSchedule(buildScheduleCancellationSettingsUpdate(snapshot.settings), "cancel"); },
    onMoveSelectionUp: () => moveSelectedPackages("up", downloadsViewCore.actionableSelectedIds),
    onMoveSelectionDown: () => moveSelectedPackages("down", downloadsViewCore.actionableSelectedIds),
    onRenameSelection: () => {
      const packageId = downloadsViewCore.actionableSelectedPackageIds[0];
      const entry = packageId ? snapshot.session.packages[packageId] : null;
      if (entry) onPackageStartEdit(entry.id, entry.name);
    },
    onRemoveSelection: removeActionableDownloads,
    onToggleClipboardWatcher: toggleClipboardWatcher,
    onClearAll: clearDownloadQueue,
    onToggleAllPackages: () => {
      const targetState = !allPackagesCollapsed;
      setDownloadDisclosureRevision((current) => current + 1);
      setCollapsedPackages((current) => {
        const next = { ...current };
        for (const entry of packages) {
          next[entry.id] = targetState;
        }
        return next;
      });
    },
    onShowAllPackages: () => setShowAllPackages(true),
    onSetVisibleSelection: (ids, selected) => {
      setSelectedIds((current) => {
        const next = new Set(current);
        for (const id of ids) {
          if (selected) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    },
    onToggleSelection: onSelectId,
    onSelectionMouseDown: onSelectMouseDown,
    onSelectionMouseEnter: onSelectMouseEnter,
    onTogglePackageCollapse: onPackageToggleCollapse,
    onStartPackageRename: onPackageStartEdit,
    onPackageRenameChange: setEditingName,
    onCommitPackageRename: (packageId, value) => {
      const currentName = snapshot.session.packages[packageId]?.name ?? "";
      onPackageFinishEdit(packageId, currentName, value);
    },
    onCancelPackageRename: () => {
      setEditingPackageId(null);
      setEditingName("");
    },
    onCancelPackage: onPackageCancel,
    onMovePackageUp: onPackageMoveUp,
    onMovePackageDown: onPackageMoveDown,
    onRemoveItem: onPackageRemoveItem,
    onOpenContextMenu: (id, x, y, packageId) => {
      const item = snapshot.session.items[id];
      onPackageContextMenu(packageId ?? item?.packageId ?? id, item?.id, x, y);
    },
    onSortColumn: (column) => {
      if (suppressColumnSortRef.current) return;
      sortDownloadsByColumn(column);
    },
    onColumnPointerDown: (column, event) => {
      if (columnDragSettleTimerRef.current !== null) {
        window.clearTimeout(columnDragSettleTimerRef.current);
        columnDragSettleTimerRef.current = null;
      }
      cancelColumnDragAnimations();
      if (columnDragSessionRef.current) clearDownloadColumnDrag(columnDragSessionRef.current);
      columnDragSessionRef.current = beginDownloadColumnDrag(event.currentTarget, column, event.pointerId, event.clientX, snapshot.settings.animatePackageDisclosure);
    },
    onColumnPointerMove: (_column, event) => {
      const session = columnDragSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      if (updateDownloadColumnDrag(session, event.clientX)) event.preventDefault();
    },
    onColumnPointerUp: (_column, event) => {
      const session = columnDragSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      if (!session.active) {
        clearDownloadColumnDrag(session);
        columnDragSessionRef.current = null;
        return;
      }
      const next = session.preview.order;
      suppressColumnSortRef.current = true;
      window.setTimeout(() => { suppressColumnSortRef.current = false; }, 0);
      const changed = next.join("|") !== session.measurements.map((measurement) => measurement.id).join("|");
      const animationsEnabled = snapshot.settings.animatePackageDisclosure;
      columnDragAnimationsRef.current = commitDownloadColumnDrag(session, next, (order) => {
        if (changed) flushSync(() => setColumnOrder(order));
      }, () => {}, animationsEnabled);
      if (changed) persistColumnOrder(next);
      if (!animationsEnabled) {
        if (columnDragSessionRef.current === session) columnDragSessionRef.current = null;
        return;
      }
      columnDragSettleTimerRef.current = window.setTimeout(() => {
        cancelColumnDragAnimations();
        session.root.classList.remove("is-column-drag-settling");
        if (columnDragSessionRef.current === session) columnDragSessionRef.current = null;
        columnDragSettleTimerRef.current = null;
      }, DOWNLOAD_COLUMN_MOVE_DURATION_MS);
    },
    onColumnPointerCancel: (_column, event) => {
      const session = columnDragSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      if (!session.active) {
        clearDownloadColumnDrag(session);
        columnDragSessionRef.current = null;
        return;
      }
      const originalOrder = session.measurements.map((measurement) => measurement.id);
      const animationsEnabled = snapshot.settings.animatePackageDisclosure;
      columnDragAnimationsRef.current = commitDownloadColumnDrag(session, originalOrder, () => {}, () => {}, animationsEnabled);
      if (!animationsEnabled) {
        if (columnDragSessionRef.current === session) columnDragSessionRef.current = null;
        return;
      }
      columnDragSettleTimerRef.current = window.setTimeout(() => {
        cancelColumnDragAnimations();
        session.root.classList.remove("is-column-drag-settling");
        if (columnDragSessionRef.current === session) columnDragSessionRef.current = null;
        columnDragSettleTimerRef.current = null;
      }, DOWNLOAD_COLUMN_MOVE_DURATION_MS);
    },
    onColumnContextMenu: (_column, x, y) => setColHeaderCtx({ x, y })
  };

  const statisticsActions: StatisticsViewActions = {
    onRangeChange: setStatisticsRange,
    onResetSession: () => {
      void askConfirmPrompt({
        title: "Sitzungsstatistik zurücksetzen",
        message: "Die Zähler, Downloadmenge und Geschwindigkeitsdaten der aktuellen Sitzung werden gelöscht. Dieser Schritt kann nicht rückgängig gemacht werden.",
        confirmLabel: "Sitzung zurücksetzen",
        danger: true
      }).then((confirmed) => {
        if (!confirmed) {
          return;
        }
        return window.rd.resetSessionStats().then(() => {
          speedHistoryRef.current = [];
          showToast("Session-Statistik zurückgesetzt", 1800);
        }).catch((error) => {
          showToast(`Session-Reset fehlgeschlagen: ${String(error)}`, 2400);
        });
      });
    },
    onResetAll: () => {
      void askConfirmPrompt({
        title: "Gesamtstatistik zurücksetzen",
        message: "Alle dauerhaft gespeicherten Download- und Providerstatistiken werden gelöscht. Dieser Schritt kann nicht rückgängig gemacht werden.",
        confirmLabel: "Gesamt zurücksetzen",
        danger: true
      }).then((confirmed) => {
        if (!confirmed) {
          return;
        }
        return window.rd.resetDownloadStats().then(() => {
          showToast("Gesamt-Downloadstatistik zurückgesetzt", 1800);
        }).catch((error) => {
          showToast(`Download-Reset fehlgeschlagen: ${String(error)}`, 2400);
        });
      });
    },
    onResetErrors: () => {
      const failedIds = Object.values(snapshot.session.items)
        .filter(isDownloadItemError)
        .map((item) => item.id);
      if (failedIds.length === 0) {
        return;
      }
      void window.rd.resetItems(failedIds).catch(() => {});
    }
  };
  const collectorActions: CollectorViewActions = {
    onFilterChange: setCollectorFilter,
    onOpenInput: openCollectorInput,
    onImportDlc: () => { void onImportDlc(); },
    onImportFile: () => { void onImportQueue(); },
    onSubmitSelected: () => {
      void submitCollectorPackages(buildCollectorTransferPackages(collectorPackagesRef.current, new Set(collectorViewModel.selectedTransferableIds)));
    },
    onSubmitAll: () => {
      void submitCollectorPackages(buildCollectorTransferPackages(collectorPackagesRef.current, new Set(collectorViewModel.visibleTransferableIds)));
    },
    onQueryChange: setCollectorQuery,
    onLinkSelectionChange: setCollectorLinkSelection,
    onPackageSelectionChange: setCollectorPackageSelection,
    onSetVisibleSelection: (ids, selected) => {
      setSelectedCollectorLinkIds((current) => setCollectorVisibleSelection(current, ids, selected));
    },
    onPackageCollapseChange: toggleCollectorPackageCollapse,
    onToggleAllPackages: toggleAllCollectorPackages,
    onRemoveSelected: removeSelectedCollectorLinks
  };

  const settingsFormModel = useMemo<SettingsFormViewModel>(() => buildSettingsFormViewModel({
    settings: settingsDraft,
    section: settingsSubTab,
    speedLimitInput,
    scheduleSpeedInputs,
    themeChoice: settingsThemeChoice
  }), [scheduleSpeedInputs, settingsDraft, settingsSubTab, settingsThemeChoice, speedLimitInput]);

  const accountRowViewId = (row: AccountTableRow): string => buildAccountRowId(
    row.entry.service,
    row.modeLabel,
    row.accountId || row.rowKey
  );
  const accountRowBindings = useMemo(() => new Map(accountRows.map((row) => [accountRowViewId(row), row])), [accountRows]);
  const activeAccountContextRow = accountContextMenu
    ? accountRowBindings.get(accountContextMenu.rowId) ?? null
    : null;
  const accountSources = useMemo<AccountRowSource[]>(() => accountRows.map((row) => {
    const checkedStatus = row.accountId ? snapshot.settings.debridAccountStatuses?.[row.accountId] : undefined;
    const state: AccountRowSource["status"]["state"] = resolveAccountStatusState(row.disabled, checkedStatus, runtimeNow);
    return {
      identityId: row.accountId || row.rowKey,
      service: row.entry.service,
      hoster: row.hosterLabel,
      mode: row.modeLabel,
      icon: ACCOUNT_SERVICE_ICONS[row.entry.service],
      enabled: !row.disabled,
      status: {
        state,
        message: checkedStatus?.message || row.entry.statusLabel,
        premiumUntilMs: checkedStatus?.premiumUntilMs ?? null,
        checkedAt: checkedStatus?.checkedAt,
        username: checkedStatus?.username,
        email: checkedStatus?.email
      },
      dailyLimitBytes: row.dailyLimitBytes,
      dailyUsageBytes: row.dailyUsedBytes,
      totalUsageBytes: row.totalUsedBytes,
      username: row.username,
      credentialKind: row.credentialLabel.includes("API") ? "api-key" : row.credentialLabel.includes("•") ? "password" : "protected",
      canCheck: row.checkable
    };
  }), [accountRows, runtimeNow, snapshot.settings.debridAccountStatuses]);
  const selectedAccountViewIds = useMemo(() => accountRows
    .filter((row) => selectedAccountRowKeys.has(row.rowKey))
    .map(accountRowViewId), [accountRows, selectedAccountRowKeys]);
  const projectedAccountRows = useMemo(() => projectAccountRows(
    accountSources,
    selectedAccountViewIds,
    runtimeNow
  ), [accountSources, runtimeNow, selectedAccountViewIds]);
  const visibleAccountRows = useMemo(() => accountStatusSort === "none"
    ? projectedAccountRows
    : sortAccountRows(projectedAccountRows, accountStatusSort), [accountStatusSort, projectedAccountRows]);
  visibleAccountRowKeysRef.current = visibleAccountRows
    .map((row) => accountRowBindings.get(row.id)?.rowKey)
    .filter((rowKey): rowKey is string => Boolean(rowKey));
  const accountRuntimeModel = useMemo<AccountWorkspaceViewModel["runtime"]>(() => {
    const runtimeEntries = snapshot.accountRuntime || [];
    const runtimeByAccountId = new Map(runtimeEntries.map((entry) => [`${entry.provider}:${entry.accountId}`, entry]));
    const runtimeAccountIdCounts = new Map<string, number>();
    for (const entry of runtimeEntries) {
      runtimeAccountIdCounts.set(entry.accountId, (runtimeAccountIdCounts.get(entry.accountId) || 0) + 1);
    }
    const uniqueRuntimeByAccountId = new Map(runtimeEntries
      .filter((entry) => runtimeAccountIdCounts.get(entry.accountId) === 1)
      .map((entry) => [entry.accountId, entry]));
    const projectedById = new Map(projectedAccountRows.map((row) => [row.id, row]));
    const providerGroups = new Map<string, {
      id: string;
      label: string;
      accountCount: number;
      availableAccountCount: number;
      activeDownloads: number;
      dailyUsageBytes: number;
    }>();
    const stateLabels = {
      ready: "Bereit",
      active: "Aktiv",
      checking: "Prüfung",
      cooldown: "Cooldown",
      disabled: "Deaktiviert",
      daily_limit: "Tageslimit",
      invalid: "Fehler"
    } as const;
    const stateTones = {
      ready: "ok",
      active: "active",
      checking: "active",
      cooldown: "warning",
      disabled: "muted",
      daily_limit: "warning",
      invalid: "danger"
    } as const;
    const accounts = accountRows.map((row) => {
      const viewId = accountRowViewId(row);
      const projected = projectedById.get(viewId);
      const runtimeId = row.accountId || `svc-${row.entry.provider}`;
      const runtimeProvider = row.entry.provider === "megadebrid"
        ? (row.modeLabel.toLocaleLowerCase("de-DE").includes("web") ? "megadebrid-web" : "megadebrid-api")
        : row.entry.provider;
      const runtime = runtimeByAccountId.get(`${runtimeProvider}:${runtimeId}`)
        ?? uniqueRuntimeByAccountId.get(runtimeId);
      const fallbackState = row.disabled
        ? "disabled"
        : row.dailyLimitBytes > 0 && row.dailyUsedBytes >= row.dailyLimitBytes
          ? "daily_limit"
          : projected?.problem
            ? "invalid"
            : "ready";
      const state = runtime?.state || fallbackState;
      const outcomes = (runtime?.successes || 0) + (runtime?.failures || 0);
      const successRateText = outcomes > 0
        ? `${Math.round(((runtime?.successes || 0) / outcomes) * 100)} % (${runtime?.successes || 0}/${outcomes})`
        : "—";
      const lastUsedAt = runtime?.lastUsedAt || null;
      let lastUsedText = "Noch nicht in dieser Sitzung";
      if (lastUsedAt) {
        const ageSeconds = Math.max(0, Math.floor((runtimeNow - lastUsedAt) / 1000));
        lastUsedText = ageSeconds < 60
          ? "Gerade eben"
          : ageSeconds < 3600
            ? `vor ${Math.floor(ageSeconds / 60)} Min.`
            : ageSeconds < 86400
              ? `vor ${Math.floor(ageSeconds / 3600)} Std.`
              : formatDateTime(lastUsedAt);
      }
      let cooldownText = "—";
      if (runtime?.cooldownUntil && runtime.cooldownUntil > runtimeNow) {
        const seconds = Math.max(1, Math.ceil((runtime.cooldownUntil - runtimeNow) / 1000));
        const duration = seconds < 60
          ? `${seconds} Sek.`
          : seconds < 3600
            ? `${Math.ceil(seconds / 60)} Min.`
            : `${Math.ceil(seconds / 3600)} Std.`;
        cooldownText = `${runtime.reason} · ${duration}`;
      } else if (state === "disabled" || state === "daily_limit" || state === "invalid") {
        cooldownText = runtime?.reason || stateLabels[state];
      }
      const providerKey = row.hosterLabel.toLocaleLowerCase("de-DE");
      const providerGroup = providerGroups.get(providerKey) ?? {
        id: providerKey,
        label: row.hosterLabel,
        accountCount: 0,
        availableAccountCount: 0,
        activeDownloads: 0,
        dailyUsageBytes: 0
      };
      providerGroup.accountCount += 1;
      providerGroup.availableAccountCount += state === "ready" || state === "active" || state === "checking" ? 1 : 0;
      providerGroup.activeDownloads += runtime?.activeDownloads || 0;
      providerGroup.dailyUsageBytes += runtime?.dailyUsageBytes ?? row.dailyUsedBytes;
      providerGroups.set(providerKey, providerGroup);
      return {
        id: viewId,
        providerLabel: row.hosterLabel,
        modeLabel: row.modeLabel,
        identity: projected?.username !== "—" ? projected?.username || "" : projected?.email || "",
        stateLabel: stateLabels[state],
        stateTone: stateTones[state],
        activeDownloads: runtime?.activeDownloads || 0,
        dailyUsageText: humanSize(runtime?.dailyUsageBytes ?? row.dailyUsedBytes),
        successRateText,
        lastUsedText,
        cooldownText
      };
    });
    return {
      providers: [...providerGroups.values()]
        .sort((left, right) => left.label.localeCompare(right.label, "de-DE", { sensitivity: "base" }))
        .map((provider) => ({
          id: provider.id,
          label: provider.label,
          accountCount: provider.accountCount,
          availableAccountCount: provider.availableAccountCount,
          activeDownloads: provider.activeDownloads,
          dailyUsageText: humanSize(provider.dailyUsageBytes)
        })),
      accounts
    };
  }, [accountRows, projectedAccountRows, runtimeNow, snapshot.accountRuntime]);
  const routingEntries = useMemo(() => Object.entries(settingsDraft.hosterRouting || {}).sort(([left], [right]) => left.localeCompare(right)), [settingsDraft.hosterRouting]);
  const usedRoutingHosters = useMemo(() => new Set(routingEntries.map(([hosterId]) => hosterId)), [routingEntries]);
  const routingProviderOptions = useMemo(() => configuredProviders.map((provider) => ({
    value: provider,
    label: providerLabelWithMode(provider, settingsDraft)
  })), [configuredProviders, settingsDraft]);
  const accountWorkspaceModel: AccountWorkspaceViewModel = {
    activePanel: accountManagementTab,
    rows: visibleAccountRows,
    selectedIds: selectedAccountViewIds,
    busy: actionBusy || accountCheckBusy,
    statusSort: accountStatusSort,
    runtime: accountRuntimeModel,
    rules: {
      providerOrder: activeProviderOrder.map((provider) => buildProviderOrderEntry(provider, settingsDraft)),
      routing: routingEntries.map(([hosterId, provider]) => `${KNOWN_HOSTERS.find((hoster) => hoster.id === hosterId)?.label || hosterId} → ${providerLabelWithMode(provider, settingsDraft)}`),
      autoFallback: settingsDraft.autoProviderFallback,
      rememberCredentials: settingsDraft.rememberToken,
      rotationEvents: (snapshot.rotationEvents || []).map((event) => ({
        id: event.id,
        title: `${event.provider} · ${event.accountLabel}`,
        detail: `${new Date(event.at).toLocaleTimeString()} · ${rotationEventText(event)}${event.reason ? ` (${event.reason})` : ""}`
      })),
      routingEntries: routingEntries.map(([hosterId, provider]) => ({
        hosterId,
        hosterLabel: KNOWN_HOSTERS.find((hoster) => hoster.id === hosterId)?.label || hosterId,
        provider,
        providers: routingProviderOptions
      })),
      availableRoutingHosters: KNOWN_HOSTERS
        .filter((hoster) => !usedRoutingHosters.has(hoster.id))
        .map((hoster) => ({ value: hoster.id, label: hoster.label }))
    }
  };

  const setHosterRouting = (hosterRouting: Record<string, DebridProvider>): void => {
    settingsDraftRevisionRef.current += 1;
    panelDirtyRevisionRef.current += 1;
    settingsDirtyRef.current = true;
    setSettingsDirty(true);
    setSettingsSaveState("dirty");
    setSettingsDraft((current) => ({ ...current, hosterRouting }));
  };
  const accountWorkspaceActions: AccountWorkspaceActions = {
    onPanelChange: setAccountManagementTab,
    onSelect: (rowId, additive) => {
      const rowKey = accountRowBindings.get(rowId)?.rowKey;
      if (!rowKey) {
        return;
      }
      setSelectedAccountRowKeys((current) => new Set(updateAccountRowSelection([...current], rowKey, additive)));
    },
    onToggleEnabled: (rowId, enabled) => {
      const row = accountRowBindings.get(rowId);
      if (row) toggleAccountTableRow(row, enabled);
    },
    onEdit: (rowId) => {
      const row = accountRowBindings.get(rowId);
      if (row) openEditAccountDialog(row);
    },
    onContextMenu: (rowId, x, y) => {
      const row = accountRowBindings.get(rowId);
      if (row) setAccountContextMenu({ x, y, rowId });
    },
    onCopyIdentity: (label, value) => {
      void window.rd.writeClipboardText(value)
        .then(() => showToast(`${label} kopiert`))
        .catch(() => showToast("Kopieren fehlgeschlagen"));
    },
    onAdd: openCreateAccountDialog,
    onRemoveSelected: () => {
      const rows = selectedAccountViewIds
        .map((rowId) => accountRowBindings.get(rowId))
        .filter((row): row is AccountTableRow => Boolean(row));
      removeAccountTableRows(rows);
    },
    onCheckActive: () => { void checkAccounts("active"); },
    onCheckAll: () => { void checkAccounts("all"); },
    onStatusSort: cycleAccountStatusSort,
    onMoveProvider: (index, direction) => {
      const target = index + direction;
      if (target < 0 || target >= activeProviderOrder.length) return;
      const next = [...activeProviderOrder];
      [next[index], next[target]] = [next[target], next[index]];
      setProviderOrder(next);
    },
    onProviderDragStart: (event, index) => {
      const provider = activeProviderOrder[index];
      if (provider) onProviderDragStart(event, provider);
    },
    onProviderDragOver: (event, index) => {
      const provider = activeProviderOrder[index];
      if (provider) onProviderDragOver(event, provider);
    },
    onProviderDrop: (event, index) => {
      const provider = activeProviderOrder[index];
      if (provider) onProviderDrop(event, provider);
    },
    onProviderDragEnd,
    onToggleAutoFallback: (enabled) => setBool("autoProviderFallback", enabled),
    onToggleRememberCredentials: (enabled) => setBool("rememberToken", enabled),
    onRoutingProviderChange: (hosterId, provider) => setHosterRouting({
      ...(settingsDraft.hosterRouting || {}),
      [hosterId]: provider as DebridProvider
    }),
    onRoutingRemove: (hosterId) => {
      const next = { ...(settingsDraft.hosterRouting || {}) };
      delete next[hosterId];
      setHosterRouting(next);
    },
    onRoutingAdd: (hosterId) => {
      const resolvedHosterId = hosterId === "__custom"
        ? (window.prompt("Hoster-Domain eingeben:") || "").trim().toLowerCase().replace(/^www\./, "").split(".")[0]
        : hosterId;
      if (!resolvedHosterId || settingsDraft.hosterRouting?.[resolvedHosterId] || !configuredProviders[0]) return;
      setHosterRouting({ ...(settingsDraft.hosterRouting || {}), [resolvedHosterId]: configuredProviders[0] });
    }
  };

  const settingsFormActions: SettingsViewActions["form"] = {
    onChange: (fieldId, value) => {
      const scheduleMatch = /^schedule:(\d+):(startHour|endHour|enabled|speedLimitMbps)$/.exec(fieldId);
      if (scheduleMatch) {
        const index = Number(scheduleMatch[1]);
        const field = scheduleMatch[2];
        if (field === "speedLimitMbps") {
          const schedule = schedules[index];
          if (schedule) {
            const key = schedule.id || `schedule-${index}`;
            setScheduleSpeedInputs((current) => ({ ...current, [key]: String(value) }));
          }
        } else if (field === "enabled") {
          updateSchedule(index, "enabled", Boolean(value));
        } else {
          const parsed = Number(value);
          if (Number.isFinite(parsed)) updateSchedule(index, field as "startHour" | "endHour", Math.max(0, Math.min(23, parsed)));
        }
        return;
      }
      if (fieldId === "speedLimitInput") {
        setSpeedLimitInput(String(value));
        return;
      }
      if (fieldId === "theme") {
        const choice = value as SettingsThemeChoice;
        const next = resolveSettingsThemeChoice(choice, window.matchMedia("(prefers-color-scheme: light)").matches);
        setSettingsThemeChoice(choice);
        setText("themePreference", choice);
        setText("theme", next);
        applyTheme(next);
        return;
      }
      if (fieldId === "historyRetentionMode" && typeof value === "string") {
        const next = resolveHistoryRetentionSelection(settingsDraft.historyRetentionMode, settingsDraft.historyMaxEntries, value);
        setText("historyRetentionMode", next.historyRetentionMode);
        setNum("historyMaxEntries", next.historyMaxEntries);
        return;
      }
      if (typeof value === "boolean") {
        setBool(fieldId as keyof RendererSettingsDraft, value);
        return;
      }
      const notificationNumber = normalizeNotificationNumberField(fieldId, value);
      if (notificationNumber !== undefined) {
        setNum(fieldId as keyof RendererSettingsDraft, notificationNumber);
        return;
      }
      const numericLimits: Partial<Record<keyof RendererSettingsDraft, [number, number, number]>> = {
        maxParallel: [1, 50, 1],
        retryLimit: [0, 99, 0],
        historyMaxEntries: [50, 100000, 500],
        historyMaxAgeDays: [0, 3650, 0],
        maxParallelExtract: [1, 8, 2],
        reconnectWaitSeconds: [10, 600, 45],
        proxyApiProxyIndex: [1, 100000, 1],
        proxyConnectionsPerDownload: [2, 80, 32]
      };
      const bounds = numericLimits[fieldId as keyof RendererSettingsDraft];
      if (bounds) {
        const parsed = Number(value);
        setNum(fieldId as keyof RendererSettingsDraft, Math.max(bounds[0], Math.min(bounds[1], Number.isFinite(parsed) ? parsed : bounds[2])));
      } else {
        setText(fieldId as keyof RendererSettingsDraft, String(value));
      }
    },
    onCommit: (fieldId, value) => {
      const scheduleMatch = /^schedule:(\d+):speedLimitMbps$/.exec(fieldId);
      if (scheduleMatch) {
        const index = Number(scheduleMatch[1]);
        const parsed = parseMbpsInput(value);
        const schedule = schedules[index];
        if (!schedule) return;
        const key = schedule.id || `schedule-${index}`;
        if (parsed === null) {
          setScheduleSpeedInputs((current) => ({ ...current, [key]: formatMbpsInputFromKbps(schedule.speedLimitKbps) }));
          return;
        }
        const nextKbps = Math.floor(parsed * 1024);
        setScheduleSpeedInputs((current) => ({ ...current, [key]: formatMbpsInputFromKbps(nextKbps) }));
        updateSchedule(index, "speedLimitKbps", nextKbps);
        return;
      }
      if (fieldId === "speedLimitInput") {
        const parsed = parseMbpsInput(value);
        if (parsed === null) {
          setSpeedLimitInput(formatMbpsInputFromKbps(settingsDraft.speedLimitKbps));
          return;
        }
        setSpeedLimitMbps(parsed);
        setSpeedLimitInput(formatMbpsInputFromKbps(Math.floor(parsed * 1024)));
      }
    },
    onAction: (fieldId) => {
      if (fieldId === "schedule:add") {
        addSchedule();
        return;
      }
      const removeScheduleMatch = /^schedule:(\d+):remove$/.exec(fieldId);
      if (removeScheduleMatch) {
        removeSchedule(Number(removeScheduleMatch[1]));
        return;
      }
      if (fieldId === "update:check") {
        void onCheckUpdates();
        return;
      }
      if (fieldId === "notifyUrl") {
        void performQuickAction(async () => {
          const ok = await window.rd.testNotification(settingsDraft.notifyUrl, settingsDraft.notifyMention);
          showToast(ok ? "Test-Nachricht gesendet" : "Test fehlgeschlagen", ok ? 2400 : 3600);
        });
        return;
      }
      if (fieldId === "logStorageDirectory") {
        void performQuickAction(async () => {
          await window.rd.openLogDirectory();
        });
        return;
      }
      if (fieldId === "proxyListPath") {
        void performQuickAction(async () => {
          const selectedPath = await window.rd.pickProxyList();
          if (selectedPath) setText("proxyListPath", selectedPath);
        });
        return;
      }
      const targetKey = fieldId === "outputDir" ? "outputDir" : fieldId === "extractDir" ? "extractDir" : fieldId === "mkvLibraryDir" ? "mkvLibraryDir" : null;
      if (targetKey) {
        void performQuickAction(async () => {
          const path = await window.rd.pickFolder();
          if (path) setText(targetKey, path);
        });
      }
    }
  };
  const settingsViewModel: SettingsViewModel = {
    section: settingsSubTab,
    saveState: settingsDirty && settingsSaveState === "clean" ? "dirty" : settingsSaveState,
    saveInFlight: settingsSaveInFlight,
    form: settingsFormModel,
    accounts: accountWorkspaceModel
  };
  const settingsViewActions: SettingsViewActions = {
    onSectionChange: setSettingsSubTab,
    onDiscard: discardSettingsChanges,
    onSave: () => { void onSaveSettings(); },
    form: settingsFormActions,
    accounts: accountWorkspaceActions
  };

  const accountAddOptions: AccountAddOption[] = filteredAccountDialogOptions.map((option) => ({
    id: option.kind,
    service: option.service,
    title: option.serviceLabel,
    mode: option.modeLabel,
    description: option.pickerDescription,
    functionLabel: getAccountPickerFunctionLabel(option),
    filter: option.modeLabel === "API" ? "api" : "web",
    multi: option.kind === "realdebrid-api" || option.kind === "realdebrid-web" || option.kind === "megadebrid-api" || option.kind === "megadebrid-web" || option.kind === "debridlink-api",
    icon: ACCOUNT_SERVICE_ICONS[option.service]
  }));
  const accountAddFields = buildAccountAddFields(accountDialog);
  const accountAddDialog = (
    <AccountAddDialog
      actions={{
        onQueryChange: setAccountDialogSearch,
        onServiceFilterChange: setAccountDialogServiceFilter,
        onOptionSelect: (optionId) => updateAccountDialogKind(optionId as AccountKind),
        onFieldChange: (fieldId, value) => setAccountDialog((current) => current ? { ...current, [fieldId]: value } : current),
        onClose: closeAccountDialog,
        onSubmit: () => {
          const quickAction = accountDialog?.kind ? getAccountQuickActionMeta(accountDialog.kind)?.action : undefined;
          void onSaveAccountDialog(quickAction);
        }
      }}
      model={{
        open: Boolean(accountDialog),
        query: accountDialogSearch,
        serviceFilter: accountDialogServiceFilter,
        serviceFilters: accountDialogServiceFilters,
        options: accountAddOptions,
        selectedOptionId: accountDialog?.kind ?? null,
        fields: accountAddFields,
        error: "",
        busy: actionBusy
      }}
    />
  );
  const accountEditSecretRequest = accountEditDialog ? buildAccountSecretRequest(accountEditDialog.target) : null;
  const accountEditHasStoredSecret = accountEditSecretRequest
    ? snapshot.accounts.some((account) => account.kind === accountEditSecretRequest.kind
      && account.accountId === accountEditSecretRequest.accountId
      && account.hasSecret)
    : false;
  const toggleAccountEditSecret = async (fieldId: string): Promise<void> => {
    if (fieldId !== "password" && fieldId !== "token") return;
    const dialog = accountEditDialog;
    if (!dialog) return;
    if (accountEditSecretVisible[fieldId]) {
      setAccountEditSecretVisible((current) => ({ ...current, [fieldId]: false }));
      return;
    }
    if (dialog[fieldId]) {
      setAccountEditSecretVisible((current) => ({ ...current, [fieldId]: true }));
      return;
    }
    const request = buildAccountSecretRequest(dialog.target);
    setAccountEditSecretBusy(fieldId);
    try {
      const result = await window.rd.revealAccountSecret(request);
      setAccountEditDialog((current) => {
        if (!current) return current;
        const currentRequest = buildAccountSecretRequest(current.target);
        if (currentRequest.kind !== request.kind || currentRequest.accountId !== request.accountId) return current;
        return { ...current, [fieldId]: result.secret };
      });
      setAccountEditSecretVisible((current) => ({ ...current, [fieldId]: true }));
    } catch (error) {
      showToast(`Gespeicherter Zugang konnte nicht angezeigt werden: ${String(error)}`, 3200);
    } finally {
      setAccountEditSecretBusy((current) => current === fieldId ? null : current);
    }
  };
  const copyAccountEditSecret = async (fieldId: string): Promise<void> => {
    if (fieldId !== "password" && fieldId !== "token") return;
    const secret = accountEditDialog?.[fieldId] || "";
    if (!secret) return;
    try {
      const copied = await window.rd.writeClipboardText(secret);
      showToast(copied ? "Zugang in die Zwischenablage kopiert" : "Zugang konnte nicht kopiert werden", 2200);
    } catch (error) {
      showToast(`Zugang konnte nicht kopiert werden: ${String(error)}`, 3200);
    }
  };
  const accountEditFields: AccountDialogField[] = accountEditDialog && accountEditOption ? [
    ...((accountEditDialog.target.type === "mega" || accountEditOption.needsCredentials) ? [
      { id: "login", label: "Login / E-Mail", type: "text" as const, value: accountEditDialog.login },
      {
        id: "password",
        label: "Passwort",
        type: "password" as const,
        value: accountEditDialog.password,
        storedSecret: accountEditHasStoredSecret,
        secretVisible: Boolean(accountEditSecretVisible.password),
        secretBusy: accountEditSecretBusy === "password"
      }
    ] : []),
    ...((accountEditDialog.target.type === "debridlink" || accountEditOption.needsToken) ? [
      {
        id: "token",
        label: accountEditDialog.target.type === "debridlink" ? "API-Key" : "Token / API-Key",
        type: "password" as const,
        value: accountEditDialog.token,
        storedSecret: accountEditHasStoredSecret,
        secretVisible: Boolean(accountEditSecretVisible.token),
        secretBusy: accountEditSecretBusy === "token"
      }
    ] : []),
    {
      id: "dailyLimitGb",
      label: "Tageslimit (GB, optional)",
      type: "number" as const,
      value: accountEditDialog.dailyLimitGb,
      placeholder: "Kein Limit"
    }
  ] : [];
  const checkAccountEditDialog = (): void => {
    if (!accountEditDialog) return;
    const validationError = validateAccountEdit(accountEditDialog, snapshot.accounts);
    if (validationError) {
      showToast(validationError, 2800);
      return;
    }
    const editSnapshot = accountEditDialog;
    void performQuickAction(async () => {
      if (editSnapshot.target.type === "mega" || editSnapshot.target.type === "debridlink"
        || editSnapshot.target.kind === "realdebrid-api" || editSnapshot.target.kind === "realdebrid-web") {
        const secret = editSnapshot.target.type === "mega" ? editSnapshot.password : editSnapshot.token;
        const kind = editSnapshot.target.kind as "realdebrid-api" | "realdebrid-web" | "megadebrid-api" | "megadebrid-web" | "debridlink-api";
        const status = await window.rd.checkAccountCredentials({
          kind,
          accountId: editSnapshot.target.type === "mega"
            ? editSnapshot.target.accountId
            : editSnapshot.target.type === "debridlink"
              ? editSnapshot.target.keyId
              : editSnapshot.target.accountId,
          identity: secret ? editSnapshot.login : undefined,
          secret: secret || undefined
        });
        if (!status.valid) throw new Error(status.message || "Zugangsdaten ungültig");
        showToast("Account erfolgreich geprüft", 2200);
        return;
      }
      const quickAction = getAccountQuickActionMeta(editSnapshot.target.kind);
      if (quickAction) {
        await runAccountQuickAction(quickAction.action, editSnapshot.target.type === "single" ? editSnapshot.target.accountId : null);
      } else {
        showToast("Für diesen Dienst ist keine direkte Statusprüfung verfügbar.", 2800);
      }
    }, (error) => showToast(formatAccountOperationError("Prüfung fehlgeschlagen", error), 3600));
  };
  const accountEditDialogView = accountEditDialog && accountEditOption ? (
    <AccountEditDialog
      actions={{
        onFieldChange: (fieldId, value) => setAccountEditDialog((current) => current ? { ...current, [fieldId]: value } : current),
        onClose: closeAccountEditDialog,
        onCheck: checkAccountEditDialog,
        onSave: () => { void onSaveAccountEditDialog(); },
        onRemove: () => {
          const row = accountEditRow;
          closeAccountEditDialog();
          if (row) removeAccountTableRow(row);
        },
        onToggleEnabled: () => {
          if (accountEditRow) toggleAccountTableRow(accountEditRow, accountEditRow.disabled);
        },
        onToggleSecret: (fieldId) => { void toggleAccountEditSecret(fieldId); },
        onCopySecret: (fieldId) => { void copyAccountEditSecret(fieldId); }
      }}
      model={{
        open: true,
        hoster: accountEditOption.serviceLabel,
        mode: accountEditOption.modeLabel,
        identity: resolveAccountUsername(accountEditRow?.username || accountEditDialog.login, accountEditStatus?.username || accountEditStatus?.email),
        enabled: !accountEditRow?.disabled,
        fields: accountEditFields,
        error: "",
        busy: actionBusy
      }}
    />
  ) : null;

  if (snapshotBootstrapStatus.phase !== "ready") {
    const snapshotBootstrapFailed = snapshotBootstrapStatus.phase === "error";
    return (
      <main
        aria-busy={!snapshotBootstrapFailed}
        aria-labelledby="snapshot-bootstrap-title"
        className="snapshot-bootstrap-root"
      >
        <section
          aria-live={snapshotBootstrapFailed ? "assertive" : "polite"}
          className={`snapshot-bootstrap-panel${snapshotBootstrapFailed ? " is-error" : ""}`}
          role={snapshotBootstrapFailed ? "alert" : "status"}
        >
          {!snapshotBootstrapFailed ? <span aria-hidden="true" className="snapshot-bootstrap-spinner" /> : null}
          <h1 id="snapshot-bootstrap-title">
            {snapshotBootstrapFailed ? "Anwendungsdaten konnten nicht geladen werden" : "Anwendungsdaten werden geladen"}
          </h1>
          <p>
            {snapshotBootstrapFailed
              ? snapshotBootstrapStatus.message || "Der aktuelle Stand konnte nicht abgerufen werden."
              : "Der aktuelle Stand wird sicher geladen."}
          </p>
          {snapshotBootstrapFailed ? (
            <button className="snapshot-bootstrap-retry" onClick={() => retrySnapshotBootstrapRef.current()} type="button">
              Erneut versuchen
            </button>
          ) : null}
        </section>
      </main>
    );
  }

  return (
    <div
      className={`md-runtime-root${dragOver ? " drag-over" : ""}${tab === "settings" ? " settings-active" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        const hasFiles = event.dataTransfer.types.includes("Files");
        const hasUri = event.dataTransfer.types.includes("text/uri-list");
        if (!hasFiles && !hasUri) { return; }
        dragDepthRef.current += 1;
        if (!dragOverRef.current) {
          dragOverRef.current = true;
          setDragOver(true);
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDragLeave={() => {
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0 && dragOverRef.current) {
          dragOverRef.current = false;
          setDragOver(false);
        }
      }}
      onDrop={onDrop}
    >
      <AppShell
        activeView={tab}
        contextInfo={tab === "downloads" ? (
          <div>
            Paket- und Linkstatus werden laufend aktualisiert. Auswahl, Reihenfolge und aktive Filter bleiben beim Ansichtswechsel erhalten.
          </div>
        ) : tab === "collector" ? (
          <div>
            Rohzeilen bleiben lokal in der gewählten Sammlung, bis sie über „An Downloads übergeben“ an die Queue gesendet werden. Strg+L öffnet den Linksammler, Strg+O lädt DLC-Dateien.
          </div>
        ) : tab === "history" ? (
          <div>
            Abgeschlossene und gelöschte Pakete bleiben hier durchsuchbar. Details zeigen Zielordner, Provider und gespeicherte Linkadressen.
          </div>
        ) : tab === "statistics" ? (
          <div>
            {statisticsViewModel.message} Für sieben und 30 Tage bleiben Kennzahlen leer, solange keine historischen Buckets gespeichert werden.
          </div>
        ) : null}
        footer={tab === "downloads" ? <DownloadsFooter actions={downloadsActions} model={downloadsViewModel} /> : tab === "history" ? <HistoryFooter model={historyViewModel} /> : null}
        headerActions={(
          <>
            <DownloadSpeedSparkline
              speedBps={liveDownloadSpeedBps}
              speedStateRef={speedSparklineStateRef}
              hidden={tab !== "downloads"}
            />
            <UpdateExperience
              available={Boolean(availableUpdate)}
              currentVersion={availableUpdate?.currentVersion ?? appVersion}
              latestTag={availableUpdate?.latestTag ?? ""}
              onClose={dismissUpdatePrompt}
              onInstall={() => { void installUpdate(); }}
              onLater={dismissUpdatePrompt}
              onOpen={() => setUpdateDialogOpen(true)}
              open={updateDialogOpen || updateInstallProgress !== null}
              progress={updateInstallProgress ? {
                percent: updateInstallProgress.percent,
                text: formatUpdateInstallProgress(updateInstallProgress)
              } : 0}
              releaseNotes={availableUpdate?.releaseNotes ?? ""}
              renderDialog={false}
              state={updateInstallProgress?.stage ?? "prompt"}
            />
      <nav aria-label="Anwendungsmenü" className="md-application-menu-tree">
        <div className="menu-bar-item">
          <button
            aria-expanded={openMenu === "datei"}
            aria-haspopup="menu"
            className={`menu-bar-trigger${openMenu === "datei" ? " open" : ""}`}
            onClick={() => setOpenMenu(openMenu === "datei" ? null : "datei")}
            onMouseEnter={() => { if (openMenu && openMenu !== "datei") { setOpenMenu("datei"); setOpenSubmenu(null); } }}
          >
            Datei
          </button>
          <div aria-hidden={openMenu !== "datei"} className={`menu-dropdown${openMenu === "datei" ? " is-open" : ""}`}>
              <button className="menu-dropdown-item" onClick={() => { closeMenus(); setTab("collector"); }}>
                <span>Text mit Links analysieren</span>
                <span className="shortcut">Strg+L</span>
              </button>
              <button className="menu-dropdown-item" onClick={() => { closeMenus(); void onImportQueue(); }}>
                <span>Datei importieren</span>
              </button>
              <button className="menu-dropdown-item" onClick={() => { closeMenus(); void onImportDlc(); }}>
                <span>Linkcontainer laden</span>
                <span className="shortcut">Strg+O</span>
              </button>
              <div className="menu-separator" />
              <div
                className="menu-submenu"
                onMouseEnter={() => setOpenSubmenu("sicherung")}
                onMouseLeave={() => setOpenSubmenu(null)}
              >
                <button className="menu-submenu-trigger">Sicherung</button>
                <div
                  aria-hidden={openSubmenu !== "sicherung"}
                  {...(openSubmenu !== "sicherung" ? { inert: "" } : {})}
                  className={`menu-submenu-dropdown${openSubmenu === "sicherung" ? " is-open" : ""}`}
                >
                    <button className="menu-dropdown-item" onClick={() => { void onExportBackup(); }}>Exportieren</button>
                    <button className="menu-dropdown-item" onClick={() => { void onImportBackup(); }}>Importieren</button>
                    <div className="menu-separator" />
                    <button className="menu-dropdown-item" onClick={() => { void onCreateOnlineBackup(); }}>Online-Schlüssel exportieren</button>
                    <button className="menu-dropdown-item" onClick={onOpenOnlineBackupImport}>Online-Schlüssel importieren</button>
                </div>
              </div>
              <div className="menu-separator" />
              <button className="menu-dropdown-item" onClick={onMenuRestart}>
                <span>Neustart</span>
                <span className="shortcut">Strg+Umschalt+R</span>
              </button>
              <button className="menu-dropdown-item" onClick={onMenuQuit}>
                <span>Beenden</span>
                <span className="shortcut">Strg+Q</span>
              </button>
          </div>
        </div>
        <div className="menu-bar-item">
          <button
            aria-expanded={openMenu === "einstellungen"}
            aria-haspopup="menu"
            className={`menu-bar-trigger${openMenu === "einstellungen" ? " open" : ""}`}
            onClick={() => setOpenMenu(openMenu === "einstellungen" ? null : "einstellungen")}
            onMouseEnter={() => { if (openMenu && openMenu !== "einstellungen") { setOpenMenu("einstellungen"); setOpenSubmenu(null); } }}
          >
            Einstellungen
          </button>
          <div aria-hidden={openMenu !== "einstellungen"} className={`menu-dropdown${openMenu === "einstellungen" ? " is-open" : ""}`}>
              <button className="menu-dropdown-item" onClick={() => { closeMenus(); setTab("settings"); }}>
                <span>Einstellungen</span>
                <span className="shortcut">Strg+P</span>
              </button>
              <div className="menu-separator" />
              <div className="menu-settings-grid" onClick={(e) => e.stopPropagation()}>
                <span>Max. gleichzeitige Downloads</span>
                <span />
                <div className="menu-spinner">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={settingsDraft.maxParallel}
                    onChange={(e) => {
                      const val = Math.max(1, Math.min(50, Number(e.target.value) || 1));
                      settingsDirtyRef.current = true;
                      const rev = ++settingsDraftRevisionRef.current;
                      setSettingsDraft((prev) => ({ ...prev, maxParallel: val }));
                      void window.rd.updateSettings({ maxParallel: val }).finally(() => { if (settingsDraftRevisionRef.current === rev && panelDirtyRevisionRef.current === 0) settingsDirtyRef.current = false; });
                    }}
                  />
                  <div className="menu-spinner-arrows">
                    <button onClick={() => {
                      const val = Math.min(50, settingsDraft.maxParallel + 1);
                      settingsDirtyRef.current = true;
                      const rev = ++settingsDraftRevisionRef.current;
                      setSettingsDraft((prev) => ({ ...prev, maxParallel: val }));
                      void window.rd.updateSettings({ maxParallel: val }).finally(() => { if (settingsDraftRevisionRef.current === rev && panelDirtyRevisionRef.current === 0) settingsDirtyRef.current = false; });
                    }}>&#9650;</button>
                    <button onClick={() => {
                      const val = Math.max(1, settingsDraft.maxParallel - 1);
                      settingsDirtyRef.current = true;
                      const rev = ++settingsDraftRevisionRef.current;
                      setSettingsDraft((prev) => ({ ...prev, maxParallel: val }));
                      void window.rd.updateSettings({ maxParallel: val }).finally(() => { if (settingsDraftRevisionRef.current === rev && panelDirtyRevisionRef.current === 0) settingsDirtyRef.current = false; });
                    }}>&#9660;</button>
                  </div>
                </div>
                <span />

                <span>Geschwindigkeitslimit</span>
                <input
                  type="checkbox"
                  checked={settingsDraft.speedLimitEnabled}
                  onChange={(e) => {
                    const next = e.target.checked;
                    settingsDirtyRef.current = true;
                    const rev = ++settingsDraftRevisionRef.current;
                    setSettingsDraft((prev) => ({ ...prev, speedLimitEnabled: next }));
                    void window.rd.updateSettings({ speedLimitEnabled: next }).finally(() => { if (settingsDraftRevisionRef.current === rev && panelDirtyRevisionRef.current === 0) settingsDirtyRef.current = false; });
                  }}
                />
                <div className={`menu-spinner${!settingsDraft.speedLimitEnabled ? " disabled" : ""}`}>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={speedLimitInput}
                    onChange={(e) => {
                      setSpeedLimitInput(e.target.value);
                    }}
                    onBlur={() => {
                      const parsed = parseMbpsInput(speedLimitInput);
                      if (parsed === null) {
                        setSpeedLimitInput(formatMbpsInputFromKbps(settingsDraft.speedLimitKbps));
                        return;
                      }
                      const kbps = Math.floor(parsed * 1024);
                      settingsDirtyRef.current = true;
                      const rev = ++settingsDraftRevisionRef.current;
                      setSettingsDraft((prev) => ({ ...prev, speedLimitKbps: kbps }));
                      void window.rd.updateSettings({ speedLimitKbps: kbps }).finally(() => { if (settingsDraftRevisionRef.current === rev && panelDirtyRevisionRef.current === 0) settingsDirtyRef.current = false; });
                      setSpeedLimitInput(formatMbpsInputFromKbps(kbps));
                    }}
                  />
                  <div className="menu-spinner-arrows">
                    <button onClick={() => {
                      const cur = (settingsDraft.speedLimitKbps || 0) / 1024;
                      const next = Math.floor((cur + 1) * 1024);
                      settingsDirtyRef.current = true;
                      const rev = ++settingsDraftRevisionRef.current;
                      setSettingsDraft((prev) => ({ ...prev, speedLimitKbps: next }));
                      void window.rd.updateSettings({ speedLimitKbps: next }).finally(() => { if (settingsDraftRevisionRef.current === rev && panelDirtyRevisionRef.current === 0) settingsDirtyRef.current = false; });
                      setSpeedLimitInput(formatMbpsInputFromKbps(next));
                    }}>&#9650;</button>
                    <button onClick={() => {
                      const cur = (settingsDraft.speedLimitKbps || 0) / 1024;
                      const next = Math.max(0, Math.floor((cur - 1) * 1024));
                      settingsDirtyRef.current = true;
                      const rev = ++settingsDraftRevisionRef.current;
                      setSettingsDraft((prev) => ({ ...prev, speedLimitKbps: next }));
                      void window.rd.updateSettings({ speedLimitKbps: next }).finally(() => { if (settingsDraftRevisionRef.current === rev && panelDirtyRevisionRef.current === 0) settingsDirtyRef.current = false; });
                      setSpeedLimitInput(formatMbpsInputFromKbps(next));
                    }}>&#9660;</button>
                  </div>
                </div>
                <span className="menu-speed-unit">MB/s</span>
              </div>
          </div>
        </div>
        <div className="menu-bar-item">
          <button
            aria-expanded={openMenu === "hilfe"}
            aria-haspopup="menu"
            className={`menu-bar-trigger${openMenu === "hilfe" ? " open" : ""}`}
            onClick={() => setOpenMenu(openMenu === "hilfe" ? null : "hilfe")}
            onMouseEnter={() => { if (openMenu && openMenu !== "hilfe") { setOpenMenu("hilfe"); setOpenSubmenu(null); } }}
          >
            Hilfe
          </button>
          <div aria-hidden={openMenu !== "hilfe"} className={`menu-dropdown${openMenu === "hilfe" ? " is-open" : ""}`}>
              <div
                className="menu-submenu"
                onMouseEnter={() => setOpenSubmenu("hilfe-log")}
                onMouseLeave={() => setOpenSubmenu(null)}
              >
                <button className="menu-submenu-trigger">Logs öffnen</button>
                <div
                  aria-hidden={openSubmenu !== "hilfe-log"}
                  {...(openSubmenu !== "hilfe-log" ? { inert: "" } : {})}
                  className={`menu-submenu-dropdown${openSubmenu === "hilfe-log" ? " is-open" : ""}`}
                >
                    <button className="menu-dropdown-item" onClick={() => { closeMenus(); void window.rd.openLog().catch(() => {}); }}><span>Haupt-Log</span></button>
                    <button className="menu-dropdown-item" onClick={() => { closeMenus(); void window.rd.openLogDirectory().catch(() => {}); }}><span>Log-Ordner öffnen</span></button>
                    <button className="menu-dropdown-item" onClick={() => { closeMenus(); void window.rd.openAuditLog().catch(() => {}); }}><span>Audit-Log</span></button>
                    <button className="menu-dropdown-item" onClick={() => { closeMenus(); void window.rd.openRenameLog().catch(() => {}); }}><span>Rename-Log</span></button>
                    <button className="menu-dropdown-item" onClick={() => { closeMenus(); void window.rd.openSessionLog().catch(() => {}); }}><span>Session-Log</span></button>
                    <button className="menu-dropdown-item" onClick={() => { closeMenus(); void window.rd.openTraceLog().catch(() => {}); }}><span>Trace-Log</span></button>
                </div>
              </div>
              <div
                className="menu-submenu"
                onMouseEnter={() => setOpenSubmenu("hilfe-remote")}
                onMouseLeave={() => setOpenSubmenu(null)}
              >
                <button className="menu-submenu-trigger">Remote-Support</button>
                <div
                  aria-hidden={openSubmenu !== "hilfe-remote"}
                  {...(openSubmenu !== "hilfe-remote" ? { inert: "" } : {})}
                  className={`menu-submenu-dropdown${openSubmenu === "hilfe-remote" ? " is-open" : ""}`}
                >
                    <button className="menu-dropdown-item" onClick={() => { void onOpenRemoteDiagnostics(); }}><span>Ferndiagnose …</span></button>
                    <button className="menu-dropdown-item" onClick={() => { void onExportSupportBundle(); }}><span>Support-Bundle exportieren</span></button>
                    <button className="menu-dropdown-item" onClick={() => { void onToggleSupportTrace(); }}><span>{supportTraceEnabled ? "Support-Trace deaktivieren" : "Support-Trace aktivieren"}</span></button>
                </div>
              </div>
              <div className="menu-separator" />
              <button className="menu-dropdown-item" onClick={() => { void onShowRecentErrors(); }}>
                <span>Letzte Fehler anzeigen</span>
              </button>
              <div
                className="menu-submenu"
                onMouseEnter={() => setOpenSubmenu("hilfe-diagnose")}
                onMouseLeave={() => setOpenSubmenu(null)}
              >
                <button className="menu-submenu-trigger">Diagnose</button>
                <div
                  aria-hidden={openSubmenu !== "hilfe-diagnose"}
                  {...(openSubmenu !== "hilfe-diagnose" ? { inert: "" } : {})}
                  className={`menu-submenu-dropdown${openSubmenu === "hilfe-diagnose" ? " is-open" : ""}`}
                >
                    <button className="menu-dropdown-item" onClick={() => { void onRunDebugSetupCheck(); }}><span>Debug-Setup prüfen</span></button>
                    <button className="menu-dropdown-item" onClick={() => { void onRotateDebugToken(); }}><span>Debug-Token rotieren</span></button>
                </div>
              </div>
              <div className="menu-separator" />
              <button className="menu-dropdown-item" onClick={() => { closeMenus(); void onCheckUpdates(); }}>
                <span>Suche Aktualisierungen</span>
              </button>
          </div>
        </div>
      </nav>
            <div className="md-avatar-anchor">
              <button
                aria-expanded={avatarMenuOpen}
                aria-haspopup="menu"
                aria-label="Kontomenü"
                className="md-avatar-trigger"
                onClick={() => setAvatarMenuOpen((open) => !open)}
                title="Kontomenü"
                type="button"
              >
                <Icon name="account" size={18} />
              </button>
              <AvatarMenu
                accountLabel={appVersion ? `Version ${appVersion}` : "Lokale Anwendung"}
                actions={[
                  { id: "settings", label: "Einstellungen", onSelect: () => setTab("settings") },
                  { id: "quit", label: "Beenden", danger: true, onSelect: onMenuQuit }
                ]}
                onClose={() => setAvatarMenuOpen(false)}
                open={avatarMenuOpen}
              />
            </div>
          </>
        )}
        onSidebarCollapsedChange={setSidebarCollapsed}
        onViewChange={setTab}
        sidebar={tab === "downloads" ? (
          <DownloadsSidebar actions={downloadsActions} model={downloadsViewModel} />
        ) : tab === "collector" ? (
          <CollectorSidebar actions={collectorActions} model={collectorViewModel} />
        ) : tab === "history" ? (
          <HistorySidebar actions={historyActions} model={historyViewModel} />
        ) : tab === "statistics" ? (
          <StatisticsSidebar actions={statisticsActions} model={statisticsViewModel} />
        ) : tab === "settings" ? (
          <SettingsSidebar actions={settingsViewActions} model={settingsViewModel} />
        ) : null}
        sidebarCollapsed={sidebarCollapsed}
        sidebarStatus={tab === "downloads" ? (
          <DownloadsSidebarStatus model={downloadsViewModel} />
        ) : tab === "collector" ? (
          <CollectorSidebarStatus model={collectorViewModel} />
        ) : tab === "history" ? (
          <>
            <span>{historySidebarCounts.entries}</span>
            <span>{historySidebarCounts.visible}</span>
            <span>{historySidebarCounts.selected}</span>
          </>
        ) : tab === "statistics" ? (
          <StatisticsSidebarStatus model={statisticsViewModel} />
        ) : null}
        toolbar={tab === "downloads" ? (
          <DownloadsToolbar actions={downloadsActions} model={downloadsViewModel} />
        ) : tab === "collector" ? (
          <CollectorToolbar actions={collectorActions} model={collectorViewModel} />
        ) : tab === "history" ? (
          <HistoryToolbar actions={historyActions} model={historyViewModel} />
        ) : null}
      >
      <main className="md-runtime-view-content">
        {tab === "collector" && (
          <MemoizedCollectorContent actions={collectorActions} model={collectorViewModel} />
        )}

        {tab === "downloads" && <DownloadsContent actions={downloadsActions} model={downloadsViewModel} />}

        {tab === "history" && (
          <HistoryContent actions={historyActions} model={historyViewModel} />
        )}

        {tab === "statistics" && (
          <StatisticsContent
            actions={statisticsActions}
            chart={<BandwidthChart running={snapshot.session.running} paused={snapshot.session.paused} speedHistoryRef={speedHistoryRef} />}
            model={statisticsViewModel}
          />
        )}

        {tab === "settings" && <SettingsContent actions={settingsViewActions} model={settingsViewModel} />}

      </main>
      </AppShell>

      <OverlayHost
        backupPassphrase={backupPassphraseMode ? (
          <BackupPassphraseDialog
            mode={backupPassphraseMode}
            onCancel={() => closeBackupPassphraseDialog(null)}
            onSubmit={(passphrase) => closeBackupPassphraseDialog(passphrase)}
          />
        ) : null}
        confirm={confirmPrompt ? (
          <Dialog actions={null} danger={confirmPrompt.danger} onClose={() => closeConfirmPrompt(false)} open title={confirmPrompt.title}>
            <p style={{ whiteSpace: "pre-line" }}>{confirmPrompt.message}</p>
            {confirmPrompt.details && (
              <details className="modal-details">
                <summary>{confirmPrompt.detailsLabel || "Details anzeigen"}</summary>
                <pre>{confirmPrompt.details}</pre>
              </details>
            )}
            <div className="modal-actions">
              <button className="btn" onClick={() => closeConfirmPrompt(false)}>{confirmPrompt.cancelLabel || "Abbrechen"}</button>
              <button
                className={confirmPrompt.danger ? "btn danger" : "btn"}
                onClick={() => closeConfirmPrompt(true)}
              >
                {confirmPrompt.confirmLabel}
              </button>
            </div>
          </Dialog>
        ) : null}

        onlineBackup={onlineBackupDialog ? (
          <Dialog
            actions={null}
            className="online-backup-modal"
            closable={!onlineBackupDialog.busy}
            onClose={() => setOnlineBackupDialog(null)}
            open
            restoreFocusFallback={() => document.querySelector<HTMLButtonElement>(".md-application-menu-tree .menu-bar-trigger")}
            restoreFocusTarget={typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null}
            size="wide"
            title={onlineBackupDialog.mode === "export" ? "Online-Schlüssel" : "Online-Schlüssel importieren"}
          >
            <p>
              {onlineBackupDialog.mode === "export"
                ? "Dieser Schlüssel stellt deine Einstellungen inklusive gespeicherter Zugangsdaten und hinterlegter Proxy-Liste wieder her. Bewahre ihn wie ein Passwort auf."
                : "Füge den vollständigen MDD2-Schlüssel ein. Einstellungen und eine enthaltene Proxy-Liste werden durch die gespeicherte Version ersetzt."}
            </p>
            {onlineBackupDialog.mode === "export" && onlineBackupDialog.busy && <div className="online-backup-status">Online-Sicherung wird verschlüsselt und gespeichert …</div>}
            {onlineBackupDialog.mode === "export" && onlineBackupDialog.key && (
              <textarea className="online-backup-key" value={onlineBackupDialog.key} readOnly spellCheck={false} aria-label="Online-Sicherungsschlüssel" />
            )}
            {onlineBackupDialog.mode === "import" && (
              <textarea
                className="online-backup-key"
                value={onlineBackupDialog.key}
                onChange={(event) => setOnlineBackupDialog((current) => current ? { ...current, key: event.target.value, error: "" } : current)}
                placeholder="MDD2-…"
                spellCheck={false}
                autoComplete="off"
                disabled={onlineBackupDialog.busy}
                autoFocus
                aria-label="Online-Sicherungsschlüssel eingeben"
              />
            )}
            {onlineBackupDialog.error && <div className="online-backup-error">{onlineBackupDialog.error}</div>}
            <div className="modal-actions">
              <button className="btn" onClick={() => setOnlineBackupDialog(null)} disabled={onlineBackupDialog.busy}>Schließen</button>
              {onlineBackupDialog.mode === "export" && onlineBackupDialog.key && <button className="btn primary" onClick={() => { void onCopyOnlineBackupKey(); }}>Kopieren</button>}
              {onlineBackupDialog.mode === "import" && <button className="btn primary" onClick={() => { void onImportOnlineBackup(); }} disabled={onlineBackupDialog.busy || !onlineBackupDialog.key.trim()}>{onlineBackupDialog.busy ? "Wird geladen …" : "Importieren"}</button>}
            </div>
          </Dialog>
        ) : null}

        diagnostics={remoteDiagOpen ? (
          <Dialog actions={null} onClose={() => setRemoteDiagOpen(false)} open title="Ferndiagnose">
            <p>Ermöglicht einer vertrauenswürdigen Support-Stelle den geschützten Lesezugriff auf Status, Logs und Fehler. Der Verbindungscode enthält das Zugriffstoken und ist wie ein Passwort zu behandeln.</p>
            <div className="rd-status-line">
              <span className={`rd-dot${remoteDiag?.status.running ? " on" : ""}`} />
              <span>
                {remoteDiag?.status.running
                  ? `Aktiv auf ${remoteDiag.status.host}:${remoteDiag.status.port}${remoteDiag.status.localOnly ? " (nur lokal)" : ` (Allowlist: ${remoteDiag.status.allowlistCount})`}`
                  : "Inaktiv"}
              </span>
            </div>

            <div className="rd-field">
              <label>Sichtbarkeit</label>
              <div className="rd-seg">
                <button className={rdHostMode === "local" ? "active" : ""} onClick={() => setRdHostMode("local")}>Nur lokal</button>
                <button className={rdHostMode === "network" ? "active" : ""} onClick={() => setRdHostMode("network")}>Im Netzwerk</button>
              </div>
              <span className="rd-hint">
                {rdHostMode === "local"
                  ? "Bindet nur an 127.0.0.1. Fernzugriff nur ueber einen Tunnel (z.B. Tailscale/SSH) - die sicherste Variante."
                  : "Bindet an 0.0.0.0. Erreichbar im Netzwerk, erfordert eine Allowlist. Nur in vertrauenswuerdigen Netzen/VPN nutzen."}
              </span>
            </div>

            <div className="rd-field">
              <label>Oeffentliche Adresse (fuer den Verbindungscode)</label>
              <input
                value={rdPublicHost}
                placeholder={rdHostMode === "local" ? "127.0.0.1 oder Tunnel-Adresse" : "Server-IP oder DNS-Name"}
                onChange={(event) => setRdPublicHost(event.target.value)}
              />
              {remoteDiag && remoteDiag.suggestedHosts.length > 0 && (
                <div className="rd-chips">
                  {remoteDiag.suggestedHosts.map((host) => (
                    <button key={host} className="rd-chip" onClick={() => setRdPublicHost(host)}>{host}</button>
                  ))}
                </div>
              )}
            </div>

            <div className="rd-field rd-field-inline">
              <div className="rd-field">
                <label>Port</label>
                <input value={rdPort} onChange={(event) => setRdPort(event.target.value.replace(/[^0-9]/g, ""))} />
              </div>
              <div className="rd-field">
                <label>Name (optional)</label>
                <input value={rdName} placeholder="z.B. Server-Berlin" onChange={(event) => setRdName(event.target.value)} />
              </div>
            </div>

            {rdHostMode === "network" && (
              <div className="rd-field">
                <label>Allowlist - erlaubte IPs/CIDR (eine pro Zeile)</label>
                <textarea
                  value={rdAllowlist}
                  placeholder={"203.0.113.5\n10.0.0.0/24"}
                  onChange={(event) => setRdAllowlist(event.target.value)}
                />
                <span className="rd-hint">Pflicht im Netzwerkmodus. Nur diese Quell-IPs duerfen verbinden (zusaetzlich zum Token). Loopback ist immer erlaubt.</span>
              </div>
            )}

            {remoteDiag?.status.running && remoteDiag.code && (
              <div className="rd-field">
                <label>Verbindungscode</label>
                <div className="rd-code">{remoteDiag.code}</div>
                <div className="rd-chips">
                  <button className="btn" onClick={() => { void onCopyRemoteDiagnosticsCode(); }}>Kopieren</button>
                  <button className="btn" onClick={() => { void onRotateRemoteDiagnosticsToken(); }} disabled={remoteDiagBusy}>Token neu (Code ungueltig machen)</button>
                </div>
                <span className="rd-hint">Enthaelt das Zugriffstoken - wie ein Passwort behandeln. Token neu = alter Code wird sofort ungueltig.</span>
              </div>
            )}

            <div className="modal-actions">
              <button className="btn" onClick={() => setRemoteDiagOpen(false)}>Schliessen</button>
              {remoteDiag?.status.running && (
                <button className="btn danger" onClick={() => { void onDisableRemoteDiagnostics(); }} disabled={remoteDiagBusy}>Deaktivieren</button>
              )}
              <button className="btn accent" onClick={() => { void onSubmitRemoteDiagnostics(); }} disabled={remoteDiagBusy}>
                {remoteDiag?.status.running ? "Aktualisieren" : "Aktivieren"}
              </button>
            </div>
          </Dialog>
        ) : null}

        deleteConfirmation={deleteConfirm ? (() => {
        const itemCount = [...deleteConfirm.ids].filter((id) => snapshot.session.items[id]).length;
        const pkgCount = [...deleteConfirm.ids].filter((id) => snapshot.session.packages[id]).length;
        const removedItemIds = new Set<string>();
        for (const id of deleteConfirm.ids) {
          if (snapshot.session.items[id]) removedItemIds.add(id);
          const pkg = snapshot.session.packages[id];
          if (pkg) { for (const iid of pkg.itemIds) removedItemIds.add(iid); }
        }
        const totalRemaining = Math.max(0, Object.keys(snapshot.session.items).length - removedItemIds.size);
        const parts: string[] = [];
        if (pkgCount > 0) parts.push(`${pkgCount} Paket(e)`);
        if (itemCount > 0) parts.push(`${itemCount} Link(s)`);
        return (
          <DeleteConfirmationDialog
            dontAsk={deleteConfirm.dontAsk}
            parts={parts}
            totalRemaining={totalRemaining}
            onCancel={() => setDeleteConfirm(null)}
            onConfirm={() => {
              if (deleteConfirm.dontAsk) {
                setSettingsDraft((prev) => ({ ...prev, confirmDeleteSelection: false }));
                void window.rd.updateSettings({ confirmDeleteSelection: false }).catch(() => {});
              }
              executeDeleteSelection(deleteConfirm.ids);
              setDeleteConfirm(null);
            }}
            onDontAskChange={(checked) => setDeleteConfirm((prev) => prev ? { ...prev, dontAsk: checked } : prev)}
          />
        );
        })() : null}

        conflict={startConflictPrompt ? (
          <Dialog actions={null} onClose={() => closeStartConflictPrompt(null)} open title="Paket bereits entpackt">
            <p>
              <strong>{startConflictPrompt.entry.packageName}</strong> ist im Ziel bereits vorhanden.
            </p>
            <p>Bei "überspringen" wird nur das erneute Entpacken übersprungen - offene Downloads bleiben in der Queue.</p>
            <p className="modal-path" title={startConflictPrompt.entry.extractDir}>{startConflictPrompt.entry.extractDir}</p>
            <label className="toggle-line">
              <input
                type="checkbox"
                checked={startConflictPrompt.applyToAll}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setStartConflictPrompt((prev) => prev ? { ...prev, applyToAll: checked } : prev);
                }}
              />
              Für alle weiteren Pakete dieselbe Auswahl verwenden
            </label>
            <div className="modal-actions">
              <button className="btn" onClick={() => closeStartConflictPrompt(null)}>Abbrechen</button>
              <button
                className="btn"
                onClick={() => closeStartConflictPrompt({ policy: "skip", applyToAll: startConflictPrompt.applyToAll })}
              >
                Entpacktes überspringen
              </button>
              <button
                className="btn danger"
                onClick={() => closeStartConflictPrompt({ policy: "overwrite", applyToAll: startConflictPrompt.applyToAll })}
              >
                überschreiben
              </button>
            </div>
          </Dialog>
        ) : null}

        accountEdit={accountEditDialogView}
        accountCreate={accountAddDialog}
        toast={<Toast message={statusToast} />}
        dropOverlay={dragOver ? <div className="drop-overlay md-drop-overlay">Links, .dlc oder Export-Dateien hier ablegen</div> : null}
        accountContextMenu={accountContextMenu && activeAccountContextRow ? (
        <ContextMenu
          ariaLabel="Accountaktionen"
          className="account-context-menu"
          onClose={() => setAccountContextMenu(null)}
          open
          ref={accountContextMenuRef}
          x={accountContextMenu.x}
          y={accountContextMenu.y}
        >
          <div className="account-context-heading">
            <strong>{formatAccountContextHeading(activeAccountContextRow.hosterLabel, activeAccountContextRow.modeLabel)}</strong>
          </div>
          <div className="ctx-menu-sep" />
          <button className="ctx-menu-item" onClick={() => { setAccountContextMenu(null); openEditAccountDialog(activeAccountContextRow); }}>
            Bearbeiten
          </button>
          <button className="ctx-menu-item" onClick={() => checkAccountTableRow(activeAccountContextRow)}>
            Account prüfen
          </button>
          {getAccountQuickActionMeta(activeAccountContextRow.entry.kind) && (
            <button className="ctx-menu-item" onClick={() => { setAccountContextMenu(null); void onAccountRowQuickAction(activeAccountContextRow); }}>
              {getAccountQuickActionMeta(activeAccountContextRow.entry.kind)?.label}
            </button>
          )}
          <button className="ctx-menu-item" onClick={() => toggleAccountTableRow(activeAccountContextRow)}>
            {activeAccountContextRow.disabled ? "Account aktivieren" : "Account deaktivieren"}
          </button>
          <div className="ctx-menu-sep" />
          <button className="ctx-menu-item ctx-danger" onClick={() => removeAccountTableRow(activeAccountContextRow)}>
            Account entfernen
          </button>
        </ContextMenu>
        ) : null}
        downloadContextMenu={contextMenu ? (() => {
        const actionableSelectedIds = downloadsViewCore.actionableSelectedIds;
        const multi = actionableSelectedIds.length > 1;
        const selectedPackageIds = actionableSelectedIds.filter((id) => snapshot.session.packages[id]);
        const selectedItemIds = actionableSelectedIds.filter((id) => snapshot.session.items[id]);
        const hasPackages = selectedPackageIds.length > 0;
        const startableStatuses = new Set(["queued", "cancelled", "reconnect_wait"]);
        const hasStartableItems = actionableSelectedIds.some((id) => { const it = snapshot.session.items[id]; return it && startableStatuses.has(it.status); });
        const hasItems = selectedItemIds.length > 0;
        const startSelected = (): void => {
          const packageIds = selectedPackageIds;
          const itemIds = selectedItemIds.filter((id) => { const item = snapshot.session.items[id]; return item && startableStatuses.has(item.status); });
          void runDownloadStartAction(
            snapshot.canStart,
            async () => {
              if (packageIds.length > 0) await window.rd.startPackages(packageIds);
              if (itemIds.length > 0) await window.rd.startItems(itemIds);
            },
            () => showToast("Downloads können derzeit nicht gestartet werden", 2400),
            (error) => showToast(`Start fehlgeschlagen: ${String(error)}`, 2800)
          );
          setContextMenu(null);
        };
        return (
        <ContextMenu ariaLabel="Downloadaktionen" onClose={() => setContextMenu(null)} open ref={ctxMenuRef} x={contextMenu.x} y={contextMenu.y}>
          <DownloadContextStartActions
            actionBusy={actionBusy}
            canStart={snapshot.canStart}
            onStartAll={() => { downloadsActions.onStartDownloads(); setContextMenu(null); }}
            onStartSelected={startSelected}
            selectedLabel={`Ausgewählte Downloads starten${multi ? ` (${actionableSelectedIds.length})` : ""}`}
            showSelected={hasPackages || hasStartableItems}
          />
          <div className="ctx-menu-sep" />
          <button className="ctx-menu-item" onClick={() => showLinksPopup(contextMenu.packageId, contextMenu.itemId)}>Linkadressen anzeigen</button>
          {hasPackages && !contextMenu.itemId && (
            <button className="ctx-menu-item" onClick={() => {
              void onExportPackageSelection(selectedPackageIds);
              setContextMenu(null);
            }}>{multi ? `Ausgewählte Pakete exportieren (${selectedPackageIds.length})` : "Paket exportieren"}</button>
          )}
          {contextMenu.itemId && (
            <button className="ctx-menu-item" onClick={() => {
              void onExportItemSelection(multi ? selectedItemIds : [contextMenu.itemId!]);
              setContextMenu(null);
            }}>{multi ? `Ausgewählte Dateien exportieren (${selectedItemIds.length})` : "Datei exportieren"}</button>
          )}
          {hasPackages && !contextMenu.itemId && (
            <button className="ctx-menu-item" onClick={() => {
              for (const id of selectedPackageIds) {
                void window.rd.openPackageLog(id).catch(() => {});
              }
              setContextMenu(null);
            }}>Log öffnen{multi ? ` (${selectedPackageIds.length})` : ""}</button>
          )}
          {contextMenu.itemId && (
            <button className="ctx-menu-item" onClick={() => {
              const itemIds = multi ? selectedItemIds : [contextMenu.itemId!];
              for (const id of itemIds) {
                void window.rd.openItemLog(id).catch(() => {});
              }
              setContextMenu(null);
            }}>Item-Log öffnen{multi ? ` (${selectedItemIds.length})` : ""}</button>
          )}
          <div className="ctx-menu-sep" />
          {hasPackages && !contextMenu.itemId && (
            <button className="ctx-menu-item" onClick={() => {
              for (const id of actionableSelectedIds) { if (snapshot.session.packages[id]) onPackageToggle(id); }
              setContextMenu(null);
            }}>
              {multi ? `Alle ${actionableSelectedIds.length} umschalten` : (snapshot.session.packages[contextMenu.packageId]?.enabled ? "Deaktivieren" : "Aktivieren")}
            </button>
          )}
          {!multi && contextMenu.itemId && (
            <button className="ctx-menu-item ctx-danger" onClick={() => {
              setContextMenu(null);
              const ids = new Set([contextMenu.itemId!]);
              if (settingsDraft.confirmDeleteSelection) { setDeleteConfirm({ ids, dontAsk: false }); }
              else { executeDeleteSelection(ids); }
            }}>Entfernen</button>
          )}
          {selectedItemIds.length > 1 && !hasPackages && (
            <button className="ctx-menu-item ctx-danger" onClick={() => {
              setContextMenu(null);
              const ids = new Set(selectedItemIds);
              if (settingsDraft.confirmDeleteSelection) { setDeleteConfirm({ ids, dontAsk: false }); }
              else { executeDeleteSelection(ids); }
            }}>Ausgewählte Dateien entfernen ({selectedItemIds.length})</button>
          )}
          {hasPackages && !contextMenu.itemId && (() => {
            const errorItemIds = getPackageErrorItemIds(selectedPackageIds, snapshot.session.packages, snapshot.session.items);
            return (
              <>
                <button className="ctx-menu-item" disabled={errorItemIds.length === 0} onClick={() => {
                  if (errorItemIds.length > 0) void window.rd.resetItems(errorItemIds).catch(() => {});
                  setContextMenu(null);
                }}>Nur fehlerhafte Dateien zurücksetzen</button>
                <button className="ctx-menu-item" onClick={() => {
                  for (const id of selectedPackageIds) void window.rd.resetPackage(id).catch(() => {});
                  setContextMenu(null);
                }}>{multi ? "Ausgewählte Pakete vollständig zurücksetzen" : "Gesamtes Paket zurücksetzen"}</button>
              </>
            );
          })()}
          {contextMenu.itemId && (
            <button className="ctx-menu-item" onClick={() => {
              const itemIds = multi ? selectedItemIds : [contextMenu.itemId!];
              void window.rd.resetItems(itemIds).catch(() => {});
              setContextMenu(null);
            }}>Zurücksetzen{multi ? ` (${selectedItemIds.length})` : ""}</button>
          )}
          {hasPackages && !multi && (() => {
            const pkg = snapshot.session.packages[contextMenu.packageId];
            const items = pkg?.itemIds.map((id) => snapshot.session.items[id]).filter(Boolean) || [];
            const someCompleted = items.some((item) => item && item.status === "completed" && !/^Entpackt\b/i.test(item.fullStatus || ""));
            return (<>
              {someCompleted && (
                <button className="ctx-menu-item" onClick={() => { void window.rd.extractNow(contextMenu.packageId).catch(() => {}); setContextMenu(null); }}>Jetzt entpacken</button>
              )}
            </>);
          })()}
          {hasPackages && !contextMenu.itemId && (<>
            <div className="ctx-menu-sep" />
            <div className="ctx-menu-sub">
              <button aria-expanded="false" aria-haspopup="menu" className="ctx-menu-item">Priorität &gt;</button>
              <div aria-label="Priorität" className="ctx-menu-sub-items" role="menu">
                {(["high", "normal", "low"] as const).map((p) => {
                  const label = p === "high" ? "Hoch" : p === "low" ? "Niedrig" : "Standard";
                  const pkgIds = selectedPackageIds;
                  const allMatch = pkgIds.every((id) => (snapshot.session.packages[id]?.priority || "normal") === p);
                  return <button key={p} className={`ctx-menu-item${allMatch ? " ctx-menu-active" : ""}`} disabled={allMatch} onClick={() => { for (const id of pkgIds) void window.rd.setPackagePriority(id, p).catch(() => {}); setContextMenu(null); }}>{allMatch ? `[Aktiv] ${label}` : label}</button>;
                })}
              </div>
            </div>
          </>)}
          {hasItems && (() => {
            const itemIds = selectedItemIds;
            const skippable = itemIds.filter((id) => { const it = snapshot.session.items[id]; return it && (it.status === "queued" || it.status === "reconnect_wait"); });
            if (skippable.length === 0) return null;
            return <button className="ctx-menu-item" onClick={() => { void window.rd.skipItems(skippable).catch(() => {}); setContextMenu(null); }}>überspringen{skippable.length > 1 ? ` (${skippable.length})` : ""}</button>;
          })()}
          {hasPackages && (
            <button className="ctx-menu-item ctx-danger" onClick={() => {
              setContextMenu(null);
              const ids = new Set(selectedPackageIds);
              if (settingsDraft.confirmDeleteSelection) { setDeleteConfirm({ ids, dontAsk: false }); }
              else { executeDeleteSelection(ids); }
            }}>{multi ? `Ausgewählte entfernen (${selectedPackageIds.length})` : "Paket entfernen"}</button>
          )}
          <div className="ctx-menu-sep" />
          <button
            className="ctx-menu-item ctx-danger"
            disabled={actionBusy || getPackagesWithOfflineLinks(snapshot.session.packageOrder, snapshot.session.packages, snapshot.session.items).length === 0}
            onClick={requestRemoveOfflinePackages}
          >{normalizeLanguage(snapshot.settings.language) === "en" ? "Remove packages with offline links …" : "Pakete mit Offline-Links entfernen …"}</button>
        </ContextMenu>
        );
        })() : null}
        columnContextMenu={colHeaderCtx ? (
        <ContextMenu
          ariaLabel="Spaltenauswahl"
          className="md-column-context-menu"
          onClose={() => setColHeaderCtx(null)}
          open
          ref={colHeaderCtxRef}
          x={colHeaderCtx.x}
          y={colHeaderCtx.y}
        >
          {ALL_COLUMN_KEYS.map((col) => {
            const def = COLUMN_DEFS[col];
            if (!def) return null;
            const isVisible = columnOrder.includes(col);
            const isRequired = col === "name";
            return (
              <button
                key={col}
                className={`ctx-menu-item${isRequired ? " ctx-menu-disabled" : ""}`}
                disabled={isRequired}
                onClick={() => {
                  if (isRequired) return;
                  let newOrder: string[];
                  if (isVisible) {
                    newOrder = columnOrder.filter((c) => c !== col);
                  } else {
                    newOrder = [...columnOrder];
                    const defaultIdx = ALL_COLUMN_KEYS.indexOf(col);
                    let insertAt = newOrder.length;
                    for (let i = 0; i < newOrder.length; i++) {
                      if (ALL_COLUMN_KEYS.indexOf(newOrder[i]) > defaultIdx) {
                        insertAt = i;
                        break;
                      }
                    }
                    newOrder.splice(insertAt, 0, col);
                  }
                  persistColumnOrder(newOrder);
                  setColumnOrder(newOrder);
                }}
              >
                <span aria-hidden="true" className="column-menu-check">{isVisible ? "\u2713" : ""}</span>
                <span>{def.label}</span>
              </button>
            );
          })}
          <div className="ctx-menu-sep" />
          <button className="ctx-menu-item column-menu-reset" onClick={() => {
            resetColumnLayout();
            setColHeaderCtx(null);
          }}>Spaltenlayout zurücksetzen</button>
        </ContextMenu>
        ) : null}
        historyContextMenu={historyCtxMenu ? (() => {
        const selectedEntryIds = historyViewModel.selectedIds;
        const multi = selectedEntryIds.length > 1;
        const contextEntry = historyEntriesRef.current.find(e => e.id === historyCtxMenu.entryId);
        const hasUrls = (contextEntry?.urls?.length ?? 0) > 0;
        return (
          <ContextMenu ariaLabel="Verlaufsaktionen" onClose={() => setHistoryCtxMenu(null)} open ref={historyCtxMenuRef} x={historyCtxMenu.x} y={historyCtxMenu.y}>
            <button className="ctx-menu-item ctx-danger" onClick={() => {
              setHistoryCtxMenu(null);
              void removeHistoryEntries(selectedEntryIds);
            }}>
              {multi ? `Ausgewählte entfernen (${selectedEntryIds.length})` : "Eintrag entfernen"}
            </button>
            {!multi && contextEntry ? (
              <button className="ctx-menu-item" onClick={() => {
                setHistoryCtxMenu(null);
                void revealHistoryEntry(contextEntry.id);
              }}>Im Ordner zeigen</button>
            ) : null}
            {hasUrls && !multi && (
              <>
                <div className="ctx-menu-sep" />
                <button className="ctx-menu-item" onClick={() => {
                  setHistoryCtxMenu(null);
                  void restoreHistoryEntries([contextEntry!.id]);
                }}>Erneut herunterladen</button>
                <button className="ctx-menu-item" onClick={() => {
                  const urls = contextEntry!.urls!;
                  const links = urls.map((u) => ({ name: u, url: u }));
                  setLinkPopup({ title: contextEntry!.name, links, isPackage: links.length > 1 });
                  setHistoryCtxMenu(null);
                }}>Linkadressen anzeigen</button>
              </>
            )}
            <div className="ctx-menu-sep" />
            <button className="ctx-menu-item ctx-danger" onClick={() => {
              setHistoryCtxMenu(null);
              void clearHistoryEntries();
            }}>Verlauf leeren</button>
          </ContextMenu>
        );
        })() : null}
        keyStats={keyStatsPopup ? (() => {
        const entry = configuredAccounts.find((a) => a.service === keyStatsPopup);
        if (!entry || entry.debridLinkKeys.length === 0) return null;
        const totalUsed = entry.debridLinkKeys.reduce((s, k) => s + k.dailyUsedBytes, 0);
        const limitedCount = entry.debridLinkKeys.filter((k) => k.dailyLimitReached).length;
        const disabledCount = entry.debridLinkKeys.filter((k) => k.disabled).length;
        const keyDiagnostics = entry.debridLinkKeys
          .map((k) => debridLinkHostLimits[k.id])
          .filter((info): info is DebridLinkHostLimitInfo => Boolean(info));
        const loadedQuotaCount = entry.debridLinkKeys.filter((k) => Boolean(debridLinkHostLimits[k.id])).length;
        const invalidCount = keyDiagnostics.filter((info) => info.state === "invalid").length;
        const cooldownCount = keyDiagnostics.filter((info) => info.state === "cooldown" || info.state === "quota" || info.state === "rate_limit").length;
        const hostStatusLabel = keyDiagnostics.find((info) => info.hostState !== "unknown")?.hostStateLabel || "";
        return (
          <Dialog actions={null} className="key-stats-popup" onClose={() => setKeyStatsPopup(null)} open showCloseButton size="wide" title="API-Key Statistik">
              <div className="key-stats-popup-header">
                <div>
                  <p className="key-stats-summary">
                    {entry.debridLinkKeys.length} Keys &middot; Heute: {humanSize(totalUsed)}
                    {limitedCount > 0 && <span className="key-stats-warn"> &middot; {limitedCount} am Limit</span>}
                    {disabledCount > 0 && <span className="key-stats-warn"> &middot; {disabledCount} deaktiviert</span>}
                    {invalidCount > 0 && <span className="key-stats-warn"> &middot; {invalidCount} invalid</span>}
                    {cooldownCount > 0 && <span className="key-stats-warn"> &middot; {cooldownCount} im Cooldown</span>}
                    {debridLinkHostLimitsLoading && <span> &middot; Rapidgator-Quota wird geladen ({loadedQuotaCount}/{entry.debridLinkKeys.length})</span>}
                    {!debridLinkHostLimitsLoading && !debridLinkHostLimitsError && <span> &middot; Rapidgator {hostStatusLabel || "Status unbekannt"}</span>}
                    {debridLinkHostLimitsError && <span className="key-stats-warn"> &middot; API-Quota konnte nicht geladen werden</span>}
                  </p>
                </div>
              </div>
              <div className="account-subkey-table">
                <div className="account-subkey-table-head">
                  <span className="col-key">#</span>
                  <span className="col-masked">Key</span>
                  <span className="col-usage">Heute</span>
                  <span className="col-limit">Lokal</span>
                  <span className="col-status">Status</span>
                  <span className="col-traffic">RG Traffic</span>
                  <span className="col-links">RG Links</span>
                  <span className="col-action"></span>
                </div>
                {entry.debridLinkKeys.map((key, ki) => {
                  const toggleRow = accountRows.find((candidate) => candidate.toggleKind === "dl" && candidate.dlKey?.id === key.id);
                  const disabled = toggleRow ? toggleRow.disabled : entry.disabled || key.disabled;
                  return <div key={key.id} className={`account-subkey-table-row${key.dailyLimitReached || (debridLinkHostLimits[key.id] && debridLinkHostLimits[key.id].state !== "ready") ? " warning" : ""}${disabled ? " disabled" : ""}`}>
                    {(() => {
                      const hostInfo = debridLinkHostLimits[key.id];
                      const statusDisplay = getDebridLinkKeyStatusDisplay(key, hostInfo);
                      return (
                        <>
                    <span className="col-key">{ki + 1}</span>
                    <button
                      aria-label={`${key.label} maskierte Kennung kopieren`}
                      className="col-masked link-popup-click"
                      type="button"
                      title={`${key.masked}\nMaskierte Kennung kopieren`}
                      onClick={() => {
                        void window.rd.writeClipboardText(key.masked)
                          .then((copied) => copied ? showToast("Maskierte Kennung kopiert", 1800) : showToast("Kopieren fehlgeschlagen", 2200))
                          .catch(() => showToast("Kopieren fehlgeschlagen", 2200));
                      }}
                    >
                      {key.masked}
                    </button>
                    <span className="col-usage">{humanSize(key.dailyUsedBytes)}</span>
                    <span className="col-limit">{disabled ? "Deaktiviert" : key.dailyLimitBytes > 0 ? humanSize(key.dailyLimitBytes) : "Kein Limit"}</span>
                    <span className={`col-status status-pill status-pill-${statusDisplay.tone}`} title={statusDisplay.title}>{statusDisplay.label}</span>
                    <span className="col-traffic" title={hostInfo?.note || ""}>{formatDebridLinkTraffic(hostInfo)}</span>
                    <span className="col-links" title={hostInfo?.note || ""}>{formatDebridLinkCountQuota(hostInfo)}</span>
                    <span className="col-action">
                      <button
                        className={`btn btn-sm ${disabled ? "success" : "danger"}`}
                        onClick={() => {
                          if (toggleRow) requestAccountToggle(toggleRow, toggleRow.disabled);
                        }}
                      >
                        {disabled ? "Aktivieren" : "Deaktivieren"}
                      </button>
                      <button
                        className="btn btn-sm"
                        disabled={actionBusy || key.dailyUsedBytes <= 0}
                        onClick={() => { void onResetDebridLinkApiKeyDailyUsage(entry, key.id, key.label); }}
                      >
                        Reset
                      </button>
                    </span>
                        </>
                      );
                    })()}
                  </div>;
                })}
              </div>
              <div className="modal-actions">
                <button className="btn" onClick={() => setKeyStatsPopup(null)}>Schließen</button>
              </div>
          </Dialog>
        );
        })() : null}
        linkPopup={(
          <>
            {collectorInput ? (
              <CollectorInputDialog
                onChange={(draft) => setCollectorInput((prev) => prev ? { ...prev, draft } : prev)}
                onClose={() => setCollectorInput(null)}
                onCommit={commitCollectorInput}
                open
                value={collectorInput.draft}
              />
            ) : null}
            {linkPopup ? (
              <LinkAddressesDialog
                isPackage={linkPopup.isPackage}
                links={linkPopup.links}
                onClose={() => setLinkPopup(null)}
                onToast={showToast}
                title={linkPopup.title}
                writeClipboardText={window.rd.writeClipboardText}
              />
            ) : null}
          </>
        )}
        update={(
          <UpdateExperience
            available={Boolean(availableUpdate)}
            currentVersion={availableUpdate?.currentVersion ?? appVersion}
            latestTag={availableUpdate?.latestTag ?? ""}
            onClose={dismissUpdatePrompt}
            onInstall={() => { void installUpdate(); }}
            onLater={dismissUpdatePrompt}
            onOpen={() => setUpdateDialogOpen(true)}
            open={updateDialogOpen || updateInstallProgress !== null}
            progress={updateInstallProgress ? {
              percent: updateInstallProgress.percent,
              text: formatUpdateInstallProgress(updateInstallProgress)
            } : 0}
            releaseNotes={availableUpdate?.releaseNotes ?? ""}
            renderTrigger={false}
            state={updateInstallProgress?.stage ?? "prompt"}
          />
        )}
      />
    </div>
  );
}
