import type {
  AppSettings,
  HistoryEntry,
  RemoteDiagnosticsInfo,
  SupportTraceConfig,
  UiSnapshot,
  UpdateCheckResult
} from "../../src/shared/types";
import { parseDebridLinkApiKeys } from "../../src/shared/debrid-link-keys";
import { getMegaDebridAccountId } from "../../src/shared/mega-debrid-accounts";
import { createRendererState } from "../../src/main/renderer-state";

export const VISUAL_SCENARIOS = ["empty", "dense", "update"] as const;

export type VisualScenario = (typeof VISUAL_SCENARIOS)[number];

export interface VisualFixture {
  snapshot: UiSnapshot;
  history: HistoryEntry[];
  update: UpdateCheckResult;
  traceConfig: SupportTraceConfig;
  remoteDiagnostics: RemoteDiagnosticsInfo;
}

export interface VisualClockTarget {
  setInterval: (handler: TimerHandler, timeout?: number, ...arguments_: unknown[]) => number;
}

export const VISUAL_NOW_MS = 1786312800000;

export function installVisualClock(target: VisualClockTarget): () => void {
  const originalDateNow = Date.now;
  const originalSetInterval = target.setInterval;
  Date.now = () => VISUAL_NOW_MS;
  target.setInterval = () => 0;
  return () => {
    Date.now = originalDateNow;
    target.setInterval = originalSetInterval;
  };
}

export async function waitForVisualFrames(
  requestFrame: (callback: FrameRequestCallback) => number
): Promise<void> {
  const waitForFrame = (): Promise<void> => new Promise((resolve) => {
    requestFrame(() => resolve());
  });
  await waitForFrame();
  await waitForFrame();
}

function createSettings(): AppSettings {
  const megaLogin = "visual@example.test";
  const debridLinkApiKeys = "visual-debrid-link-key-1\nvisual-debrid-link-key-2";
  const megaAccountId = getMegaDebridAccountId(megaLogin);
  const debridLinkKeys = parseDebridLinkApiKeys(debridLinkApiKeys);
  return {
    token: "visual-real-debrid-token",
    realDebridUseWebLogin: false,
    realDebridApiTokens: "visual-real-debrid-token",
    realDebridWebAccountIds: [],
    realDebridDisabledAccountIds: [],
    realDebridAccountDailyLimitBytes: {},
    realDebridAccountDailyUsageBytes: {},
    realDebridAccountTotalUsageBytes: {},
    megaLogin,
    megaPassword: "visual-password",
    language: "de",
    megaCredentials: `${megaLogin}:visual-password`,
    megaDebridApiCredentials: `${megaLogin}:visual-password`,
    megaDebridWebCredentials: "",
    megaDebridApiEnabled: true,
    megaDebridWebEnabled: true,
    megaDebridPreferApi: true,
    bestToken: "visual-best-debrid-token",
    bestDebridUseWebLogin: false,
    allDebridToken: "visual-all-debrid-token",
    allDebridUseWebLogin: false,
    deepbridApiKey: "visual-deepbrid-key",
    ddownloadLogin: "visual-ddownload",
    ddownloadPassword: "visual-password",
    oneFichierApiKey: "visual-onefichier-key",
    debridLinkApiKeys,
    debridLinkDisabledKeyIds: [],
    linkSnappyLogin: "visual-linksnappy",
    linkSnappyPassword: "visual-password",
    archivePasswordList: "visual-archive-password",
    rememberToken: true,
    providerOrder: ["realdebrid", "megadebrid-api", "bestdebrid", "alldebrid", "debridlink"],
    providerPrimary: "realdebrid",
    providerSecondary: "megadebrid-api",
    providerTertiary: "bestdebrid",
    autoProviderFallback: true,
    outputDir: "C:\\Visual\\Downloads",
    packageName: "",
    autoExtract: true,
    autoRename4sf4sj: true,
    keepGermanAudioOnly: false,
    germanAudioMode: "tag",
    extractDir: "C:\\Visual\\Extracted",
    collectMkvToLibrary: true,
    mkvLibraryDir: "C:\\Visual\\Library",
    createExtractSubfolder: true,
    hybridExtract: true,
    cleanupMode: "none",
    extractConflictMode: "overwrite",
    removeLinkFilesAfterExtract: true,
    removeSamplesAfterExtract: true,
    enableIntegrityCheck: true,
    autoResumeOnStart: true,
    autoReconnect: true,
    reconnectWaitSeconds: 45,
    completedCleanupPolicy: "never",
    maxParallel: 4,
    maxParallelExtract: 2,
    retryLimit: 3,
    speedLimitEnabled: false,
    speedLimitKbps: 0,
    speedLimitMode: "global",
    updateRepo: "Sucukdeluxe/Multi-Debrid-Downloader",
    autoUpdateCheck: true,
    clipboardWatch: true,
    minimizeToTray: false,
    theme: "dark",
    themePreference: "dark",
    logStorageLocation: "appdata",
    collapseNewPackages: false,
    animatePackageDisclosure: true,
    historyRetentionMode: "permanent",
    historyMaxEntries: 500,
    historyMaxAgeDays: 0,
    accountListShowDetailedDebridLinkKeys: true,
    autoSortPackagesByProgress: false,
    autoSkipExtracted: false,
    hideExtractedItems: false,
    confirmDeleteSelection: true,
    backupIncludeDownloads: false,
    backupIncludeRemoteDiagnostics: false,
    notifyUrl: "https://example.test/visual-webhook",
    notifyMention: "@visual",
    notifyOnPackageCompleted: true,
    notifyOnPackageFailed: true,
    notifyOnRunFinished: true,
    notifyPackageSuccessMode: "digest",
    notifyOnRemainingBelow: true,
    notifyRemainingThresholdGb: 75,
    notifyOnDownloadStall: true,
    notifyStallAfterSeconds: 120,
    notifyStallCooldownMinutes: 15,
    notifyOnDownloadRecovery: true,
    totalDownloadedAllTime: 987654321000,
    totalCompletedFilesAllTime: 842,
    totalRuntimeAllTimeMs: 172800000,
    bandwidthSchedules: [
      {
        id: "visual-schedule-night",
        startHour: 22,
        endHour: 6,
        speedLimitKbps: 12288,
        enabled: true
      }
    ],
    columnOrder: ["name", "size", "progress", "hoster", "account", "prio", "status", "speed", "availability"],
    columnOrderVersion: 3,
    extractCpuPriority: "middle",
    autoExtractWhenStopped: true,
    disabledProviders: ["onefichier"],
    hosterRouting: {
      "rapidgator.net": "realdebrid",
      "ddownload.com": "debridlink"
    },
    providerDailyLimitBytes: {
      realdebrid: 1099511627776,
      debridlink: 536870912000
    },
    providerDailyUsageBytes: {
      realdebrid: 214748364800,
      debridlink: 107374182400
    },
    providerTotalUsageBytes: {
      realdebrid: 8796093022208,
      debridlink: 2199023255552
    },
    debridLinkApiKeyDailyLimitBytes: {
      [debridLinkKeys[0].id]: 268435456000,
      [debridLinkKeys[1].id]: 268435456000
    },
    debridLinkApiKeyDailyUsageBytes: {
      [debridLinkKeys[0].id]: 53687091200,
      [debridLinkKeys[1].id]: 26843545600
    },
    debridLinkApiKeyTotalUsageBytes: {
      [debridLinkKeys[0].id]: 1099511627776,
      [debridLinkKeys[1].id]: 549755813888
    },
    megaDebridDisabledAccountIds: [],
    megaDebridApiDisabledAccountIds: [],
    megaDebridWebDisabledAccountIds: [],
    megaDebridAccountDailyLimitBytes: {
      [megaAccountId]: 322122547200
    },
    megaDebridAccountDailyUsageBytes: {
      [megaAccountId]: 64424509440
    },
    megaDebridAccountTotalUsageBytes: {
      [megaAccountId]: 1649267441664
    },
    debridAccountStatuses: {
      [megaAccountId]: {
        accountId: megaAccountId,
        provider: "megadebrid",
        label: "Mega-Debrid Hauptkonto",
        maskedLogin: "v***@example.test",
        valid: true,
        isPremium: true,
        premiumUntilMs: 1798761600000,
        email: "visual@example.test",
        message: "Premium aktiv",
        checkedAt: 1786312800000
      },
      [debridLinkKeys[0].id]: {
        accountId: debridLinkKeys[0].id,
        provider: "debridlink",
        label: "Debrid-Link Key 1",
        maskedLogin: debridLinkKeys[0].masked,
        valid: true,
        isPremium: true,
        premiumUntilMs: null,
        message: "API-Key aktiv",
        checkedAt: 1786312800000
      },
      [debridLinkKeys[1].id]: {
        accountId: debridLinkKeys[1].id,
        provider: "debridlink",
        label: "Debrid-Link Key 2",
        maskedLogin: debridLinkKeys[1].masked,
        valid: true,
        isPremium: true,
        premiumUntilMs: null,
        message: "API-Key aktiv",
        checkedAt: 1786312800000
      }
    },
    providerDailyUsageDay: "2026-08-10",
    dailyStartEnabled: false,
    dailyStartMinuteOfDay: 0,
    dailyStartFirstLocalDate: "",
    dailyStartLastHandledLocalDate: "",
    dailyStartPendingLocalDate: "",
    dailyStartLastOutcome: "",
    scheduledStartEpochMs: 0
  };
}

function createEmptySnapshot(): UiSnapshot {
  const renderer = createRendererState(createSettings());
  return {
    ...renderer,
    session: {
      version: 1,
      packageOrder: [],
      packages: {},
      items: {},
      runStartedAt: 0,
      totalDownloadedBytes: 0,
      summaryText: "Keine Downloads in der Warteschlange",
      reconnectUntil: 0,
      reconnectReason: "",
      paused: false,
      running: false,
      updatedAt: 1786312800000
    },
    summary: null,
    stats: {
      totalDownloaded: 0,
      totalDownloadedAllTime: 987654321000,
      totalFiles: 0,
      totalFilesSession: 0,
      totalFilesAllTime: 842,
      totalPackages: 0,
      sessionStartedAt: 1786309200000,
      appSessionStartedAt: 1786309200000,
      sessionRuntimeMs: 3600000,
      totalRuntimeMs: 172800000,
      runtimeMeasuredAt: 1786312800000
    },
    speedText: "0 B/s",
    etaText: "--:--",
    canStart: false,
    canStop: false,
    canPause: false,
    clipboardActive: true,
    reconnectSeconds: 0,
    packageSpeedBps: {},
    payloadKind: "full",
    removedItemIds: [],
    removedPackageIds: [],
    rotationEvents: []
  };
}

function createDenseSnapshot(): UiSnapshot {
  const snapshot = createEmptySnapshot();
  const debridLinkKeys = snapshot.accounts.filter((account) => account.kind === "debridlink-api");
  snapshot.session = {
    version: 1,
    packageOrder: ["visual-package-active", "visual-package-complete", "visual-package-failed"],
    packages: {
      "visual-package-active": {
        id: "visual-package-active",
        name: "Dokumentation Staffel 1",
        outputDir: "C:\\Visual\\Downloads\\Dokumentation Staffel 1",
        extractDir: "C:\\Visual\\Extracted\\Dokumentation Staffel 1",
        status: "downloading",
        itemIds: ["visual-item-active-1", "visual-item-active-2"],
        cancelled: false,
        enabled: true,
        priority: "high",
        postProcessLabel: "Automatisch entpacken",
        downloadStartedAt: 1786311000000,
        createdAt: 1786310400000,
        updatedAt: 1786312800000
      },
      "visual-package-complete": {
        id: "visual-package-complete",
        name: "Konzertmitschnitt 2026",
        outputDir: "C:\\Visual\\Downloads\\Konzertmitschnitt 2026",
        extractDir: "C:\\Visual\\Extracted\\Konzertmitschnitt 2026",
        status: "completed",
        itemIds: ["visual-item-complete-1"],
        cancelled: false,
        enabled: true,
        priority: "normal",
        postProcessLabel: "Entpackt",
        downloadStartedAt: 1786307400000,
        downloadCompletedAt: 1786309200000,
        createdAt: 1786306800000,
        updatedAt: 1786309200000
      },
      "visual-package-failed": {
        id: "visual-package-failed",
        name: "Archiv mit Wiederholung",
        outputDir: "C:\\Visual\\Downloads\\Archiv mit Wiederholung",
        extractDir: "C:\\Visual\\Extracted\\Archiv mit Wiederholung",
        status: "failed",
        itemIds: ["visual-item-failed-1"],
        cancelled: false,
        enabled: true,
        priority: "low",
        postProcessLabel: "Wartet auf Wiederholung",
        downloadStartedAt: 1786310100000,
        createdAt: 1786309800000,
        updatedAt: 1786312500000
      }
    },
    items: {
      "visual-item-active-1": {
        id: "visual-item-active-1",
        packageId: "visual-package-active",
        url: "https://rapidgator.net/file/visual-active-1",
        provider: "realdebrid",
        providerLabel: "Real-Debrid",
        providerAccountId: "visual-rd-account",
        providerAccountLabel: "Real-Debrid Hauptkonto",
        status: "downloading",
        retries: 0,
        speedBps: 12582912,
        downloadedBytes: 3221225472,
        totalBytes: 8589934592,
        progressPercent: 37.5,
        fileName: "dokumentation.s01e01.2160p.mkv",
        targetPath: "C:\\Visual\\Downloads\\Dokumentation Staffel 1\\dokumentation.s01e01.2160p.mkv",
        resumable: true,
        attempts: 1,
        lastError: "",
        fullStatus: "Download läuft",
        createdAt: 1786310400000,
        updatedAt: 1786312800000,
        onlineStatus: "online"
      },
      "visual-item-active-2": {
        id: "visual-item-active-2",
        packageId: "visual-package-active",
        url: "https://ddownload.com/visual-active-2",
        provider: "debridlink",
        providerLabel: "Debrid-Link",
        providerAccountId: debridLinkKeys[0].accountId,
        providerAccountLabel: "Debrid-Link Key 1",
        status: "queued",
        retries: 0,
        speedBps: 0,
        downloadedBytes: 0,
        totalBytes: 7516192768,
        progressPercent: 0,
        fileName: "dokumentation.s01e02.2160p.mkv",
        targetPath: "C:\\Visual\\Downloads\\Dokumentation Staffel 1\\dokumentation.s01e02.2160p.mkv",
        resumable: true,
        attempts: 0,
        lastError: "",
        fullStatus: "In Warteschlange",
        createdAt: 1786310460000,
        updatedAt: 1786312800000,
        onlineStatus: "online"
      },
      "visual-item-complete-1": {
        id: "visual-item-complete-1",
        packageId: "visual-package-complete",
        url: "https://rapidgator.net/file/visual-complete-1",
        provider: "realdebrid",
        providerLabel: "Real-Debrid",
        providerAccountId: "visual-rd-account",
        providerAccountLabel: "Real-Debrid Hauptkonto",
        status: "completed",
        retries: 0,
        speedBps: 0,
        downloadedBytes: 12884901888,
        totalBytes: 12884901888,
        progressPercent: 100,
        fileName: "konzertmitschnitt.2026.mkv",
        targetPath: "C:\\Visual\\Downloads\\Konzertmitschnitt 2026\\konzertmitschnitt.2026.mkv",
        resumable: true,
        attempts: 1,
        lastError: "",
        fullStatus: "Abgeschlossen",
        createdAt: 1786306800000,
        updatedAt: 1786309200000,
        onlineStatus: "online"
      },
      "visual-item-failed-1": {
        id: "visual-item-failed-1",
        packageId: "visual-package-failed",
        url: "https://example.test/offline/visual-failed-1",
        provider: "bestdebrid",
        providerLabel: "BestDebrid",
        providerAccountId: "visual-best-account",
        providerAccountLabel: "BestDebrid Hauptkonto",
        status: "failed",
        retries: 3,
        speedBps: 0,
        downloadedBytes: 536870912,
        totalBytes: 4294967296,
        progressPercent: 12.5,
        fileName: "archiv.part01.rar",
        targetPath: "C:\\Visual\\Downloads\\Archiv mit Wiederholung\\archiv.part01.rar",
        resumable: false,
        attempts: 4,
        lastError: "Hoster vorübergehend nicht verfügbar",
        fullStatus: "Fehlgeschlagen nach 4 Versuchen",
        createdAt: 1786309800000,
        updatedAt: 1786312500000,
        onlineStatus: "offline"
      }
    },
    runStartedAt: 1786311000000,
    totalDownloadedBytes: 16642998272,
    summaryText: "1 aktiv, 1 wartet, 1 abgeschlossen, 1 fehlgeschlagen",
    reconnectUntil: 0,
    reconnectReason: "",
    paused: false,
    running: true,
    updatedAt: 1786312800000
  };
  snapshot.summary = {
    total: 4,
    success: 1,
    failed: 1,
    cancelled: 0,
    extracted: 1,
    durationSeconds: 5400,
    averageSpeedBps: 9437184
  };
  snapshot.stats = {
    totalDownloaded: 16642998272,
    totalDownloadedAllTime: 987654321000,
    totalFiles: 4,
    totalFilesSession: 4,
    totalFilesAllTime: 842,
    totalPackages: 3,
    sessionStartedAt: 1786309200000,
    appSessionStartedAt: 1786309200000,
    sessionRuntimeMs: 3600000,
    totalRuntimeMs: 172800000,
    runtimeMeasuredAt: 1786312800000,
    statistics: {
      version: 2,
      startedAt: 1786053600000,
      minutes: [],
      days: [
        {
          day: "2026-08-08",
          downloadedBytes: 182536110080,
          measuredBytes: 182536110080,
          completedFiles: 124,
          failedFiles: 3,
          activeDownloadMs: 21600000,
          providers: {
            realdebrid: { bytes: 123480309760, completed: 86, failed: 1 },
            debridlink: { bytes: 59055800320, completed: 38, failed: 2 }
          }
        },
        {
          day: "2026-08-10",
          downloadedBytes: 541165879488,
          measuredBytes: 541165879488,
          completedFiles: 310,
          failedFiles: 2,
          activeDownloadMs: 32400000,
          providers: {
            realdebrid: { bytes: 328565653504, completed: 192, failed: 1 },
            debridlink: { bytes: 212600225984, completed: 118, failed: 1 }
          }
        }
      ]
    },
    rolling24Hours: {
      from: 1786226400000,
      to: 1786312800000,
      downloadedBytes: 541165879488,
      accounts: [
        {
          id: "rdw_visual_primary",
          provider: "realdebrid",
          label: "xSucukDE",
          bytes: 328565653504
        },
        {
          id: "dl_visual_secondary",
          provider: "debridlink",
          label: "Debrid-Link Key 2",
          bytes: 212600225984
        }
      ]
    }
  };
  snapshot.speedText = "12,0 MB/s";
  snapshot.etaText = "00:17:24";
  snapshot.canStart = true;
  snapshot.canStop = true;
  snapshot.canPause = true;
  snapshot.packageSpeedBps = {
    "visual-package-active": 12582912,
    "visual-package-complete": 0,
    "visual-package-failed": 0
  };
  snapshot.rotationEvents = [
    {
      id: "visual-rotation-event-1",
      at: 1786312200000,
      level: "WARN",
      provider: "Debrid-Link",
      accountLabel: "Debrid-Link Key 2",
      event: "Account gewechselt",
      reason: "Tageslimit erreicht",
      category: "quota",
      cooldownSec: 3600,
      next: "Debrid-Link Key 1"
    }
  ];
  return snapshot;
}

function createDenseHistory(): HistoryEntry[] {
  return [
    {
      id: "visual-history-1",
      name: "Naturfilm Sammlung",
      totalBytes: 25769803776,
      downloadedBytes: 25769803776,
      fileCount: 6,
      provider: "realdebrid",
      completedAt: 1786226400000,
      durationSeconds: 1842,
      status: "completed",
      outputDir: "C:\\Visual\\Downloads\\Naturfilm Sammlung",
      urls: [
        "https://rapidgator.net/file/visual-history-1a",
        "https://rapidgator.net/file/visual-history-1b"
      ]
    },
    {
      id: "visual-history-2",
      name: "Gelöschtes Testpaket",
      totalBytes: 4294967296,
      downloadedBytes: 4294967296,
      fileCount: 1,
      provider: "debridlink",
      completedAt: 1786140000000,
      durationSeconds: 722,
      status: "deleted",
      outputDir: "C:\\Visual\\Downloads\\Gelöschtes Testpaket",
      urls: ["https://ddownload.com/visual-history-2"]
    }
  ];
}

function createUpdate(updateAvailable: boolean): UpdateCheckResult {
  return updateAvailable
    ? {
        updateAvailable: true,
        currentVersion: "2.0.12",
        latestVersion: "9.9.9",
        latestTag: "v9.9.9",
        releaseUrl: "https://github.com/Sucukdeluxe/Multi-Debrid-Downloader/releases/tag/v9.9.9",
        setupAssetUrl: "https://example.test/Multi-Debrid-Downloader-Setup-9.9.9.exe",
        setupAssetName: "Multi-Debrid-Downloader-Setup-9.9.9.exe",
        setupAssetDigest: "sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        releaseNotes: "Neue kompakte Desktop-Oberfläche\nVerbesserte Accountübersicht\nPräzisere Statusanzeigen"
      }
    : {
        updateAvailable: false,
        currentVersion: "2.0.12",
        latestVersion: "2.0.12",
        latestTag: "v2.0.12",
        releaseUrl: "https://github.com/Sucukdeluxe/Multi-Debrid-Downloader/releases/tag/v2.0.12",
        releaseNotes: "Aktuelle Version"
      };
}

function createTraceConfig(): SupportTraceConfig {
  return {
    enabled: false,
    includeMainLog: true,
    includeAudit: true,
    logDebugRequests: false,
    autoDisableAt: null,
    updatedAt: "2026-08-10T12:00:00.000Z"
  };
}

function createRemoteDiagnostics(): RemoteDiagnosticsInfo {
  return {
    status: {
      running: false,
      host: "127.0.0.1",
      port: 7843,
      hasToken: true,
      localOnly: true,
      allowlistCount: 1
    },
    code: "VISUAL-CODE",
    publicHost: "visual.example.test",
    name: "Visual Harness",
    allowlist: ["127.0.0.1"],
    suggestedHosts: ["visual.example.test"]
  };
}

export function createVisualFixture(scenario: VisualScenario): VisualFixture {
  if (scenario === "empty") {
    return {
      snapshot: createEmptySnapshot(),
      history: [],
      update: createUpdate(false),
      traceConfig: createTraceConfig(),
      remoteDiagnostics: createRemoteDiagnostics()
    };
  }

  return {
    snapshot: createDenseSnapshot(),
    history: createDenseHistory(),
    update: createUpdate(scenario === "update"),
    traceConfig: createTraceConfig(),
    remoteDiagnostics: createRemoteDiagnostics()
  };
}
