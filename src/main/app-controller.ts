import path from "node:path";
import os from "node:os";
import v8 from "node:v8";
import { randomUUID } from "node:crypto";
import { app } from "electron";
import {
  AddLinksPayload,
  AccountCheckScope,
  AllDebridHostInfo,
  AppSettings,
  AccountCommand,
  AccountCommandResult,
  AccountCredentialCheckInput,
  AccountSecretRequest,
  AccountSecretResult,
  ArchivePasswordListResult,
  DebridAccountStatus,
  DebridProvider,
  DuplicatePolicy,
  EnableRemoteDiagnosticsInput,
  HistoryEntry,
  PackagePriority,
  ParsedPackageInput,
  RemoteDiagnosticsInfo,
  SessionStats,
  StartConflictEntry,
  StartConflictResolutionResult,
  UiSnapshot,
  UpdateCheckResult,
  UpdateInstallProgress,
  UpdateInstallResult
} from "../shared/types";
import { resetDebridLinkApiKeyDailyUsage, resetProviderDailyUsage } from "../shared/provider-daily-limits";
import { importDlcContainers } from "./container";
import { APP_VERSION, ONLINE_BACKUP_API_URL } from "./constants";
import { DownloadManager } from "./download-manager";
import { fetchAllDebridHostInfo, fetchDebridLinkHostLimits } from "./debrid";
import { checkAllDebridAccounts, checkDebridLinkKey, checkMegaDebridAccount, checkRealDebridAccount, retainConfiguredRealDebridStatuses } from "./account-check";
import { parseMegaDebridAccounts } from "../shared/mega-debrid-accounts";
import { getMegaDebridAccountsForMode } from "../shared/mega-debrid-accounts";
import { parseDebridLinkApiKeys } from "../shared/debrid-link-keys";
import { getRealDebridAccounts, isRealDebridWebAccountId, type RealDebridWebAccountEntry } from "../shared/real-debrid-accounts";
import type { RealDebridLoginRequest } from "../shared/preload-api";
import { applyAccountCommand, resolveStoredAccountSecret } from "./account-commands";
import { collectAccountStatusRedactionValues, sanitizeDebridAccountStatus, sanitizeDebridAccountStatuses } from "./account-status-sanitizer";
import { createRendererState } from "./renderer-state";
import { parseCollectorInput } from "./link-parser";
import { inspectCollectorPackages, inspectCollectorText } from "./collector-inspection";
import type { CollectorInspectionRequest, CollectorInspectionResult } from "../shared/collector";
import { configureLogger, flushLoggerSync, getLogFilePath, logger } from "./logger";
import { AllDebridWebFallback } from "./all-debrid-web";
import { BestDebridWebFallback } from "./bestdebrid-web";
import { RealDebridWebFallback } from "./realdebrid-web";
import { getItemLogPath, initItemLogs, shutdownItemLogs } from "./item-log";
import { getPackageLogPath, initPackageLogs, shutdownPackageLogs } from "./package-log";
import { initSessionLog, getSessionLogPath, shutdownSessionLog } from "./session-log";
import { MegaWebFallback } from "./mega-web-fallback";
import { addHistoryEntry, addHistoryEntryForRetention, cancelPendingAsyncSaves, clearHistory, createStoragePaths, loadHistory, loadHistoryForRetention, loadSessionWithStatus, loadSettings, normalizeHistoryEntry, normalizeLoadedSession, normalizeLoadedSessionTransientFields, normalizeSettings, removeHistoryEntries, resetHistoryForRetention, saveHistory, saveSession, saveSettings } from "./storage";
import { abortActiveUpdateDownload, checkGitHubUpdate, installLatestUpdate } from "./update";
import { runInstallWithResume } from "./update-install-flow";
import { rotateDebugToken, startDebugServer, stopDebugServer, restartDebugServer, getDebugServerRuntimeStatus, getActiveDebugToken, getDebugAllowlist, writeDebugServerConfig, clearDebugToken } from "./debug-server";
import { encodeConnectionCode, loadRemoteMeta, saveRemoteMeta } from "./connection-code";
import { encryptBackup, decryptBackup } from "./backup-crypto";
import { buildBackupPayload, planBackupImport, resolveRemoteDiagnosticsRestore, BackupRemoteDiagnostics } from "./backup-payload";
import { getAuditLogPath, initAuditLog, logAuditEvent, shutdownAuditLog } from "./audit-log";
import { initAccountRotationLog, shutdownAccountRotationLog } from "./account-rotation-log";
import { initConversionLog, shutdownConversionLog } from "./conversion-trace";
import { runStartupHealthCheck } from "./startup-health-check";
import { getDebugSetupCheck } from "./debug-setup";
import { buildLinkExportSelection, serializeLinkExportText } from "./link-export";
import { getRenameLogPath, initRenameLog, shutdownRenameLog } from "./rename-log";
import { getDesktopRenameLogPath, initDesktopRenameLogAt, shutdownDesktopRenameLog } from "./desktop-rename-log";
import { buildAccountSummary, buildNotificationSupportPayload, diffAccountSummary, type NotificationSupportPayload } from "./support-data";
import { buildSupportBundle, getSupportBundleDefaultFileName } from "./support-bundle";
import { getTraceConfig, getTraceLogPath, initTraceLog, logTraceEvent, setTraceEnabled, shutdownTraceLog } from "./trace-log";
import type { DebugSetupCheckResult, SupportTraceConfig } from "../shared/types";
import { createOnlineBackup, downloadOnlineBackup, uploadOnlineBackup } from "./online-backup";
import { overlayLiveUsageCounters } from "./settings-live-overlay";
import { getLegacyDesktopLogDirectory, migrateLogDirectories, prepareLogDirectory, resolveLogDirectory } from "./log-storage";
import { normalizeStatisticsLedger, saveStatisticsLedger } from "./statistics-ledger";
import { NotificationOutbox } from "./notification-outbox";
import { sendNotification } from "./notify";
import { DownloadHealthMonitor } from "./download-health-monitor";

function sanitizeSettingsPatch(partial: Partial<AppSettings>): Partial<AppSettings> {
  const entries = Object.entries(partial || {}).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as Partial<AppSettings>;
}

function settingsFingerprint(settings: AppSettings): string {
  return JSON.stringify(normalizeSettings(settings));
}

type PendingRealDebridWebAccount = {
  generation: number;
  dailyLimitBytes: number;
};

export class AppController {
  private settings: AppSettings;

  private manager: DownloadManager;

  private megaWebFallback: MegaWebFallback;

  private realDebridWebFallbacks = new Map<string, RealDebridWebFallback>();

  private pendingRealDebridWebAccountIds = new Map<string, PendingRealDebridWebAccount>();

  private realDebridWebGenerations = new Map<string, number>();

  private realDebridWebAuthenticationTasks = new Map<string, Promise<void>>();

  private allDebridWebFallback: AllDebridWebFallback;

  private bestDebridWebFallback: BestDebridWebFallback;

  private lastUpdateCheck: UpdateCheckResult | null = null;

  private lastUpdateCheckAt = 0;

  private storagePaths = createStoragePaths(path.join(app.getPath("userData"), "runtime"));

  private notificationOutbox: NotificationOutbox;

  private downloadHealthMonitor: DownloadHealthMonitor;

  private downloadHealthTimer: NodeJS.Timeout | null = null;

  private downloadHealthEvaluation: Promise<void> | null = null;

  private logDirectory = this.storagePaths.baseDir;

  private onStateHandler: ((snapshot: UiSnapshot) => void) | null = null;

  private onHistoryEntryAddedHandler: ((entry: HistoryEntry) => void) | null = null;

  private autoResumePending = false;
  private runtimeStatsTimer: NodeJS.Timeout | null = null;
  private lastMemoryWarnAt = 0;

  public constructor() {
    configureLogger(this.storagePaths.baseDir);
    this.settings = loadSettings(this.storagePaths);
    flushLoggerSync();
    const desktopDir = this.getDesktopDirectory();
    const requestedLogDirectory = resolveLogDirectory(this.storagePaths.baseDir, desktopDir, this.settings.logStorageLocation);
    if (!prepareLogDirectory(requestedLogDirectory)) {
      this.settings = normalizeSettings({ ...this.settings, logStorageLocation: "appdata" });
      saveSettings(this.storagePaths, this.settings);
      this.logDirectory = this.storagePaths.baseDir;
    } else {
      this.logDirectory = requestedLogDirectory;
      const legacyDirectory = this.settings.logStorageLocation === "desktop"
        ? getLegacyDesktopLogDirectory(desktopDir)
        : null;
      migrateLogDirectories(
        [this.storagePaths.baseDir, ...(legacyDirectory ? [legacyDirectory] : [])],
        this.logDirectory
      );
    }
    this.initializeLogStorage();
    resetHistoryForRetention(this.storagePaths, this.settings.historyRetentionMode);
    const loadResult = loadSessionWithStatus(this.storagePaths);
    const session = loadResult.session;
    this.notificationOutbox = new NotificationOutbox({
      filePath: this.storagePaths.notificationOutboxFile,
      autoDrain: true,
      send: (event) => sendNotification(this.settings.notifyUrl, {
        title: event.payload.title,
        message: event.payload.description || "",
        mention: this.settings.notifyMention,
        color: event.payload.color ?? (event.priority === "error" ? 0xe74c3c : 0x2ecc71),
        fields: event.payload.fields,
        timestamp: event.createdAt
      })
    });
    this.downloadHealthMonitor = new DownloadHealthMonitor(this.storagePaths.notificationHealthFile);
    void this.notificationOutbox.drain().catch((error) => {
      logger.warn(`Notification-Outbox konnte nicht gestartet werden: ${String(error)}`);
    });
    this.megaWebFallback = new MegaWebFallback(() => ({
      login: this.settings.megaLogin,
      password: this.settings.megaPassword
    }));
    this.allDebridWebFallback = new AllDebridWebFallback(() => this.settings.rememberToken);
    this.bestDebridWebFallback = new BestDebridWebFallback(() => this.settings.rememberToken);
    this.manager = new DownloadManager(this.settings, session, this.storagePaths, {
      megaWebUnrestrict: (link: string, signal?: AbortSignal, account?: { login: string; password: string }) => this.megaWebFallback.unrestrict(link, signal, account),
      allDebridWebUnrestrict: (link: string, signal?: AbortSignal) => this.allDebridWebFallback.unrestrict(link, signal),
      realDebridWebUnrestrict: (accountId: string, link: string, signal?: AbortSignal) => this.unrestrictRealDebridWebAccount(accountId, link, signal),
      bestDebridWebUnrestrict: (link: string, signal?: AbortSignal) => this.bestDebridWebFallback.unrestrict(link, signal),
      invalidateMegaSession: () => this.megaWebFallback.invalidateSession(),
      protectEmptyClobber: loadResult.status === "empty-unreadable",
      enqueueNotification: (event) => this.notificationOutbox.enqueue(event),
      onHistoryEntry: (entry: HistoryEntry) => {
        this.recordHistoryEntry(entry);
      }
    });
    this.manager.on("state", (snapshot: UiSnapshot) => {
      this.onStateHandler?.(snapshot);
    });
    void this.evaluateDownloadHealth();
    this.downloadHealthTimer = setInterval(() => {
      void this.evaluateDownloadHealth();
    }, 15_000);
    this.downloadHealthTimer.unref?.();
    logger.info(`App gestartet v${APP_VERSION}`);
    logger.info(`Log-Datei: ${getLogFilePath()}`);
    logAuditEvent("INFO", "App gestartet", {
      appVersion: APP_VERSION,
      runtimeDir: this.storagePaths.baseDir
    });
    try {
      const report = runStartupHealthCheck(this.settings, this.storagePaths);
      if (report.errorCount > 0 || report.warnCount > 0) {
        logger.warn(`Health-Check: ${report.errorCount} Fehler, ${report.warnCount} Warnungen, ${report.infoCount} Info`);
      } else {
        logger.info(`Health-Check: alles OK (${report.infoCount} Info)`);
      }
      for (const finding of report.findings) {
        const line = finding.hint
          ? `Health-Check [${finding.code}]: ${finding.message} — ${finding.hint}`
          : `Health-Check [${finding.code}]: ${finding.message}`;
        if (finding.severity === "ERROR") {
          logger.error(line);
        } else if (finding.severity === "WARN") {
          logger.warn(line);
        } else {
          logger.info(line);
        }
        if (finding.severity !== "INFO") {
          logAuditEvent(finding.severity, `Health-Check: ${finding.code}`, {
            message: finding.message,
            hint: finding.hint || ""
          });
        }
      }
    } catch (err) {
      logger.warn(`Health-Check uebersprungen (Fehler): ${String((err as Error).message || err)}`);
    }
    startDebugServer(this.manager, this.storagePaths.baseDir, () => this.getNotificationSupportPayload());
    this.runtimeStatsTimer = setInterval(() => {
      this.manager.persistRuntimeStats();
      this.settings = this.manager.getSettings();
      this.checkMemoryPressure();
    }, 60_000);
    this.runtimeStatsTimer.unref?.();

    if (this.settings.autoResumeOnStart) {
      const snapshot = this.manager.getSnapshot();
      const hasPending = Object.values(snapshot.session.items).some((item) => item.status === "queued" || item.status === "reconnect_wait");
      if (hasPending && this.hasAnyProviderToken(this.settings)) {
        if (this.onStateHandler) {
          this.beginAutoResume();
        } else {
          this.autoResumePending = true;
          logger.info("Auto-Resume beim Start vorgemerkt");
        }
      }
    }
  }

  // Early-warning for OOM on a long-running process. Measured against the V8
  // heap_size_limit (the real ceiling at which the process is killed), NOT against
  // heapTotal: V8 routinely runs near-full of its current heapTotal just before it
  // grows it, so a heapUsed/heapTotal ratio would cry wolf and — since every WARN
  // now feeds the error ring — crowd real failures out. Throttled to 1 warning per
  // 5 min so a genuine sustained-pressure run does not spam the log/ring.
  private checkMemoryPressure(): void {
    try {
      const mem = process.memoryUsage();
      const heapLimit = v8.getHeapStatistics().heap_size_limit;
      const ratio = heapLimit > 0 ? mem.heapUsed / heapLimit : 0;
      if (ratio < 0.9) {
        return;
      }
      const now = Date.now();
      if (now - this.lastMemoryWarnAt < 5 * 60_000) {
        return;
      }
      this.lastMemoryWarnAt = now;
      const mb = (bytes: number): number => Math.round(bytes / 1048576);
      logger.warn(
        `Speicherdruck: heapUsed=${mb(mem.heapUsed)}MB von Limit ${mb(heapLimit)}MB ` +
        `(${Math.round(ratio * 100)}%), heapTotal=${mb(mem.heapTotal)}MB, rss=${mb(mem.rss)}MB, external=${mb(mem.external)}MB`
      );
    } catch {
    }
  }

  private hasAnyProviderToken(settings: AppSettings): boolean {
    return Boolean(
      settings.token.trim()
      || settings.realDebridUseWebLogin
      || (settings.megaLogin.trim() && settings.megaPassword.trim())
      || settings.bestToken.trim()
      || settings.bestDebridUseWebLogin
      || settings.allDebridUseWebLogin
      || settings.allDebridToken.trim()
      || (settings.ddownloadLogin.trim() && settings.ddownloadPassword.trim())
      || settings.oneFichierApiKey.trim()
    );
  }

  public get onState(): ((snapshot: UiSnapshot) => void) | null {
    return this.onStateHandler;
  }

  public set onState(handler: ((snapshot: UiSnapshot) => void) | null) {
    this.onStateHandler = handler;
    if (handler) {
      handler(this.manager.getSnapshot());
      if (this.autoResumePending) {
        this.autoResumePending = false;
        this.beginAutoResume();
      } else {
        this.manager.triggerIdleExtractions();
      }
    }
  }

  private beginAutoResume(): void {
    void this.manager.getStartConflicts().then((conflicts) => {
      const excludePackageIds = new Set(conflicts.map((conflict) => conflict.packageId));
      if (excludePackageIds.size > 0) {
        const names = conflicts.map((conflict) => conflict.packageName).join(", ");
        logger.info(`Auto-Resume: ${excludePackageIds.size} Paket(e) mit Start-Konflikt zurückgehalten (${names}); übrige Pakete starten`);
      } else {
        logger.info("Auto-Resume beim Start aktiviert (keine Start-Konflikte)");
      }
      void this.manager.start(excludePackageIds.size > 0 ? { excludePackageIds } : undefined)
        .catch((err) => logger.warn(`Auto-Resume Start Fehler: ${String(err)}`));
    }).catch((err) => logger.warn(`Auto-Resume Konflikt-Check Fehler: ${String(err)}`));
  }

  public getSnapshot(): UiSnapshot {
    return this.manager.getSnapshot();
  }

  public getVersion(): string {
    return APP_VERSION;
  }

  public getSettings(): AppSettings {
    return this.settings;
  }

  public getAuditLogPath(): string | null {
    return getAuditLogPath();
  }

  public getRenameLogPath(): string | null {
    return getRenameLogPath();
  }

  public getDesktopRenameLogPath(): string | null {
    return getDesktopRenameLogPath();
  }

  public getTraceLogPath(): string | null {
    return getTraceLogPath();
  }

  public getTraceConfig(): SupportTraceConfig {
    return getTraceConfig();
  }

  public rotateDebugToken(): { path: string; token: string } {
    const rotated = rotateDebugToken(this.storagePaths.baseDir);
    this.audit("WARN", "Debug-Token rotiert", { path: rotated.path });
    return rotated;
  }

  private getSuggestedRemoteHosts(): string[] {
    const hosts: string[] = [];
    try {
      const interfaces = os.networkInterfaces();
      for (const entry of Object.values(interfaces)) {
        for (const net of entry || []) {
          if (net.family === "IPv4" && !net.internal && net.address) {
            hosts.push(net.address);
          }
        }
      }
    } catch {
    }
    return [...new Set(hosts)];
  }

  public getRemoteDiagnostics(): RemoteDiagnosticsInfo {
    const status = getDebugServerRuntimeStatus();
    const meta = loadRemoteMeta(this.storagePaths.baseDir);
    const token = getActiveDebugToken();
    const allowlist = getDebugAllowlist();
    const suggestedHosts = this.getSuggestedRemoteHosts();
    const host = meta.publicHost
      || (status.localOnly ? "127.0.0.1" : (suggestedHosts[0] || status.host));
    const code = (status.hasToken && token && host)
      ? encodeConnectionCode({ host, port: status.port, token, name: meta.name || undefined })
      : null;
    return {
      status,
      code,
      publicHost: meta.publicHost,
      name: meta.name,
      allowlist,
      suggestedHosts
    };
  }

  public async enableRemoteDiagnostics(input: EnableRemoteDiagnosticsInput): Promise<RemoteDiagnosticsInfo> {
    const baseDir = this.storagePaths.baseDir;
    const port = input.port && Number.isInteger(input.port) && input.port >= 1024 && input.port <= 65535
      ? input.port
      : 9868;
    const bindHost = input.hostMode === "network" ? "0.0.0.0" : "127.0.0.1";
    const allowlist = (input.allowlist || []).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
    if (input.hostMode === "network" && allowlist.length === 0) {
      throw new Error("Netzwerk-Freigabe erfordert mindestens eine erlaubte IP oder CIDR in der Allowlist.");
    }
    let token = getActiveDebugToken();
    if (!token || input.rotateToken) {
      token = rotateDebugToken(baseDir).token;
    }
    writeDebugServerConfig({ host: bindHost, port, allowlist });
    saveRemoteMeta(baseDir, { publicHost: (input.publicHost || "").trim(), name: (input.name || "").trim() });
    await restartDebugServer();
    this.audit("WARN", "Ferndiagnose aktiviert", {
      host: bindHost,
      port,
      allowlistCount: allowlist.length,
      localOnly: input.hostMode === "local"
    });
    return this.getRemoteDiagnostics();
  }

  public async disableRemoteDiagnostics(): Promise<RemoteDiagnosticsInfo> {
    clearDebugToken();
    await restartDebugServer();
    this.audit("WARN", "Ferndiagnose deaktiviert (Token entfernt)");
    return this.getRemoteDiagnostics();
  }

  public async rotateRemoteDiagnosticsToken(): Promise<RemoteDiagnosticsInfo> {
    rotateDebugToken(this.storagePaths.baseDir);
    await restartDebugServer();
    this.audit("WARN", "Ferndiagnose-Token rotiert");
    return this.getRemoteDiagnostics();
  }

  private restoreRemoteDiagnosticsFromBackup(section: unknown, restartNow: boolean): void {
    const restore = resolveRemoteDiagnosticsRestore(section);
    if (!restore) {
      return;
    }
    writeDebugServerConfig({ host: restore.host, port: restore.port, allowlist: restore.allowlist });
    if (restartNow) {
      void restartDebugServer().catch(() => {});
    }
    this.audit("INFO", "Ferndiagnose-Einstellungen aus Backup wiederhergestellt", {
      port: restore.port ?? null,
      allowlistCount: restore.allowlist?.length ?? 0,
      host: restore.host ?? "unveraendert",
      restartNow
    });
  }

  public getDebugSetupCheck(): DebugSetupCheckResult {
    return getDebugSetupCheck(this.storagePaths.baseDir);
  }

  private audit(level: "INFO" | "WARN" | "ERROR", message: string, fields?: Record<string, unknown>): void {
    logAuditEvent(level, message, fields);
    logTraceEvent(level, "audit", message, fields);
  }

  public setTraceEnabled(enabled: boolean, note = "", durationMs?: number): SupportTraceConfig {
    const next = setTraceEnabled(enabled, note, durationMs);
    this.audit("INFO", enabled ? "Support-Trace aktiviert" : "Support-Trace deaktiviert", { note });
    return next;
  }

  // Carry the live, runtime-maintained usage/status counters onto a settings
  // object about to be applied, so they are never rolled back to a stale snapshot.
  // All-time totals take the max; daily/total usage and account statuses are taken
  // live; per-key Debrid-Link usage is filtered to keys that still exist.
  private overlayLiveUsageCounters(target: AppSettings): void {
    const liveSettings = this.manager.getSettings();
    overlayLiveUsageCounters(target, liveSettings, this.manager.getLiveTotalRuntimeMs());
  }

  public set onHistoryEntryAdded(handler: ((entry: HistoryEntry) => void) | null) {
    this.onHistoryEntryAddedHandler = handler;
  }

  private applySettingsOnlyBackup(importedSettings: AppSettings, remoteDiagnostics?: unknown, restoreRemoteDiagnostics = false): void {
    let restoredSettings = normalizeSettings(importedSettings);
    if (this.settings.logStorageLocation !== restoredSettings.logStorageLocation
      && !this.reconfigureLogStorage(restoredSettings.logStorageLocation)) {
      restoredSettings = normalizeSettings({
        ...restoredSettings,
        logStorageLocation: this.settings.logStorageLocation
      });
    }
    this.overlayLiveUsageCounters(restoredSettings);
    this.settings = restoredSettings;
    saveSettings(this.storagePaths, this.settings);
    this.manager.setSettings(this.settings, { settingsOnlyImport: true });
    if (restoreRemoteDiagnostics) {
      this.restoreRemoteDiagnosticsFromBackup(remoteDiagnostics, true);
    }
  }

  public updateSettings(partial: Partial<AppSettings>): AppSettings {
    const sanitizedPatch = sanitizeSettingsPatch(partial);
    const previousSettings = this.settings;
    let nextSettings = normalizeSettings({
      ...previousSettings,
      ...sanitizedPatch
    });

    if (settingsFingerprint(nextSettings) === settingsFingerprint(previousSettings)) {
      return previousSettings;
    }

    if (previousSettings.logStorageLocation !== nextSettings.logStorageLocation
      && !this.reconfigureLogStorage(nextSettings.logStorageLocation)) {
      nextSettings = normalizeSettings({
        ...nextSettings,
        logStorageLocation: previousSettings.logStorageLocation
      });
    }
    this.overlayLiveUsageCounters(nextSettings);
    const retentionChanged = previousSettings.historyRetentionMode !== nextSettings.historyRetentionMode;
    const historyLimitsChanged = previousSettings.historyMaxEntries !== nextSettings.historyMaxEntries
      || previousSettings.historyMaxAgeDays !== nextSettings.historyMaxAgeDays;
    this.settings = nextSettings;
    if (retentionChanged) {
      resetHistoryForRetention(this.storagePaths, this.settings.historyRetentionMode);
    } else if (historyLimitsChanged && this.settings.historyRetentionMode !== "never") {
      saveHistory(this.storagePaths, loadHistory(this.storagePaths), this.historyLimits());
    }
    saveSettings(this.storagePaths, this.settings);
    this.manager.setSettings(this.settings);
    this.audit("INFO", "Einstellungen aktualisiert", {
      changedKeys: Object.keys(sanitizedPatch),
      accountChanges: diffAccountSummary(previousSettings, this.settings)
    });
    this.pruneRealDebridWebFallbacks(previousSettings, this.settings);
    if (previousSettings.rememberToken && !this.settings.rememberToken) {
      const accountIds = new Set([...this.settings.realDebridWebAccountIds, ...this.realDebridWebFallbacks.keys()]);
      for (const accountId of accountIds) {
        void this.cleanupRealDebridWebAccount(accountId, true).catch((error) => {
          logger.warn(`Real-Debrid Web-Session konnte nicht gelöscht werden (${accountId}): ${String(error)}`);
        });
      }
      void this.allDebridWebFallback.clearSessions().catch((error) => {
        logger.warn(`AllDebrid Web-Session konnte nicht gelöscht werden: ${String(error)}`);
      });
      void this.bestDebridWebFallback.clearSessions().catch((error) => {
        logger.warn(`BestDebrid Web-Session konnte nicht gelöscht werden: ${String(error)}`);
      });
    }
    return this.settings;
  }

  public async executeAccountCommand(command: AccountCommand): Promise<AccountCommandResult> {
    const applied = applyAccountCommand(this.settings, command);
    let checkedStatus: DebridAccountStatus | null = null;
    const redactions = collectAccountStatusRedactionValues(applied.settings, command);
    if (command.action !== "delete" && applied.response.accountId && (command.kind === "megadebrid-api" || command.kind === "megadebrid-web")) {
      const mode = command.kind === "megadebrid-web" ? "web" : "api";
      const account = getMegaDebridAccountsForMode(applied.settings, mode).find((entry) => entry.id === applied.response.accountId);
      if (!account) throw new Error("Account-Payload ist ungültig");
      checkedStatus = await checkMegaDebridAccount(account);
    }
    if (command.action !== "delete" && applied.response.accountId && command.kind === "debridlink-api") {
      const key = parseDebridLinkApiKeys(applied.settings.debridLinkApiKeys).find((entry) => entry.id === applied.response.accountId);
      if (!key) throw new Error("Account-Payload ist ungültig");
      checkedStatus = await checkDebridLinkKey(key);
    }
    if (command.action !== "delete" && applied.response.accountId && command.kind === "realdebrid-api") {
      const account = getRealDebridAccounts(applied.settings).find((entry) => entry.id === applied.response.accountId && entry.kind === "api");
      if (!account) throw new Error("Account-Payload ist ungültig");
      checkedStatus = await checkRealDebridAccount(account);
    }
    if (checkedStatus) {
      checkedStatus = sanitizeDebridAccountStatus(checkedStatus, redactions);
    }
    if (checkedStatus && !checkedStatus.valid) {
      throw new Error(checkedStatus.message || "Zugangsdaten ungültig");
    }
    this.updateSettings(applied.settings);
    if (checkedStatus) this.manager.applyDebridAccountStatuses([checkedStatus]);
    const state = createRendererState(this.settings);
    this.audit("INFO", "Account aktualisiert", { action: command.action, kind: command.kind, accountId: applied.response.accountId });
    return { ...applied.response, ...state };
  }

  public revealAccountSecret(request: AccountSecretRequest): AccountSecretResult {
    const secret = resolveStoredAccountSecret(this.settings, request);
    this.audit("INFO", "Gespeicherter Account-Zugang explizit angezeigt", { kind: request.kind });
    return { secret };
  }

  public getArchivePasswordList(): ArchivePasswordListResult {
    const passwords = this.settings.archivePasswordList;
    const entryCount = passwords.split(/\r?\n/).filter((entry) => entry.trim().length > 0).length;
    this.audit("INFO", "Archiv-Passwortliste explizit angezeigt", { entryCount });
    return { passwords };
  }

  public async checkAccountCredentials(input: AccountCredentialCheckInput): Promise<DebridAccountStatus> {
    const redactions = collectAccountStatusRedactionValues(this.settings, input);
    if (input.kind === "realdebrid-api" || input.kind === "realdebrid-web") {
      const useWebLogin = input.kind === "realdebrid-web";
      const account = input.secret?.trim() && !useWebLogin
        ? {
          id: `rda_${randomUUID().replace(/-/g, "")}`,
          kind: "api" as const,
          index: 0,
          label: "Real-Debrid",
          maskedLogin: "Geschützter API-Token",
          enabled: true,
          token: input.secret.trim()
        }
        : getRealDebridAccounts(this.settings).find((entry) => entry.id === input.accountId && entry.kind === (useWebLogin ? "web" : "api"));
      if (!account) throw new Error("Account-Payload ist ungültig");
      const status = sanitizeDebridAccountStatus(
        await checkRealDebridAccount(
          account,
          undefined,
          Date.now(),
          useWebLogin ? (signal) => this.getRealDebridWebFallback(account.id).probeLoginState(signal) : undefined
        ),
        redactions
      );
      if (!input.secret && getRealDebridAccounts(this.settings).some((entry) => entry.id === status.accountId)) {
        this.manager.applyDebridAccountStatuses([status]);
      }
      return status;
    }
    if (input.kind === "megadebrid-api" || input.kind === "megadebrid-web") {
      const mode = input.kind === "megadebrid-web" ? "web" : "api";
      const account = input.identity?.trim() && input.secret
        ? parseMegaDebridAccounts(`${input.identity.trim()}:${input.secret}`)[0]
        : getMegaDebridAccountsForMode(this.settings, mode).find((entry) => entry.id === input.accountId);
      if (!account) throw new Error("Account-Payload ist ungültig");
      const status = sanitizeDebridAccountStatus(await checkMegaDebridAccount(account), redactions);
      if (!input.secret && getMegaDebridAccountsForMode(this.settings, mode).some((entry) => entry.id === status.accountId)) {
        this.manager.applyDebridAccountStatuses([status]);
      }
      return status;
    }
    const key = input.secret?.trim()
      ? parseDebridLinkApiKeys(input.secret)[0]
      : parseDebridLinkApiKeys(this.settings.debridLinkApiKeys).find((entry) => entry.id === input.accountId);
    if (!key) throw new Error("Account-Payload ist ungültig");
    const status = sanitizeDebridAccountStatus(await checkDebridLinkKey(key), redactions);
    if (!input.secret && parseDebridLinkApiKeys(this.settings.debridLinkApiKeys).some((entry) => entry.id === status.accountId)) {
      this.manager.applyDebridAccountStatuses([status]);
    }
    return status;
  }

  public resetProviderDailyUsage(provider: DebridProvider): AppSettings {
    const liveSettings = this.manager.getSettings();
    const nextSettings = normalizeSettings({
      ...liveSettings,
      ...resetProviderDailyUsage(liveSettings, provider)
    });
    this.settings = nextSettings;
    saveSettings(this.storagePaths, this.settings);
    this.manager.setSettings(this.settings);
    this.audit("INFO", "Provider-Tagesnutzung zurückgesetzt", { provider });
    return this.settings;
  }

  public resetDebridLinkApiKeyDailyUsage(keyId: string): AppSettings {
    const liveSettings = this.manager.getSettings();
    const nextSettings = normalizeSettings({
      ...liveSettings,
      ...resetDebridLinkApiKeyDailyUsage(liveSettings, keyId)
    });
    this.settings = nextSettings;
    saveSettings(this.storagePaths, this.settings);
    this.manager.setSettings(this.settings);
    this.audit("INFO", "Debrid-Link-Key-Tagesnutzung zurückgesetzt", { keyId });
    return this.settings;
  }

  private getRealDebridWebPartition(accountId: string): string {
    return accountId === "rdw_legacy"
      ? "persist:realdebrid-web"
      : `persist:realdebrid-web-${accountId}`;
  }

  private getRealDebridWebFallback(accountId: string): RealDebridWebFallback {
    if (!isRealDebridWebAccountId(accountId)) {
      throw new Error("Account-Payload ist ungültig");
    }
    const existing = this.realDebridWebFallbacks.get(accountId);
    if (existing) {
      return existing;
    }
    const fallback = new RealDebridWebFallback(
      this.getRealDebridWebPartition(accountId),
      () => this.settings.rememberToken,
      () => this.queueRealDebridWebAuthentication(accountId),
      () => this.handleRealDebridWebWindowClosed(accountId)
    );
    this.realDebridWebFallbacks.set(accountId, fallback);
    return fallback;
  }

  private queueRealDebridWebAuthentication(accountId: string): void {
    if (this.realDebridWebAuthenticationTasks.has(accountId)) {
      return;
    }
    const generation = this.realDebridWebGenerations.get(accountId) || 0;
    const task = this.refreshRealDebridWebStatus(accountId, generation)
      .catch((error) => logger.warn(`Real-Debrid Web-Status konnte nicht aktualisiert werden (${accountId}): ${String(error)}`))
      .finally(() => {
        if (this.realDebridWebAuthenticationTasks.get(accountId) === task) {
          this.realDebridWebAuthenticationTasks.delete(accountId);
        }
      });
    this.realDebridWebAuthenticationTasks.set(accountId, task);
  }

  private handleRealDebridWebWindowClosed(accountId: string): void {
    if (!this.pendingRealDebridWebAccountIds.has(accountId)) {
      return;
    }
    void Promise.resolve().then(async () => {
      const authenticationTask = this.realDebridWebAuthenticationTasks.get(accountId);
      if (authenticationTask) {
        await authenticationTask;
      }
      if (!this.pendingRealDebridWebAccountIds.has(accountId)
        || this.settings.realDebridWebAccountIds.includes(accountId)) {
        return;
      }
      await this.cleanupRealDebridWebAccount(accountId, true);
    }).catch((error) => {
      logger.warn(`Abgebrochener Real-Debrid Web-Login konnte nicht bereinigt werden (${accountId}): ${String(error)}`);
    });
  }

  private async cleanupRealDebridWebAccount(accountId: string, clearStorage: boolean): Promise<void> {
    const nextGeneration = (this.realDebridWebGenerations.get(accountId) || 0) + 1;
    this.realDebridWebGenerations.set(accountId, nextGeneration);
    this.pendingRealDebridWebAccountIds.delete(accountId);
    const existing = this.realDebridWebFallbacks.get(accountId);
    this.realDebridWebFallbacks.delete(accountId);
    const fallback = existing || new RealDebridWebFallback(
      this.getRealDebridWebPartition(accountId),
      () => this.settings.rememberToken
    );
    if (clearStorage) {
      await fallback.clearSessions();
    } else {
      fallback.dispose();
    }
  }

  private pruneRealDebridWebFallbacks(previous: AppSettings, current: AppSettings): void {
    const currentIds = new Set(current.realDebridWebAccountIds);
    for (const accountId of previous.realDebridWebAccountIds) {
      if (currentIds.has(accountId)) {
        continue;
      }
      void this.cleanupRealDebridWebAccount(accountId, true).catch((error) => {
        logger.warn(`Real-Debrid Web-Session konnte nicht gelöscht werden (${accountId}): ${String(error)}`);
      });
    }
  }

  public async openRealDebridLoginWindow(request: RealDebridLoginRequest): Promise<void> {
    const accountId = String(request.accountId || "").trim();
    if (!isRealDebridWebAccountId(accountId)) {
      throw new Error("Account-Payload ist ungültig");
    }
    const existing = getRealDebridAccounts(this.settings).find((entry) => entry.id === accountId && entry.kind === "web");
    if (request.create && existing) {
      throw new Error("Account-Payload ist ungültig");
    }
    if (!request.create && !existing && accountId !== "rdw_legacy") {
      throw new Error("Account wurde nicht gefunden");
    }
    if (!existing) {
      const generation = (this.realDebridWebGenerations.get(accountId) || 0) + 1;
      this.realDebridWebGenerations.set(accountId, generation);
      this.pendingRealDebridWebAccountIds.set(accountId, {
        generation,
        dailyLimitBytes: request.create ? Math.floor(request.dailyLimitBytes || 0) : 0
      });
    }
    this.audit("INFO", "Real-Debrid Login-Fenster geöffnet", { accountId, create: !existing });
    try {
      await this.getRealDebridWebFallback(accountId).openLoginWindow();
    } catch (error) {
      if (!existing) {
        await this.cleanupRealDebridWebAccount(accountId, true);
      }
      throw error;
    }
  }

  public probeRealDebridWebAccount(accountId: string, signal?: AbortSignal) {
    return this.getRealDebridWebFallback(accountId).probeLoginState(signal);
  }

  public unrestrictRealDebridWebAccount(accountId: string, link: string, signal?: AbortSignal) {
    return this.getRealDebridWebFallback(accountId).unrestrict(link, signal);
  }

  public async clearRealDebridWebAccount(accountId: string): Promise<void> {
    await this.cleanupRealDebridWebAccount(accountId, true);
  }

  private async refreshRealDebridWebStatus(accountId: string, generation = this.realDebridWebGenerations.get(accountId) || 0): Promise<void> {
    const account = getRealDebridAccounts(this.settings)
      .filter((entry): entry is RealDebridWebAccountEntry => entry.kind === "web")
      .find((entry) => entry.id === accountId);
    const checkedAccount: RealDebridWebAccountEntry = account || {
      id: accountId,
      kind: "web",
      index: this.settings.realDebridWebAccountIds.length,
      label: `Browser-Login ${this.settings.realDebridWebAccountIds.length + 1}`,
      maskedLogin: "Geschützter Browser-Login",
      enabled: true
    };
    const status = sanitizeDebridAccountStatus(
      await checkRealDebridAccount(
        checkedAccount,
        undefined,
        Date.now(),
        (signal) => this.getRealDebridWebFallback(accountId).probeLoginState(signal)
      ),
      collectAccountStatusRedactionValues(this.settings)
    );
    if (!status.valid) {
      return;
    }
    if ((this.realDebridWebGenerations.get(accountId) || 0) !== generation) {
      return;
    }
    const currentAccount = getRealDebridAccounts(this.settings).find((entry) => entry.id === accountId && entry.kind === "web");
    if (account && !currentAccount) {
      return;
    }
    if (!account) {
      const pending = this.pendingRealDebridWebAccountIds.get(accountId);
      if (!pending || pending.generation !== generation) {
        return;
      }
      const applied = applyAccountCommand(this.settings, {
        action: "create",
        kind: "realdebrid-web",
        identity: accountId,
        secret: "",
        dailyLimitBytes: pending.dailyLimitBytes
      });
      this.pendingRealDebridWebAccountIds.delete(accountId);
      this.updateSettings(applied.settings);
    }
    this.manager.applyDebridAccountStatuses([status]);
    const fallback = this.realDebridWebFallbacks.get(accountId);
    if (fallback) {
      this.realDebridWebFallbacks.delete(accountId);
      fallback.dispose();
    }
  }

  public async openAllDebridLoginWindow(): Promise<void> {
    this.audit("INFO", "AllDebrid Login-Fenster geöffnet");
    await this.allDebridWebFallback.openLoginWindow();
  }

  public async importBestDebridCookies(filePath: string): Promise<number> {
    const imported = await this.bestDebridWebFallback.importCookiesFromFile(filePath);
    this.audit("INFO", "BestDebrid Cookies importiert", {
      filePath,
      imported
    });
    return imported;
  }

  public async getAllDebridHostInfo(host = "rapidgator"): Promise<AllDebridHostInfo> {
    if (this.settings.allDebridUseWebLogin) {
      return this.allDebridWebFallback.getHostInfo(host);
    }
    const token = this.settings.allDebridToken.trim();
    if (!token) {
      throw new Error("AllDebrid ist nicht konfiguriert");
    }
    return fetchAllDebridHostInfo(token, host);
  }

  public async getDebridLinkHostLimits(host = "rapidgator") {
    return fetchDebridLinkHostLimits(this.settings.debridLinkApiKeys, host);
  }

  public async checkDebridAccounts(scope: AccountCheckScope = "active"): Promise<DebridAccountStatus[]> {
    const checkedStatuses = sanitizeDebridAccountStatuses(
      await checkAllDebridAccounts(
        this.settings,
        undefined,
        (accountId, signal) => this.getRealDebridWebFallback(accountId).probeLoginState(signal),
        scope
      ),
      collectAccountStatusRedactionValues(this.settings)
    );
    const statuses = retainConfiguredRealDebridStatuses(this.settings, checkedStatuses);
    this.manager.applyDebridAccountStatuses(statuses);
    this.audit("INFO", "Debrid-Accounts geprueft", {
      total: statuses.length,
      scope,
      valid: statuses.filter((s) => s.valid).length,
      premium: statuses.filter((s) => s.isPremium).length
    });
    return statuses;
  }
  public async checkUpdates(): Promise<UpdateCheckResult> {
    const result = await checkGitHubUpdate(this.settings.updateRepo);
    if (!result.error) {
      this.lastUpdateCheck = result;
      this.lastUpdateCheckAt = Date.now();
    }
    return result;
  }

  public async installUpdate(onProgress?: (progress: UpdateInstallProgress) => void): Promise<UpdateInstallResult> {
    const result = await runInstallWithResume(
      this.manager,
      () => installLatestUpdate(this.settings.updateRepo, undefined, onProgress)
    );
    if (result.started) {
      this.lastUpdateCheck = null;
      this.lastUpdateCheckAt = 0;
    }
    return result;
  }

  public addLinks(payload: AddLinksPayload): { addedPackages: number; addedLinks: number; invalidCount: number } {
    const parsed = parseCollectorInput(payload.rawText, payload.packageName || this.settings.packageName);
    if (parsed.length === 0) {
      this.audit("WARN", "Links hinzufügen ohne gültigen Inhalt", {
        hasPackageName: Boolean(payload.packageName)
      });
      return { addedPackages: 0, addedLinks: 0, invalidCount: 1 };
    }
    const result = this.manager.addPackages(parsed);
    this.audit("INFO", "Links hinzugefügt", {
      addedPackages: result.addedPackages,
      addedLinks: result.addedLinks,
      requestedPackages: parsed.length
    });
    return { ...result, invalidCount: 0 };
  }

  public inspectCollectorText(request: CollectorInspectionRequest): Promise<CollectorInspectionResult> {
    return inspectCollectorText(request, this.settings);
  }

  public async inspectCollectorContainers(filePaths: string[], addedAt: number): Promise<CollectorInspectionResult> {
    const packages = await importDlcContainers(filePaths);
    return inspectCollectorPackages(packages, this.settings, addedAt, {}, true);
  }

  public async addContainers(filePaths: string[]): Promise<{ addedPackages: number; addedLinks: number }> {
    const packages = await importDlcContainers(filePaths);
    const merged: ParsedPackageInput[] = packages.map((pkg) => ({
      name: pkg.name,
      links: pkg.links,
      ...(pkg.fileNames ? { fileNames: pkg.fileNames } : {})
    }));
    const result = this.manager.addPackages(merged);
    this.audit("INFO", "Container importiert", {
      files: filePaths.length,
      addedPackages: result.addedPackages,
      addedLinks: result.addedLinks
    });
    return result;
  }

  public async getStartConflicts(): Promise<StartConflictEntry[]> {
    return this.manager.getStartConflicts();
  }

  public async resolveStartConflict(packageId: string, policy: DuplicatePolicy): Promise<StartConflictResolutionResult> {
    return this.manager.resolveStartConflict(packageId, policy);
  }

  public clearAll(): void {
    this.audit("WARN", "Queue komplett geleert");
    this.manager.clearAll();
  }

  public async start(): Promise<void> {
    this.audit("INFO", "Session-Start ausgelöst");
    await this.manager.start();
  }

  public async startPackages(packageIds: string[]): Promise<void> {
    this.audit("INFO", "Paket-Start ausgelöst", { packageIds });
    await this.manager.startPackages(packageIds);
  }

  public async startItems(itemIds: string[]): Promise<void> {
    this.audit("INFO", "Item-Start ausgelöst", { itemIds });
    await this.manager.startItems(itemIds);
  }

  public stop(): void {
    this.audit("INFO", "Session-Stopp ausgelöst");
    this.manager.stop();
  }

  public togglePause(): boolean {
    const paused = this.manager.togglePause();
    this.audit("INFO", "Pause umgeschaltet", { paused });
    return paused;
  }

  public retryExtraction(packageId: string): void {
    this.audit("INFO", "Extraktion manuell wiederholt", { packageId });
    this.manager.retryExtraction(packageId);
  }

  public extractNow(packageId: string): void {
    this.audit("INFO", "Jetzt entpacken ausgelöst", { packageId });
    this.manager.extractNow(packageId);
  }

  public resetPackage(packageId: string): void {
    this.audit("INFO", "Paket zurückgesetzt", { packageId });
    this.manager.resetPackage(packageId);
  }

  public cancelPackage(packageId: string): void {
    this.audit("WARN", "Paket abgebrochen", { packageId });
    this.manager.cancelPackage(packageId);
  }

  public renamePackage(packageId: string, newName: string): void {
    this.audit("INFO", "Paket umbenannt", { packageId, newName });
    this.manager.renamePackage(packageId, newName);
  }

  public reorderPackages(packageIds: string[]): void {
    this.audit("INFO", "Paketreihenfolge geändert", { packageIds });
    this.manager.reorderPackages(packageIds);
  }

  public removeItem(itemId: string): void {
    this.audit("WARN", "Item entfernt", { itemId });
    this.manager.removeItem(itemId);
  }

  public togglePackage(packageId: string): void {
    this.audit("INFO", "Paket aktiviert/deaktiviert", { packageId });
    this.manager.togglePackage(packageId);
  }

  public exportPackageSelection(packageIds: string[]): { text: string; defaultFileName: string; packageCount: number; linkCount: number } {
    const selection = buildLinkExportSelection(this.manager.getSnapshot(), packageIds, []);
    this.audit("INFO", "Paket-Auswahl exportiert", {
      packageCount: selection.packageCount,
      linkCount: selection.linkCount,
      packageIds
    });
    return {
      text: serializeLinkExportText(selection.packages),
      defaultFileName: selection.defaultFileName,
      packageCount: selection.packageCount,
      linkCount: selection.linkCount
    };
  }

  public exportItemSelection(itemIds: string[]): { text: string; defaultFileName: string; packageCount: number; linkCount: number } {
    const selection = buildLinkExportSelection(this.manager.getSnapshot(), [], itemIds);
    this.audit("INFO", "Item-Auswahl exportiert", {
      packageCount: selection.packageCount,
      linkCount: selection.linkCount,
      itemIds
    });
    return {
      text: serializeLinkExportText(selection.packages),
      defaultFileName: selection.defaultFileName,
      packageCount: selection.packageCount,
      linkCount: selection.linkCount
    };
  }

  public exportQueue(): string {
    return this.manager.exportQueue();
  }

  public importQueue(json: string): { addedPackages: number; addedLinks: number } {
    const result = this.manager.importQueue(json);
    this.audit("INFO", "Import-Datei verarbeitet", result);
    return result;
  }

  public getSessionStats(): SessionStats {
    return this.manager.getSessionStats();
  }

  public resetSessionStats(): void {
    this.audit("INFO", "Session-Statistik zurückgesetzt");
    this.manager.resetSessionStats();
  }

  public resetDownloadStats(): void {
    this.manager.resetDownloadStats();
    this.settings = this.manager.getSettings();
    this.audit("INFO", "Download-Statistik zurückgesetzt");
  }

  public exportBackup(passphrase: string): Buffer {
    let remoteDiagnostics: BackupRemoteDiagnostics | undefined;
    if (Boolean(this.settings.backupIncludeRemoteDiagnostics)) {
      const status = getDebugServerRuntimeStatus();
      remoteDiagnostics = {
        allowlist: getDebugAllowlist(),
        port: status.port,
        hostMode: status.host === "0.0.0.0" ? "network" : "local"
      };
    }
    const payloadObj = buildBackupPayload({
      settings: { ...this.settings },
      appVersion: APP_VERSION,
      exportedAt: new Date().toISOString(),
      session: this.manager.getSession(),
      history: loadHistoryForRetention(this.storagePaths, this.settings.historyRetentionMode, this.historyLimits()),
      statistics: this.manager.getStatisticsLedgerForBackup(),
      remoteDiagnostics
    });
    const encrypted = encryptBackup(JSON.stringify(payloadObj), passphrase);
    this.audit("INFO", "Backup exportiert", {
      kind: payloadObj.kind,
      historyEntries: payloadObj.history ? payloadObj.history.length : 0,
      sessionItems: payloadObj.session ? Object.keys(payloadObj.session.items).length : 0,
      sessionPackages: payloadObj.session ? Object.keys(payloadObj.session.packages).length : 0
    });
    return encrypted;
  }

  public async exportOnlineBackup(): Promise<{ key: string }> {
    const created = createOnlineBackup({ ...this.settings }, APP_VERSION);
    await uploadOnlineBackup(created.record, ONLINE_BACKUP_API_URL);
    this.audit("INFO", "Online-Sicherung erstellt", { kind: "settings-only" });
    return { key: created.key };
  }

  public async importOnlineBackup(key: string): Promise<{ restored: boolean; relaunch: false; message: string }> {
    const payload = await downloadOnlineBackup(key, ONLINE_BACKUP_API_URL);
    this.applySettingsOnlyBackup(payload.settings);
    this.audit("INFO", "Online-Sicherung importiert", {
      kind: "settings-only",
      accountSummary: buildAccountSummary(this.settings)
    });
    return { restored: true, relaunch: false, message: "Einstellungen aus Online-Sicherung wiederhergestellt" };
  }

  public async exportSupportBundle(): Promise<{ buffer: Buffer; defaultFileName: string }> {
    this.audit("INFO", "Support-Bundle exportiert");
    logTraceEvent("INFO", "support", "Support-Bundle erstellt", {
      packageCount: Object.keys(this.manager.getSnapshot().session.packages).length,
      itemCount: Object.keys(this.manager.getSnapshot().session.items).length
    });
    return {
      buffer: await buildSupportBundle(this.manager, this.storagePaths.baseDir, {
        hostDiagnosticsMode: "cached",
        notificationStatus: this.getNotificationSupportPayload()
      }),
      defaultFileName: getSupportBundleDefaultFileName()
    };
  }

  public getSupportBundleDefaultFileName(): string {
    return getSupportBundleDefaultFileName();
  }

  public getNotificationSupportPayload(): NotificationSupportPayload {
    return buildNotificationSupportPayload(
      this.notificationOutbox.getStatus(),
      this.downloadHealthMonitor.getState()
    );
  }

  public importBackup(data: Buffer, passphrase?: string): { restored: boolean; relaunch: boolean; message: string } {
    let parsed: Record<string, unknown>;
    try {
      const json = decryptBackup(data, passphrase);
      parsed = JSON.parse(json) as Record<string, unknown>;
    } catch {
      try {
        const json = data.toString("utf8");
        parsed = JSON.parse(json) as Record<string, unknown>;
      } catch {
        return { restored: false, relaunch: false, message: "Backup-Datei konnte nicht entschlüsselt werden" };
      }
    }
    const plan = planBackupImport(parsed);
    if (!plan.valid) {
      return { restored: false, relaunch: false, message: plan.message };
    }
    const hasSession = plan.restoreDownloads;

    const importedSettings = parsed.settings as AppSettings;
    const importedSettingsRecord = importedSettings as unknown as Record<string, unknown>;
    const currentSettingsRecord = this.settings as unknown as Record<string, unknown>;
    const SENSITIVE_KEYS: (keyof AppSettings)[] = [
      "token", "megaLogin", "megaPassword", "bestToken", "allDebridToken",
      "ddownloadLogin", "ddownloadPassword", "oneFichierApiKey",
      "debridLinkApiKeys", "linkSnappyLogin", "linkSnappyPassword",
      "notifyUrl"
    ];
    for (const key of SENSITIVE_KEYS) {
      const val = importedSettingsRecord[key];
      if (typeof val === "string" && val.startsWith("***")) {
        importedSettingsRecord[key] = currentSettingsRecord[key];
      }
    }
    let restoredSettings = normalizeSettings(importedSettings);

    // Settings-only backup: keep the running queue AND the live counters untouched.
    // Overlay the live usage/status counters so they don't roll back to the backup's
    // (older) snapshot (BUG I), and suppress the retroactive cleanup sweep so the
    // backup's cleanup policy can't purge the live completed queue here (BUG B) — the
    // policy still governs FUTURE completions through the normal path. Do NOT stop the
    // manager, wipe the session, block persistence or relaunch.
    if (!hasSession) {
      this.applySettingsOnlyBackup(restoredSettings, parsed.remoteDiagnostics, true);
      this.audit("INFO", "Backup importiert (nur Einstellungen)", {
        accountSummary: buildAccountSummary(this.settings)
      });
      return {
        restored: true,
        relaunch: false,
        message: "Einstellungen wiederhergestellt"
      };
    }

    if (this.settings.logStorageLocation !== restoredSettings.logStorageLocation
      && !this.reconfigureLogStorage(restoredSettings.logStorageLocation)) {
      restoredSettings = normalizeSettings({
        ...restoredSettings,
        logStorageLocation: this.settings.logStorageLocation
      });
    }
    this.settings = restoredSettings;
    saveSettings(this.storagePaths, this.settings);
    this.manager.setSettings(this.settings);

    this.manager.stop();
    this.manager.abortAllPostProcessing();
    this.manager.clearPersistTimer();
    cancelPendingAsyncSaves();

    const restoredSession = normalizeLoadedSessionTransientFields(
      normalizeLoadedSession(parsed.session)
    );
    saveSession(this.storagePaths, restoredSession);

    if (parsed.statistics) {
      saveStatisticsLedger(this.storagePaths.statisticsFile, normalizeStatisticsLedger(parsed.statistics));
    }

    if (Array.isArray(parsed.history) && parsed.history.length > 0) {
      const normalizedHistory = (parsed.history as unknown[])
        .map((raw, idx) => normalizeHistoryEntry(raw, idx))
        .filter((entry): entry is HistoryEntry => entry !== null);
      if (normalizedHistory.length > 0) {
        saveHistory(this.storagePaths, normalizedHistory);
        logger.info(`Backup: ${normalizedHistory.length} History-Einträge wiederhergestellt`);
      }
    }

    resetHistoryForRetention(this.storagePaths, this.settings.historyRetentionMode);

    this.restoreRemoteDiagnosticsFromBackup(parsed.remoteDiagnostics, false);

    this.manager.skipShutdownPersist = true;
    this.manager.blockAllPersistence = true;
    logger.info("Backup wiederhergestellt — App startet automatisch neu");
    this.audit("WARN", "Backup importiert", {
      historyEntries: Array.isArray(parsed.history) ? parsed.history.length : 0,
      accountSummary: buildAccountSummary(this.settings)
    });
    return { restored: true, relaunch: true, message: "Backup wiederhergestellt – App startet automatisch neu…" };
  }

  public getSessionLogPath(): string | null {
    return getSessionLogPath();
  }

  public getLogDirectory(): string {
    return this.logDirectory;
  }

  public getPackageLogPath(packageId: string): string | null {
    return this.manager.getPackageLogPath(packageId) || getPackageLogPath(packageId);
  }

  public getItemLogPath(itemId: string): string | null {
    return this.manager.getItemLogPath(itemId) || getItemLogPath(itemId);
  }

  private evaluateDownloadHealth(): Promise<void> {
    if (this.downloadHealthEvaluation) {
      return this.downloadHealthEvaluation;
    }
    const now = Date.now();
    const task = this.downloadHealthMonitor.sample(
      this.manager.getDownloadHealthSnapshot(now),
      now,
      {
        stallAfterMs: this.settings.notifyStallAfterSeconds * 1000,
        cooldownMs: this.settings.notifyStallCooldownMinutes * 60_000,
        notifyOnStall: this.settings.notifyOnDownloadStall && Boolean(String(this.settings.notifyUrl || "").trim()),
        notifyOnRecovery: this.settings.notifyOnDownloadRecovery && Boolean(String(this.settings.notifyUrl || "").trim())
      },
      (event) => this.notificationOutbox.enqueue(event)
    ).then(() => undefined).catch((error) => {
      logger.warn(`Download-Health-Monitor konnte nicht ausgewertet werden: ${String(error)}`);
    }).finally(() => {
      if (this.downloadHealthEvaluation === task) {
        this.downloadHealthEvaluation = null;
      }
    });
    this.downloadHealthEvaluation = task;
    return task;
  }

  public async shutdown(): Promise<void> {
    if (this.downloadHealthTimer) {
      clearInterval(this.downloadHealthTimer);
      this.downloadHealthTimer = null;
    }
    this.manager.suspendDownloadHealthMonitoring?.();
    if (this.downloadHealthEvaluation) {
      await this.downloadHealthEvaluation;
    }
    if (this.downloadHealthMonitor) {
      await this.evaluateDownloadHealth();
    }
    if (this.runtimeStatsTimer) {
      clearInterval(this.runtimeStatsTimer);
      this.runtimeStatsTimer = null;
    }
    stopDebugServer();
    abortActiveUpdateDownload();
    cancelPendingAsyncSaves();
    const notificationFlush = this.manager.flushNotificationsForShutdown?.();
    if (notificationFlush) {
      await notificationFlush;
    }
    await this.notificationOutbox.drainForShutdown(3000).catch((error) => {
      logger.warn(`Notification-Outbox konnte beim Beenden nicht geleert werden: ${String(error)}`);
    });
    this.manager.prepareForShutdown();
    this.megaWebFallback.dispose();
    for (const fallback of this.realDebridWebFallbacks.values()) {
      fallback.dispose();
    }
    this.realDebridWebFallbacks.clear();
    this.pendingRealDebridWebAccountIds.clear();
    this.allDebridWebFallback.dispose();
    this.bestDebridWebFallback.dispose();
    this.shutdownLogStorage();
    this.audit("INFO", "App beendet");
    shutdownTraceLog();
    shutdownAccountRotationLog();
    shutdownConversionLog();
    shutdownAuditLog();
    if (this.settings.historyRetentionMode === "session") {
      clearHistory(this.storagePaths);
    }
    logger.info("App beendet");
  }

  private getDesktopDirectory(): string | null {
    try {
      return app.getPath("desktop");
    } catch {
      return null;
    }
  }

  private initializeLogStorage(): void {
    configureLogger(this.logDirectory);
    initSessionLog(this.logDirectory);
    initPackageLogs(this.logDirectory);
    initItemLogs(this.logDirectory);
    initAuditLog(this.logDirectory);
    initAccountRotationLog(this.logDirectory);
    initConversionLog(this.logDirectory);
    initRenameLog(this.logDirectory);
    initDesktopRenameLogAt(this.logDirectory);
    initTraceLog(this.logDirectory);
  }

  private shutdownLogStorage(): void {
    flushLoggerSync();
    shutdownSessionLog();
    shutdownPackageLogs();
    shutdownItemLogs();
    shutdownRenameLog();
    shutdownDesktopRenameLog();
  }

  private reconfigureLogStorage(location: AppSettings["logStorageLocation"]): boolean {
    const nextDirectory = resolveLogDirectory(this.storagePaths.baseDir, this.getDesktopDirectory(), location);
    if (nextDirectory === this.logDirectory) {
      return true;
    }
    if (!prepareLogDirectory(nextDirectory)) {
      return false;
    }
    this.shutdownLogStorage();
    shutdownTraceLog();
    shutdownAccountRotationLog();
    shutdownConversionLog();
    shutdownAuditLog();
    const legacyDirectory = location === "desktop"
      ? getLegacyDesktopLogDirectory(this.getDesktopDirectory())
      : null;
    migrateLogDirectories(
      [this.logDirectory, ...(legacyDirectory ? [legacyDirectory] : [])],
      nextDirectory
    );
    this.logDirectory = nextDirectory;
    this.initializeLogStorage();
    logger.info(`Log-Speicherort geändert: ${this.logDirectory}`);
    return true;
  }

  private historyLimits(): { maxEntries: number; maxAgeDays: number } {
    return { maxEntries: this.settings.historyMaxEntries, maxAgeDays: this.settings.historyMaxAgeDays };
  }

  private recordHistoryEntry(entry: HistoryEntry): void {
    const entries = addHistoryEntryForRetention(this.storagePaths, this.settings.historyRetentionMode, entry, this.historyLimits());
    if (entries[0]?.id === entry.id) {
      this.onHistoryEntryAddedHandler?.(entry);
    }
  }

  public getHistory(): HistoryEntry[] {
    return loadHistoryForRetention(this.storagePaths, this.settings.historyRetentionMode, this.historyLimits());
  }

  public clearHistory(): void {
    this.audit("WARN", "Verlauf geleert");
    clearHistory(this.storagePaths);
  }

  public setPackagePriority(packageId: string, priority: PackagePriority): void {
    this.audit("INFO", "Paket-Priorität geändert", { packageId, priority });
    this.manager.setPackagePriority(packageId, priority);
  }

  public skipItems(itemIds: string[]): void {
    this.audit("INFO", "Items übersprungen", { itemIds });
    this.manager.skipItems(itemIds);
  }

  public resetItems(itemIds: string[]): void {
    this.audit("INFO", "Items zurückgesetzt", { itemIds });
    this.manager.resetItems(itemIds);
  }

  public removeHistoryEntry(entryId: string): void {
    this.removeHistoryEntries([entryId]);
  }

  public removeHistoryEntries(entryIds: string[]): void {
    this.audit("INFO", "Verlaufseinträge entfernt", { count: entryIds.length });
    removeHistoryEntries(this.storagePaths, entryIds, this.historyLimits());
  }

  public addToHistory(entry: HistoryEntry): void {
    this.audit("INFO", "Verlaufseintrag hinzugefügt", {
      id: entry.id,
      name: entry.name,
      status: entry.status,
      provider: entry.provider,
      fileCount: entry.fileCount
    });
    addHistoryEntry(this.storagePaths, entry);
  }
}
