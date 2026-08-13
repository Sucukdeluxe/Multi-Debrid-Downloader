import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseDebridLinkApiKeys } from "../src/shared/debrid-link-keys";
import { getMegaDebridAccountId, getMegaDebridAccountStatusId } from "../src/shared/mega-debrid-accounts";
import { getProviderUsageDayKey } from "../src/shared/provider-daily-limits";
import { AppSettings } from "../src/shared/types";
import { defaultSettings } from "../src/main/constants";
import { configureCredentialProtector } from "../src/main/credential-protection";
import { addHistoryEntryForRetention, clearHistory, createStoragePaths, emptySession, loadHistory, loadHistoryForRetention, loadSession, loadSettings, normalizeLoadedSession, normalizeSettings, resetHistoryForRetention, saveHistory, saveSession, saveSessionAsync, saveSettings, saveSettingsAsync } from "../src/main/storage";

const tempDirs: string[] = [];
type SettingsSaveMode = "sync" | "async";

async function saveSettingsInMode(mode: SettingsSaveMode, paths: ReturnType<typeof createStoragePaths>, settings: AppSettings): Promise<void> {
  if (mode === "sync") {
    saveSettings(paths, settings);
  } else {
    await saveSettingsAsync(paths, settings);
  }
}

beforeEach(() => {
  configureCredentialProtector({
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, "utf8").reverse(),
    decryptString: (value) => Buffer.from(value).reverse().toString("utf8")
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("settings storage", () => {
  it("repairs a persisted version-2 column order that lost availability during default merging", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);
    fs.writeFileSync(paths.configFile, JSON.stringify({
      ...defaultSettings(),
      columnOrder: ["name", "size", "progress", "hoster", "account", "prio", "status", "speed"],
      columnOrderVersion: 2
    }), "utf8");

    const loaded = loadSettings(paths);

    expect(loaded.columnOrder).toEqual(["name", "size", "progress", "hoster", "account", "prio", "status", "speed", "availability"]);
    expect(loaded.columnOrderVersion).toBe(3);
  });

  it("adds availability beside speed once for legacy column settings", () => {
    const legacy = { ...defaultSettings(), columnOrder: ["name", "status", "speed"] } as Partial<AppSettings>;
    delete legacy.columnOrderVersion;

    const normalized = normalizeSettings(legacy as AppSettings);

    expect(normalized.columnOrder).toEqual(["name", "status", "speed", "availability"]);
    expect(normalized.columnOrderVersion).toBe(3);
    expect(normalizeSettings({ ...normalized, columnOrder: ["name", "speed"] }).columnOrder).toEqual(["name", "speed"]);
  });

  it("uses English for new installations and preserves only supported languages", () => {
    expect(defaultSettings().language).toBe("en");
    expect(normalizeSettings({ ...defaultSettings(), language: "de" }).language).toBe("de");
    expect(normalizeSettings({ ...defaultSettings(), language: "fr" as "en" }).language).toBe("en");
  });

  it("migrates a legacy shared Mega-Debrid pool into only the preferred mode", () => {
    const legacy = { ...defaultSettings() } as Partial<AppSettings>;
    legacy.megaCredentials = "legacy@example.test:legacy-pass";
    legacy.megaLogin = "legacy@example.test";
    legacy.megaPassword = "legacy-pass";
    legacy.megaDebridApiEnabled = true;
    legacy.megaDebridWebEnabled = true;
    legacy.megaDebridPreferApi = true;
    delete legacy.megaDebridApiCredentials;
    delete legacy.megaDebridWebCredentials;
    delete legacy.megaDebridApiDisabledAccountIds;
    delete legacy.megaDebridWebDisabledAccountIds;

    const normalized = normalizeSettings(legacy as AppSettings);

    expect(normalized.megaDebridApiCredentials).toBe("legacy@example.test:legacy-pass");
    expect(normalized.megaDebridWebCredentials).toBe("");
    expect(normalized.megaDebridApiEnabled).toBe(true);
    expect(normalized.megaDebridWebEnabled).toBe(false);
  });

  it("keeps German for existing settings files created before language selection existed", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);
    const legacy = { ...defaultSettings() } as Partial<AppSettings>;
    delete legacy.language;
    fs.mkdirSync(path.dirname(paths.configFile), { recursive: true });
    fs.writeFileSync(paths.configFile, JSON.stringify(legacy), "utf8");

    expect(loadSettings(paths).language).toBe("de");
  });

  it("defaults download directories to the desktop project folder", () => {
    const baseDir = path.join(os.homedir(), "Desktop", "Multi-Debrid-Downloader");
    const defaults = defaultSettings();

    expect(defaults.outputDir).toBe(baseDir);
    expect(defaults.extractDir).toBe(path.join(baseDir, "_entpackt"));
    expect(defaults.mkvLibraryDir).toBe(path.join(baseDir, "_mkv"));
  });

  it("migrates an untouched legacy directory configuration", () => {
    const legacyBaseDir = path.join(os.homedir(), "Downloads", "RealDebrid");
    const normalized = normalizeSettings({
      ...defaultSettings(),
      outputDir: legacyBaseDir,
      extractDir: path.join(legacyBaseDir, "_entpackt"),
      mkvLibraryDir: path.join(legacyBaseDir, "_mkv")
    });
    const defaults = defaultSettings();

    expect(normalized.outputDir).toBe(defaults.outputDir);
    expect(normalized.extractDir).toBe(defaults.extractDir);
    expect(normalized.mkvLibraryDir).toBe(defaults.mkvLibraryDir);
  });

  it("keeps custom directory choices during legacy migration", () => {
    const legacyBaseDir = path.join(os.homedir(), "Downloads", "RealDebrid");
    const customOutputDir = path.join(os.homedir(), "Videos", "Custom-Downloads");
    const normalized = normalizeSettings({
      ...defaultSettings(),
      outputDir: customOutputDir,
      extractDir: path.join(legacyBaseDir, "_entpackt"),
      mkvLibraryDir: path.join(legacyBaseDir, "_mkv")
    });

    expect(normalized.outputDir).toBe(customOutputDir);
    expect(normalized.extractDir).toBe(path.join(legacyBaseDir, "_entpackt"));
    expect(normalized.mkvLibraryDir).toBe(path.join(legacyBaseDir, "_mkv"));
  });

  it("does not persist provider credentials when rememberToken is disabled", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);

    saveSettings(paths, {
      ...defaultSettings(),
      rememberToken: false,
      token: "rd-token",
      megaLogin: "mega-user",
      megaPassword: "mega-pass",
      megaCredentials: "mega-user:mega-pass",
      megaDebridApiCredentials: "mega-user:mega-pass",
      megaDebridWebCredentials: "web-user:web-pass",
      bestToken: "best-token",
      allDebridToken: "all-token"
    });

    const raw = JSON.parse(fs.readFileSync(paths.configFile, "utf8")) as Record<string, unknown>;
    expect(raw.token).toBe("");
    expect(raw.megaLogin).toBe("");
    expect(raw.megaPassword).toBe("");
    expect(raw.megaCredentials).toBe("");
    expect(raw.megaDebridApiCredentials).toBe("");
    expect(raw.megaDebridWebCredentials).toBe("");
    expect(raw.bestToken).toBe("");
    expect(raw.allDebridToken).toBe("");

    const loaded = loadSettings(paths);
    expect(loaded.rememberToken).toBe(false);
    expect(loaded.token).toBe("");
    expect(loaded.megaLogin).toBe("");
    expect(loaded.megaPassword).toBe("");
    expect(loaded.megaCredentials).toBe("");
    expect(loaded.megaDebridApiCredentials).toBe("");
    expect(loaded.megaDebridWebCredentials).toBe("");
    expect(loaded.bestToken).toBe("");
    expect(loaded.allDebridToken).toBe("");
  });

  it("persists provider credentials when rememberToken is enabled", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);

    saveSettings(paths, {
      ...defaultSettings(),
      rememberToken: true,
      token: "rd-token",
      megaLogin: "mega-user",
      megaPassword: "mega-pass",
      bestToken: "best-token",
      allDebridToken: "all-token"
    });

    const loaded = loadSettings(paths);
    expect(loaded.token).toBe("rd-token");
    expect(loaded.megaLogin).toBe("mega-user");
    expect(loaded.megaPassword).toBe("mega-pass");
    expect(loaded.bestToken).toBe("best-token");
    expect(loaded.allDebridToken).toBe("all-token");
  });

  it("preserves mode-specific Mega-Debrid account statuses across save and load", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);
    const accountId = getMegaDebridAccountId("shared-login");
    const apiStatusId = getMegaDebridAccountStatusId(accountId, "api");
    const webStatusId = getMegaDebridAccountStatusId(accountId, "web");
    const settings = {
      ...defaultSettings(),
      rememberToken: true,
      megaDebridApiCredentials: "shared-login:api-password",
      megaDebridWebCredentials: "shared-login:web-password",
      debridAccountStatuses: {
        [apiStatusId]: {
          accountId: apiStatusId,
          provider: "megadebrid" as const,
          label: "API account",
          maskedLogin: "sh*******in",
          valid: false,
          isPremium: false,
          premiumUntilMs: null,
          message: "API login failed",
          checkedAt: 100
        },
        [webStatusId]: {
          accountId: webStatusId,
          provider: "megadebrid" as const,
          label: "Web account",
          maskedLogin: "sh*******in",
          valid: true,
          isPremium: true,
          premiumUntilMs: 200,
          message: "Web login succeeded",
          checkedAt: 101
        }
      }
    };

    saveSettings(paths, settings);

    expect(loadSettings(paths).debridAccountStatuses).toEqual(settings.debridAccountStatuses);
  });

  it.each(["sync", "async"] as const)("preserves the previous recoverable settings state during a %s save", async (mode) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);
    const previousToken = "previous-value-for-recovery";
    const previous = {
      ...defaultSettings(),
      packageName: "previous-package-name",
      token: previousToken
    };
    saveSettings(paths, previous);

    await saveSettingsInMode(mode, paths, {
      ...previous,
      packageName: "current-package-name",
      token: "current-value"
    });

    const backupText = fs.readFileSync(`${paths.configFile}.bak`, "utf8");
    expect(backupText).not.toContain(previousToken);
    fs.writeFileSync(paths.configFile, "{broken-current-config", "utf8");
    const recovered = loadSettings(paths);
    expect(recovered.packageName).toBe("previous-package-name");
    expect(recovered.token).toBe(previousToken);
  });

  it.each(["sync", "async"] as const)("clears previously stored credentials from the backup when remembering is disabled during a %s save", async (mode) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);
    const remembered = {
      ...defaultSettings(),
      rememberToken: true,
      token: "stored-value-before-clear",
      packageName: "previous-package-name"
    };
    saveSettings(paths, remembered);

    const cleared = { ...remembered, rememberToken: false, packageName: "current-package-name" };
    await saveSettingsInMode(mode, paths, cleared);

    const primary = JSON.parse(fs.readFileSync(paths.configFile, "utf8")) as Record<string, unknown>;
    const backup = JSON.parse(fs.readFileSync(`${paths.configFile}.bak`, "utf8")) as Record<string, unknown>;
    expect(primary.token).toBe("");
    expect(backup.token).toBe("");
    expect(primary.packageName).toBe("current-package-name");
    expect(backup.packageName).toBe("previous-package-name");
    expect(backup.rememberToken).toBe(false);
  });

  it.each(["sync", "async"] as const)("clears previously stored credentials from the backup when encryption is unavailable during a %s save", async (mode) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);
    const remembered = {
      ...defaultSettings(),
      rememberToken: true,
      token: "stored-value-before-unavailable"
    };
    saveSettings(paths, remembered);
    configureCredentialProtector({
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => ""
    });

    await saveSettingsInMode(mode, paths, remembered);

    const primary = JSON.parse(fs.readFileSync(paths.configFile, "utf8")) as Record<string, unknown>;
    const backup = JSON.parse(fs.readFileSync(`${paths.configFile}.bak`, "utf8")) as Record<string, unknown>;
    expect(primary.token).toBe("");
    expect(backup.token).toBe("");
  });

  it.each([
    ["sync", "absent"],
    ["async", "absent"],
    ["sync", "corrupt"],
    ["async", "corrupt"]
  ] as const)("uses a credential-free current fallback for a %s save with a %s prior primary", async (mode, priorState) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);
    if (priorState === "corrupt") {
      fs.writeFileSync(paths.configFile, "{broken-prior-config", "utf8");
    }
    const currentToken = "current-value-for-safe-fallback";

    await saveSettingsInMode(mode, paths, {
      ...defaultSettings(),
      rememberToken: true,
      packageName: "current-package-name",
      token: currentToken
    });

    expect(fs.existsSync(`${paths.configFile}.bak`)).toBe(true);
    const backupText = fs.readFileSync(`${paths.configFile}.bak`, "utf8");
    const backup = JSON.parse(backupText) as Record<string, unknown>;
    expect(backup.packageName).toBe("current-package-name");
    expect(backup.rememberToken).toBe(false);
    expect(backup.token).toBe("");
    expect(backupText).not.toContain(currentToken);
    expect(loadSettings(paths).token).toBe(currentToken);
  });

  it("migrates remembered plaintext provider values without retaining plaintext in config backups", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);
    const value = "legacy-value-to-migrate";
    fs.writeFileSync(paths.configFile, JSON.stringify({
      ...defaultSettings(),
      rememberToken: true,
      token: value
    }), "utf8");

    const loaded = loadSettings(paths);
    const config = fs.readFileSync(paths.configFile, "utf8");
    const backup = fs.existsSync(`${paths.configFile}.bak`)
      ? fs.readFileSync(`${paths.configFile}.bak`, "utf8")
      : "";

    expect(loaded.token).toBe(value);
    expect(config).not.toContain(value);
    expect(backup).not.toContain(value);
  });

  it("normalizes invalid enum and numeric values", () => {
    const normalized = normalizeSettings({
      ...defaultSettings(),
      providerPrimary: "invalid-provider" as unknown as AppSettings["providerPrimary"],
      providerSecondary: "invalid-provider" as unknown as AppSettings["providerSecondary"],
      providerTertiary: "invalid-provider" as unknown as AppSettings["providerTertiary"],
      cleanupMode: "broken" as unknown as AppSettings["cleanupMode"],
      extractConflictMode: "broken" as unknown as AppSettings["extractConflictMode"],
      completedCleanupPolicy: "broken" as unknown as AppSettings["completedCleanupPolicy"],
      speedLimitMode: "broken" as unknown as AppSettings["speedLimitMode"],
      maxParallel: 0,
      retryLimit: 999,
      reconnectWaitSeconds: 9999,
      speedLimitKbps: -1,
      outputDir: "   ",
      extractDir: "   ",
      mkvLibraryDir: "   ",
      updateRepo: "   "
    });

    expect(normalized.providerPrimary).toBe("realdebrid");
    expect(normalized.providerSecondary).toBe("none");
    expect(normalized.providerTertiary).toBe("none");
    expect(normalized.cleanupMode).toBe("none");
    expect(normalized.extractConflictMode).toBe("overwrite");
    expect(normalized.completedCleanupPolicy).toBe("never");
    expect(normalized.speedLimitMode).toBe("global");
    expect(normalized.maxParallel).toBe(1);
    expect(normalized.retryLimit).toBe(99);
    expect(normalized.reconnectWaitSeconds).toBe(600);
    expect(normalized.speedLimitKbps).toBe(0);
    expect(normalized.outputDir).toBe(defaultSettings().outputDir);
    expect(normalized.extractDir).toBe(defaultSettings().extractDir);
    expect(normalized.mkvLibraryDir).toBe(defaultSettings().mkvLibraryDir);
    expect(normalized.updateRepo).toBe(defaultSettings().updateRepo);
  });

  it("migrates the previous private update repository to the public release repository", () => {
    for (const updateRepo of [
      "legacy-owner/real-debrid-downloader",
      "legacy-owner/multi-debrid-downloader",
      "legacy-owner/real-debrid-downloader.git"
    ]) {
      const normalized = normalizeSettings({ ...defaultSettings(), updateRepo });
      expect(normalized.updateRepo).toBe(defaultSettings().updateRepo);
    }
  });

  it("normalizes malformed persisted config on load", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);

    fs.writeFileSync(
      paths.configFile,
      JSON.stringify({
        providerPrimary: "not-valid",
        completedCleanupPolicy: "not-valid",
        maxParallel: "999",
        retryLimit: "-3",
        reconnectWaitSeconds: "1",
        speedLimitMode: "not-valid",
        updateRepo: "",
        autoSortPackagesByProgress: false
      }),
      "utf8"
    );

    const loaded = loadSettings(paths);
    expect(loaded.providerPrimary).toBe("realdebrid");
    expect(loaded.completedCleanupPolicy).toBe("never");
    expect(loaded.maxParallel).toBe(50);
    expect(loaded.retryLimit).toBe(0);
    expect(loaded.reconnectWaitSeconds).toBe(10);
    expect(loaded.speedLimitMode).toBe("global");
    expect(loaded.updateRepo).toBe(defaultSettings().updateRepo);
    expect(loaded.autoSortPackagesByProgress).toBe(false);
  });

  it("keeps explicit none as fallback provider choice", () => {
    const normalized = normalizeSettings({
      ...defaultSettings(),
      providerSecondary: "none",
      providerTertiary: "none"
    });

    expect(normalized.providerSecondary).toBe("none");
    expect(normalized.providerTertiary).toBe("none");
  });

  it("migrates legacy MegaDebrid provider selections to explicit API/Web providers", () => {
    const apiNormalized = normalizeSettings({
      ...defaultSettings(),
      megaLogin: "mega-user",
      megaPassword: "mega-pass",
      megaDebridPreferApi: true,
      providerPrimary: "megadebrid" as unknown as AppSettings["providerPrimary"],
      providerSecondary: "megadebrid" as unknown as AppSettings["providerSecondary"],
      disabledProviders: ["megadebrid" as unknown as AppSettings["providerPrimary"]]
    });

    expect(apiNormalized.providerPrimary).toBe("megadebrid-api");
    expect(apiNormalized.providerSecondary).toBe("none");
    expect(apiNormalized.disabledProviders).toEqual(["megadebrid-api", "megadebrid-web"]);

    const webNormalized = normalizeSettings({
      ...defaultSettings(),
      megaLogin: "mega-user",
      megaPassword: "mega-pass",
      megaDebridPreferApi: false,
      megaDebridApiEnabled: false,
      megaDebridWebEnabled: true,
      providerPrimary: "megadebrid" as unknown as AppSettings["providerPrimary"],
      hosterRouting: { rapidgator: "megadebrid" as unknown as AppSettings["providerPrimary"] }
    });

    expect(webNormalized.providerPrimary).toBe("megadebrid-web");
    expect(webNormalized.hosterRouting.rapidgator).toBe("megadebrid-web");
  });

  it("migriert eine pre-v1.6.90-Config (Mega-Creds, beide Enable-Flags fehlen) zu aktiviertem Mega-Debrid statt es still auf false zu setzen", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);
    const legacyApi = {
      megaLogin: "mega-user",
      megaPassword: "mega-pass",
      megaDebridPreferApi: true,
      providerPrimary: "realdebrid",
      providerSecondary: "megadebrid"
    };
    fs.writeFileSync(paths.configFile, JSON.stringify(legacyApi), "utf8");
    const loadedApi = loadSettings(paths);
    expect(loadedApi.megaDebridApiEnabled).toBe(true);
    expect(loadedApi.megaDebridWebEnabled).toBe(false);

    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir2);
    const paths2 = createStoragePaths(dir2);
    const legacyWeb = {
      megaLogin: "mega-user",
      megaPassword: "mega-pass",
      megaDebridPreferApi: false,
      providerPrimary: "realdebrid",
      providerSecondary: "megadebrid"
    };
    fs.writeFileSync(paths2.configFile, JSON.stringify(legacyWeb), "utf8");
    const loadedWeb = loadSettings(paths2);
    expect(loadedWeb.megaDebridApiEnabled).toBe(false);
    expect(loadedWeb.megaDebridWebEnabled).toBe(true);
  });

  it("migrates an explicitly Web-only legacy account even when API remains preferred", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);
    fs.writeFileSync(paths.configFile, JSON.stringify({
      rememberToken: true,
      megaCredentials: "web-user:web-pass",
      megaDebridPreferApi: true,
      megaDebridApiEnabled: false,
      megaDebridWebEnabled: true
    }), "utf8");

    const loaded = loadSettings(paths);

    expect(loaded.megaDebridApiCredentials).toBe("");
    expect(loaded.megaDebridWebCredentials).toBe("web-user:web-pass");
    expect(loaded.megaDebridApiEnabled).toBe(false);
    expect(loaded.megaDebridWebEnabled).toBe(true);
  });

  it("migrates legacy disabled Mega-Debrid accounts into the selected mode", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);
    const accountId = getMegaDebridAccountId("disabled-user");
    fs.writeFileSync(paths.configFile, JSON.stringify({
      rememberToken: true,
      megaCredentials: "disabled-user:disabled-pass",
      megaDebridPreferApi: true,
      megaDebridApiEnabled: true,
      megaDebridWebEnabled: false,
      megaDebridDisabledAccountIds: [accountId]
    }), "utf8");

    const loaded = loadSettings(paths);

    expect(loaded.megaDebridApiDisabledAccountIds).toEqual([accountId]);
    expect(loaded.megaDebridWebDisabledAccountIds).toEqual([]);
  });

  it("preserves explicit mode-specific disabled Mega-Debrid accounts", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);
    const accountId = getMegaDebridAccountId("shared-user");
    fs.writeFileSync(paths.configFile, JSON.stringify({
      rememberToken: true,
      megaDebridApiCredentials: "shared-user:api-pass",
      megaDebridWebCredentials: "shared-user:web-pass",
      megaDebridApiEnabled: true,
      megaDebridWebEnabled: true,
      megaDebridDisabledAccountIds: [accountId],
      megaDebridApiDisabledAccountIds: [],
      megaDebridWebDisabledAccountIds: [accountId]
    }), "utf8");

    const loaded = loadSettings(paths);

    expect(loaded.megaDebridApiDisabledAccountIds).toEqual([]);
    expect(loaded.megaDebridWebDisabledAccountIds).toEqual([accountId]);
  });

  it("re-aktiviert KEINE bewusst deaktivierten Mega-Flags und migriert nicht ohne Mega-Creds", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);
    const deliberatelyDisabled = {
      megaLogin: "mega-user",
      megaPassword: "mega-pass",
      megaDebridPreferApi: true,
      megaDebridApiEnabled: false,
      megaDebridWebEnabled: false
    };
    fs.writeFileSync(paths.configFile, JSON.stringify(deliberatelyDisabled), "utf8");
    const loaded = loadSettings(paths);
    expect(loaded.megaDebridApiEnabled).toBe(false);
    expect(loaded.megaDebridWebEnabled).toBe(false);

    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir2);
    const paths2 = createStoragePaths(dir2);
    const noCreds = {
      megaDebridPreferApi: true,
      providerPrimary: "realdebrid"
    };
    fs.writeFileSync(paths2.configFile, JSON.stringify(noCreds), "utf8");
    const loadedNoCreds = loadSettings(paths2);
    expect(loadedNoCreds.megaDebridApiEnabled).toBe(false);
    expect(loadedNoCreds.megaDebridWebEnabled).toBe(false);
  });

  it("normalizes provider daily limits and resets stale daily usage", () => {
    const [debridLinkKey] = parseDebridLinkApiKeys("dl-key-one");
    const normalized = normalizeSettings({
      ...defaultSettings(),
      megaLogin: "mega-user",
      megaPassword: "mega-pass",
      megaDebridApiEnabled: true,
      debridLinkApiKeys: "dl-key-one",
      providerDailyLimitBytes: {
        realdebrid: 1024,
        megadebrid: 2048
      } as AppSettings["providerDailyLimitBytes"],
      providerTotalUsageBytes: {
        realdebrid: 16384,
        megadebrid: 32768
      } as AppSettings["providerTotalUsageBytes"],
      debridLinkApiKeyDailyLimitBytes: {
        [debridLinkKey.id]: 3072,
        stale: 1234
      },
      providerDailyUsageDay: "2001-01-01",
      providerDailyUsageBytes: {
        realdebrid: 4096,
        megadebrid: 8192
      } as AppSettings["providerDailyUsageBytes"],
      debridLinkApiKeyDailyUsageBytes: {
        [debridLinkKey.id]: 8192,
        stale: 9999
      },
      debridLinkApiKeyTotalUsageBytes: {
        [debridLinkKey.id]: 12288,
        stale: 9999
      }
    });

    expect(normalized.providerDailyLimitBytes.realdebrid).toBe(1024);
    expect(normalized.providerDailyLimitBytes["megadebrid-api"]).toBe(2048);
    expect(normalized.debridLinkApiKeyDailyLimitBytes).toEqual({
      [debridLinkKey.id]: 3072
    });
    expect(normalized.providerTotalUsageBytes).toEqual({
      realdebrid: 16384,
      "megadebrid-api": 32768
    });
    expect(normalized.providerDailyUsageDay).toBe(getProviderUsageDayKey());
    expect(normalized.providerDailyUsageBytes).toEqual({});
    expect(normalized.debridLinkApiKeyDailyUsageBytes).toEqual({});
    expect(normalized.debridLinkApiKeyTotalUsageBytes).toEqual({
      [debridLinkKey.id]: 12288
    });
  });

  it("normalizes archive password list line endings", () => {
    const normalized = normalizeSettings({
      ...defaultSettings(),
      archivePasswordList: "one\r\ntwo\r\nthree"
    });

    expect(normalized.archivePasswordList).toBe("one\ntwo\nthree");
  });

  it("defaults Real-Debrid web login to disabled and normalizes the flag", () => {
    expect(defaultSettings().realDebridUseWebLogin).toBe(false);

    const normalizedEnabled = normalizeSettings({
      ...defaultSettings(),
      realDebridUseWebLogin: 1 as unknown as boolean
    });
    expect(normalizedEnabled.realDebridUseWebLogin).toBe(true);

    const normalizedDisabled = normalizeSettings({
      ...defaultSettings(),
      realDebridUseWebLogin: 0 as unknown as boolean
    });
    expect(normalizedDisabled.realDebridUseWebLogin).toBe(false);
  });

  it("defaults AllDebrid web login to disabled and normalizes the flag", () => {
    expect(defaultSettings().allDebridUseWebLogin).toBe(false);

    const normalizedEnabled = normalizeSettings({
      ...defaultSettings(),
      allDebridUseWebLogin: 1 as unknown as boolean
    });
    expect(normalizedEnabled.allDebridUseWebLogin).toBe(true);

    const normalizedDisabled = normalizeSettings({
      ...defaultSettings(),
      allDebridUseWebLogin: 0 as unknown as boolean
    });
    expect(normalizedDisabled.allDebridUseWebLogin).toBe(false);
  });

  it("defaults history retention to permanent and normalizes invalid values", () => {
    expect(defaultSettings().historyRetentionMode).toBe("permanent");

    const normalized = normalizeSettings({
      ...defaultSettings(),
      historyRetentionMode: "broken" as unknown as AppSettings["historyRetentionMode"]
    });

    expect(normalized.historyRetentionMode).toBe("permanent");
  });

  it("skips adding persisted history entries when history retention is never", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);

    const result = addHistoryEntryForRetention(paths, "never", {
      id: "hist-1",
      name: "ignored",
      totalBytes: 1024,
      downloadedBytes: 1024,
      fileCount: 1,
      provider: "realdebrid",
      completedAt: Date.now(),
      durationSeconds: 12,
      status: "completed",
      outputDir: path.join(dir, "out"),
      urls: ["https://example.com/file.rar"]
    });

    expect(result).toEqual([]);
    expect(loadHistory(paths)).toEqual([]);
    expect(loadHistoryForRetention(paths, "never")).toEqual([]);
  });

  it("clears persisted history for session retention mode", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);

    saveHistory(paths, [{
      id: "hist-2",
      name: "kept",
      totalBytes: 2048,
      downloadedBytes: 2048,
      fileCount: 1,
      provider: "realdebrid",
      completedAt: Date.now(),
      durationSeconds: 20,
      status: "completed",
      outputDir: path.join(dir, "out"),
      urls: ["https://example.com/file2.rar"]
    }]);

    resetHistoryForRetention(paths, "session");

    expect(loadHistory(paths)).toEqual([]);
  });

  it("propagates a history deletion failure instead of reporting success", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);
    saveHistory(paths, [{
      id: "hist-locked",
      name: "locked",
      totalBytes: 1,
      downloadedBytes: 1,
      fileCount: 1,
      provider: "realdebrid",
      completedAt: Date.now(),
      durationSeconds: 1,
      status: "completed",
      outputDir: path.join(dir, "out"),
      urls: []
    }]);
    const originalUnlink = fs.unlinkSync;
    vi.spyOn(fs, "unlinkSync").mockImplementation((target) => {
      if (target === paths.historyFile) {
        const error = new Error("EPERM: history file is locked") as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      }
      return originalUnlink(target);
    });

    expect(() => clearHistory(paths)).toThrow(/EPERM/);
    expect(loadHistory(paths)).toHaveLength(1);
  });

  it("caps persisted history to the configured maxEntries", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);
    const now = Date.now();
    const entries = Array.from({ length: 10 }, (_unused, i) => ({
      id: `h-${i}`,
      name: `e${i}`,
      totalBytes: 1,
      downloadedBytes: 1,
      fileCount: 1,
      provider: "realdebrid" as const,
      completedAt: now - i * 1000,
      durationSeconds: 1,
      status: "completed" as const,
      outputDir: path.join(dir, "out"),
      urls: []
    }));

    saveHistory(paths, entries, { maxEntries: 3, maxAgeDays: 0 });

    const loaded = loadHistory(paths, { maxEntries: 3, maxAgeDays: 0 });
    expect(loaded).toHaveLength(3);
    expect(loaded.map((e) => e.id)).toEqual(["h-0", "h-1", "h-2"]);
  });

  it("drops history entries older than maxAgeDays", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const fresh = {
      id: "fresh",
      name: "fresh",
      totalBytes: 1,
      downloadedBytes: 1,
      fileCount: 1,
      provider: "realdebrid" as const,
      completedAt: now - 2 * day,
      durationSeconds: 1,
      status: "completed" as const,
      outputDir: path.join(dir, "out"),
      urls: []
    };
    const old = { ...fresh, id: "old", name: "old", completedAt: now - 40 * day };

    saveHistory(paths, [fresh, old], { maxEntries: 500, maxAgeDays: 30 });

    const loaded = loadHistory(paths, { maxEntries: 500, maxAgeDays: 30 });
    expect(loaded.map((e) => e.id)).toEqual(["fresh"]);
  });

  it("assigns and preserves bandwidth schedule ids", () => {
    const normalized = normalizeSettings({
      ...defaultSettings(),
      bandwidthSchedules: [{ id: "", startHour: 1, endHour: 6, speedLimitKbps: 1024, enabled: true }]
    });

    const generatedId = normalized.bandwidthSchedules[0]?.id;
    expect(typeof generatedId).toBe("string");
    expect(generatedId?.length).toBeGreaterThan(0);

    const normalizedAgain = normalizeSettings({
      ...defaultSettings(),
      bandwidthSchedules: normalized.bandwidthSchedules
    });
    expect(normalizedAgain.bandwidthSchedules[0]?.id).toBe(generatedId);
  });

  it("resets stale active statuses to queued on session load", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);

    const session = emptySession();
    session.packages["pkg1"] = {
      id: "pkg1",
      name: "Test Package",
      outputDir: "/tmp/out",
      extractDir: "/tmp/extract",
      status: "downloading",
      itemIds: ["item1", "item2", "item3", "item4"],
      cancelled: false,
      enabled: true,
      downloadStartedAt: 0,
      downloadCompletedAt: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    session.items["item1"] = {
      id: "item1",
      packageId: "pkg1",
      url: "https://example.com/file1.rar",
      provider: null,
      status: "downloading",
      retries: 0,
      speedBps: 1024,
      downloadedBytes: 5000,
      totalBytes: 10000,
      progressPercent: 50,
      fileName: "file1.rar",
      targetPath: "/tmp/out/file1.rar",
      resumable: true,
      attempts: 1,
      lastError: "some error",
      fullStatus: "",
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    session.items["item2"] = {
      id: "item2",
      packageId: "pkg1",
      url: "https://example.com/file2.rar",
      provider: null,
      status: "paused",
      retries: 0,
      speedBps: 0,
      downloadedBytes: 0,
      totalBytes: null,
      progressPercent: 0,
      fileName: "file2.rar",
      targetPath: "/tmp/out/file2.rar",
      resumable: false,
      attempts: 0,
      lastError: "",
      fullStatus: "",
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    session.items["item3"] = {
      id: "item3",
      packageId: "pkg1",
      url: "https://example.com/file3.rar",
      provider: null,
      status: "completed",
      retries: 0,
      speedBps: 0,
      downloadedBytes: 10000,
      totalBytes: 10000,
      progressPercent: 100,
      fileName: "file3.rar",
      targetPath: "/tmp/out/file3.rar",
      resumable: false,
      attempts: 1,
      lastError: "",
      fullStatus: "",
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    session.items["item4"] = {
      id: "item4",
      packageId: "pkg1",
      url: "https://example.com/file4.rar",
      provider: null,
      status: "queued",
      retries: 0,
      speedBps: 0,
      downloadedBytes: 0,
      totalBytes: null,
      progressPercent: 0,
      fileName: "file4.rar",
      targetPath: "/tmp/out/file4.rar",
      resumable: false,
      attempts: 0,
      lastError: "",
      fullStatus: "",
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    saveSession(paths, session);
    const loaded = loadSession(paths);

    expect(loaded.items["item1"].status).toBe("queued");
    expect(loaded.items["item2"].status).toBe("queued");
    expect(loaded.items["item1"].speedBps).toBe(0);
    expect(loaded.items["item1"].lastError).toBe("");
    expect(loaded.items["item3"].status).toBe("completed");
    expect(loaded.items["item4"].status).toBe("queued");
    expect(loaded.items["item1"].downloadedBytes).toBe(5000);
    expect(loaded.packages["pkg1"].name).toBe("Test Package");
  });

  it("preserves cleaned package progress aggregates while normalizing a session", () => {
    const session = emptySession();
    session.packageOrder = ["pkg-progress"];
    session.packages["pkg-progress"] = {
      id: "pkg-progress",
      name: "Progress",
      outputDir: "C:\\Downloads\\Progress",
      extractDir: "C:\\Downloads\\Progress\\Extracted",
      status: "downloading",
      itemIds: [],
      cancelled: false,
      enabled: true,
      cleanedCompletedItemCount: 3,
      cleanedExtractedItemCount: 2,
      cleanedDownloadedBytes: 3_000,
      cleanedTotalBytes: 4_000,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const normalized = normalizeLoadedSession(session);

    expect(normalized.packages["pkg-progress"]).toEqual(expect.objectContaining({
      cleanedCompletedItemCount: 3,
      cleanedExtractedItemCount: 2,
      cleanedDownloadedBytes: 3_000,
      cleanedTotalBytes: 4_000
    }));
  });

  it("returns empty session when session file contains invalid JSON", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);

    fs.writeFileSync(paths.sessionFile, "{{{corrupted json!!!", "utf8");

    const loaded = loadSession(paths);
    const empty = emptySession();
    expect(loaded.packages).toEqual(empty.packages);
    expect(loaded.items).toEqual(empty.items);
    expect(loaded.packageOrder).toEqual(empty.packageOrder);
  });

  it("loads backup session when primary session is corrupted", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);

    const backupSession = emptySession();
    backupSession.packageOrder = ["pkg-backup"];
    backupSession.packages["pkg-backup"] = {
      id: "pkg-backup",
      name: "Backup Package",
      outputDir: path.join(dir, "out"),
      extractDir: path.join(dir, "extract"),
      status: "queued",
      itemIds: ["item-backup"],
      cancelled: false,
      enabled: true,
      downloadStartedAt: 0,
      downloadCompletedAt: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    backupSession.items["item-backup"] = {
      id: "item-backup",
      packageId: "pkg-backup",
      url: "https://example.com/backup-file",
      provider: null,
      status: "queued",
      retries: 0,
      speedBps: 0,
      downloadedBytes: 0,
      totalBytes: null,
      progressPercent: 0,
      fileName: "backup-file.rar",
      targetPath: path.join(dir, "out", "backup-file.rar"),
      resumable: true,
      attempts: 0,
      lastError: "",
      fullStatus: "Wartet",
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    fs.writeFileSync(`${paths.sessionFile}.bak`, JSON.stringify(backupSession), "utf8");
    fs.writeFileSync(paths.sessionFile, "{broken-session-json", "utf8");

    const loaded = loadSession(paths);
    expect(loaded.packageOrder).toEqual(["pkg-backup"]);
    expect(loaded.packages["pkg-backup"]?.name).toBe("Backup Package");
    expect(loaded.items["item-backup"]?.fileName).toBe("backup-file.rar");

    const restoredPrimary = JSON.parse(fs.readFileSync(paths.sessionFile, "utf8")) as { packages?: Record<string, unknown> };
    expect(restoredPrimary.packages && "pkg-backup" in restoredPrimary.packages).toBe(true);
  });

  it("preserves resume recovery state across a session save and reload", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);
    const session = emptySession();
    const now = Date.now();
    const outputDir = path.join(dir, "out");
    const itemId = "item-resume";
    session.packageOrder = ["pkg-resume"];
    session.packages["pkg-resume"] = {
      id: "pkg-resume",
      name: "Resume Package",
      outputDir,
      extractDir: path.join(dir, "extract"),
      status: "queued",
      itemIds: [itemId],
      cancelled: false,
      enabled: true,
      createdAt: now,
      updatedAt: now
    };
    session.items[itemId] = {
      id: itemId,
      packageId: "pkg-resume",
      url: "https://example.com/resume-file",
      provider: "megadebrid-web",
      status: "queued",
      retries: 2,
      speedBps: 0,
      downloadedBytes: 8192,
      totalBytes: 16384,
      progressPercent: 50,
      fileName: "resume-file.bin",
      targetPath: path.join(outputDir, "resume-file.bin"),
      resumable: true,
      attempts: 3,
      lastError: "",
      fullStatus: "Resume-Link erneuern",
      resumeLinkRenewalFailures: 4,
      resumeHardResetUsed: true,
      resumeResetPending: true,
      http416FreshRestarts: 2,
      createdAt: now,
      updatedAt: now
    };

    saveSession(paths, session);
    const loaded = loadSession(paths);

    expect(loaded.items[itemId]).toEqual(expect.objectContaining({
      downloadedBytes: 8192,
      totalBytes: 16384,
      resumeLinkRenewalFailures: 4,
      resumeHardResetUsed: true,
      resumeResetPending: true,
      http416FreshRestarts: 2
    }));
  });

  it("returns defaults when config file contains invalid JSON", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);

    fs.writeFileSync(paths.configFile, "{{{{not valid json!!!}", "utf8");

    const loaded = loadSettings(paths);
    const defaults = defaultSettings();
    expect(loaded.providerPrimary).toBe(defaults.providerPrimary);
    expect(loaded.maxParallel).toBe(defaults.maxParallel);
    expect(loaded.retryLimit).toBe(defaults.retryLimit);
    expect(loaded.outputDir).toBe(defaults.outputDir);
    expect(loaded.cleanupMode).toBe(defaults.cleanupMode);
  });

  it("loads backup config when primary config is corrupted", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);

    const backupSettings = {
      ...defaultSettings(),
      outputDir: path.join(dir, "backup-output"),
      packageName: "from-backup"
    };
    fs.writeFileSync(`${paths.configFile}.bak`, JSON.stringify(backupSettings, null, 2), "utf8");
    fs.writeFileSync(paths.configFile, "{broken-json", "utf8");

    const loaded = loadSettings(paths);
    expect(loaded.outputDir).toBe(backupSettings.outputDir);
    expect(loaded.packageName).toBe("from-backup");
  });

  it("sanitizes malformed persisted session structures", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);

    fs.writeFileSync(paths.sessionFile, JSON.stringify({
      version: "invalid",
      packageOrder: [123, "pkg-valid"],
      packages: {
        "1": "bad-entry",
        "pkg-valid": {
          id: "pkg-valid",
          name: "Valid Package",
          outputDir: "C:/tmp/out",
          extractDir: "C:/tmp/extract",
          status: "downloading",
          itemIds: ["item-valid", 123],
          cancelled: false,
          enabled: true
        }
      },
      items: {
        "item-valid": {
          id: "item-valid",
          packageId: "pkg-valid",
          url: "https://example.com/file",
          status: "queued",
          fileName: "file.bin",
          targetPath: "C:/tmp/out/file.bin"
        },
        "item-bad": "broken"
      }
    }), "utf8");

    const loaded = loadSession(paths);
    expect(Object.keys(loaded.packages)).toEqual(["pkg-valid"]);
    expect(Object.keys(loaded.items)).toEqual(["item-valid"]);
    expect(loaded.packageOrder).toEqual(["pkg-valid"]);
  });

  it("drops unsafe session ids and target paths outside the package output directory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);
    const outputDir = path.join(dir, "downloads", "safe");
    const safeTargetPath = path.join(outputDir, "safe.bin");
    const outsideTargetPath = path.join(dir, "outside.bin");

    fs.writeFileSync(paths.sessionFile, JSON.stringify({
      version: 2,
      packageOrder: ["pkg-safe", "../pkg-evil"],
      packages: {
        "pkg-safe": {
          id: "pkg-safe",
          name: "Safe Package",
          outputDir,
          extractDir: path.join(dir, "extract", "safe"),
          status: "queued",
          itemIds: ["item-safe", "item-outside", "../item-evil"],
          cancelled: false,
          enabled: true
        },
        "../pkg-evil": {
          id: "../pkg-evil",
          name: "Unsafe Package",
          outputDir,
          extractDir: path.join(dir, "extract", "unsafe"),
          status: "queued",
          itemIds: ["item-evil"],
          cancelled: false,
          enabled: true
        }
      },
      items: {
        "item-safe": {
          id: "item-safe",
          packageId: "pkg-safe",
          url: "https://example.com/safe",
          status: "queued",
          fileName: "safe.bin",
          targetPath: safeTargetPath
        },
        "item-outside": {
          id: "item-outside",
          packageId: "pkg-safe",
          url: "https://example.com/outside",
          status: "queued",
          fileName: "outside.bin",
          targetPath: outsideTargetPath
        },
        "../item-evil": {
          id: "../item-evil",
          packageId: "pkg-safe",
          url: "https://example.com/evil",
          status: "queued",
          fileName: "evil.bin",
          targetPath: safeTargetPath
        }
      }
    }), "utf8");

    const loaded = loadSession(paths);
    expect(Object.keys(loaded.packages)).toEqual(["pkg-safe"]);
    expect(Object.keys(loaded.items).sort()).toEqual(["item-outside", "item-safe"]);
    expect(loaded.packageOrder).toEqual(["pkg-safe"]);
    expect(path.resolve(loaded.items["item-safe"]?.targetPath || "")).toBe(path.resolve(safeTargetPath));
    expect(loaded.items["item-outside"]?.targetPath).toBe("");
  });

  it("captures async session save payload before later mutations", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);

    const session = emptySession();
    session.summaryText = "before-mutation";

    const pending = saveSessionAsync(paths, session);
    session.summaryText = "after-mutation";
    await pending;

    const persisted = JSON.parse(fs.readFileSync(paths.sessionFile, "utf8")) as { summaryText: string };
    expect(persisted.summaryText).toBe("before-mutation");
  });

  it("creates session backup before sync and async session overwrites", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);

    const first = emptySession();
    first.summaryText = "first";
    saveSession(paths, first);

    const second = emptySession();
    second.summaryText = "second";
    saveSession(paths, second);

    const backupAfterSync = JSON.parse(fs.readFileSync(`${paths.sessionFile}.bak`, "utf8")) as { summaryText?: string };
    expect(backupAfterSync.summaryText).toBe("first");

    const third = emptySession();
    third.summaryText = "third";
    await saveSessionAsync(paths, third);

    const backupAfterAsync = JSON.parse(fs.readFileSync(`${paths.sessionFile}.bak`, "utf8")) as { summaryText?: string };
    const primaryAfterAsync = JSON.parse(fs.readFileSync(paths.sessionFile, "utf8")) as { summaryText?: string };
    expect(backupAfterAsync.summaryText).toBe("second");
    expect(primaryAfterAsync.summaryText).toBe("third");
  });

  it("applies defaults for missing fields when loading old config", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-store-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);

    fs.writeFileSync(
      paths.configFile,
      JSON.stringify({
        token: "my-token",
        rememberToken: true,
        outputDir: "/custom/output"
      }),
      "utf8"
    );

    const loaded = loadSettings(paths);
    const defaults = defaultSettings();

    expect(loaded.token).toBe("my-token");
    expect(loaded.outputDir).toBe(path.resolve("/custom/output"));

    expect(loaded.autoProviderFallback).toBe(defaults.autoProviderFallback);
    expect(loaded.hybridExtract).toBe(defaults.hybridExtract);
    expect(loaded.completedCleanupPolicy).toBe(defaults.completedCleanupPolicy);
    expect(loaded.speedLimitMode).toBe(defaults.speedLimitMode);
    expect(loaded.clipboardWatch).toBe(defaults.clipboardWatch);
    expect(loaded.minimizeToTray).toBe(defaults.minimizeToTray);
    expect(loaded.retryLimit).toBe(defaults.retryLimit);
    expect(loaded.collectMkvToLibrary).toBe(defaults.collectMkvToLibrary);
    expect(loaded.mkvLibraryDir).toBe(defaults.mkvLibraryDir);
    expect(loaded.theme).toBe(defaults.theme);
    expect(loaded.bandwidthSchedules).toEqual(defaults.bandwidthSchedules);
    expect(loaded.updateRepo).toBe(defaults.updateRepo);
  });
});
