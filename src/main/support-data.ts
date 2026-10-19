import { getDebridLinkApiKeyIds } from "../shared/debrid-link-keys";
import { getRealDebridAccounts } from "../shared/real-debrid-accounts";
import { isNotifyUrlValid } from "./notify";
import type { AppSettings, HistoryEntry, UiSnapshot } from "../shared/types";
import type { DownloadHealthState } from "./download-health-monitor";
import type { NotificationOutboxStatus } from "./notification-outbox";

function hasText(value: unknown): boolean {
  return String(value || "").trim().length > 0;
}

export interface NotificationSupportPayload {
  queued: number;
  lastSuccessAt: number | null;
  incidentType: DownloadHealthState["incidentType"];
  incidentAgeMs: number | null;
}

export function normalizeNotificationSupportPayload(
  value?: Partial<NotificationSupportPayload> | null
): NotificationSupportPayload {
  const rawQueued = value?.queued;
  const rawLastSuccessAt = value?.lastSuccessAt;
  const rawIncidentAgeMs = value?.incidentAgeMs;
  const queued = typeof rawQueued === "number" && Number.isFinite(rawQueued)
    ? Math.max(0, Math.floor(rawQueued))
    : 0;
  const lastSuccessAt = typeof rawLastSuccessAt === "number" && Number.isFinite(rawLastSuccessAt) && rawLastSuccessAt > 0
    ? Math.floor(rawLastSuccessAt)
    : null;
  const incidentType = value?.incidentType === "scheduler" || value?.incidentType === "no_data"
    ? value.incidentType
    : null;
  const incidentAgeMs = incidentType && typeof rawIncidentAgeMs === "number" && Number.isFinite(rawIncidentAgeMs) && rawIncidentAgeMs >= 0
    ? Math.floor(rawIncidentAgeMs)
    : null;
  return { queued, lastSuccessAt, incidentType, incidentAgeMs };
}

export function buildNotificationSupportPayload(
  outbox: Pick<NotificationOutboxStatus, "queued" | "lastSuccessAt">,
  health: Pick<DownloadHealthState, "incidentType" | "incidentStartedAt">,
  now: number = Date.now()
): NotificationSupportPayload {
  const queued = Number.isFinite(outbox.queued) ? Math.max(0, Math.floor(outbox.queued)) : 0;
  const lastSuccessAt = Number.isFinite(outbox.lastSuccessAt) && outbox.lastSuccessAt > 0
    ? Math.floor(outbox.lastSuccessAt)
    : null;
  const incidentType = health.incidentType === "scheduler" || health.incidentType === "no_data"
    ? health.incidentType
    : null;
  const incidentStartedAt = Number.isFinite(health.incidentStartedAt) && health.incidentStartedAt > 0
    ? Math.floor(health.incidentStartedAt)
    : 0;
  const incidentAgeMs = incidentType && incidentStartedAt > 0
    ? Math.max(0, Math.floor(Number.isFinite(now) ? now : Date.now()) - incidentStartedAt)
    : null;
  return normalizeNotificationSupportPayload({ queued, lastSuccessAt, incidentType, incidentAgeMs });
}

export function buildAccountSummary(settings: AppSettings): Record<string, unknown> {
  const debridLinkKeyIds = getDebridLinkApiKeyIds(settings.debridLinkApiKeys);
  const disabledDebridLinkIds = new Set(settings.debridLinkDisabledKeyIds || []);
  const realDebridAccounts = getRealDebridAccounts(settings);
  const enabledRealDebridAccounts = realDebridAccounts.filter((account) => account.enabled);
  const deepbridStatus = settings.debridAccountStatuses?.["svc-deepbrid"];

  return {
    realDebrid: {
      configured: realDebridAccounts.length > 0 || hasText(settings.token) || settings.realDebridUseWebLogin,
      accountCount: realDebridAccounts.length,
      enabledAccountCount: enabledRealDebridAccounts.length,
      disabledAccountCount: realDebridAccounts.length - enabledRealDebridAccounts.length,
      apiAccountCount: realDebridAccounts.filter((account) => account.kind === "api").length,
      webAccountCount: realDebridAccounts.filter((account) => account.kind === "web").length,
      tokenConfigured: realDebridAccounts.some((account) => account.kind === "api") || hasText(settings.token),
      webLoginEnabled: realDebridAccounts.some((account) => account.kind === "web") || settings.realDebridUseWebLogin,
      rememberToken: settings.rememberToken
    },
    megaDebrid: {
      configured: (hasText(settings.megaLogin) && hasText(settings.megaPassword))
        || settings.megaDebridApiEnabled
        || settings.megaDebridWebEnabled,
      loginConfigured: hasText(settings.megaLogin) && hasText(settings.megaPassword),
      apiEnabled: settings.megaDebridApiEnabled,
      webEnabled: settings.megaDebridWebEnabled,
      preferApi: settings.megaDebridPreferApi
    },
    bestDebrid: {
      configured: hasText(settings.bestToken) || settings.bestDebridUseWebLogin,
      tokenConfigured: hasText(settings.bestToken),
      webLoginEnabled: settings.bestDebridUseWebLogin
    },
    allDebrid: {
      configured: hasText(settings.allDebridToken) || settings.allDebridUseWebLogin,
      tokenConfigured: hasText(settings.allDebridToken),
      webLoginEnabled: settings.allDebridUseWebLogin
    },
    deepbrid: {
      configured: hasText(settings.deepbridApiKey),
      apiKeyConfigured: hasText(settings.deepbridApiKey),
      status: {
        checked: Boolean(deepbridStatus),
        valid: deepbridStatus?.valid ?? null,
        premium: deepbridStatus?.isPremium ?? null,
        premiumUntilMs: deepbridStatus?.premiumUntilMs ?? null,
        checkedAt: deepbridStatus?.checkedAt ?? null
      },
      usage: {
        dailyLimitBytes: settings.providerDailyLimitBytes.deepbrid || 0,
        dailyUsageBytes: settings.providerDailyUsageBytes.deepbrid || 0,
        totalUsageBytes: settings.providerTotalUsageBytes.deepbrid || 0
      }
    },
    ddownload: {
      configured: hasText(settings.ddownloadLogin) && hasText(settings.ddownloadPassword)
    },
    oneFichier: {
      configured: hasText(settings.oneFichierApiKey)
    },
    debridLink: {
      configured: debridLinkKeyIds.length > 0,
      keyCount: debridLinkKeyIds.length,
      enabledKeyCount: debridLinkKeyIds.filter((id) => !disabledDebridLinkIds.has(id)).length,
      disabledKeyCount: debridLinkKeyIds.filter((id) => disabledDebridLinkIds.has(id)).length
    },
    linkSnappy: {
      configured: hasText(settings.linkSnappyLogin) && hasText(settings.linkSnappyPassword)
    },
    disabledProviders: [...(settings.disabledProviders || [])]
  };
}

export function diffAccountSummary(previous: AppSettings, next: AppSettings): Record<string, unknown> {
  const before = buildAccountSummary(previous);
  const after = buildAccountSummary(next);
  const changes: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    const beforeJson = JSON.stringify(before[key]);
    const afterJson = JSON.stringify(after[key]);
    if (beforeJson !== afterJson) {
      changes[key] = after[key];
    }
  }
  return changes;
}

export function buildRedactedSettingsPayload(settings: AppSettings): Record<string, unknown> {
  return {
    paths: {
      outputDir: settings.outputDir,
      extractDir: settings.extractDir,
      mkvLibraryDir: settings.mkvLibraryDir
    },
    providers: {
      providerOrder: settings.providerOrder,
      providerPrimary: settings.providerPrimary,
      providerSecondary: settings.providerSecondary,
      providerTertiary: settings.providerTertiary,
      autoProviderFallback: settings.autoProviderFallback,
      disabledProviders: settings.disabledProviders,
      hosterRouting: settings.hosterRouting
    },
    extraction: {
      autoExtract: settings.autoExtract,
      autoExtractWhenStopped: settings.autoExtractWhenStopped,
      hybridExtract: settings.hybridExtract,
      createExtractSubfolder: settings.createExtractSubfolder,
      cleanupMode: settings.cleanupMode,
      extractConflictMode: settings.extractConflictMode,
      removeLinkFilesAfterExtract: settings.removeLinkFilesAfterExtract,
      removeSamplesAfterExtract: settings.removeSamplesAfterExtract,
      enableIntegrityCheck: settings.enableIntegrityCheck,
      archivePasswordCount: String(settings.archivePasswordList || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .length,
      extractCpuPriority: settings.extractCpuPriority,
      maxParallelExtract: settings.maxParallelExtract
    },
    downloads: {
      maxParallel: settings.maxParallel,
      retryLimit: settings.retryLimit,
      autoResumeOnStart: settings.autoResumeOnStart,
      autoReconnect: settings.autoReconnect,
      reconnectWaitSeconds: settings.reconnectWaitSeconds,
      autoSkipExtracted: settings.autoSkipExtracted,
      completedCleanupPolicy: settings.completedCleanupPolicy
    },
    ui: {
      packageName: settings.packageName,
      theme: settings.theme,
      collapseNewPackages: settings.collapseNewPackages,
      hideExtractedItems: settings.hideExtractedItems,
      confirmDeleteSelection: settings.confirmDeleteSelection,
      clipboardWatch: settings.clipboardWatch,
      minimizeToTray: settings.minimizeToTray,
      columnOrder: settings.columnOrder
    },
    bandwidth: {
      speedLimitEnabled: settings.speedLimitEnabled,
      speedLimitKbps: settings.speedLimitKbps,
      speedLimitMode: settings.speedLimitMode,
      bandwidthSchedules: settings.bandwidthSchedules
    },
    updates: {
      updateRepo: settings.updateRepo,
      autoUpdateCheck: settings.autoUpdateCheck
    },
    notifications: {
      notifyUrlConfigured: Boolean(String(settings.notifyUrl || "").trim()),
      notifyUrlLooksValid: isNotifyUrlValid(settings.notifyUrl),
      notifyMentionConfigured: Boolean(String(settings.notifyMention || "").trim()),
      notifyOnPackageCompleted: settings.notifyOnPackageCompleted,
      notifyOnPackageFailed: settings.notifyOnPackageFailed,
      notifyOnRunFinished: settings.notifyOnRunFinished
    },
    statistics: {
      totalDownloadedAllTime: settings.totalDownloadedAllTime,
      totalCompletedFilesAllTime: settings.totalCompletedFilesAllTime,
      totalRuntimeAllTimeMs: settings.totalRuntimeAllTimeMs,
      providerDailyLimitBytes: settings.providerDailyLimitBytes,
      providerDailyUsageBytes: settings.providerDailyUsageBytes,
      providerTotalUsageBytes: settings.providerTotalUsageBytes,
      debridLinkApiKeyDailyLimitBytes: settings.debridLinkApiKeyDailyLimitBytes,
      debridLinkApiKeyDailyUsageBytes: settings.debridLinkApiKeyDailyUsageBytes,
      debridLinkApiKeyTotalUsageBytes: settings.debridLinkApiKeyTotalUsageBytes,
      providerDailyUsageDay: settings.providerDailyUsageDay
    },
    accounts: buildAccountSummary(settings)
  };
}

export function buildStatsPayload(snapshot: UiSnapshot): Record<string, unknown> {
  const rolling24Hours = snapshot.stats.rolling24Hours;
  return {
    session: {
      ...snapshot.stats,
      ...(rolling24Hours ? {
        rolling24Hours: {
          from: rolling24Hours.from,
          to: rolling24Hours.to,
          downloadedBytes: rolling24Hours.downloadedBytes,
          accounts: rolling24Hours.accounts.map((account) => ({
            provider: account.provider,
            bytes: account.bytes
          }))
        }
      } : {})
    },
    totals: {
      totalPackages: Object.keys(snapshot.session.packages).length,
      totalItems: Object.keys(snapshot.session.items).length,
      speedText: snapshot.speedText,
      etaText: snapshot.etaText,
      canStart: snapshot.canStart,
      canStop: snapshot.canStop,
      canPause: snapshot.canPause
    }
  };
}

export function summarizeHistoryEntry(entry: HistoryEntry): Record<string, unknown> {
  return {
    id: entry.id,
    name: entry.name,
    status: entry.status,
    provider: entry.provider,
    fileCount: entry.fileCount,
    totalBytes: entry.totalBytes,
    downloadedBytes: entry.downloadedBytes,
    durationSeconds: entry.durationSeconds,
    completedAt: entry.completedAt,
    outputDir: entry.outputDir,
    urlCount: Array.isArray(entry.urls) ? entry.urls.length : 0
  };
}
