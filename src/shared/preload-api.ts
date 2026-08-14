import type {
  AddLinksPayload,
  AccountCommandResult,
  AccountCredentialCheckInput,
  AccountCreateCommand,
  AccountDeleteCommand,
  AccountReplaceCommand,
  AccountUpdateSecretCommand,
  AllDebridHostInfo,
  DebridAccountStatus,
  DebugSetupCheckResult,
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
  SupportTraceConfig,
  UiSnapshot,
  UpdateCheckResult,
  UpdateInstallProgress,
  UpdateInstallResult
} from "./types";

export interface ElectronApi {
  getSnapshot: () => Promise<UiSnapshot>;
  getVersion: () => Promise<string>;
  checkUpdates: () => Promise<UpdateCheckResult>;
  installUpdate: () => Promise<UpdateInstallResult>;
  openExternal: (url: string) => Promise<boolean>;
  updateSettings: (settings: RendererSettingsUpdate) => Promise<RendererSettings>;
  resetProviderDailyUsage: (provider: DebridProvider) => Promise<RendererSettings>;
  resetDebridLinkApiKeyDailyUsage: (keyId: string) => Promise<RendererSettings>;
  createAccount: (command: AccountCreateCommand) => Promise<AccountCommandResult>;
  replaceAccount: (command: AccountReplaceCommand) => Promise<AccountCommandResult>;
  updateAccountSecret: (command: AccountUpdateSecretCommand) => Promise<AccountCommandResult>;
  deleteAccount: (command: AccountDeleteCommand) => Promise<AccountCommandResult>;
  addLinks: (payload: AddLinksPayload) => Promise<{ addedPackages: number; addedLinks: number; invalidCount: number }>;
  addContainers: (filePaths: string[]) => Promise<{ addedPackages: number; addedLinks: number }>;
  getStartConflicts: () => Promise<StartConflictEntry[]>;
  resolveStartConflict: (packageId: string, policy: DuplicatePolicy) => Promise<StartConflictResolutionResult>;
  clearAll: () => Promise<void>;
  start: () => Promise<void>;
  startPackages: (packageIds: string[]) => Promise<void>;
  stop: () => Promise<void>;
  togglePause: () => Promise<boolean>;
  cancelPackage: (packageId: string) => Promise<void>;
  renamePackage: (packageId: string, newName: string) => Promise<void>;
  reorderPackages: (packageIds: string[]) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  togglePackage: (packageId: string) => Promise<void>;
  exportPackageSelection: (packageIds: string[]) => Promise<{ saved: boolean; packageCount: number; linkCount: number; filePath?: string }>;
  exportItemSelection: (itemIds: string[]) => Promise<{ saved: boolean; packageCount: number; linkCount: number; filePath?: string }>;
  exportQueue: () => Promise<{ saved: boolean }>;
  importQueue: (json: string) => Promise<{ addedPackages: number; addedLinks: number }>;
  toggleClipboard: () => Promise<boolean>;
  writeClipboardText: (text: string) => Promise<boolean>;
  pickFolder: () => Promise<string | null>;
  pickContainers: () => Promise<string[]>;
  getSessionStats: () => Promise<SessionStats>;
  resetSessionStats: () => Promise<void>;
  resetDownloadStats: () => Promise<void>;
  restart: () => Promise<void>;
  quit: () => Promise<void>;
  exportBackup: (passphrase: string) => Promise<{ saved: boolean }>;
  selectBackupImport: () => Promise<{ selected: boolean; requiresPassphrase: boolean; message?: string }>;
  importBackup: (passphrase?: string) => Promise<{ restored: boolean; relaunch: boolean; message: string }>;
  cancelBackupImport: () => Promise<void>;
  exportOnlineBackup: () => Promise<{ key: string }>;
  importOnlineBackup: (key: string) => Promise<{ restored: boolean; relaunch: false; message: string }>;
  exportSupportBundle: () => Promise<{ saved: boolean; filePath?: string }>;
  openLog: () => Promise<void>;
  openLogDirectory: () => Promise<void>;
  openAuditLog: () => Promise<void>;
  openRenameLog: () => Promise<void>;
  openSessionLog: () => Promise<void>;
  openTraceLog: () => Promise<void>;
  openPackageLog: (packageId: string) => Promise<void>;
  openItemLog: (itemId: string) => Promise<void>;
  getDebugSetupCheck: () => Promise<DebugSetupCheckResult>;
  getRecentErrors: () => Promise<Array<{ ts: string; level: string; message: string }>>;
  testNotification: (url: string, mention: string) => Promise<boolean>;
  getTraceConfig: () => Promise<SupportTraceConfig>;
  setTraceEnabled: (enabled: boolean, note?: string, durationMinutes?: number) => Promise<SupportTraceConfig>;
  rotateDebugToken: () => Promise<{ path: string }>;
  getRemoteDiagnostics: () => Promise<RemoteDiagnosticsInfo>;
  enableRemoteDiagnostics: (input: EnableRemoteDiagnosticsInput) => Promise<RemoteDiagnosticsInfo>;
  disableRemoteDiagnostics: () => Promise<RemoteDiagnosticsInfo>;
  rotateRemoteDiagnosticsToken: () => Promise<RemoteDiagnosticsInfo>;
  openRealDebridLogin: () => Promise<void>;
  openAllDebridLogin: () => Promise<void>;
  importBestDebridCookies: () => Promise<number>;
  getAllDebridHostInfo: () => Promise<AllDebridHostInfo>;
  getDebridLinkHostLimits: () => Promise<DebridLinkHostLimitInfo[]>;
  checkDebridAccounts: () => Promise<DebridAccountStatus[]>;
  checkAccountCredentials: (input: AccountCredentialCheckInput) => Promise<DebridAccountStatus>;
  retryExtraction: (packageId: string) => Promise<void>;
  extractNow: (packageId: string) => Promise<void>;
  resetPackage: (packageId: string) => Promise<void>;
  getHistory: () => Promise<HistoryEntry[]>;
  clearHistory: () => Promise<void>;
  removeHistoryEntry: (entryId: string) => Promise<void>;
  revealHistoryEntry: (entryId: string) => Promise<HistoryRevealResult>;
  setPackagePriority: (packageId: string, priority: PackagePriority) => Promise<void>;
  skipItems: (itemIds: string[]) => Promise<void>;
  resetItems: (itemIds: string[]) => Promise<void>;
  startItems: (itemIds: string[]) => Promise<void>;
  reportRendererError: (report: RendererErrorReport) => void;
  onStateUpdate: (callback: (snapshot: UiSnapshot) => void) => () => void;
  onClipboardDetected: (callback: (links: string[]) => void) => () => void;
  onUpdateInstallProgress: (callback: (progress: UpdateInstallProgress) => void) => () => void;
}
