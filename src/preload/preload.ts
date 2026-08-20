import { contextBridge, ipcRenderer } from "electron";
import {
  AddLinksPayload,
  AccountCheckScope,
  AccountCommandResult,
  AccountCredentialCheckInput,
  AccountSecretRequest,
  AccountSecretResult,
  AccountCreateCommand,
  AccountDeleteCommand,
  AccountReplaceCommand,
  AccountUpdateSecretCommand,
  AllDebridHostInfo,
  DebridAccountStatus,
  DebridLinkHostLimitInfo,
  DebridProvider,
  DuplicatePolicy,
  EnableRemoteDiagnosticsInput,
  HistoryEntry,
  HistoryRevealResult,
  PackagePriority,
  RemoteDiagnosticsInfo,
  RendererSettings,
  RendererSettingsUpdate,
  RendererErrorReport,
  SessionStats,
  StartConflictEntry,
  StartConflictResolutionResult,
  UiSnapshot,
  UpdateCheckResult,
  UpdateInstallProgress
} from "../shared/types";
import type { RealDebridLoginRequest } from "../shared/preload-api";
import { IPC_CHANNELS } from "../shared/ipc";
import { ElectronApi } from "../shared/preload-api";

const api: ElectronApi = {
  getSnapshot: (): Promise<UiSnapshot> => ipcRenderer.invoke(IPC_CHANNELS.GET_SNAPSHOT),
  getVersion: (): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.GET_VERSION),
  checkUpdates: (): Promise<UpdateCheckResult> => ipcRenderer.invoke(IPC_CHANNELS.CHECK_UPDATES),
  installUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.INSTALL_UPDATE),
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.OPEN_EXTERNAL, url),
  updateSettings: (settings: RendererSettingsUpdate): Promise<RendererSettings> => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_SETTINGS, settings),
  resetProviderDailyUsage: (provider: DebridProvider): Promise<RendererSettings> => ipcRenderer.invoke(IPC_CHANNELS.RESET_PROVIDER_DAILY_USAGE, provider),
  resetDebridLinkApiKeyDailyUsage: (keyId: string): Promise<RendererSettings> => ipcRenderer.invoke(IPC_CHANNELS.RESET_DEBRID_LINK_API_KEY_DAILY_USAGE, keyId),
  createAccount: (command: AccountCreateCommand): Promise<AccountCommandResult> => ipcRenderer.invoke(IPC_CHANNELS.CREATE_ACCOUNT, command),
  replaceAccount: (command: AccountReplaceCommand): Promise<AccountCommandResult> => ipcRenderer.invoke(IPC_CHANNELS.REPLACE_ACCOUNT, command),
  updateAccountSecret: (command: AccountUpdateSecretCommand): Promise<AccountCommandResult> => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_ACCOUNT_SECRET, command),
  deleteAccount: (command: AccountDeleteCommand): Promise<AccountCommandResult> => ipcRenderer.invoke(IPC_CHANNELS.DELETE_ACCOUNT, command),
  addLinks: (payload: AddLinksPayload): Promise<{ addedPackages: number; addedLinks: number; invalidCount: number }> =>
    ipcRenderer.invoke(IPC_CHANNELS.ADD_LINKS, payload),
  addContainers: (filePaths: string[]): Promise<{ addedPackages: number; addedLinks: number }> =>
    ipcRenderer.invoke(IPC_CHANNELS.ADD_CONTAINERS, filePaths),
  getStartConflicts: (): Promise<StartConflictEntry[]> => ipcRenderer.invoke(IPC_CHANNELS.GET_START_CONFLICTS),
  resolveStartConflict: (packageId: string, policy: DuplicatePolicy): Promise<StartConflictResolutionResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.RESOLVE_START_CONFLICT, packageId, policy),
  clearAll: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_ALL),
  start: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.START),
  startPackages: (packageIds: string[]): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.START_PACKAGES, packageIds),
  stop: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.STOP),
  togglePause: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.TOGGLE_PAUSE),
  cancelPackage: (packageId: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.CANCEL_PACKAGE, packageId),
  renamePackage: (packageId: string, newName: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.RENAME_PACKAGE, packageId, newName),
  reorderPackages: (packageIds: string[]): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.REORDER_PACKAGES, packageIds),
  removeItem: (itemId: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.REMOVE_ITEM, itemId),
  togglePackage: (packageId: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.TOGGLE_PACKAGE, packageId),
  exportPackageSelection: (packageIds: string[]) => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_PACKAGE_SELECTION, packageIds),
  exportItemSelection: (itemIds: string[]) => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_ITEM_SELECTION, itemIds),
  exportQueue: (): Promise<{ saved: boolean }> => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_QUEUE),
  importQueue: (json: string): Promise<{ addedPackages: number; addedLinks: number }> => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_QUEUE, json),
  toggleClipboard: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.TOGGLE_CLIPBOARD),
  writeClipboardText: (text: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.WRITE_CLIPBOARD_TEXT, text),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC_CHANNELS.PICK_FOLDER),
  pickContainers: (): Promise<string[]> => ipcRenderer.invoke(IPC_CHANNELS.PICK_CONTAINERS),
  getSessionStats: (): Promise<SessionStats> => ipcRenderer.invoke(IPC_CHANNELS.GET_SESSION_STATS),
  resetSessionStats: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.RESET_SESSION_STATS),
  resetDownloadStats: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.RESET_DOWNLOAD_STATS),
  restart: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.RESTART),
  quit: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.QUIT),
  exportBackup: (passphrase: string): Promise<{ saved: boolean }> => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_BACKUP, passphrase),
  selectBackupImport: (): Promise<{ selected: boolean; requiresPassphrase: boolean; message?: string }> => ipcRenderer.invoke(IPC_CHANNELS.SELECT_BACKUP_IMPORT),
  importBackup: (passphrase?: string): Promise<{ restored: boolean; relaunch: boolean; message: string }> => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_BACKUP, passphrase),
  cancelBackupImport: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.CANCEL_BACKUP_IMPORT),
  exportOnlineBackup: (): Promise<{ key: string }> => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_ONLINE_BACKUP),
  importOnlineBackup: (key: string): Promise<{ restored: boolean; relaunch: false; message: string }> => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_ONLINE_BACKUP, key),
  exportSupportBundle: (): Promise<{ saved: boolean; filePath?: string }> => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_SUPPORT_BUNDLE),
  openLog: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.OPEN_LOG),
  openLogDirectory: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.OPEN_LOG_DIRECTORY),
  openAuditLog: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.OPEN_AUDIT_LOG),
  openRenameLog: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.OPEN_RENAME_LOG),
  openSessionLog: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.OPEN_SESSION_LOG),
  openTraceLog: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.OPEN_TRACE_LOG),
  openPackageLog: (packageId: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.OPEN_PACKAGE_LOG, packageId),
  openItemLog: (itemId: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.OPEN_ITEM_LOG, itemId),
  getDebugSetupCheck: () => ipcRenderer.invoke(IPC_CHANNELS.GET_DEBUG_SETUP_CHECK),
  getRecentErrors: () => ipcRenderer.invoke(IPC_CHANNELS.GET_RECENT_ERRORS),
  testNotification: (url: string, mention: string) => ipcRenderer.invoke(IPC_CHANNELS.TEST_NOTIFY, url, mention),
  getTraceConfig: () => ipcRenderer.invoke(IPC_CHANNELS.GET_TRACE_CONFIG),
  setTraceEnabled: (enabled: boolean, note?: string, durationMinutes?: number) => ipcRenderer.invoke(IPC_CHANNELS.SET_TRACE_ENABLED, enabled, note, durationMinutes),
  rotateDebugToken: (): Promise<{ path: string }> => ipcRenderer.invoke(IPC_CHANNELS.ROTATE_DEBUG_TOKEN),
  getRemoteDiagnostics: (): Promise<RemoteDiagnosticsInfo> => ipcRenderer.invoke(IPC_CHANNELS.GET_REMOTE_DIAGNOSTICS),
  enableRemoteDiagnostics: (input: EnableRemoteDiagnosticsInput): Promise<RemoteDiagnosticsInfo> => ipcRenderer.invoke(IPC_CHANNELS.ENABLE_REMOTE_DIAGNOSTICS, input),
  disableRemoteDiagnostics: (): Promise<RemoteDiagnosticsInfo> => ipcRenderer.invoke(IPC_CHANNELS.DISABLE_REMOTE_DIAGNOSTICS),
  rotateRemoteDiagnosticsToken: (): Promise<RemoteDiagnosticsInfo> => ipcRenderer.invoke(IPC_CHANNELS.ROTATE_REMOTE_DIAGNOSTICS_TOKEN),
  openRealDebridLogin: (request: RealDebridLoginRequest = { accountId: "rdw_legacy" }): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.OPEN_REALDEBRID_LOGIN, request),
  openAllDebridLogin: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.OPEN_ALLDEBRID_LOGIN),
  importBestDebridCookies: (): Promise<number> => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_BESTDEBRID_COOKIES),
  getAllDebridHostInfo: (): Promise<AllDebridHostInfo> => ipcRenderer.invoke(IPC_CHANNELS.GET_ALLDEBRID_HOST_INFO),
  getDebridLinkHostLimits: (): Promise<DebridLinkHostLimitInfo[]> => ipcRenderer.invoke(IPC_CHANNELS.GET_DEBRIDLINK_HOST_LIMITS),
  checkDebridAccounts: (scope: AccountCheckScope = "active"): Promise<DebridAccountStatus[]> => ipcRenderer.invoke(IPC_CHANNELS.CHECK_DEBRID_ACCOUNTS, scope),
  checkAccountCredentials: (input: AccountCredentialCheckInput): Promise<DebridAccountStatus> => ipcRenderer.invoke(IPC_CHANNELS.CHECK_ACCOUNT_CREDENTIALS, input),
  revealAccountSecret: (input: AccountSecretRequest): Promise<AccountSecretResult> => ipcRenderer.invoke(IPC_CHANNELS.REVEAL_ACCOUNT_SECRET, input),
  getArchivePasswordList: () => ipcRenderer.invoke(IPC_CHANNELS.GET_ARCHIVE_PASSWORD_LIST),
  retryExtraction: (packageId: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.RETRY_EXTRACTION, packageId),
  extractNow: (packageId: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.EXTRACT_NOW, packageId),
  resetPackage: (packageId: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.RESET_PACKAGE, packageId),
  getHistory: (): Promise<HistoryEntry[]> => ipcRenderer.invoke(IPC_CHANNELS.GET_HISTORY),
  onHistoryEntryAdded: (callback: (entry: HistoryEntry) => void): (() => void) => {
    const listener = (_event: unknown, entry: HistoryEntry): void => callback(entry);
    ipcRenderer.on(IPC_CHANNELS.HISTORY_ENTRY_ADDED, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.HISTORY_ENTRY_ADDED, listener);
    };
  },
  clearHistory: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_HISTORY),
  removeHistoryEntry: (entryId: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.REMOVE_HISTORY_ENTRY, entryId),
  revealHistoryEntry: (entryId: string): Promise<HistoryRevealResult> => ipcRenderer.invoke(IPC_CHANNELS.REVEAL_HISTORY_ENTRY, entryId),
  setPackagePriority: (packageId: string, priority: PackagePriority): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.SET_PACKAGE_PRIORITY, packageId, priority),
  skipItems: (itemIds: string[]): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.SKIP_ITEMS, itemIds),
  resetItems: (itemIds: string[]): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.RESET_ITEMS, itemIds),
  startItems: (itemIds: string[]): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.START_ITEMS, itemIds),
  reportRendererError: (report: RendererErrorReport): void => ipcRenderer.send(IPC_CHANNELS.LOG_RENDERER_ERROR, report),
  onStateUpdate: (callback: (snapshot: UiSnapshot) => void): (() => void) => {
    const listener = (_event: unknown, snapshot: UiSnapshot): void => callback(snapshot);
    ipcRenderer.on(IPC_CHANNELS.STATE_UPDATE, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.STATE_UPDATE, listener);
    };
  },
  onClipboardDetected: (callback: (links: string[]) => void): (() => void) => {
    const listener = (_event: unknown, links: string[]): void => callback(links);
    ipcRenderer.on(IPC_CHANNELS.CLIPBOARD_DETECTED, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.CLIPBOARD_DETECTED, listener);
    };
  },
  onUpdateInstallProgress: (callback: (progress: UpdateInstallProgress) => void): (() => void) => {
    const listener = (_event: unknown, progress: UpdateInstallProgress): void => callback(progress);
    ipcRenderer.on(IPC_CHANNELS.UPDATE_INSTALL_PROGRESS, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_INSTALL_PROGRESS, listener);
    };
  }
};

contextBridge.exposeInMainWorld("rd", api);
