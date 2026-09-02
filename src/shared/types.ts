export type DownloadStatus =
  | "queued"
  | "validating"
  | "downloading"
  | "paused"
  | "reconnect_wait"
  | "extracting"
  | "integrity_check"
  | "completed"
  | "failed"
  | "cancelled";

export type CleanupMode = "none" | "trash" | "delete";
export type ConflictMode = "overwrite" | "skip" | "rename" | "ask";
export type SpeedMode = "global" | "per_download";
export type FinishedCleanupPolicy = "never" | "immediate" | "on_start" | "package_done";
export type OfflineSkipScope = "archive" | "package";
export type DebridProvider =
  | "realdebrid"
  | "megadebrid"
  | "megadebrid-api"
  | "megadebrid-web"
  | "bestdebrid"
  | "alldebrid"
  | "deepbrid"
  | "ddownload"
  | "onefichier"
  | "debridlink"
  | "linksnappy";
export type DebridFallbackProvider = DebridProvider | "none";
export type AppTheme = "dark" | "light";
export type ThemePreference = AppTheme | "system";
export type AppLanguage = "en" | "de";
export type PackagePriority = "high" | "normal" | "low";
export type ExtractCpuPriority = "high" | "middle" | "low";
export type HistoryRetentionMode = "never" | "session" | "permanent";
export type LogStorageLocation = "appdata" | "desktop";

export interface BandwidthScheduleEntry {
  id: string;
  startHour: number;
  endHour: number;
  speedLimitKbps: number;
  enabled: boolean;
}

export interface StatisticsProviderBucket {
  bytes: number;
  completed: number;
  failed: number;
}

export interface StatisticsDayBucket {
  day: string;
  downloadedBytes: number;
  measuredBytes: number;
  completedFiles: number;
  failedFiles: number;
  activeDownloadMs: number;
  providers: Partial<Record<DebridProvider, StatisticsProviderBucket>>;
}

export interface StatisticsAccountMinuteUsage {
  provider: DebridProvider;
  label: string;
  bytes: number;
}

export interface StatisticsMinuteBucket {
  minute: number;
  downloadedBytes: number;
  accounts: Record<string, StatisticsAccountMinuteUsage>;
}

export interface StatisticsAccountUsage {
  id: string;
  provider: DebridProvider;
  label: string;
  bytes: number;
}

export interface StatisticsRolling24Hours {
  from: number;
  to: number;
  downloadedBytes: number;
  accounts: StatisticsAccountUsage[];
}

export interface StatisticsLedger {
  version: 2;
  startedAt: number;
  minuteTrackingStartedAt?: number;
  providerSeedSuppressedDay?: string;
  providerSeedBaselineBytes?: Partial<Record<DebridProvider, number>>;
  providerBytesOnlyDays?: string[];
  days: StatisticsDayBucket[];
  minutes: StatisticsMinuteBucket[];
}

export interface DownloadStats {
  totalDownloaded: number;
  totalDownloadedAllTime: number;
  totalFiles?: number;
  totalFilesSession: number;
  totalFilesAllTime: number;
  totalPackages: number;
  sessionStartedAt: number;
  appSessionStartedAt: number;
  sessionRuntimeMs: number;
  totalRuntimeMs: number;
  runtimeMeasuredAt: number;
  statistics?: StatisticsLedger;
  rolling24Hours?: StatisticsRolling24Hours;
}

export interface DebridAccountStatus {
  accountId: string;
  provider: DebridProvider;
  label: string;
  maskedLogin: string;
  valid: boolean;
  isPremium: boolean;
  premiumUntilMs: number | null;
  username?: string;
  email?: string;
  message: string;
  checkedAt: number;
}

export type NotifyPackageSuccessMode = "digest" | "individual";

export type DailyStartOutcome = "" | "started" | "already_active" | "empty_queue" | "missing_account" | "start_failed" | "missed";

export interface DailyStartSettings {
  dailyStartEnabled: boolean;
  dailyStartMinuteOfDay: number;
  dailyStartFirstLocalDate: string;
  dailyStartLastHandledLocalDate: string;
  dailyStartPendingLocalDate: string;
  dailyStartLastOutcome: DailyStartOutcome;
}

export interface ProxyDownloadSettings {
  proxyDownloadEnabled: boolean;
  proxyListPath: string;
  proxyApiProxyIndex: number;
  proxyConnectionsPerDownload: number;
}

export interface AppSettings extends DailyStartSettings, ProxyDownloadSettings {
  language: AppLanguage;
  token: string;
  realDebridUseWebLogin: boolean;
  realDebridApiTokens: string;
  realDebridWebAccountIds: string[];
  realDebridDisabledAccountIds: string[];
  realDebridAccountDailyLimitBytes: Record<string, number>;
  realDebridAccountDailyUsageBytes: Record<string, number>;
  realDebridAccountTotalUsageBytes: Record<string, number>;
  megaLogin: string;
  megaPassword: string;
  megaCredentials: string;
  megaDebridApiCredentials: string;
  megaDebridWebCredentials: string;
  megaDebridApiEnabled: boolean;
  megaDebridWebEnabled: boolean;
  megaDebridPreferApi: boolean;
  bestToken: string;
  bestDebridUseWebLogin: boolean;
  allDebridToken: string;
  allDebridUseWebLogin: boolean;
  deepbridApiKey: string;
  ddownloadLogin: string;
  ddownloadPassword: string;
  oneFichierApiKey: string;
  debridLinkApiKeys: string;
  debridLinkDisabledKeyIds: string[];
  linkSnappyLogin: string;
  linkSnappyPassword: string;
  archivePasswordList: string;
  rememberToken: boolean;
  providerOrder: readonly DebridProvider[];
  providerPrimary: DebridProvider;
  providerSecondary: DebridFallbackProvider;
  providerTertiary: DebridFallbackProvider;
  autoProviderFallback: boolean;
  outputDir: string;
  createWorkDirectoriesOnStartup: boolean;
  packageName: string;
  autoExtract: boolean;
  autoRename4sf4sj: boolean;
  keepGermanAudioOnly: boolean;
  germanAudioMode: "tag" | "first";
  extractDir: string;
  collectMkvToLibrary: boolean;
  mkvLibraryDir: string;
  createExtractSubfolder: boolean;
  hybridExtract: boolean;
  cleanupMode: CleanupMode;
  extractConflictMode: ConflictMode;
  removeLinkFilesAfterExtract: boolean;
  removeSamplesAfterExtract: boolean;
  enableIntegrityCheck: boolean;
  autoResumeOnStart: boolean;
  autoReconnect: boolean;
  reconnectWaitSeconds: number;
  completedCleanupPolicy: FinishedCleanupPolicy;
  maxParallel: number;
  maxParallelExtract: number;
  retryLimit: number;
  offlineSkipScope: OfflineSkipScope;
  speedLimitEnabled: boolean;
  speedLimitKbps: number;
  speedLimitMode: SpeedMode;
  updateRepo: string;
  autoUpdateCheck: boolean;
  clipboardWatch: boolean;
  minimizeToTray: boolean;
  theme: AppTheme;
  themePreference: ThemePreference;
  logStorageLocation: LogStorageLocation;
  collapseNewPackages: boolean;
  animatePackageDisclosure: boolean;
  historyRetentionMode: HistoryRetentionMode;
  historyMaxEntries: number;
  historyMaxAgeDays: number;
  accountListShowDetailedDebridLinkKeys: boolean;
  autoSortPackagesByProgress: boolean;
  autoSkipExtracted: boolean;
  hideExtractedItems: boolean;
  confirmDeleteSelection: boolean;
  backupIncludeDownloads: boolean;
  backupIncludeRemoteDiagnostics: boolean;
  notifyUrl: string;
  notifyMention: string;
  notifyOnPackageCompleted: boolean;
  notifyOnPackageFailed: boolean;
  notifyOnRunFinished: boolean;
  notifyPackageSuccessMode: NotifyPackageSuccessMode;
  notifyOnRemainingBelow: boolean;
  notifyRemainingThresholdGb: number;
  notifyOnDownloadStall: boolean;
  notifyStallAfterSeconds: number;
  notifyStallCooldownMinutes: number;
  notifyOnDownloadRecovery: boolean;
  totalDownloadedAllTime: number;
  totalCompletedFilesAllTime: number;
  totalRuntimeAllTimeMs: number;
  bandwidthSchedules: BandwidthScheduleEntry[];
  columnOrder: string[];
  columnOrderVersion?: number;
  extractCpuPriority: ExtractCpuPriority;
  autoExtractWhenStopped: boolean;
  disabledProviders: DebridProvider[];
  hosterRouting: Record<string, DebridProvider>;
  providerDailyLimitBytes: Partial<Record<DebridProvider, number>>;
  providerDailyUsageBytes: Partial<Record<DebridProvider, number>>;
  providerTotalUsageBytes: Partial<Record<DebridProvider, number>>;
  debridLinkApiKeyDailyLimitBytes: Record<string, number>;
  debridLinkApiKeyDailyUsageBytes: Record<string, number>;
  debridLinkApiKeyTotalUsageBytes: Record<string, number>;
  megaDebridDisabledAccountIds: string[];
  megaDebridApiDisabledAccountIds: string[];
  megaDebridWebDisabledAccountIds: string[];
  megaDebridAccountDailyLimitBytes: Record<string, number>;
  megaDebridAccountDailyUsageBytes: Record<string, number>;
  megaDebridAccountTotalUsageBytes: Record<string, number>;
  debridAccountStatuses: Record<string, DebridAccountStatus>;
  providerDailyUsageDay: string;
  scheduledStartEpochMs: number;
}

export type AccountCheckScope = "active" | "all";

export type RendererAccountKind =
  | "realdebrid-api"
  | "realdebrid-web"
  | "megadebrid-api"
  | "megadebrid-web"
  | "bestdebrid-api"
  | "bestdebrid-web"
  | "alldebrid-api"
  | "alldebrid-web"
  | "deepbrid-api"
  | "ddownload-login"
  | "onefichier-api"
  | "debridlink-api"
  | "linksnappy-login";

export interface RendererAccount {
  accountId: string;
  kind: RendererAccountKind;
  provider: DebridProvider;
  identity: string;
  maskedIdentity: string;
  hasSecret: boolean;
  enabled: boolean;
  dailyLimitBytes: number;
  dailyUsageBytes: number;
  totalUsageBytes: number;
  status: DebridAccountStatus | null;
}

export interface RendererSettings extends DailyStartSettings, ProxyDownloadSettings {
  language: AppLanguage;
  realDebridUseWebLogin: boolean;
  realDebridDisabledAccountIds: string[];
  realDebridAccountDailyLimitBytes: Record<string, number>;
  realDebridAccountDailyUsageBytes: Record<string, number>;
  realDebridAccountTotalUsageBytes: Record<string, number>;
  megaDebridApiEnabled: boolean;
  megaDebridWebEnabled: boolean;
  megaDebridPreferApi: boolean;
  bestDebridUseWebLogin: boolean;
  allDebridUseWebLogin: boolean;
  debridLinkDisabledKeyIds: string[];
  rememberToken: boolean;
  configuredProviders: DebridProvider[];
  providerOrder: readonly DebridProvider[];
  providerPrimary: DebridProvider;
  providerSecondary: DebridFallbackProvider;
  providerTertiary: DebridFallbackProvider;
  autoProviderFallback: boolean;
  outputDir: string;
  createWorkDirectoriesOnStartup: boolean;
  packageName: string;
  autoExtract: boolean;
  autoRename4sf4sj: boolean;
  keepGermanAudioOnly: boolean;
  germanAudioMode: "tag" | "first";
  extractDir: string;
  collectMkvToLibrary: boolean;
  mkvLibraryDir: string;
  createExtractSubfolder: boolean;
  hybridExtract: boolean;
  cleanupMode: CleanupMode;
  extractConflictMode: ConflictMode;
  removeLinkFilesAfterExtract: boolean;
  removeSamplesAfterExtract: boolean;
  enableIntegrityCheck: boolean;
  autoResumeOnStart: boolean;
  autoReconnect: boolean;
  reconnectWaitSeconds: number;
  completedCleanupPolicy: FinishedCleanupPolicy;
  maxParallel: number;
  maxParallelExtract: number;
  retryLimit: number;
  offlineSkipScope: OfflineSkipScope;
  speedLimitEnabled: boolean;
  speedLimitKbps: number;
  speedLimitMode: SpeedMode;
  updateRepo: string;
  autoUpdateCheck: boolean;
  clipboardWatch: boolean;
  minimizeToTray: boolean;
  theme: AppTheme;
  themePreference: ThemePreference;
  logStorageLocation: LogStorageLocation;
  collapseNewPackages: boolean;
  animatePackageDisclosure: boolean;
  historyRetentionMode: HistoryRetentionMode;
  historyMaxEntries: number;
  historyMaxAgeDays: number;
  accountListShowDetailedDebridLinkKeys: boolean;
  autoSortPackagesByProgress: boolean;
  autoSkipExtracted: boolean;
  hideExtractedItems: boolean;
  confirmDeleteSelection: boolean;
  backupIncludeDownloads: boolean;
  backupIncludeRemoteDiagnostics: boolean;
  archivePasswordListConfigured: boolean;
  notifyUrlConfigured: boolean;
  notifyMention: string;
  notifyOnPackageCompleted: boolean;
  notifyOnPackageFailed: boolean;
  notifyOnRunFinished: boolean;
  notifyPackageSuccessMode: NotifyPackageSuccessMode;
  notifyOnRemainingBelow: boolean;
  notifyRemainingThresholdGb: number;
  notifyOnDownloadStall: boolean;
  notifyStallAfterSeconds: number;
  notifyStallCooldownMinutes: number;
  notifyOnDownloadRecovery: boolean;
  totalDownloadedAllTime: number;
  totalCompletedFilesAllTime: number;
  totalRuntimeAllTimeMs: number;
  bandwidthSchedules: BandwidthScheduleEntry[];
  columnOrder: string[];
  columnOrderVersion?: number;
  extractCpuPriority: ExtractCpuPriority;
  autoExtractWhenStopped: boolean;
  disabledProviders: DebridProvider[];
  hosterRouting: Record<string, DebridProvider>;
  providerDailyLimitBytes: Partial<Record<DebridProvider, number>>;
  providerDailyUsageBytes: Partial<Record<DebridProvider, number>>;
  providerTotalUsageBytes: Partial<Record<DebridProvider, number>>;
  debridLinkApiKeyDailyLimitBytes: Record<string, number>;
  debridLinkApiKeyDailyUsageBytes: Record<string, number>;
  debridLinkApiKeyTotalUsageBytes: Record<string, number>;
  megaDebridDisabledAccountIds: string[];
  megaDebridApiDisabledAccountIds: string[];
  megaDebridWebDisabledAccountIds: string[];
  megaDebridAccountDailyLimitBytes: Record<string, number>;
  megaDebridAccountDailyUsageBytes: Record<string, number>;
  megaDebridAccountTotalUsageBytes: Record<string, number>;
  debridAccountStatuses: Record<string, DebridAccountStatus>;
  providerDailyUsageDay: string;
  scheduledStartEpochMs: number;
  nextDailyStartEpochMs: number;
}

export type RendererSettingsUpdate = Partial<Omit<RendererSettings,
  "dailyStartLastHandledLocalDate"
  | "dailyStartPendingLocalDate"
  | "dailyStartLastOutcome"
  | "nextDailyStartEpochMs"
>> & {
  archivePasswordList?: string;
  notifyUrl?: string;
};

export interface AccountCreateCommand {
  action: "create";
  kind: RendererAccountKind;
  identity?: string;
  secret?: string;
  dailyLimitBytes?: number;
}

export interface AccountReplaceCommand {
  action: "replace";
  kind: RendererAccountKind;
  accountId: string;
  identity?: string;
  secret?: string;
  dailyLimitBytes?: number;
}

export interface AccountUpdateSecretCommand {
  action: "update-secret";
  kind: RendererAccountKind;
  accountId: string;
  secret: string;
}

export interface AccountDeleteCommand {
  action: "delete";
  kind: RendererAccountKind;
  accountId: string;
}

export type AccountCommand = AccountCreateCommand | AccountReplaceCommand | AccountUpdateSecretCommand | AccountDeleteCommand;

export interface AccountCommandResult {
  accountId: string | null;
  settings: RendererSettings;
  accounts: RendererAccount[];
}

export interface AccountCredentialCheckInput {
  kind: "realdebrid-api" | "realdebrid-web" | "megadebrid-api" | "megadebrid-web" | "debridlink-api" | "deepbrid-api";
  accountId?: string;
  identity?: string;
  secret?: string;
}

export interface AccountSecretRequest {
  kind: RendererAccountKind;
  accountId: string;
}

export interface AccountSecretResult {
  secret: string;
}

export interface ArchivePasswordListResult {
  passwords: string;
}

export interface DownloadItem {
  id: string;
  packageId: string;
  url: string;
  provider: DebridProvider | null;
  providerLabel?: string;
  providerAccountId?: string;
  providerAccountLabel?: string;
  status: DownloadStatus;
  retries: number;
  speedBps: number;
  downloadedBytes: number;
  totalBytes: number | null;
  progressPercent: number;
  fileName: string;
  targetPath: string;
  metadataRenameTargetPath?: string;
  resumable: boolean;
  attempts: number;
  archiveRecoveryRedownloads?: number;
  lastError: string;
  fullStatus: string;
  createdAt: number;
  updatedAt: number;
  onlineStatus?: "online" | "offline" | "checking";
}

export interface AudioStripFileResult {
  name: string;
  action: string;
  reason: string;
  languages?: string;
}

export interface AudioStripSummary {
  at: number;
  candidates: number;
  remuxed: number;
  keptSingle: number;
  skippedNoGerman: number;
  skippedNoTool: number;
  failed: number;
  files: AudioStripFileResult[];
}

export type PackageResultStatus = "completed" | "partial" | "failed" | "cancelled";
export type FailurePhase = "download" | "extract" | "remux" | "cleanup" | "postprocess" | null;

export interface ArchiveOperationMetric {
  id: string;
  name: string;
  itemIds: string[];
  partCount: number;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  status: "completed" | "failed" | "cancelled";
  errorCategory: string;
}

export interface RemuxOperationMetric {
  id: string;
  fileName: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  status: "completed" | "failed" | "cancelled";
  errorCategory: string;
}

export interface PackageTelemetry {
  package: PackageEntry;
  items: DownloadItem[];
  archiveOperations?: ArchiveOperationMetric[];
  remuxOperations?: RemuxOperationMetric[];
  outputCount?: number;
  cleanupErrorCategory?: string;
  postProcessErrorCategory?: string;
}

export interface PackageResult {
  packageId: string;
  name: string;
  status: PackageResultStatus;
  startedAt: number;
  downloadEndedAt: number;
  postProcessStartedAt: number;
  completedAt: number;
  downloadDurationSeconds: number;
  extractionDurationSeconds: number;
  remuxDurationSeconds: number;
  postProcessDurationSeconds: number;
  totalDurationSeconds: number;
  totalBytes: number;
  downloadedBytes: number;
  averageDownloadSpeedBps: number;
  successfulFiles: number;
  failedFiles: number;
  cancelledFiles: number;
  downloadFailures: number;
  offlineFailures: number;
  extractionFailures: number;
  remuxFailures: number;
  cleanupFailures: number;
  postProcessFailures: number;
  archiveCount: number;
  partCount: number;
  outputCount: number;
  failurePhase: FailurePhase;
  errorCategory: string;
  archiveOperations: ArchiveOperationMetric[];
  remuxOperations: RemuxOperationMetric[];
}

export interface PackageEntry {
  id: string;
  name: string;
  outputDir: string;
  extractDir: string;
  status: DownloadStatus;
  itemIds: string[];
  cancelled: boolean;
  enabled: boolean;
  priority?: PackagePriority;
  postProcessLabel?: string;
  audioStripSummary?: AudioStripSummary;
  cleanedCompletedItemCount?: number;
  cleanedExtractedItemCount?: number;
  cleanedDownloadedBytes?: number;
  cleanedTotalBytes?: number;
  cleanedUrls?: string[];
  cleanedProviders?: DebridProvider[];
  downloadStartedAt?: number;
  downloadCompletedAt?: number;
  downloadEndedAt?: number;
  postProcessQueuedAt?: number;
  postProcessStartedAt?: number;
  postProcessCompletedAt?: number;
  terminalAt?: number;
  archiveOperations?: ArchiveOperationMetric[];
  remuxOperations?: RemuxOperationMetric[];
  outputCount?: number;
  outputBaselineSignatures?: string[];
  cleanupErrorCategory?: string;
  postProcessErrorCategory?: string;
  resultGeneration?: number;
  createdAt: number;
  updatedAt: number;
}

export interface SessionState {
  version: number;
  packageOrder: string[];
  packages: Record<string, PackageEntry>;
  items: Record<string, DownloadItem>;
  runStartedAt: number;
  totalDownloadedBytes: number;
  summaryText: string;
  reconnectUntil: number;
  reconnectReason: string;
  paused: boolean;
  running: boolean;
  updatedAt: number;
}

export interface DownloadSummary {
  total: number;
  success: number;
  failed: number;
  cancelled: number;
  extracted: number;
  durationSeconds: number;
  averageSpeedBps: number;
}

export interface ParsedPackageInput {
  name: string;
  links: string[];
  fileNames?: string[];
}

export interface ContainerImportResult {
  packages: ParsedPackageInput[];
  source: "dlc";
}

export interface RotationEvent {
  id: string;
  at: number;
  level: "INFO" | "WARN" | "ERROR";
  provider: string;
  accountLabel: string;
  event: string;
  reason?: string;
  category?: string;
  cooldownSec?: number;
  next?: string;
}

export type AccountRuntimeState = "ready" | "active" | "checking" | "cooldown" | "disabled" | "daily_limit" | "invalid";

export interface AccountRuntimeEntry {
  accountId: string;
  provider: DebridProvider;
  state: AccountRuntimeState;
  reason: string;
  activeDownloads: number;
  inFlight: number;
  attempts: number;
  successes: number;
  failures: number;
  lastUsedAt: number | null;
  cooldownUntil: number | null;
  dailyUsageBytes: number;
}

export interface UiSnapshot {
  settings: RendererSettings;
  accounts: RendererAccount[];
  session: SessionState;
  summary: DownloadSummary | null;
  stats: DownloadStats;
  speedText: string;
  etaText: string;
  canStart: boolean;
  canStop: boolean;
  canPause: boolean;
  clipboardActive: boolean;
  reconnectSeconds: number;
  packageSpeedBps: Record<string, number>;
  runRemainingBytes?: number;
  runRemainingUnknownItems?: number;
  diskWaitEvents?: Array<{
    phase: "download" | "extract" | "remux";
    ownerId: string;
    itemId?: string;
    packageId?: string;
    volumeKey: string;
    requiredBytes: number;
    availableBytes: number;
    deficitBytes: number;
    retryAt: number;
  }>;
  snapshotRevision?: number;
  payloadKind?: "full" | "delta";
  removedItemIds?: string[];
  removedPackageIds?: string[];
  rotationEvents?: RotationEvent[];
  accountRuntime?: AccountRuntimeEntry[];
}

export interface AddLinksPayload {
  rawText: string;
  packageName?: string;
  duplicatePolicy?: DuplicatePolicy;
}

export interface AddContainerPayload {
  filePaths: string[];
}

export type DuplicatePolicy = "keep" | "skip" | "overwrite";

export interface QueueAddResult {
  addedPackages: number;
  addedLinks: number;
  skippedExistingPackages: string[];
  overwrittenPackages: string[];
}

export interface ContainerConflictResult {
  conflicts: string[];
  packageCount: number;
  linkCount: number;
}

export interface StartConflictEntry {
  packageId: string;
  packageName: string;
  extractDir: string;
}

export interface StartConflictResolutionResult {
  skipped: boolean;
  overwritten: boolean;
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  latestTag: string;
  releaseUrl: string;
  setupAssetUrl?: string;
  setupAssetName?: string;
  setupAssetDigest?: string;
  releaseNotes?: string;
  error?: string;
}

export interface UpdateInstallResult {
  started: boolean;
  message: string;
}

export interface UpdateInstallProgress {
  stage: "starting" | "downloading" | "verifying" | "launching" | "done" | "error";
  percent: number | null;
  downloadedBytes: number;
  totalBytes: number | null;
  message: string;
}

export type AllDebridHostState = "up" | "down" | "not_tracked" | "unknown";
export type AllDebridHostInfoSource = "api" | "web";
export type DebridLinkHostState = "up" | "down" | "unknown";
export type DebridLinkKeyState = "ready" | "cooldown" | "invalid" | "quota" | "rate_limit" | "error" | "unknown";

export interface AllDebridHostInfo {
  host: string;
  source: AllDebridHostInfoSource;
  state: AllDebridHostState;
  statusLabel: string;
  fetchedAt: number;
  lastCheckedAt: number | null;
  quota: number | null;
  quotaMax: number | null;
  quotaType: string;
  limitSimuDl: number | null;
  note: string;
}

export interface DebridLinkHostLimitInfo {
  keyId: string;
  keyLabel: string;
  host: string;
  fetchedAt: number;
  trafficCurrentBytes: number | null;
  trafficMaxBytes: number | null;
  linksCurrent: number | null;
  linksMax: number | null;
  note: string;
  state: DebridLinkKeyState;
  stateLabel: string;
  stateDetail: string;
  cooldownUntil: number | null;
  cooldownRemainingMs: number;
  lastCheckedAt: number | null;
  hostState: DebridLinkHostState;
  hostStateLabel: string;
  hostNote: string;
}

export interface ParsedHashEntry {
  fileName: string;
  algorithm: "crc32" | "md5" | "sha1";
  digest: string;
}

export interface BandwidthSample {
  timestamp: number;
  speedBps: number;
}

export interface BandwidthStats {
  samples: BandwidthSample[];
  currentSpeedBps: number;
  averageSpeedBps: number;
  maxSpeedBps: number;
  totalBytesSession: number;
  sessionDurationSeconds: number;
}

export interface SessionStats {
  bandwidth: BandwidthStats;
  totalDownloads: number;
  completedDownloads: number;
  failedDownloads: number;
  activeDownloads: number;
  queuedDownloads: number;
}

export interface SupportTraceConfig {
  enabled: boolean;
  includeMainLog: boolean;
  includeAudit: boolean;
  logDebugRequests: boolean;
  autoDisableAt: string | null;
  updatedAt: string;
}

export interface SupportFileSizeInfo {
  path: string | null;
  exists: boolean;
  bytes: number;
}

export interface SupportDirectorySizeInfo {
  path: string;
  exists: boolean;
  fileCount: number;
  bytes: number;
}

export interface SupportDiskSpaceInfo {
  path: string;
  totalBytes: number | null;
  freeBytes: number | null;
  freePercent: number | null;
}

export interface SupportBundleEstimate {
  estimatedBytes: number;
  estimatedEntries: number;
  duplicatedLiveLogBytes: number;
  note: string;
}

export interface DebugSetupCheckResult {
  status: "ok" | "warn";
  enabled: boolean;
  runtimeBaseDir: string;
  host: string;
  port: number;
  localOnly: boolean;
  tokenConfigured: boolean;
  tokenPath: string;
  supportManifestPath: string;
  supportManifestPresent: boolean;
  traceConfigPath: string | null;
  traceLogPath: string | null;
  traceEnabled: boolean;
  traceAutoDisableAt: string | null;
  diskSpace: {
    runtime: SupportDiskSpaceInfo;
    output: SupportDiskSpaceInfo;
    extract: SupportDiskSpaceInfo;
  };
  logSummary: {
    totalBytes: number;
    main: SupportFileSizeInfo;
    mainBackup: SupportFileSizeInfo;
    audit: SupportFileSizeInfo;
    auditBackup: SupportFileSizeInfo;
    rename: SupportFileSizeInfo;
    renameBackup: SupportFileSizeInfo;
    session: SupportFileSizeInfo;
    trace: SupportFileSizeInfo;
    traceBackup: SupportFileSizeInfo;
    sessionLogs: SupportDirectorySizeInfo;
    packageLogs: SupportDirectorySizeInfo;
    itemLogs: SupportDirectorySizeInfo;
  };
  supportBundle: SupportBundleEstimate;
  warnings: string[];
  notes: string[];
  localUrls: {
    health: string;
    meta: string;
    diagnostics: string;
  };
  remoteUrlTemplates: {
    health: string;
    meta: string;
    diagnostics: string;
  };
}

export interface HistoryEntry {
  id: string;
  name: string;
  totalBytes: number;
  downloadedBytes: number;
  fileCount: number;
  provider: DebridProvider | null;
  completedAt: number;
  durationSeconds: number;
  status: PackageResultStatus | "deleted";
  outputDir: string;
  urls?: string[];
  startedAt?: number;
  downloadEndedAt?: number;
  postProcessStartedAt?: number;
  downloadDurationSeconds?: number;
  extractionDurationSeconds?: number;
  remuxDurationSeconds?: number;
  postProcessDurationSeconds?: number;
  totalDurationSeconds?: number;
  successfulFiles?: number;
  failedFiles?: number;
  cancelledFiles?: number;
  archiveCount?: number;
  partCount?: number;
  outputCount?: number;
  failurePhase?: FailurePhase;
  errorCategory?: string;
  downloadFailures?: number;
  offlineFailures?: number;
  extractionFailures?: number;
  remuxFailures?: number;
  cleanupFailures?: number;
  postProcessFailures?: number;
  archiveOperations?: ArchiveOperationMetric[];
  remuxOperations?: RemuxOperationMetric[];
}

export interface HistoryState {
  entries: HistoryEntry[];
  maxEntries: number;
}

export type HistoryRevealFailureReason =
  | "entry-not-found"
  | "invalid-output-dir"
  | "output-dir-missing"
  | "output-dir-not-directory"
  | "open-failed";

export type HistoryRevealResult =
  | { ok: true }
  | { ok: false; reason: HistoryRevealFailureReason };

export interface RendererErrorReport {
  kind: "error" | "unhandledrejection" | "react";
  message: string;
  stack?: string;
  source?: string;
  line?: number;
  column?: number;
  componentStack?: string;
}

export interface RemoteDiagnosticsStatus {
  running: boolean;
  host: string;
  port: number;
  hasToken: boolean;
  localOnly: boolean;
  allowlistCount: number;
}

export interface RemoteDiagnosticsInfo {
  status: RemoteDiagnosticsStatus;
  code: string | null;
  publicHost: string;
  name: string;
  allowlist: string[];
  suggestedHosts: string[];
}

export interface EnableRemoteDiagnosticsInput {
  hostMode: "local" | "network";
  publicHost: string;
  port?: number;
  allowlist: string[];
  name?: string;
  rotateToken?: boolean;
}
