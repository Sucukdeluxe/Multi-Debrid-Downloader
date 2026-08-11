import { parseDebridLinkApiKeys } from "../shared/debrid-link-keys";
import { getMegaDebridAccountsForMode, getMegaDebridDisabledAccountIdsForMode, parseMegaDebridAccounts } from "../shared/mega-debrid-accounts";
import type { AppSettings, DebridAccountStatus, DebridProvider, RendererAccount, RendererAccountKind, RendererSettings } from "../shared/types";

function maskValue(value: string, keepStart = 3, keepEnd = 3): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length <= keepStart + keepEnd) {
    return "*".repeat(trimmed.length);
  }
  return `${trimmed.slice(0, keepStart)}${"*".repeat(Math.max(4, trimmed.length - keepStart - keepEnd))}${trimmed.slice(-keepEnd)}`;
}

function getSecrets(settings: AppSettings): string[] {
  const megaSecrets = [settings.megaCredentials, settings.megaDebridApiCredentials, settings.megaDebridWebCredentials]
    .flatMap((credentials) => parseMegaDebridAccounts(credentials, settings.megaPassword))
    .map((account) => account.password);
  const debridLinkSecrets = parseDebridLinkApiKeys(settings.debridLinkApiKeys).map((key) => key.token);
  return [...new Set([
    settings.token,
    settings.megaPassword,
    settings.megaCredentials,
    settings.megaDebridApiCredentials,
    settings.megaDebridWebCredentials,
    ...megaSecrets,
    settings.bestToken,
    settings.allDebridToken,
    settings.ddownloadPassword,
    settings.oneFichierApiKey,
    settings.debridLinkApiKeys,
    ...debridLinkSecrets,
    settings.linkSnappyPassword,
    settings.archivePasswordList,
    settings.notifyUrl
  ].map((value) => value.trim()).filter(Boolean))].sort((left, right) => right.length - left.length);
}

function redact(value: string, secrets: readonly string[]): string {
  return secrets.reduce((result, secret) => result.split(secret).join("[geschützt]"), value);
}

function safeStatus(status: DebridAccountStatus | undefined, secrets: readonly string[]): DebridAccountStatus | null {
  if (!status) {
    return null;
  }
  return {
    ...status,
    label: redact(status.label, secrets),
    maskedLogin: redact(status.maskedLogin, secrets),
    email: status.email ? redact(status.email, secrets) : undefined,
    message: redact(status.message, secrets)
  };
}

function providerEnabled(settings: AppSettings, provider: DebridProvider): boolean {
  return !settings.disabledProviders.includes(provider);
}

function singleAccount(
  settings: AppSettings,
  kind: RendererAccountKind,
  provider: DebridProvider,
  identity: string,
  maskedIdentity: string,
  hasSecret: boolean
): RendererAccount {
  return {
    accountId: `svc-${provider}`,
    kind,
    provider,
    identity,
    maskedIdentity,
    hasSecret,
    enabled: providerEnabled(settings, provider),
    dailyLimitBytes: settings.providerDailyLimitBytes[provider] || 0,
    dailyUsageBytes: settings.providerDailyUsageBytes[provider] || 0,
    totalUsageBytes: settings.providerTotalUsageBytes[provider] || 0,
    status: null
  };
}

export function createRendererAccounts(settings: AppSettings): RendererAccount[] {
  const accounts: RendererAccount[] = [];
  const secrets = getSecrets(settings);
  if (settings.realDebridUseWebLogin || settings.token.trim()) {
    accounts.push(singleAccount(
      settings,
      settings.realDebridUseWebLogin ? "realdebrid-web" : "realdebrid-api",
      "realdebrid",
      "",
      settings.realDebridUseWebLogin ? "Browser-Login" : maskValue(settings.token),
      true
    ));
  }
  for (const mode of ["api", "web"] as const) {
    const kind: RendererAccountKind = mode === "api" ? "megadebrid-api" : "megadebrid-web";
    const provider: DebridProvider = kind;
    const modeEnabled = mode === "api" ? settings.megaDebridApiEnabled : settings.megaDebridWebEnabled;
    const disabledIds = new Set(getMegaDebridDisabledAccountIdsForMode(settings, mode));
    for (const account of getMegaDebridAccountsForMode(settings, mode)) {
      accounts.push({
        accountId: account.id,
        kind,
        provider,
        identity: account.login,
        maskedIdentity: account.maskedLogin,
        hasSecret: Boolean(account.password),
        enabled: modeEnabled && providerEnabled(settings, provider) && !disabledIds.has(account.id),
        dailyLimitBytes: settings.megaDebridAccountDailyLimitBytes[account.id] || 0,
        dailyUsageBytes: settings.megaDebridAccountDailyUsageBytes[account.id] || 0,
        totalUsageBytes: settings.megaDebridAccountTotalUsageBytes[account.id] || 0,
        status: safeStatus(settings.debridAccountStatuses[account.id], secrets)
      });
    }
  }
  if (settings.bestDebridUseWebLogin || settings.bestToken.trim()) {
    accounts.push(singleAccount(
      settings,
      settings.bestDebridUseWebLogin ? "bestdebrid-web" : "bestdebrid-api",
      "bestdebrid",
      "",
      settings.bestDebridUseWebLogin ? "Cookie-Import" : maskValue(settings.bestToken),
      true
    ));
  }
  if (settings.allDebridUseWebLogin || settings.allDebridToken.trim()) {
    accounts.push(singleAccount(
      settings,
      settings.allDebridUseWebLogin ? "alldebrid-web" : "alldebrid-api",
      "alldebrid",
      "",
      settings.allDebridUseWebLogin ? "Browser-Login" : maskValue(settings.allDebridToken),
      true
    ));
  }
  if (settings.ddownloadLogin.trim() && settings.ddownloadPassword) {
    accounts.push(singleAccount(settings, "ddownload-login", "ddownload", settings.ddownloadLogin.trim(), maskValue(settings.ddownloadLogin, 2, 4), true));
  }
  if (settings.oneFichierApiKey.trim()) {
    accounts.push(singleAccount(settings, "onefichier-api", "onefichier", "", maskValue(settings.oneFichierApiKey), true));
  }
  for (const key of parseDebridLinkApiKeys(settings.debridLinkApiKeys)) {
    accounts.push({
      accountId: key.id,
      kind: "debridlink-api",
      provider: "debridlink",
      identity: "",
      maskedIdentity: key.masked,
      hasSecret: true,
      enabled: providerEnabled(settings, "debridlink") && !settings.debridLinkDisabledKeyIds.includes(key.id),
      dailyLimitBytes: settings.debridLinkApiKeyDailyLimitBytes[key.id] || 0,
      dailyUsageBytes: settings.debridLinkApiKeyDailyUsageBytes[key.id] || 0,
      totalUsageBytes: settings.debridLinkApiKeyTotalUsageBytes[key.id] || 0,
      status: safeStatus(settings.debridAccountStatuses[key.id], secrets)
    });
  }
  if (settings.linkSnappyLogin.trim() && settings.linkSnappyPassword) {
    accounts.push(singleAccount(settings, "linksnappy-login", "linksnappy", settings.linkSnappyLogin.trim(), maskValue(settings.linkSnappyLogin, 2, 4), true));
  }
  return accounts;
}

export function createRendererSettings(settings: AppSettings): RendererSettings {
  const configuredProviders = [...new Set(createRendererAccounts(settings).map((account) => account.provider))];
  return {
    language: settings.language,
    realDebridUseWebLogin: settings.realDebridUseWebLogin,
    megaDebridApiEnabled: settings.megaDebridApiEnabled,
    megaDebridWebEnabled: settings.megaDebridWebEnabled,
    megaDebridPreferApi: settings.megaDebridPreferApi,
    bestDebridUseWebLogin: settings.bestDebridUseWebLogin,
    allDebridUseWebLogin: settings.allDebridUseWebLogin,
    debridLinkDisabledKeyIds: [...settings.debridLinkDisabledKeyIds],
    rememberToken: settings.rememberToken,
    configuredProviders,
    providerOrder: [...settings.providerOrder],
    providerPrimary: settings.providerPrimary,
    providerSecondary: settings.providerSecondary,
    providerTertiary: settings.providerTertiary,
    autoProviderFallback: settings.autoProviderFallback,
    outputDir: settings.outputDir,
    packageName: settings.packageName,
    autoExtract: settings.autoExtract,
    autoRename4sf4sj: settings.autoRename4sf4sj,
    keepGermanAudioOnly: settings.keepGermanAudioOnly,
    germanAudioMode: settings.germanAudioMode,
    extractDir: settings.extractDir,
    collectMkvToLibrary: settings.collectMkvToLibrary,
    mkvLibraryDir: settings.mkvLibraryDir,
    createExtractSubfolder: settings.createExtractSubfolder,
    hybridExtract: settings.hybridExtract,
    cleanupMode: settings.cleanupMode,
    extractConflictMode: settings.extractConflictMode,
    removeLinkFilesAfterExtract: settings.removeLinkFilesAfterExtract,
    removeSamplesAfterExtract: settings.removeSamplesAfterExtract,
    enableIntegrityCheck: settings.enableIntegrityCheck,
    autoResumeOnStart: settings.autoResumeOnStart,
    autoReconnect: settings.autoReconnect,
    reconnectWaitSeconds: settings.reconnectWaitSeconds,
    completedCleanupPolicy: settings.completedCleanupPolicy,
    maxParallel: settings.maxParallel,
    maxParallelExtract: settings.maxParallelExtract,
    retryLimit: settings.retryLimit,
    speedLimitEnabled: settings.speedLimitEnabled,
    speedLimitKbps: settings.speedLimitKbps,
    speedLimitMode: settings.speedLimitMode,
    updateRepo: settings.updateRepo,
    autoUpdateCheck: settings.autoUpdateCheck,
    clipboardWatch: settings.clipboardWatch,
    minimizeToTray: settings.minimizeToTray,
    theme: settings.theme,
    collapseNewPackages: settings.collapseNewPackages,
    historyRetentionMode: settings.historyRetentionMode,
    historyMaxEntries: settings.historyMaxEntries,
    historyMaxAgeDays: settings.historyMaxAgeDays,
    accountListShowDetailedDebridLinkKeys: settings.accountListShowDetailedDebridLinkKeys,
    autoSortPackagesByProgress: settings.autoSortPackagesByProgress,
    autoSkipExtracted: settings.autoSkipExtracted,
    hideExtractedItems: settings.hideExtractedItems,
    confirmDeleteSelection: settings.confirmDeleteSelection,
    backupIncludeDownloads: settings.backupIncludeDownloads,
    backupIncludeRemoteDiagnostics: settings.backupIncludeRemoteDiagnostics,
    archivePasswordListConfigured: Boolean(settings.archivePasswordList.trim()),
    notifyUrlConfigured: Boolean(settings.notifyUrl.trim()),
    notifyMention: settings.notifyMention,
    notifyOnPackageCompleted: settings.notifyOnPackageCompleted,
    notifyOnPackageFailed: settings.notifyOnPackageFailed,
    notifyOnRunFinished: settings.notifyOnRunFinished,
    totalDownloadedAllTime: settings.totalDownloadedAllTime,
    totalCompletedFilesAllTime: settings.totalCompletedFilesAllTime,
    totalRuntimeAllTimeMs: settings.totalRuntimeAllTimeMs,
    bandwidthSchedules: settings.bandwidthSchedules.map((entry) => ({ ...entry })),
    columnOrder: [...settings.columnOrder],
    columnOrderVersion: settings.columnOrderVersion,
    extractCpuPriority: settings.extractCpuPriority,
    autoExtractWhenStopped: settings.autoExtractWhenStopped,
    disabledProviders: [...settings.disabledProviders],
    hosterRouting: { ...settings.hosterRouting },
    providerDailyLimitBytes: { ...settings.providerDailyLimitBytes },
    providerDailyUsageBytes: { ...settings.providerDailyUsageBytes },
    providerTotalUsageBytes: { ...settings.providerTotalUsageBytes },
    debridLinkApiKeyDailyLimitBytes: { ...settings.debridLinkApiKeyDailyLimitBytes },
    debridLinkApiKeyDailyUsageBytes: { ...settings.debridLinkApiKeyDailyUsageBytes },
    debridLinkApiKeyTotalUsageBytes: { ...settings.debridLinkApiKeyTotalUsageBytes },
    megaDebridDisabledAccountIds: [...settings.megaDebridDisabledAccountIds],
    megaDebridApiDisabledAccountIds: [...settings.megaDebridApiDisabledAccountIds],
    megaDebridWebDisabledAccountIds: [...settings.megaDebridWebDisabledAccountIds],
    megaDebridAccountDailyLimitBytes: { ...settings.megaDebridAccountDailyLimitBytes },
    megaDebridAccountDailyUsageBytes: { ...settings.megaDebridAccountDailyUsageBytes },
    megaDebridAccountTotalUsageBytes: { ...settings.megaDebridAccountTotalUsageBytes },
    debridAccountStatuses: Object.fromEntries(Object.entries(settings.debridAccountStatuses).map(([id, status]) => [id, safeStatus(status, getSecrets(settings))])),
    providerDailyUsageDay: settings.providerDailyUsageDay,
    scheduledStartEpochMs: settings.scheduledStartEpochMs
  } as RendererSettings;
}

export function createRendererState(settings: AppSettings): { settings: RendererSettings; accounts: RendererAccount[] } {
  return {
    settings: createRendererSettings(settings),
    accounts: createRendererAccounts(settings)
  };
}
