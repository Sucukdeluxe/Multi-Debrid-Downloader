import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getDebridLinkApiKeyIds } from "../shared/debrid-link-keys";
import { getMegaDebridAccountIds, mergeMegaDebridCredentialPools, parseMegaDebridAccounts } from "../shared/mega-debrid-accounts";
import { AppSettings, AudioStripSummary, BandwidthScheduleEntry, DebridAccountStatus, DebridFallbackProvider, DebridProvider, DownloadItem, DownloadStatus, HistoryEntry, HistoryRetentionMode, LogStorageLocation, PackageEntry, PackagePriority, SessionState } from "../shared/types";
import { getProviderUsageDayKey } from "../shared/provider-daily-limits";
import { defaultSettings } from "./constants";
import { needsPersistedSettingsRewrite, protectPersistedSettings, restorePersistedSettings } from "./credential-protection";
import { logger } from "./logger";

const VALID_PRIMARY_PROVIDERS = new Set(["realdebrid", "megadebrid-api", "megadebrid-web", "bestdebrid", "alldebrid", "ddownload", "onefichier", "debridlink", "linksnappy"]);
const VALID_FALLBACK_PROVIDERS = new Set(["none", "realdebrid", "megadebrid-api", "megadebrid-web", "bestdebrid", "alldebrid", "ddownload", "onefichier", "debridlink", "linksnappy"]);
const VALID_CLEANUP_MODES = new Set(["none", "trash", "delete"]);
const VALID_CONFLICT_MODES = new Set(["overwrite", "skip", "rename", "ask"]);
const VALID_FINISHED_POLICIES = new Set(["never", "immediate", "on_start", "package_done"]);
const VALID_SPEED_MODES = new Set(["global", "per_download"]);
const VALID_THEMES = new Set(["dark", "light"]);
const VALID_EXTRACT_CPU_PRIORITIES = new Set(["high", "middle", "low"]);
const VALID_HISTORY_RETENTION_MODES = new Set<HistoryRetentionMode>(["never", "session", "permanent"]);
const VALID_LOG_STORAGE_LOCATIONS = new Set<LogStorageLocation>(["appdata", "desktop"]);
const VALID_PACKAGE_PRIORITIES = new Set<string>(["high", "normal", "low"]);
const VALID_DOWNLOAD_STATUSES = new Set<DownloadStatus>([
  "queued", "validating", "downloading", "paused", "reconnect_wait", "extracting", "integrity_check", "completed", "failed", "cancelled"
]);
const VALID_ITEM_PROVIDERS = new Set<DebridProvider>(["realdebrid", "megadebrid", "megadebrid-api", "megadebrid-web", "bestdebrid", "alldebrid", "ddownload", "onefichier", "debridlink"]);
const VALID_ONLINE_STATUSES = new Set(["online", "offline", "checking"]);
const SAFE_SESSION_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeSessionId(value: unknown): string {
  const text = asText(value);
  if (!text || !SAFE_SESSION_ID_RE.test(text)) {
    return "";
  }
  return text;
}

function isPathInsideDir(filePath: string, dirPath: string): boolean {
  try {
    const resolvedFile = path.resolve(filePath);
    const resolvedDir = path.resolve(dirPath);
    const normalizedFile = process.platform === "win32" ? resolvedFile.toLowerCase() : resolvedFile;
    const normalizedDir = process.platform === "win32" ? resolvedDir.toLowerCase() : resolvedDir;
    return normalizedFile === normalizedDir || normalizedFile.startsWith(`${normalizedDir}${path.sep}`);
  } catch {
    return false;
  }
}

function normalizeSessionTargetPath(value: unknown, packageOutputDir: string): string {
  const targetPath = asText(value);
  if (!targetPath || !packageOutputDir || !path.isAbsolute(targetPath)) {
    return "";
  }
  if (!isPathInsideDir(targetPath, packageOutputDir)) {
    return "";
  }
  return path.resolve(targetPath);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(num)));
}

function createScheduleId(index: number): string {
  return `sched-${Date.now().toString(36)}-${index.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeBandwidthSchedules(raw: unknown): BandwidthScheduleEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const normalized: BandwidthScheduleEntry[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const entry = raw[index];
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const value = entry as Partial<BandwidthScheduleEntry>;
    const rawId = typeof value.id === "string" ? value.id.trim() : "";
    normalized.push({
      id: rawId || createScheduleId(index),
      startHour: clampNumber(value.startHour, 0, 0, 23),
      endHour: clampNumber(value.endHour, 8, 0, 23),
      speedLimitKbps: clampNumber(value.speedLimitKbps, 0, 0, 500000),
      enabled: value.enabled === undefined ? true : Boolean(value.enabled)
    });
  }
  return normalized;
}

function normalizeAbsoluteDir(value: unknown, fallback: string): string {
  const text = asText(value);
  if (!text || !path.isAbsolute(text)) {
    return path.resolve(fallback);
  }
  return path.resolve(text);
}

function samePath(left: unknown, right: string): boolean {
  const leftText = asText(left);
  if (!leftText) {
    return false;
  }
  const leftResolved = path.resolve(leftText);
  const rightResolved = path.resolve(right);
  return process.platform === "win32"
    ? leftResolved.toLowerCase() === rightResolved.toLowerCase()
    : leftResolved === rightResolved;
}

function migrateLegacyDefaultDirectories(settings: AppSettings, defaults: AppSettings): AppSettings {
  const legacyBaseDir = path.join(os.homedir(), "Downloads", "RealDebrid");
  const legacyExtractDir = path.join(legacyBaseDir, "_entpackt");
  const legacyMkvLibraryDir = path.join(legacyBaseDir, "_mkv");
  const isUntouchedLegacyConfiguration = samePath(settings.outputDir, legacyBaseDir)
    && samePath(settings.extractDir, legacyExtractDir)
    && samePath(settings.mkvLibraryDir, legacyMkvLibraryDir);
  if (!isUntouchedLegacyConfiguration) {
    return settings;
  }
  return {
    ...settings,
    outputDir: defaults.outputDir,
    extractDir: defaults.extractDir,
    mkvLibraryDir: defaults.mkvLibraryDir
  };
}

const DEFAULT_COLUMN_ORDER = ["name", "size", "progress", "hoster", "account", "prio", "status", "speed", "availability"];
const ALL_VALID_COLUMNS = new Set([...DEFAULT_COLUMN_ORDER, "added"]);

function normalizeColumnOrder(raw: unknown, version: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [...DEFAULT_COLUMN_ORDER];
  }
  const valid = ALL_VALID_COLUMNS;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const col of raw) {
    if (typeof col === "string" && valid.has(col) && !seen.has(col)) {
      seen.add(col);
      result.push(col);
    }
  }
  if (!seen.has("name")) {
    result.unshift("name");
  }
  if (version !== 3 && !seen.has("availability")) {
    const speedIndex = result.indexOf("speed");
    result.splice(speedIndex >= 0 ? speedIndex + 1 : result.length, 0, "availability");
  }
  return result;
}

function getPreferredMegaDebridProvider(megaDebridPreferApi: boolean, megaDebridApiEnabled: boolean, megaDebridWebEnabled: boolean): DebridProvider {
  if (megaDebridApiEnabled && !megaDebridWebEnabled) {
    return "megadebrid-api";
  }
  if (megaDebridWebEnabled && !megaDebridApiEnabled) {
    return "megadebrid-web";
  }
  return megaDebridPreferApi ? "megadebrid-api" : "megadebrid-web";
}

function normalizeConfiguredProvider(raw: unknown, megaDebridPreferApi: boolean, megaDebridApiEnabled: boolean, megaDebridWebEnabled: boolean): DebridProvider | null {
  const provider = String(raw ?? "").trim();
  if (!provider) {
    return null;
  }
  if (provider === "megadebrid") {
    return getPreferredMegaDebridProvider(megaDebridPreferApi, megaDebridApiEnabled, megaDebridWebEnabled);
  }
  return VALID_PRIMARY_PROVIDERS.has(provider) ? provider as DebridProvider : null;
}

function normalizeFallbackProvider(raw: unknown, megaDebridPreferApi: boolean, megaDebridApiEnabled: boolean, megaDebridWebEnabled: boolean): DebridFallbackProvider {
  const provider = String(raw ?? "").trim();
  if (!provider || provider === "none") {
    return "none";
  }
  const normalized = normalizeConfiguredProvider(provider, megaDebridPreferApi, megaDebridApiEnabled, megaDebridWebEnabled);
  return normalized || "none";
}

function normalizeDisabledProviders(raw: unknown): DebridProvider[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<DebridProvider>();
  const result: DebridProvider[] = [];
  for (const entry of raw) {
    const provider = String(entry ?? "").trim();
    const candidates: DebridProvider[] = provider === "megadebrid"
      ? ["megadebrid-api", "megadebrid-web"]
      : (VALID_PRIMARY_PROVIDERS.has(provider) ? [provider as DebridProvider] : []);
    for (const candidate of candidates) {
      if (seen.has(candidate)) {
        continue;
      }
      seen.add(candidate);
      result.push(candidate);
    }
  }
  return result;
}

function normalizeProviderByteMap(
  raw: unknown,
  megaDebridPreferApi: boolean,
  megaDebridApiEnabled: boolean,
  megaDebridWebEnabled: boolean,
  mergeMode: "max" | "sum"
): Partial<Record<DebridProvider, number>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const result: Partial<Record<DebridProvider, number>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const provider = normalizeConfiguredProvider(key, megaDebridPreferApi, megaDebridApiEnabled, megaDebridWebEnabled);
    if (!provider) {
      continue;
    }
    const bytes = clampNumber(value, 0, 0, Number.MAX_SAFE_INTEGER);
    if (bytes <= 0) {
      continue;
    }
    if (mergeMode === "sum") {
      result[provider] = (result[provider] || 0) + bytes;
    } else {
      result[provider] = Math.max(result[provider] || 0, bytes);
    }
  }
  return result;
}

function normalizeNamedByteMap(raw: unknown, allowedKeys: readonly string[]): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const allowed = new Set(allowedKeys);
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey || !allowed.has(normalizedKey)) {
      continue;
    }
    const bytes = clampNumber(value, 0, 0, Number.MAX_SAFE_INTEGER);
    if (bytes <= 0) {
      continue;
    }
    result[normalizedKey] = bytes;
  }
  return result;
}

function normalizeDebridAccountStatuses(
  value: unknown,
  megaIds: string[],
  debridLinkIds: string[]
): Record<string, DebridAccountStatus> {
  const allowed = new Set([...megaIds, ...debridLinkIds]);
  const result: Record<string, DebridAccountStatus> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (!allowed.has(key) || !raw || typeof raw !== "object") {
        continue;
      }
      const entry = raw as Partial<DebridAccountStatus>;
      if (typeof entry.accountId !== "string" || typeof entry.checkedAt !== "number") {
        continue;
      }
      result[key] = {
        accountId: entry.accountId,
        provider: entry.provider === "debridlink" ? "debridlink" : "megadebrid",
        label: String(entry.label || ""),
        maskedLogin: String(entry.maskedLogin || ""),
        valid: Boolean(entry.valid),
        isPremium: Boolean(entry.isPremium),
        premiumUntilMs: typeof entry.premiumUntilMs === "number" ? entry.premiumUntilMs : null,
        email: typeof entry.email === "string" ? entry.email : undefined,
        message: String(entry.message || ""),
        checkedAt: entry.checkedAt
      };
    }
  }
  return result;
}

function normalizeStringList(raw: unknown, allowedKeys: readonly string[]): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const allowed = new Set(allowedKeys);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of raw) {
    const normalized = String(entry || "").trim();
    if (!normalized || !allowed.has(normalized) || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeHosterRouting(raw: unknown, megaDebridPreferApi: boolean, megaDebridApiEnabled: boolean, megaDebridWebEnabled: boolean): Record<string, DebridProvider> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, DebridProvider> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const hoster = String(key).trim().toLowerCase();
    const provider = normalizeConfiguredProvider(value, megaDebridPreferApi, megaDebridApiEnabled, megaDebridWebEnabled);
    if (hoster && provider) {
      result[hoster] = provider;
    }
  }
  return result;
}

function normalizeProviderOrder(
  raw: unknown,
  megaDebridPreferApi: boolean,
  megaDebridApiEnabled: boolean,
  megaDebridWebEnabled: boolean,
  legacyPrimary: unknown,
  legacySecondary: unknown,
  legacyTertiary: unknown
): DebridProvider[] {
  let list: unknown[] = [];

  if (Array.isArray(raw) && raw.length > 0) {
    list = raw;
  } else {
    const candidates = [legacyPrimary, legacySecondary, legacyTertiary].filter(
      (v) => v && String(v).trim() && String(v).trim() !== "none"
    );
    if (candidates.length > 0) {
      list = candidates;
    }
  }

  const seen = new Set<DebridProvider>();
  const result: DebridProvider[] = [];
  for (const entry of list) {
    const provider = normalizeConfiguredProvider(entry, megaDebridPreferApi, megaDebridApiEnabled, megaDebridWebEnabled);
    if (provider && !seen.has(provider)) {
      seen.add(provider);
      result.push(provider);
    }
  }
  return result;
}

const DEPRECATED_UPDATE_REPO_NAMES = new Set([
  "real-debrid-downloader",
  "multi-debrid-downloader"
]);

function migrateUpdateRepo(raw: string, fallback: string): string {
  const trimmed = raw.trim();
  const repoName = trimmed.split("/").filter(Boolean).pop()?.replace(/\.git$/i, "").toLowerCase() || "";
  if (!trimmed || (DEPRECATED_UPDATE_REPO_NAMES.has(repoName) && trimmed.toLowerCase() !== fallback.toLowerCase())) {
    return fallback;
  }
  return trimmed;
}

export function normalizeSettings(settings: AppSettings): AppSettings {
  const defaults = defaultSettings();
  const directorySettings = migrateLegacyDefaultDirectories(settings, defaults);
  const currentUsageDay = getProviderUsageDayKey();
  const legacyMegaLogin = asText(settings.megaLogin);
  const legacyMegaPassword = asText(settings.megaPassword);
  let legacyMegaCredentials = String(settings.megaCredentials ?? "").replace(/\r\n|\r/g, "\n").trim();
  if (!legacyMegaCredentials && legacyMegaLogin && legacyMegaPassword) {
    legacyMegaCredentials = `${legacyMegaLogin}:${legacyMegaPassword}`;
  }
  const megaDebridPreferApi = settings.megaDebridPreferApi !== undefined ? Boolean(settings.megaDebridPreferApi) : true;
  const hasLegacyMegaCredentials = getMegaDebridAccountIds(legacyMegaCredentials).length > 0;
  const requestedMegaDebridApiEnabled = settings.megaDebridApiEnabled !== undefined
    ? Boolean(settings.megaDebridApiEnabled)
    : (hasLegacyMegaCredentials ? megaDebridPreferApi : defaults.megaDebridApiEnabled);
  const requestedMegaDebridWebEnabled = settings.megaDebridWebEnabled !== undefined
    ? Boolean(settings.megaDebridWebEnabled)
    : (hasLegacyMegaCredentials ? !megaDebridPreferApi : defaults.megaDebridWebEnabled);
  const legacyMegaMode = requestedMegaDebridApiEnabled !== requestedMegaDebridWebEnabled
    ? requestedMegaDebridApiEnabled ? "api" : "web"
    : megaDebridPreferApi ? "api" : "web";
  const rawMegaDebridApiCredentials = String(settings.megaDebridApiCredentials || "").replace(/\r\n|\r/g, "\n").trim();
  const rawMegaDebridWebCredentials = String(settings.megaDebridWebCredentials || "").replace(/\r\n|\r/g, "\n").trim();
  const hasDedicatedMegaPools = Boolean(rawMegaDebridApiCredentials || rawMegaDebridWebCredentials) || !legacyMegaCredentials;
  const megaDebridApiCredentials = hasDedicatedMegaPools
    ? rawMegaDebridApiCredentials
    : legacyMegaMode === "api" ? legacyMegaCredentials : "";
  const megaDebridWebCredentials = hasDedicatedMegaPools
    ? rawMegaDebridWebCredentials
    : legacyMegaMode === "web" ? legacyMegaCredentials : "";
  const megaDebridApiAccountIds = getMegaDebridAccountIds(megaDebridApiCredentials);
  const megaDebridWebAccountIds = getMegaDebridAccountIds(megaDebridWebCredentials);
  const megaCredentials = mergeMegaDebridCredentialPools(megaDebridApiCredentials, megaDebridWebCredentials);
  const megaDebridAccountIds = getMegaDebridAccountIds(megaCredentials);
  const primaryMegaAccount = parseMegaDebridAccounts(megaCredentials)[0];
  const megaLogin = primaryMegaAccount?.login || "";
  const megaPassword = primaryMegaAccount?.password || "";
  const megaDebridApiEnabled = requestedMegaDebridApiEnabled && megaDebridApiAccountIds.length > 0;
  const megaDebridWebEnabled = requestedMegaDebridWebEnabled && megaDebridWebAccountIds.length > 0;
  const legacyMegaDisabledAccountIds = normalizeStringList(settings.megaDebridDisabledAccountIds, megaDebridAccountIds);
  const megaDebridApiDisabledAccountIds = Array.isArray(settings.megaDebridApiDisabledAccountIds)
    ? normalizeStringList(settings.megaDebridApiDisabledAccountIds, megaDebridApiAccountIds)
    : legacyMegaDisabledAccountIds.filter((id) => megaDebridApiAccountIds.includes(id));
  const megaDebridWebDisabledAccountIds = Array.isArray(settings.megaDebridWebDisabledAccountIds)
    ? normalizeStringList(settings.megaDebridWebDisabledAccountIds, megaDebridWebAccountIds)
    : legacyMegaDisabledAccountIds.filter((id) => megaDebridWebAccountIds.includes(id));
  const megaDebridDisabledAccountIds = [...new Set([...megaDebridApiDisabledAccountIds, ...megaDebridWebDisabledAccountIds])];
  const providerDailyUsageDayRaw = asText(settings.providerDailyUsageDay);
  const providerDailyUsageDay = /^\d{4}-\d{2}-\d{2}$/.test(providerDailyUsageDayRaw)
    ? providerDailyUsageDayRaw
    : currentUsageDay;
  const debridLinkApiKeyIds = getDebridLinkApiKeyIds(String(settings.debridLinkApiKeys ?? ""));
  const providerDailyUsageBytes = normalizeProviderByteMap(
    settings.providerDailyUsageBytes,
    megaDebridPreferApi, megaDebridApiEnabled, megaDebridWebEnabled,
    "sum"
  );
  const providerTotalUsageBytes = normalizeProviderByteMap(
    settings.providerTotalUsageBytes,
    megaDebridPreferApi, megaDebridApiEnabled, megaDebridWebEnabled,
    "sum"
  );
  const debridLinkApiKeyDailyLimitBytes = normalizeNamedByteMap(
    settings.debridLinkApiKeyDailyLimitBytes,
    debridLinkApiKeyIds
  );
  const debridLinkApiKeyDailyUsageBytes = normalizeNamedByteMap(
    settings.debridLinkApiKeyDailyUsageBytes,
    debridLinkApiKeyIds
  );
  const debridLinkApiKeyTotalUsageBytes = normalizeNamedByteMap(
    settings.debridLinkApiKeyTotalUsageBytes,
    debridLinkApiKeyIds
  );
  const debridLinkDisabledKeyIds = normalizeStringList(settings.debridLinkDisabledKeyIds, debridLinkApiKeyIds);
  const normalized: AppSettings = {
    language: settings.language === "de" ? "de" : "en",
    token: asText(settings.token),
    realDebridUseWebLogin: Boolean(settings.realDebridUseWebLogin),
    megaLogin,
    megaPassword,
    megaCredentials,
    megaDebridApiCredentials,
    megaDebridWebCredentials,
    megaDebridApiEnabled,
    megaDebridWebEnabled,
    megaDebridPreferApi,
    bestToken: asText(settings.bestToken),
    bestDebridUseWebLogin: Boolean(settings.bestDebridUseWebLogin),
    allDebridToken: asText(settings.allDebridToken),
    allDebridUseWebLogin: Boolean(settings.allDebridUseWebLogin),
    ddownloadLogin: asText(settings.ddownloadLogin),
    ddownloadPassword: asText(settings.ddownloadPassword),
    oneFichierApiKey: asText(settings.oneFichierApiKey),
    debridLinkApiKeys: String(settings.debridLinkApiKeys ?? "").replace(/\r\n|\r/g, "\n").trim(),
    debridLinkDisabledKeyIds,
    linkSnappyLogin: asText(settings.linkSnappyLogin),
    linkSnappyPassword: asText(settings.linkSnappyPassword),
    archivePasswordList: String(settings.archivePasswordList ?? "").replace(/\r\n|\r/g, "\n"),
    rememberToken: Boolean(settings.rememberToken),
    providerOrder: normalizeProviderOrder(
      settings.providerOrder,
      megaDebridPreferApi, megaDebridApiEnabled, megaDebridWebEnabled,
      settings.providerPrimary, settings.providerSecondary, settings.providerTertiary
    ),
    providerPrimary: normalizeConfiguredProvider(settings.providerPrimary, megaDebridPreferApi, megaDebridApiEnabled, megaDebridWebEnabled) || defaults.providerPrimary,
    providerSecondary: normalizeFallbackProvider(settings.providerSecondary, megaDebridPreferApi, megaDebridApiEnabled, megaDebridWebEnabled),
    providerTertiary: normalizeFallbackProvider(settings.providerTertiary, megaDebridPreferApi, megaDebridApiEnabled, megaDebridWebEnabled),
    autoProviderFallback: Boolean(settings.autoProviderFallback),
    outputDir: normalizeAbsoluteDir(directorySettings.outputDir, defaults.outputDir),
    packageName: asText(settings.packageName),
    autoExtract: Boolean(settings.autoExtract),
    autoRename4sf4sj: Boolean(settings.autoRename4sf4sj),
    keepGermanAudioOnly: Boolean(settings.keepGermanAudioOnly),
    germanAudioMode: settings.germanAudioMode === "first" ? "first" : "tag",
    extractDir: normalizeAbsoluteDir(directorySettings.extractDir, defaults.extractDir),
    collectMkvToLibrary: Boolean(settings.collectMkvToLibrary),
    mkvLibraryDir: normalizeAbsoluteDir(directorySettings.mkvLibraryDir, defaults.mkvLibraryDir),
    createExtractSubfolder: Boolean(settings.createExtractSubfolder),
    hybridExtract: Boolean(settings.hybridExtract),
    cleanupMode: settings.cleanupMode,
    extractConflictMode: settings.extractConflictMode,
    removeLinkFilesAfterExtract: Boolean(settings.removeLinkFilesAfterExtract),
    removeSamplesAfterExtract: Boolean(settings.removeSamplesAfterExtract),
    enableIntegrityCheck: Boolean(settings.enableIntegrityCheck),
    autoResumeOnStart: Boolean(settings.autoResumeOnStart),
    autoReconnect: Boolean(settings.autoReconnect),
    maxParallel: clampNumber(settings.maxParallel, defaults.maxParallel, 1, 50),
    maxParallelExtract: clampNumber(settings.maxParallelExtract, defaults.maxParallelExtract, 1, 8),
    retryLimit: clampNumber(settings.retryLimit, defaults.retryLimit, 0, 99),
    reconnectWaitSeconds: clampNumber(settings.reconnectWaitSeconds, defaults.reconnectWaitSeconds, 10, 600),
    completedCleanupPolicy: settings.completedCleanupPolicy,
    speedLimitEnabled: Boolean(settings.speedLimitEnabled),
    speedLimitKbps: clampNumber(settings.speedLimitKbps, defaults.speedLimitKbps, 0, 500000),
    speedLimitMode: settings.speedLimitMode,
    autoUpdateCheck: Boolean(settings.autoUpdateCheck),
    updateRepo: migrateUpdateRepo(asText(settings.updateRepo), defaults.updateRepo),
    clipboardWatch: Boolean(settings.clipboardWatch),
    minimizeToTray: Boolean(settings.minimizeToTray),
    logStorageLocation: VALID_LOG_STORAGE_LOCATIONS.has(settings.logStorageLocation)
      ? settings.logStorageLocation
      : defaults.logStorageLocation,
    collapseNewPackages: settings.collapseNewPackages !== undefined ? Boolean(settings.collapseNewPackages) : defaults.collapseNewPackages,
    historyRetentionMode: VALID_HISTORY_RETENTION_MODES.has(settings.historyRetentionMode)
      ? settings.historyRetentionMode
      : defaults.historyRetentionMode,
    historyMaxEntries: clampNumber(settings.historyMaxEntries, defaults.historyMaxEntries, 50, 100000),
    historyMaxAgeDays: clampNumber(settings.historyMaxAgeDays, defaults.historyMaxAgeDays, 0, 3650),
    accountListShowDetailedDebridLinkKeys: settings.accountListShowDetailedDebridLinkKeys !== undefined
      ? Boolean(settings.accountListShowDetailedDebridLinkKeys)
      : defaults.accountListShowDetailedDebridLinkKeys,
    autoSortPackagesByProgress: settings.autoSortPackagesByProgress !== undefined ? Boolean(settings.autoSortPackagesByProgress) : defaults.autoSortPackagesByProgress,
    autoSkipExtracted: settings.autoSkipExtracted !== undefined ? Boolean(settings.autoSkipExtracted) : defaults.autoSkipExtracted,
    hideExtractedItems: settings.hideExtractedItems !== undefined ? Boolean(settings.hideExtractedItems) : defaults.hideExtractedItems,
    confirmDeleteSelection: settings.confirmDeleteSelection !== undefined ? Boolean(settings.confirmDeleteSelection) : defaults.confirmDeleteSelection,
    backupIncludeDownloads: settings.backupIncludeDownloads !== undefined ? Boolean(settings.backupIncludeDownloads) : defaults.backupIncludeDownloads,
    backupIncludeRemoteDiagnostics: settings.backupIncludeRemoteDiagnostics !== undefined ? Boolean(settings.backupIncludeRemoteDiagnostics) : defaults.backupIncludeRemoteDiagnostics,
    notifyUrl: asText(settings.notifyUrl) || defaults.notifyUrl,
    notifyMention: asText(settings.notifyMention) || defaults.notifyMention,
    notifyOnPackageCompleted: settings.notifyOnPackageCompleted !== undefined ? Boolean(settings.notifyOnPackageCompleted) : defaults.notifyOnPackageCompleted,
    notifyOnPackageFailed: settings.notifyOnPackageFailed !== undefined ? Boolean(settings.notifyOnPackageFailed) : defaults.notifyOnPackageFailed,
    notifyOnRunFinished: settings.notifyOnRunFinished !== undefined ? Boolean(settings.notifyOnRunFinished) : defaults.notifyOnRunFinished,
    totalDownloadedAllTime: typeof settings.totalDownloadedAllTime === "number" && settings.totalDownloadedAllTime >= 0 ? settings.totalDownloadedAllTime : defaults.totalDownloadedAllTime,
    totalCompletedFilesAllTime: typeof settings.totalCompletedFilesAllTime === "number" && settings.totalCompletedFilesAllTime >= 0 ? settings.totalCompletedFilesAllTime : defaults.totalCompletedFilesAllTime,
    totalRuntimeAllTimeMs: typeof settings.totalRuntimeAllTimeMs === "number" && settings.totalRuntimeAllTimeMs >= 0 ? settings.totalRuntimeAllTimeMs : defaults.totalRuntimeAllTimeMs,
    theme: VALID_THEMES.has(settings.theme) ? settings.theme : defaults.theme,
    bandwidthSchedules: normalizeBandwidthSchedules(settings.bandwidthSchedules),
    columnOrder: normalizeColumnOrder(settings.columnOrder, settings.columnOrderVersion),
    columnOrderVersion: 3,
    extractCpuPriority: settings.extractCpuPriority,
    autoExtractWhenStopped: settings.autoExtractWhenStopped !== undefined ? Boolean(settings.autoExtractWhenStopped) : defaults.autoExtractWhenStopped,
    disabledProviders: normalizeDisabledProviders(settings.disabledProviders),
    hosterRouting: normalizeHosterRouting(settings.hosterRouting, megaDebridPreferApi, megaDebridApiEnabled, megaDebridWebEnabled),
    providerDailyLimitBytes: normalizeProviderByteMap(
      settings.providerDailyLimitBytes,
      megaDebridPreferApi, megaDebridApiEnabled, megaDebridWebEnabled,
      "max"
    ),
    providerDailyUsageBytes: providerDailyUsageDay === currentUsageDay ? providerDailyUsageBytes : {},
    providerTotalUsageBytes,
    debridLinkApiKeyDailyLimitBytes,
    debridLinkApiKeyDailyUsageBytes: providerDailyUsageDay === currentUsageDay ? debridLinkApiKeyDailyUsageBytes : {},
    debridLinkApiKeyTotalUsageBytes,
    megaDebridDisabledAccountIds,
    megaDebridApiDisabledAccountIds,
    megaDebridWebDisabledAccountIds,
    megaDebridAccountDailyLimitBytes: normalizeNamedByteMap(settings.megaDebridAccountDailyLimitBytes, megaDebridAccountIds),
    megaDebridAccountDailyUsageBytes: providerDailyUsageDay === currentUsageDay
      ? normalizeNamedByteMap(settings.megaDebridAccountDailyUsageBytes, megaDebridAccountIds)
      : {},
    megaDebridAccountTotalUsageBytes: normalizeNamedByteMap(settings.megaDebridAccountTotalUsageBytes, megaDebridAccountIds),
    debridAccountStatuses: normalizeDebridAccountStatuses(settings.debridAccountStatuses, megaDebridAccountIds, debridLinkApiKeyIds),
    providerDailyUsageDay: providerDailyUsageDay === currentUsageDay ? providerDailyUsageDay : currentUsageDay,
    scheduledStartEpochMs: clampNumber(settings.scheduledStartEpochMs, defaults.scheduledStartEpochMs, 0, Number.MAX_SAFE_INTEGER)
  };

  if (!VALID_PRIMARY_PROVIDERS.has(normalized.providerPrimary)) {
    normalized.providerPrimary = defaults.providerPrimary;
  }
  if (!VALID_FALLBACK_PROVIDERS.has(normalized.providerSecondary)) {
    normalized.providerSecondary = "none";
  }
  if (!VALID_FALLBACK_PROVIDERS.has(normalized.providerTertiary)) {
    normalized.providerTertiary = "none";
  }
  if (normalized.providerSecondary === normalized.providerPrimary) {
    normalized.providerSecondary = "none";
  }
  if (normalized.providerTertiary === normalized.providerPrimary || normalized.providerTertiary === normalized.providerSecondary) {
    normalized.providerTertiary = "none";
  }
  if (!VALID_CLEANUP_MODES.has(normalized.cleanupMode)) {
    normalized.cleanupMode = defaults.cleanupMode;
  }
  if (!VALID_CONFLICT_MODES.has(normalized.extractConflictMode)) {
    normalized.extractConflictMode = defaults.extractConflictMode;
  }
  if (!VALID_FINISHED_POLICIES.has(normalized.completedCleanupPolicy)) {
    normalized.completedCleanupPolicy = defaults.completedCleanupPolicy;
  }
  if (!VALID_SPEED_MODES.has(normalized.speedLimitMode)) {
    normalized.speedLimitMode = defaults.speedLimitMode;
  }
  if (!VALID_EXTRACT_CPU_PRIORITIES.has(normalized.extractCpuPriority)) {
    normalized.extractCpuPriority = defaults.extractCpuPriority;
  }

  return normalized;
}

export interface StoragePaths {
  baseDir: string;
  configFile: string;
  sessionFile: string;
  historyFile: string;
}

export function createStoragePaths(baseDir: string): StoragePaths {
  return {
    baseDir,
    configFile: path.join(baseDir, "rd_downloader_config.json"),
    sessionFile: path.join(baseDir, "rd_session_state.json"),
    historyFile: path.join(baseDir, "rd_history.json")
  };
}

function ensureBaseDir(baseDir: string): void {
  try {
    fs.mkdirSync(baseDir, { recursive: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code || "";
    if (code === "EACCES" || code === "EPERM") {
      logger.error(`AppData-Ordner kann nicht erstellt werden (${code}): ${baseDir} - pruefe Schreibrechte fuer Benutzer ${process.env.USERNAME || process.env.USER || "?"}`);
    }
    throw error;
  }
}

function safeJsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeAudioStripSummary(raw: unknown): AudioStripSummary | undefined {
  const parsed = asRecord(raw);
  if (!parsed) {
    return undefined;
  }
  const files = Array.isArray(parsed.files)
    ? parsed.files.slice(0, 100).flatMap((entry) => {
      const file = asRecord(entry);
      if (!file) {
        return [];
      }
      const name = asText(file.name);
      if (!name) {
        return [];
      }
      const languages = asText(file.languages);
      return [{ name, action: asText(file.action), reason: asText(file.reason), ...(languages ? { languages } : {}) }];
    })
    : [];
  return {
    at: clampNumber(parsed.at, 0, 0, Number.MAX_SAFE_INTEGER),
    candidates: clampNumber(parsed.candidates, 0, 0, 1_000_000),
    remuxed: clampNumber(parsed.remuxed, 0, 0, 1_000_000),
    keptSingle: clampNumber(parsed.keptSingle, 0, 0, 1_000_000),
    skippedNoGerman: clampNumber(parsed.skippedNoGerman, 0, 0, 1_000_000),
    skippedNoTool: clampNumber(parsed.skippedNoTool, 0, 0, 1_000_000),
    failed: clampNumber(parsed.failed, 0, 0, 1_000_000),
    files
  };
}

function migrateLegacyMegaEnableFlags(parsed: AppSettings): AppSettings {
  if (parsed.megaDebridApiEnabled !== undefined || parsed.megaDebridWebEnabled !== undefined) {
    return parsed;
  }
  const hasMegaCreds = Boolean(
    getMegaDebridAccountIds(asText(parsed.megaCredentials), asText(parsed.megaPassword)).length
    || (asText(parsed.megaLogin) && asText(parsed.megaPassword))
  );
  if (!hasMegaCreds) {
    return parsed;
  }
  const preferApi = parsed.megaDebridPreferApi !== undefined ? Boolean(parsed.megaDebridPreferApi) : true;
  return { ...parsed, megaDebridApiEnabled: preferApi, megaDebridWebEnabled: !preferApi };
}

interface LoadedSettingsFile {
  settings: AppSettings;
  needsCredentialRewrite: boolean;
}

function readSettingsFile(filePath: string): LoadedSettingsFile | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as AppSettings;
    const needsCredentialRewrite = needsPersistedSettingsRewrite(parsed);
    const restored = restorePersistedSettings(parsed);
    const migratedLanguage = (restored as Partial<AppSettings>).language === undefined ? "de" : restored.language;
    const migrated = migrateLegacyMegaEnableFlags(restored);
    const mergedInput = {
      ...defaultSettings(),
      ...migrated,
      language: migratedLanguage,
      columnOrderVersion: parsed.columnOrderVersion
    } as AppSettings;
    if (!Object.prototype.hasOwnProperty.call(parsed, "megaDebridApiDisabledAccountIds")) {
      delete (mergedInput as Partial<AppSettings>).megaDebridApiDisabledAccountIds;
    }
    if (!Object.prototype.hasOwnProperty.call(parsed, "megaDebridWebDisabledAccountIds")) {
      delete (mergedInput as Partial<AppSettings>).megaDebridWebDisabledAccountIds;
    }
    const merged = normalizeSettings(mergedInput);
    return { settings: merged, needsCredentialRewrite };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code || "";
    if (code === "ENOENT") {
    } else if (code === "EACCES" || code === "EPERM") {
      logger.error(`Settings-Datei nicht zugreifbar (${code}): ${filePath} - pruefe Datei-/Ordner-Berechtigungen fuer Benutzer ${process.env.USERNAME || process.env.USER || "?"}`);
    } else {
      logger.warn(`Settings-Datei nicht lesbar: ${filePath}: ${String(error)}`);
    }
    return null;
  }
}

export function normalizeLoadedSession(raw: unknown): SessionState {
  const fallback = emptySession();
  const parsed = asRecord(raw);
  if (!parsed) {
    return fallback;
  }

  const now = Date.now();
  const itemsById: Record<string, DownloadItem> = {};
  const rawItems = asRecord(parsed.items) ?? {};
  for (const [entryId, rawItem] of Object.entries(rawItems)) {
    const item = asRecord(rawItem);
    if (!item) {
      continue;
    }
    const id = normalizeSessionId(item.id) || normalizeSessionId(entryId);
    const packageId = normalizeSessionId(item.packageId);
    const url = asText(item.url);
    if (!id || !packageId || !url) {
      continue;
    }

    const statusRaw = asText(item.status) as DownloadStatus;
    const status: DownloadStatus = VALID_DOWNLOAD_STATUSES.has(statusRaw) ? statusRaw : "queued";
    const providerRaw = asText(item.provider) as DebridProvider;

    const onlineStatusRaw = asText(item.onlineStatus);
    const lastError = asText(item.lastError);
    const legacyResumeFailureCount = /^(?:range_ignored_on_resume:|range_mismatch_on_resume:|resume_download_underflow:)/i.test(lastError) ? 1 : 0;

    itemsById[id] = {
      id,
      packageId,
      url,
      provider: VALID_ITEM_PROVIDERS.has(providerRaw) ? providerRaw : null,
      providerLabel: asText(item.providerLabel) || undefined,
      providerAccountId: asText(item.providerAccountId) || undefined,
      providerAccountLabel: asText(item.providerAccountLabel) || undefined,
      status,
      retries: clampNumber(item.retries, 0, 0, 1_000_000),
      speedBps: clampNumber(item.speedBps, 0, 0, 10_000_000_000),
      downloadedBytes: clampNumber(item.downloadedBytes, 0, 0, 10_000_000_000_000),
      totalBytes: item.totalBytes == null ? null : clampNumber(item.totalBytes, 0, 0, 10_000_000_000_000),
      progressPercent: clampNumber(item.progressPercent, 0, 0, 100),
      fileName: asText(item.fileName) || "download.bin",
      targetPath: asText(item.targetPath),
      resumable: item.resumable === undefined ? true : Boolean(item.resumable),
      attempts: clampNumber(item.attempts, 0, 0, 10_000),
      lastError,
      fullStatus: asText(item.fullStatus),
      resumeLinkRenewalFailures: clampNumber(item.resumeLinkRenewalFailures, legacyResumeFailureCount, 0, 1_000_000) || undefined,
      resumeHardResetUsed: Boolean(item.resumeHardResetUsed) || undefined,
      resumeResetPending: Boolean(item.resumeResetPending) || undefined,
      onlineStatus: VALID_ONLINE_STATUSES.has(onlineStatusRaw) ? onlineStatusRaw as "online" | "offline" | "checking" : undefined,
      createdAt: clampNumber(item.createdAt, now, 0, Number.MAX_SAFE_INTEGER),
      updatedAt: clampNumber(item.updatedAt, now, 0, Number.MAX_SAFE_INTEGER)
    };
  }

  const packagesById: Record<string, PackageEntry> = {};
  const rawPackages = asRecord(parsed.packages) ?? {};
  for (const [entryId, rawPkg] of Object.entries(rawPackages)) {
    const pkg = asRecord(rawPkg);
    if (!pkg) {
      continue;
    }
    const id = normalizeSessionId(pkg.id) || normalizeSessionId(entryId);
    if (!id) {
      continue;
    }
    const statusRaw = asText(pkg.status) as DownloadStatus;
    const status: DownloadStatus = VALID_DOWNLOAD_STATUSES.has(statusRaw) ? statusRaw : "queued";
    const rawItemIds = Array.isArray(pkg.itemIds) ? pkg.itemIds : [];
    packagesById[id] = {
      id,
      name: asText(pkg.name) || "Paket",
      outputDir: asText(pkg.outputDir),
      extractDir: asText(pkg.extractDir),
      status,
      itemIds: rawItemIds
        .map((value) => normalizeSessionId(value))
        .filter((value) => value.length > 0),
      cancelled: Boolean(pkg.cancelled),
      enabled: pkg.enabled === undefined ? true : Boolean(pkg.enabled),
      priority: VALID_PACKAGE_PRIORITIES.has(asText(pkg.priority)) ? asText(pkg.priority) as PackagePriority : "normal",
      audioStripSummary: normalizeAudioStripSummary(pkg.audioStripSummary),
      cleanedCompletedItemCount: clampNumber(pkg.cleanedCompletedItemCount, 0, 0, 1_000_000),
      cleanedExtractedItemCount: clampNumber(pkg.cleanedExtractedItemCount, 0, 0, 1_000_000),
      cleanedDownloadedBytes: clampNumber(pkg.cleanedDownloadedBytes, 0, 0, 10_000_000_000_000),
      cleanedTotalBytes: clampNumber(pkg.cleanedTotalBytes, 0, 0, 10_000_000_000_000),
      cleanedUrls: Array.isArray(pkg.cleanedUrls)
        ? [...new Set(pkg.cleanedUrls.map((value) => asText(value)).filter(Boolean))].slice(0, 1_000_000)
        : [],
      cleanedProviders: Array.isArray(pkg.cleanedProviders)
        ? [...new Set(pkg.cleanedProviders.map((value) => asText(value) as DebridProvider).filter((value) => VALID_ITEM_PROVIDERS.has(value)))]
        : [],
      downloadStartedAt: clampNumber(pkg.downloadStartedAt, 0, 0, Number.MAX_SAFE_INTEGER),
      downloadCompletedAt: clampNumber(pkg.downloadCompletedAt, 0, 0, Number.MAX_SAFE_INTEGER),
      createdAt: clampNumber(pkg.createdAt, now, 0, Number.MAX_SAFE_INTEGER),
      updatedAt: clampNumber(pkg.updatedAt, now, 0, Number.MAX_SAFE_INTEGER)
    };
  }

  let orphanedItemCount = 0;
  for (const [itemId, item] of Object.entries(itemsById)) {
    if (!packagesById[item.packageId]) {
      orphanedItemCount += 1;
      delete itemsById[itemId];
    }
  }
  if (orphanedItemCount > 0) {
    logger.warn(`normalizeLoadedSession: ${orphanedItemCount} verwaiste Items entfernt (fehlende Pakete)`);
  }

  let droppedUnsafeTargetPathCount = 0;
  for (const item of Object.values(itemsById)) {
    const pkg = packagesById[item.packageId];
    if (!pkg) {
      continue;
    }
    const safeTargetPath = normalizeSessionTargetPath(item.targetPath, pkg.outputDir);
    if (!safeTargetPath && asText(item.targetPath)) {
      droppedUnsafeTargetPathCount += 1;
    }
    item.targetPath = safeTargetPath;
  }
  if (droppedUnsafeTargetPathCount > 0) {
    logger.warn(`normalizeLoadedSession: ${droppedUnsafeTargetPathCount} unsichere targetPath-Eintraege verworfen`);
  }

  for (const pkg of Object.values(packagesById)) {
    pkg.itemIds = pkg.itemIds.filter((itemId) => {
      const item = itemsById[itemId];
      return Boolean(item) && item.packageId === pkg.id;
    });
  }

  const rawOrder = Array.isArray(parsed.packageOrder) ? parsed.packageOrder : [];
  const seenOrder = new Set<string>();
  const packageOrder = rawOrder
    .map((entry) => normalizeSessionId(entry))
    .filter((id) => {
      if (!(id in packagesById) || seenOrder.has(id)) {
        return false;
      }
      seenOrder.add(id);
      return true;
    });
  for (const packageId of Object.keys(packagesById)) {
    if (!seenOrder.has(packageId)) {
      seenOrder.add(packageId);
      packageOrder.push(packageId);
    }
  }

  return {
    ...fallback,
    version: clampNumber(parsed.version, fallback.version, 1, 10),
    packageOrder,
    packages: packagesById,
    items: itemsById,
    runStartedAt: clampNumber(parsed.runStartedAt, 0, 0, Number.MAX_SAFE_INTEGER),
    totalDownloadedBytes: clampNumber(parsed.totalDownloadedBytes, 0, 0, Number.MAX_SAFE_INTEGER),
    summaryText: asText(parsed.summaryText),
    reconnectUntil: clampNumber(parsed.reconnectUntil, 0, 0, Number.MAX_SAFE_INTEGER),
    reconnectReason: asText(parsed.reconnectReason),
    paused: Boolean(parsed.paused),
    running: Boolean(parsed.running),
    updatedAt: clampNumber(parsed.updatedAt, now, 0, Number.MAX_SAFE_INTEGER)
  };
}

export function loadSettings(paths: StoragePaths): AppSettings {
  ensureBaseDir(paths.baseDir);
  if (!fs.existsSync(paths.configFile)) {
    return defaultSettings();
  }
  const loaded = readSettingsFile(paths.configFile);
  if (loaded) {
    const backupFile = `${paths.configFile}.bak`;
    const backupNeedsCredentialRewrite = fs.existsSync(backupFile)
      ? needsSettingsFileCredentialRewrite(backupFile)
      : false;
    if (loaded.needsCredentialRewrite || backupNeedsCredentialRewrite) {
      rewriteProtectedSettings(paths, loaded.settings);
    }
    return loaded.settings;
  }

  const backupFile = `${paths.configFile}.bak`;
  const backupLoaded = fs.existsSync(backupFile) ? readSettingsFile(backupFile) : null;
  if (backupLoaded) {
    logger.warn("Konfiguration defekt, Backup-Datei wird verwendet");
    rewriteProtectedSettings(paths, backupLoaded.settings);
    return backupLoaded.settings;
  }

  logger.error("Konfiguration konnte nicht geladen werden (auch Backup fehlgeschlagen)");
  return defaultSettings();
}

function syncRenameWithExdevFallback(tempPath: string, targetPath: string): void {
  try {
    fs.renameSync(tempPath, targetPath);
  } catch (renameError: unknown) {
    if (renameError && typeof renameError === "object" && "code" in renameError && (renameError as NodeJS.ErrnoException).code === "EXDEV") {
      fs.copyFileSync(tempPath, targetPath);
      try { fs.rmSync(tempPath, { force: true }); } catch {}
    } else {
      throw renameError;
    }
  }
}

function settingsPayload(settings: AppSettings): string {
  return JSON.stringify(protectPersistedSettings(normalizeSettings(settings)), safeJsonReplacer, 2);
}

interface SettingsSavePayloads {
  primary: string;
  backup: string;
}

function credentialFreeSettingsPayload(settings: AppSettings): string {
  return settingsPayload({ ...settings, rememberToken: false });
}

function createSettingsSavePayloads(paths: StoragePaths, settings: AppSettings): SettingsSavePayloads {
  const previous = readSettingsFile(paths.configFile);
  const backup = previous
    ? settingsPayload({ ...previous.settings, rememberToken: settings.rememberToken })
    : credentialFreeSettingsPayload(settings);
  return {
    primary: settingsPayload(settings),
    backup
  };
}

function captureSettings(settings: AppSettings): AppSettings {
  return JSON.parse(JSON.stringify(normalizeSettings(settings))) as AppSettings;
}

function writeSettingsFileAtomically(filePath: string, payload: string): void {
  const tempPath = `${filePath}.tmp`;
  try {
    fs.writeFileSync(tempPath, payload, "utf8");
    syncRenameWithExdevFallback(tempPath, filePath);
  } catch (error) {
    try { fs.rmSync(tempPath, { force: true }); } catch { }
    throw error;
  }
}

function rewriteProtectedSettings(paths: StoragePaths, settings: AppSettings): void {
  const payload = settingsPayload(settings);
  writeSettingsFileAtomically(`${paths.configFile}.bak`, payload);
  writeSettingsFileAtomically(paths.configFile, payload);
}

function needsSettingsFileCredentialRewrite(filePath: string): boolean {
  try {
    return needsPersistedSettingsRewrite(JSON.parse(fs.readFileSync(filePath, "utf8")) as AppSettings);
  } catch {
    return false;
  }
}

function sessionTempPath(sessionFile: string, kind: "sync" | "async"): string {
  return `${sessionFile}.${kind}.tmp`;
}

function sessionBackupPath(sessionFile: string): string {
  return `${sessionFile}.bak`;
}

export function normalizeLoadedSessionTransientFields(session: SessionState): SessionState {
  const ACTIVE_STATUSES = new Set(["downloading", "validating", "extracting", "integrity_check", "paused", "reconnect_wait"]);
  for (const item of Object.values(session.items)) {
    if (ACTIVE_STATUSES.has(item.status)) {
      item.status = "queued";
      item.lastError = "";
    }
    item.speedBps = 0;
  }

  const ACTIVE_PKG_STATUSES = new Set(["downloading", "validating", "extracting", "integrity_check", "paused", "reconnect_wait"]);
  for (const pkg of Object.values(session.packages)) {
    if (ACTIVE_PKG_STATUSES.has(pkg.status)) {
      pkg.status = "queued";
    }
    pkg.postProcessLabel = undefined;
  }

  session.running = false;
  session.paused = false;

  return session;
}

const TRANSIENT_READ_CODES = new Set(["EBUSY", "EPERM", "EAGAIN"]);

function sleepSyncMs(ms: number): void {
  if (ms <= 0) {
    return;
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readSessionFile(filePath: string): SessionState | null {
  let raw: string | null = null;
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      raw = fs.readFileSync(filePath, "utf8");
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code || "";
      if (TRANSIENT_READ_CODES.has(code) && attempt < maxAttempts) {
        const backoffMs = 100 * 2 ** (attempt - 1);
        logger.warn(`Session-Datei vorübergehend gesperrt (${code}), Versuch ${attempt}/${maxAttempts}, warte ${backoffMs}ms: ${filePath}`);
        sleepSyncMs(backoffMs);
        continue;
      }
      if (code === "EACCES" || code === "EPERM") {
        logger.error(`Session-Datei nicht zugreifbar (${code}): ${filePath} - pruefe Datei-/Ordner-Berechtigungen fuer Benutzer ${process.env.USERNAME || process.env.USER || "?"}`);
      } else {
        logger.error(`Session-Datei nicht lesbar (${code || "?"}): ${filePath}: ${String(error)}`);
      }
      return null;
    }
  }
  if (raw === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const session = normalizeLoadedSessionTransientFields(normalizeLoadedSession(parsed));
    const pkgCount = Object.keys(session.packages).length;
    const itemCount = Object.keys(session.items).length;
    logger.info(`Session geladen: ${filePath} (${pkgCount} Pakete, ${itemCount} Items)`);
    return session;
  } catch (error) {
    logger.error(`Session-Datei beschädigt (JSON ungültig): ${filePath}: ${String(error)}`);
    return null;
  }
}

export function saveSettings(paths: StoragePaths, settings: AppSettings): void {
  syncSettingsSaveGeneration += 1;
  ensureBaseDir(paths.baseDir);
  const payloads = createSettingsSavePayloads(paths, settings);
  writeSettingsFileAtomically(`${paths.configFile}.bak`, payloads.backup);
  writeSettingsFileAtomically(paths.configFile, payloads.primary);
}

let asyncSettingsSaveRunning = false;
let asyncSettingsSaveQueued: { paths: StoragePaths; settings: AppSettings; generation: number } | null = null;
let syncSettingsSaveGeneration = 0;

async function writeSettingsPayload(paths: StoragePaths, settings: AppSettings, generation: number): Promise<void> {
  await fs.promises.mkdir(paths.baseDir, { recursive: true });
  const payloads = createSettingsSavePayloads(paths, settings);
  const tempPath = `${paths.configFile}.settings.tmp`;
  await fsp.writeFile(tempPath, payloads.primary, "utf8");
  if (generation < syncSettingsSaveGeneration) {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    return;
  }
  const backupTempPath = `${paths.configFile}.bak.settings.tmp`;
  await fsp.writeFile(backupTempPath, payloads.backup, "utf8");
  if (generation < syncSettingsSaveGeneration) {
    await Promise.all([
      fsp.rm(tempPath, { force: true }).catch(() => {}),
      fsp.rm(backupTempPath, { force: true }).catch(() => {})
    ]);
    return;
  }
  try {
    await fsp.rename(backupTempPath, `${paths.configFile}.bak`);
  } catch (renameError: unknown) {
    if (renameError && typeof renameError === "object" && "code" in renameError && (renameError as NodeJS.ErrnoException).code === "EXDEV") {
      await fsp.copyFile(backupTempPath, `${paths.configFile}.bak`);
      await fsp.rm(backupTempPath, { force: true }).catch(() => {});
    } else {
      await fsp.rm(backupTempPath, { force: true }).catch(() => {});
      throw renameError;
    }
  }
  try {
    await fsp.rename(tempPath, paths.configFile);
  } catch (renameError: unknown) {
    if (renameError && typeof renameError === "object" && "code" in renameError && (renameError as NodeJS.ErrnoException).code === "EXDEV") {
      if (generation < syncSettingsSaveGeneration) {
        await fsp.rm(tempPath, { force: true }).catch(() => {});
        return;
      }
      await fsp.copyFile(tempPath, paths.configFile);
      await fsp.rm(tempPath, { force: true }).catch(() => {});
    } else {
      await fsp.rm(tempPath, { force: true }).catch(() => {});
      throw renameError;
    }
  }
}

async function saveSettingsPayloadAsync(paths: StoragePaths, settings: AppSettings, generation: number): Promise<void> {
  if (asyncSettingsSaveRunning) {
    asyncSettingsSaveQueued = { paths, settings, generation };
    return;
  }
  asyncSettingsSaveRunning = true;
  try {
    await writeSettingsPayload(paths, settings, generation);
  } catch (error) {
    logger.error(`Async Settings-Save fehlgeschlagen: ${String(error)}`);
  } finally {
    asyncSettingsSaveRunning = false;
    if (asyncSettingsSaveQueued) {
      const queued = asyncSettingsSaveQueued;
      asyncSettingsSaveQueued = null;
      void saveSettingsPayloadAsync(queued.paths, queued.settings, queued.generation);
    }
  }
}

export async function saveSettingsAsync(paths: StoragePaths, settings: AppSettings): Promise<void> {
  const generation = syncSettingsSaveGeneration;
  await saveSettingsPayloadAsync(paths, captureSettings(settings), generation);
}

export function emptySession(): SessionState {
  return {
    version: 2,
    packageOrder: [],
    packages: {},
    items: {},
    runStartedAt: 0,
    totalDownloadedBytes: 0,
    summaryText: "",
    reconnectUntil: 0,
    reconnectReason: "",
    paused: false,
    running: false,
    updatedAt: Date.now()
  };
}

export type SessionLoadStatus =
  | "ok"
  | "recovered-backup"
  | "recovered-temp"
  | "empty-fresh"
  | "empty-unreadable";

export interface SessionLoadResult {
  session: SessionState;
  status: SessionLoadStatus;
}

export function loadSessionWithStatus(paths: StoragePaths): SessionLoadResult {
  ensureBaseDir(paths.baseDir);
  const backupFile = sessionBackupPath(paths.sessionFile);
  const syncTempFile = sessionTempPath(paths.sessionFile, "sync");
  const asyncTempFile = sessionTempPath(paths.sessionFile, "async");
  const primaryExists = fs.existsSync(paths.sessionFile);
  const backupExists = fs.existsSync(backupFile);
  const anyTempExists = fs.existsSync(syncTempFile) || fs.existsSync(asyncTempFile);

  if (!primaryExists) {
    if (!backupExists && !anyTempExists) {
      logger.info("Keine Session-Datei vorhanden, starte mit leerer Session");
      return { session: emptySession(), status: "empty-fresh" };
    }
    logger.warn("Session-Primaerdatei fehlt, aber Backup/Temp vorhanden — Wiederherstellung wird versucht");
  }

  const primary = primaryExists ? readSessionFile(paths.sessionFile) : null;

  if (primary) {
    const primaryPkgCount = Object.keys(primary.packages).length;
    if (primaryPkgCount === 0 && backupExists) {
      const backup = readSessionFile(backupFile);
      if (backup) {
        const backupPkgCount = Object.keys(backup.packages).length;
        if (backupPkgCount > 0) {
          logger.warn(`Session-Datei ist leer (0 Pakete), aber Backup hat ${backupPkgCount} Pakete — verwende Backup`);
          try {
            const payload = JSON.stringify({ ...backup, updatedAt: Date.now() }, safeJsonReplacer);
            fs.writeFileSync(syncTempFile, payload, "utf8");
            syncRenameWithExdevFallback(syncTempFile, paths.sessionFile);
          } catch {
          }
          return { session: backup, status: "recovered-backup" };
        }
      }
    }
    return { session: primary, status: "ok" };
  }

  const backup = backupExists ? readSessionFile(backupFile) : null;
  if (backup) {
    logger.warn("Session defekt, Backup-Datei wird verwendet");
    try {
      const payload = JSON.stringify({ ...backup, updatedAt: Date.now() }, safeJsonReplacer);
      fs.writeFileSync(syncTempFile, payload, "utf8");
      syncRenameWithExdevFallback(syncTempFile, paths.sessionFile);
    } catch {
    }
    return { session: backup, status: "recovered-backup" };
  }

  for (const kind of ["sync", "async"] as const) {
    const tmpPath = sessionTempPath(paths.sessionFile, kind);
    if (fs.existsSync(tmpPath)) {
      const tmpSession = readSessionFile(tmpPath);
      if (tmpSession && Object.keys(tmpSession.packages).length > 0) {
        logger.warn(`Session aus temporaerer Datei wiederhergestellt: ${tmpPath} (${Object.keys(tmpSession.packages).length} Pakete)`);
        try {
          const payload = JSON.stringify({ ...tmpSession, updatedAt: Date.now() }, safeJsonReplacer);
          fs.writeFileSync(paths.sessionFile, payload, "utf8");
        } catch {
        }
        return { session: tmpSession, status: "recovered-temp" };
      }
    }
  }

  if (primaryExists || backupExists || anyTempExists) {
    logger.error("Session konnte nicht geladen werden (Primary, Backup und Temp-Dateien fehlgeschlagen) — Schutz gegen leeres Ueberschreiben aktiv");
    return { session: emptySession(), status: "empty-unreadable" };
  }

  return { session: emptySession(), status: "empty-fresh" };
}

export function loadSession(paths: StoragePaths): SessionState {
  return loadSessionWithStatus(paths).session;
}

export function saveSession(paths: StoragePaths, session: SessionState): void {
  syncSaveGeneration += 1;
  ensureBaseDir(paths.baseDir);
  if (fs.existsSync(paths.sessionFile)) {
    try {
      fs.copyFileSync(paths.sessionFile, sessionBackupPath(paths.sessionFile));
    } catch {
    }
  }
  const payload = JSON.stringify({ ...session, updatedAt: Date.now() }, safeJsonReplacer);
  const tempPath = sessionTempPath(paths.sessionFile, "sync");
  try {
    const fd = fs.openSync(tempPath, "w");
    try {
      fs.writeSync(fd, payload);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    syncRenameWithExdevFallback(tempPath, paths.sessionFile);
  } catch (error) {
    try { fs.rmSync(tempPath, { force: true }); } catch {  }
    throw error;
  }
}

let asyncSaveRunning = false;
let asyncSaveQueued: { paths: StoragePaths; payload: string; generation: number } | null = null;
let syncSaveGeneration = 0;

async function writeSessionPayload(paths: StoragePaths, payload: string, generation: number): Promise<void> {
  await fs.promises.mkdir(paths.baseDir, { recursive: true });
  await fsp.copyFile(paths.sessionFile, sessionBackupPath(paths.sessionFile)).catch(() => {});
  const tempPath = sessionTempPath(paths.sessionFile, "async");
  const handle = await fsp.open(tempPath, "w");
  try {
    await handle.writeFile(payload, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (generation < syncSaveGeneration) {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    return;
  }
  try {
    await fsp.rename(tempPath, paths.sessionFile);
  } catch (renameError: unknown) {
    if (renameError && typeof renameError === "object" && "code" in renameError && (renameError as NodeJS.ErrnoException).code === "EXDEV") {
      if (generation < syncSaveGeneration) {
        await fsp.rm(tempPath, { force: true }).catch(() => {});
        return;
      }
      await fsp.copyFile(tempPath, paths.sessionFile);
      await fsp.rm(tempPath, { force: true }).catch(() => {});
    } else {
      await fsp.rm(tempPath, { force: true }).catch(() => {});
      throw renameError;
    }
  }
}

async function saveSessionPayloadAsync(paths: StoragePaths, payload: string, generation: number): Promise<void> {
  if (asyncSaveRunning) {
    asyncSaveQueued = { paths, payload, generation };
    return;
  }
  asyncSaveRunning = true;
  try {
    await writeSessionPayload(paths, payload, generation);
  } catch (error) {
    logger.error(`Async Session-Save fehlgeschlagen: ${String(error)}`);
  } finally {
    asyncSaveRunning = false;
    if (asyncSaveQueued) {
      const queued = asyncSaveQueued;
      asyncSaveQueued = null;
      void saveSessionPayloadAsync(queued.paths, queued.payload, queued.generation);
    }
  }
}

export function cancelPendingAsyncSaves(): void {
  asyncSaveQueued = null;
  asyncSettingsSaveQueued = null;
  syncSaveGeneration += 1;
  syncSettingsSaveGeneration += 1;
}

export async function saveSessionAsync(paths: StoragePaths, session: SessionState): Promise<void> {
  const generation = syncSaveGeneration;
  const payload = JSON.stringify({ ...session, updatedAt: Date.now() }, safeJsonReplacer);
  await saveSessionPayloadAsync(paths, payload, generation);
}

const MAX_HISTORY_ENTRIES = 500;
const HISTORY_HARD_CAP = 100000;

export interface HistoryLimits {
  maxEntries: number;
  maxAgeDays: number;
}

function pruneHistoryEntries(entries: HistoryEntry[], limits?: HistoryLimits, now = Date.now()): HistoryEntry[] {
  const maxEntries = limits && limits.maxEntries > 0 ? Math.min(limits.maxEntries, HISTORY_HARD_CAP) : MAX_HISTORY_ENTRIES;
  const maxAgeDays = limits && limits.maxAgeDays > 0 ? limits.maxAgeDays : 0;
  let result = entries;
  if (maxAgeDays > 0) {
    const cutoff = now - maxAgeDays * 24 * 60 * 60 * 1000;
    result = result.filter((entry) => entry.completedAt >= cutoff);
  }
  return result.length > maxEntries ? result.slice(0, maxEntries) : result;
}

export function normalizeHistoryEntry(raw: unknown, index: number): HistoryEntry | null {
  const entry = asRecord(raw);
  if (!entry) return null;

  const id = asText(entry.id) || `hist-${Date.now().toString(36)}-${index}`;
  const name = asText(entry.name) || "Unbenannt";
  const providerRaw = asText(entry.provider);

  return {
    id,
    name,
    totalBytes: clampNumber(entry.totalBytes, 0, 0, Number.MAX_SAFE_INTEGER),
    downloadedBytes: clampNumber(entry.downloadedBytes, 0, 0, Number.MAX_SAFE_INTEGER),
    fileCount: clampNumber(entry.fileCount, 0, 0, 100000),
    provider: VALID_ITEM_PROVIDERS.has(providerRaw as DebridProvider) ? providerRaw as DebridProvider : null,
    completedAt: clampNumber(entry.completedAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
    durationSeconds: clampNumber(entry.durationSeconds, 0, 0, Number.MAX_SAFE_INTEGER),
    status: entry.status === "deleted" ? "deleted" : "completed",
    outputDir: asText(entry.outputDir),
    urls: Array.isArray(entry.urls) ? (entry.urls as unknown[]).map(String).filter(Boolean) : undefined
  };
}

export function loadHistory(paths: StoragePaths, limits?: HistoryLimits): HistoryEntry[] {
  ensureBaseDir(paths.baseDir);
  if (!fs.existsSync(paths.historyFile)) {
    return [];
  }

  try {
    const raw = JSON.parse(fs.readFileSync(paths.historyFile, "utf8")) as unknown;
    if (!Array.isArray(raw)) return [];

    const entries: HistoryEntry[] = [];
    for (let i = 0; i < raw.length && entries.length < HISTORY_HARD_CAP; i++) {
      const normalized = normalizeHistoryEntry(raw[i], i);
      if (normalized) entries.push(normalized);
    }
    return pruneHistoryEntries(entries, limits);
  } catch {
    return [];
  }
}

export function saveHistory(paths: StoragePaths, entries: HistoryEntry[], limits?: HistoryLimits): void {
  ensureBaseDir(paths.baseDir);
  const trimmed = pruneHistoryEntries(entries, limits);
  const payload = JSON.stringify(trimmed, safeJsonReplacer, 2);
  const tempPath = `${paths.historyFile}.tmp`;
  try {
    fs.writeFileSync(tempPath, payload, "utf8");
    syncRenameWithExdevFallback(tempPath, paths.historyFile);
  } catch (error) {
    try { fs.rmSync(tempPath, { force: true }); } catch {  }
    throw error;
  }
}

export function addHistoryEntry(paths: StoragePaths, entry: HistoryEntry, limits?: HistoryLimits): HistoryEntry[] {
  const existing = loadHistory(paths, limits);
  const updated = pruneHistoryEntries([entry, ...existing], limits);
  saveHistory(paths, updated, limits);
  return updated;
}

export function loadHistoryForRetention(paths: StoragePaths, retentionMode: HistoryRetentionMode, limits?: HistoryLimits): HistoryEntry[] {
  return retentionMode === "never" ? [] : loadHistory(paths, limits);
}

export function addHistoryEntryForRetention(paths: StoragePaths, retentionMode: HistoryRetentionMode, entry: HistoryEntry, limits?: HistoryLimits): HistoryEntry[] {
  if (retentionMode === "never") {
    return [];
  }
  return addHistoryEntry(paths, entry, limits);
}

export function resetHistoryForRetention(paths: StoragePaths, retentionMode: HistoryRetentionMode): void {
  if (retentionMode === "permanent") {
    return;
  }
  clearHistory(paths);
}

export function removeHistoryEntry(paths: StoragePaths, entryId: string): HistoryEntry[] {
  const existing = loadHistory(paths);
  const updated = existing.filter(e => e.id !== entryId);
  saveHistory(paths, updated);
  return updated;
}

export function clearHistory(paths: StoragePaths): void {
  ensureBaseDir(paths.baseDir);
  if (fs.existsSync(paths.historyFile)) {
    try {
      fs.unlinkSync(paths.historyFile);
    } catch {
    }
  }
}
