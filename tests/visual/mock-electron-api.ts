import type { ElectronApi } from "../../src/shared/preload-api";
import type { HistoryEntry, RendererSettings, RendererSettingsUpdate } from "../../src/shared/types";
import type { VisualFixture } from "./fixtures";

const stableNoopUnsubscribe = (): void => {};

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function createVisualElectronApi(
  fixture: VisualFixture,
  search = typeof window === "undefined" ? "" : window.location.search
): ElectronApi {
  const searchParams = new URLSearchParams(search);
  const historyState = searchParams.get("history-state");
  if (searchParams.get("animations") === "off") fixture.snapshot.settings.animatePackageDisclosure = false;
  let archivePasswordList = searchParams.get("archive-passwords") === "configured"
    ? "visual-archive-password-one\nvisual-archive-password-two"
    : fixture.snapshot.settings.archivePasswordListConfigured ? "visual-archive-password" : "";
  fixture.snapshot.settings.archivePasswordListConfigured = archivePasswordList.length > 0;
  let historyRequestCount = 0;
  const stateUpdateListeners = new Set<Parameters<ElectronApi["onStateUpdate"]>[0]>();
  const emitStateUpdate = (): void => {
    const snapshot = clone(fixture.snapshot);
    for (const listener of stateUpdateListeners) listener(snapshot);
  };
  const updateSettings = (settings: RendererSettingsUpdate): RendererSettings => {
    const { archivePasswordList: _archivePasswordList, notifyUrl: _notifyUrl, ...safe } = settings;
    if (typeof _archivePasswordList === "string") {
      archivePasswordList = _archivePasswordList;
      fixture.snapshot.settings.archivePasswordListConfigured = archivePasswordList.trim().length > 0;
    }
    Object.assign(fixture.snapshot.settings, safe);
    emitStateUpdate();
    return clone(fixture.snapshot.settings);
  };

  return {
    getSnapshot: async () => clone(fixture.snapshot),
    getArchivePasswordList: async () => ({ passwords: archivePasswordList }),
    getVersion: async () => "2.0.12",
    checkUpdates: async () => clone(fixture.update),
    installUpdate: async () => ({ started: true, message: "Visual update gestartet" }),
    openExternal: async () => true,
    updateSettings: async (settings) => updateSettings(settings),
    resetProviderDailyUsage: async (provider) => {
      fixture.snapshot.settings.providerDailyUsageBytes[provider] = 0;
      return clone(fixture.snapshot.settings);
    },
    resetDebridLinkApiKeyDailyUsage: async (keyId) => {
      fixture.snapshot.settings.debridLinkApiKeyDailyUsageBytes[keyId] = 0;
      return clone(fixture.snapshot.settings);
    },
    createAccount: async () => ({ accountId: null, settings: clone(fixture.snapshot.settings), accounts: clone(fixture.snapshot.accounts) }),
    replaceAccount: async () => ({ accountId: null, settings: clone(fixture.snapshot.settings), accounts: clone(fixture.snapshot.accounts) }),
    updateAccountSecret: async () => ({ accountId: null, settings: clone(fixture.snapshot.settings), accounts: clone(fixture.snapshot.accounts) }),
    revealAccountSecret: async () => ({ secret: "" }),
    deleteAccount: async () => ({ accountId: null, settings: clone(fixture.snapshot.settings), accounts: clone(fixture.snapshot.accounts) }),
    addLinks: async () => ({ addedPackages: 0, addedLinks: 0, invalidCount: 0 }),
    addContainers: async () => ({ addedPackages: 0, addedLinks: 0 }),
    prepareCollectorText: async () => ({ packages: [], invalidCount: 0, duplicateCount: 0 }),
    prepareCollectorContainers: async () => ({ packages: [], invalidCount: 0, duplicateCount: 0 }),
    enrichCollectorPackages: async (request) => ({ packages: clone(request.packages), invalidCount: 0, duplicateCount: 0 }),
    onCollectorEnrichmentProgress: () => () => {},
    getPathForDroppedFile: () => "",
    getStartConflicts: async () => [],
    resolveStartConflict: async (_packageId, policy) => ({
      skipped: policy === "skip",
      overwritten: policy === "overwrite"
    }),
    clearAll: async () => {
      fixture.snapshot.session.packageOrder = [];
      fixture.snapshot.session.packages = {};
      fixture.snapshot.session.items = {};
      fixture.snapshot.session.running = false;
      fixture.snapshot.session.paused = false;
      fixture.snapshot.session.totalDownloadedBytes = 0;
      fixture.snapshot.packageSpeedBps = {};
      fixture.snapshot.canStart = false;
      fixture.snapshot.canStop = false;
      fixture.snapshot.canPause = false;
    },
    start: async () => {
      fixture.snapshot.session.running = true;
      fixture.snapshot.session.paused = false;
      fixture.snapshot.canStop = true;
      fixture.snapshot.canPause = true;
    },
    startPackages: async (packageIds) => {
      for (const packageId of packageIds) {
        const entry = fixture.snapshot.session.packages[packageId];
        if (entry) {
          entry.status = "downloading";
        }
      }
      fixture.snapshot.session.running = true;
    },
    stop: async () => {
      fixture.snapshot.session.running = false;
      fixture.snapshot.session.paused = false;
      fixture.snapshot.canStop = false;
      fixture.snapshot.canPause = false;
    },
    togglePause: async () => {
      fixture.snapshot.session.paused = !fixture.snapshot.session.paused;
      return fixture.snapshot.session.paused;
    },
    cancelPackage: async (packageId) => {
      const entry = fixture.snapshot.session.packages[packageId];
      if (entry) {
        entry.cancelled = true;
        entry.status = "cancelled";
      }
    },
    renamePackage: async (packageId, newName) => {
      const entry = fixture.snapshot.session.packages[packageId];
      if (entry) {
        entry.name = newName;
      }
    },
    reorderPackages: async (packageIds) => {
      fixture.snapshot.session.packageOrder = [...packageIds];
    },
    removeItem: async (itemId) => {
      const item = fixture.snapshot.session.items[itemId];
      if (item) {
        const entry = fixture.snapshot.session.packages[item.packageId];
        if (entry) {
          entry.itemIds = entry.itemIds.filter((id) => id !== itemId);
        }
        delete fixture.snapshot.session.items[itemId];
      }
    },
    togglePackage: async (packageId) => {
      const entry = fixture.snapshot.session.packages[packageId];
      if (entry) {
        entry.enabled = !entry.enabled;
      }
    },
    exportPackageSelection: async (packageIds) => ({
      saved: true,
      packageCount: packageIds.length,
      linkCount: packageIds.reduce(
        (count, packageId) => count + (fixture.snapshot.session.packages[packageId]?.itemIds.length ?? 0),
        0
      ),
      filePath: "C:\\Visual\\Exports\\packages.txt"
    }),
    exportItemSelection: async (itemIds) => ({
      saved: true,
      packageCount: new Set(
        itemIds.map((itemId) => fixture.snapshot.session.items[itemId]?.packageId).filter(Boolean)
      ).size,
      linkCount: itemIds.length,
      filePath: "C:\\Visual\\Exports\\items.txt"
    }),
    exportQueue: async () => ({ saved: true }),
    importQueue: async () => ({ addedPackages: 0, addedLinks: 0 }),
    toggleClipboard: async () => {
      fixture.snapshot.clipboardActive = !fixture.snapshot.clipboardActive;
      fixture.snapshot.settings.clipboardWatch = fixture.snapshot.clipboardActive;
      return fixture.snapshot.clipboardActive;
    },
    writeClipboardText: async () => true,
    pickFolder: async () => "C:\\Visual\\Selected",
    pickContainers: async () => ["C:\\Visual\\Containers\\visual.dlc"],
    getSessionStats: async () => ({
      bandwidth: {
        samples: [
          { timestamp: 1786312680000, speedBps: 10485760 },
          { timestamp: 1786312740000, speedBps: 11534336 },
          { timestamp: 1786312800000, speedBps: 12582912 }
        ],
        currentSpeedBps: 12582912,
        averageSpeedBps: 11534336,
        maxSpeedBps: 15728640,
        totalBytesSession: 16642998272,
        sessionDurationSeconds: 3600
      },
      totalDownloads: 4,
      completedDownloads: 1,
      failedDownloads: 1,
      activeDownloads: 1,
      queuedDownloads: 1
    }),
    resetSessionStats: async () => {
      fixture.snapshot.stats.totalDownloaded = 0;
      fixture.snapshot.stats.totalFilesSession = 0;
      fixture.snapshot.session.totalDownloadedBytes = 0;
    },
    resetDownloadStats: async () => {
      fixture.snapshot.stats.totalDownloadedAllTime = 0;
      fixture.snapshot.stats.totalFilesAllTime = 0;
      fixture.snapshot.settings.totalDownloadedAllTime = 0;
      fixture.snapshot.settings.totalCompletedFilesAllTime = 0;
      fixture.snapshot.settings.totalRuntimeAllTimeMs = 0;
    },
    restart: async () => {},
    quit: async () => {},
    exportBackup: async () => ({ saved: true }),
    selectBackupImport: async () => ({ selected: true, requiresPassphrase: false }),
    importBackup: async () => ({ restored: true, relaunch: false, message: "Visual backup importiert" }),
    cancelBackupImport: async () => {},
    exportOnlineBackup: async () => ({ key: "visual-online-backup-key" }),
    importOnlineBackup: async () => ({ restored: true, relaunch: false, message: "Visual online backup importiert" }),
    exportSupportBundle: async () => ({ saved: true, filePath: "C:\\Visual\\Support\\support.zip" }),
    openLog: async () => {},
    openLogDirectory: async () => {},
    openAuditLog: async () => {},
    openRenameLog: async () => {},
    openSessionLog: async () => {},
    openTraceLog: async () => {},
    openPackageLog: async () => {},
    openItemLog: async () => {},
    getDebugSetupCheck: async () => ({
      status: "ok",
      enabled: false,
      runtimeBaseDir: "C:\\Visual\\Runtime",
      host: "127.0.0.1",
      port: 7843,
      localOnly: true,
      tokenConfigured: true,
      tokenPath: "C:\\Visual\\Runtime\\debug-token",
      supportManifestPath: "C:\\Visual\\Runtime\\support-manifest.json",
      supportManifestPresent: true,
      traceConfigPath: "C:\\Visual\\Runtime\\trace-config.json",
      traceLogPath: "C:\\Visual\\Runtime\\trace.log",
      traceEnabled: fixture.traceConfig.enabled,
      traceAutoDisableAt: fixture.traceConfig.autoDisableAt,
      diskSpace: {
        runtime: { path: "C:\\Visual\\Runtime", totalBytes: 1099511627776, freeBytes: 549755813888, freePercent: 50 },
        output: { path: "C:\\Visual\\Downloads", totalBytes: 1099511627776, freeBytes: 549755813888, freePercent: 50 },
        extract: { path: "C:\\Visual\\Extracted", totalBytes: 1099511627776, freeBytes: 549755813888, freePercent: 50 }
      },
      logSummary: {
        totalBytes: 12288,
        main: { path: "C:\\Visual\\Runtime\\main.log", exists: true, bytes: 4096 },
        mainBackup: { path: null, exists: false, bytes: 0 },
        audit: { path: "C:\\Visual\\Runtime\\audit.log", exists: true, bytes: 2048 },
        auditBackup: { path: null, exists: false, bytes: 0 },
        rename: { path: "C:\\Visual\\Runtime\\rename.log", exists: true, bytes: 1024 },
        renameBackup: { path: null, exists: false, bytes: 0 },
        session: { path: "C:\\Visual\\Runtime\\session.log", exists: true, bytes: 2048 },
        trace: { path: "C:\\Visual\\Runtime\\trace.log", exists: true, bytes: 3072 },
        traceBackup: { path: null, exists: false, bytes: 0 },
        sessionLogs: { path: "C:\\Visual\\Runtime\\sessions", exists: true, fileCount: 2, bytes: 2048 },
        packageLogs: { path: "C:\\Visual\\Runtime\\packages", exists: true, fileCount: 3, bytes: 3072 },
        itemLogs: { path: "C:\\Visual\\Runtime\\items", exists: true, fileCount: 4, bytes: 4096 }
      },
      supportBundle: {
        estimatedBytes: 24576,
        estimatedEntries: 12,
        duplicatedLiveLogBytes: 0,
        note: "Visual support bundle"
      },
      warnings: [],
      notes: ["Deterministischer Visual-Harness"],
      localUrls: {
        health: "http://127.0.0.1:7843/health",
        meta: "http://127.0.0.1:7843/meta",
        diagnostics: "http://127.0.0.1:7843/diagnostics"
      },
      remoteUrlTemplates: {
        health: "https://visual.example.test/health",
        meta: "https://visual.example.test/meta",
        diagnostics: "https://visual.example.test/diagnostics"
      }
    }),
    getRecentErrors: async () => [
      { ts: "2026-08-10T11:55:00.000Z", level: "WARN", message: "Visualer Beispielhinweis" }
    ],
    testNotification: async () => true,
    getTraceConfig: async () => clone(fixture.traceConfig),
    setTraceEnabled: async (enabled) => {
      fixture.traceConfig = { ...fixture.traceConfig, enabled };
      return clone(fixture.traceConfig);
    },
    rotateDebugToken: async () => ({ path: "C:\\Visual\\Runtime\\debug-token" }),
    getRemoteDiagnostics: async () => clone(fixture.remoteDiagnostics),
    enableRemoteDiagnostics: async (input) => {
      fixture.remoteDiagnostics = {
        ...fixture.remoteDiagnostics,
        status: {
          ...fixture.remoteDiagnostics.status,
          running: true,
          host: input.hostMode === "local" ? "127.0.0.1" : "0.0.0.0",
          port: input.port ?? 7843,
          localOnly: input.hostMode === "local",
          allowlistCount: input.allowlist.length
        },
        publicHost: input.publicHost,
        name: input.name ?? fixture.remoteDiagnostics.name,
        allowlist: [...input.allowlist]
      };
      return clone(fixture.remoteDiagnostics);
    },
    disableRemoteDiagnostics: async () => {
      fixture.remoteDiagnostics = {
        ...fixture.remoteDiagnostics,
        status: { ...fixture.remoteDiagnostics.status, running: false }
      };
      return clone(fixture.remoteDiagnostics);
    },
    rotateRemoteDiagnosticsToken: async () => clone(fixture.remoteDiagnostics),
    openRealDebridLogin: async () => {},
    openAllDebridLogin: async () => {},
    importBestDebridCookies: async () => 2,
    getAllDebridHostInfo: async () => ({
      host: "rapidgator.net",
      source: "api",
      state: "up",
      statusLabel: "Verfügbar",
      fetchedAt: 1786312800000,
      lastCheckedAt: 1786312740000,
      quota: 42,
      quotaMax: 100,
      quotaType: "daily",
      limitSimuDl: 8,
      note: "Visual host status"
    }),
    getDebridLinkHostLimits: async () => {
      const primaryKey = fixture.snapshot.accounts.find((account) => account.kind === "debridlink-api");
      if (!primaryKey) return [];
      return [{
        keyId: primaryKey.accountId,
        keyLabel: "Key 1",
        host: "ddownload.com",
        fetchedAt: 1786312800000,
        trafficCurrentBytes: 53687091200,
        trafficMaxBytes: 268435456000,
        linksCurrent: 12,
        linksMax: 100,
        note: "Visual quota",
        state: "ready",
        stateLabel: "Bereit",
        stateDetail: "Kontingent verfügbar",
        cooldownUntil: null,
        cooldownRemainingMs: 0,
        lastCheckedAt: 1786312740000,
        hostState: "up",
        hostStateLabel: "Online",
        hostNote: "Hoster verfügbar"
      }];
    },
    checkDebridAccounts: async () => clone(Object.values(fixture.snapshot.settings.debridAccountStatuses)),
    checkAccountCredentials: async (input) => clone(fixture.snapshot.accounts.find((account) => account.accountId === input.accountId)?.status || {
      accountId: input.accountId || "visual-account",
      provider: input.kind === "debridlink-api" ? "debridlink" : "megadebrid",
      label: "Visual Account",
      maskedLogin: "vi***al",
      valid: true,
      isPremium: true,
      premiumUntilMs: null,
      message: "Premium aktiv",
      checkedAt: 1786312800000
    }),
    retryExtraction: async (packageId) => {
      const entry = fixture.snapshot.session.packages[packageId];
      if (entry) {
        entry.status = "extracting";
      }
    },
    extractNow: async (packageId) => {
      const entry = fixture.snapshot.session.packages[packageId];
      if (entry) {
        entry.status = "extracting";
      }
    },
    resetPackage: async (packageId) => {
      const entry = fixture.snapshot.session.packages[packageId];
      if (entry) {
        entry.status = "queued";
        entry.cancelled = false;
      }
    },
    getHistory: async () => {
      historyRequestCount += 1;
      if (historyRequestCount > 1 && historyState === "loading") {
        return new Promise<HistoryEntry[]>(() => {});
      }
      if (historyRequestCount > 1 && historyState === "error") {
        throw new Error("Visual history load failed");
      }
      return clone(fixture.history);
    },
    clearHistory: async () => {
      fixture.history.splice(0, fixture.history.length);
    },
    removeHistoryEntry: async (entryId) => {
      const index = fixture.history.findIndex((entry) => entry.id === entryId);
      if (index >= 0) {
        fixture.history.splice(index, 1);
      }
    },
    removeHistoryEntries: async (entryIds) => {
      const removed = new Set(entryIds);
      const retained = fixture.history.filter((entry) => !removed.has(entry.id));
      fixture.history.splice(0, fixture.history.length, ...retained);
    },
    revealHistoryEntry: async (entryId) => fixture.history.some((entry) => entry.id === entryId)
      ? { ok: true }
      : { ok: false, reason: "entry-not-found" },
    setPackagePriority: async (packageId, priority) => {
      const entry = fixture.snapshot.session.packages[packageId];
      if (!entry || entry.priority === priority) return;
      entry.priority = priority;
      const order = fixture.snapshot.session.packageOrder;
      const currentIndex = order.indexOf(packageId);
      if (currentIndex >= 0) {
        order.splice(currentIndex, 1);
        const priorityRank = { high: 0, normal: 1, low: 2 } as const;
        let insertAt = order.length;
        for (let index = 0; index < order.length; index += 1) {
          const otherPriority = fixture.snapshot.session.packages[order[index]]?.priority || "normal";
          if (priorityRank[otherPriority] > priorityRank[priority]) {
            insertAt = index;
            break;
          }
        }
        order.splice(insertAt, 0, packageId);
      }
      emitStateUpdate();
    },
    skipItems: async (itemIds) => {
      for (const itemId of itemIds) {
        const item = fixture.snapshot.session.items[itemId];
        if (item) {
          item.status = "cancelled";
          item.fullStatus = "Übersprungen";
        }
      }
    },
    resetItems: async (itemIds) => {
      for (const itemId of itemIds) {
        const item = fixture.snapshot.session.items[itemId];
        if (item) {
          item.status = "queued";
          item.downloadedBytes = 0;
          item.progressPercent = 0;
          item.speedBps = 0;
          item.lastError = "";
          item.fullStatus = "In Warteschlange";
        }
      }
    },
    startItems: async (itemIds) => {
      for (const itemId of itemIds) {
        const item = fixture.snapshot.session.items[itemId];
        if (item) {
          item.status = "downloading";
          item.fullStatus = "Download läuft";
        }
      }
      fixture.snapshot.session.running = true;
    },
    reportRendererError: () => {},
    onStateUpdate: (callback) => {
      stateUpdateListeners.add(callback);
      return () => stateUpdateListeners.delete(callback);
    },
    onHistoryEntryAdded: () => stableNoopUnsubscribe,
    onClipboardDetected: () => stableNoopUnsubscribe,
    onUpdateInstallProgress: () => stableNoopUnsubscribe
  };
}
