import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppController } from "../src/main/app-controller";
import { defaultSettings } from "../src/main/constants";
import { configureCredentialProtector } from "../src/main/credential-protection";
import { prepareDailyStartSettingsPatch } from "../src/main/daily-start-scheduler";
import { logger } from "../src/main/logger";
import { createStatisticsLedger, loadStatisticsLedger, saveStatisticsLedger } from "../src/main/statistics-ledger";
import { createStoragePaths, emptySession, loadHistory, loadSession, loadSettings, saveHistory, saveSession, saveSettings } from "../src/main/storage";
import type { CollectorPersistenceState } from "../src/shared/collector";
import type { AppSettings, SessionState } from "../src/shared/types";

const appState = vi.hoisted(() => ({ userDataDir: "C:\\MDD\\Test" }));
const bootStorage = vi.hoisted(() => ({
  settings: null as unknown,
  loadResult: null as unknown,
  historyResetError: null as Error | null,
  historyClearError: null as Error | null,
  settingsSaveError: null as Error | null,
  sessionSaveError: null as Error | null,
  rollbackCreateError: null as Error | null,
  barrierAcquisitions: 0,
  barrierReleases: [] as boolean[],
  barrierReleaseHook: null as ((replayBlocked: boolean) => void) | null
}));
const statisticsStorage = vi.hoisted(() => ({ saveError: null as Error | null }));
const debugStorage = vi.hoisted(() => ({
  configError: null as Error | null,
  restartCalls: 0,
  restartErrors: [] as Error[]
}));

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => name === "desktop" ? path.join(appState.userDataDir, "Desktop") : appState.userDataDir
  },
  BrowserWindow: class {},
  clipboard: {},
  dialog: {},
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: vi.fn(), decryptString: vi.fn() },
  shell: {},
  Tray: class {}
}));

vi.mock("../src/main/debug-server", async () => {
  const actual = await vi.importActual<typeof import("../src/main/debug-server")>("../src/main/debug-server");
  return {
    ...actual,
    startDebugServer: vi.fn(),
    stopDebugServer: vi.fn(),
    restartDebugServer: vi.fn(async () => {
      debugStorage.restartCalls += 1;
      const error = debugStorage.restartErrors.shift();
      if (error) throw error;
      return actual.getDebugServerRuntimeStatus();
    }),
    writeDebugServerConfig: (...args: Parameters<typeof actual.writeDebugServerConfig>) => {
      if (debugStorage.configError) throw debugStorage.configError;
      return actual.writeDebugServerConfig(...args);
    }
  };
});

vi.mock("../src/main/statistics-ledger", async () => {
  const actual = await vi.importActual<typeof import("../src/main/statistics-ledger")>("../src/main/statistics-ledger");
  return {
    ...actual,
    saveStatisticsLedger: (...args: Parameters<typeof actual.saveStatisticsLedger>) => {
      if (statisticsStorage.saveError) throw statisticsStorage.saveError;
      return actual.saveStatisticsLedger(...args);
    }
  };
});

vi.mock("../src/main/storage", async () => {
  const actual = await vi.importActual<typeof import("../src/main/storage")>("../src/main/storage");
  return {
    ...actual,
    loadSettings: (...args: Parameters<typeof actual.loadSettings>) => bootStorage.settings
      ? bootStorage.settings as AppSettings
      : actual.loadSettings(...args),
    loadSessionWithStatus: (...args: Parameters<typeof actual.loadSessionWithStatus>) => bootStorage.loadResult
      ? bootStorage.loadResult as ReturnType<typeof actual.loadSessionWithStatus>
      : actual.loadSessionWithStatus(...args),
    resetHistoryForRetention: (...args: Parameters<typeof actual.resetHistoryForRetention>) => {
      if (bootStorage.historyResetError) throw bootStorage.historyResetError;
      return actual.resetHistoryForRetention(...args);
    },
    clearHistory: (...args: Parameters<typeof actual.clearHistory>) => {
      if (bootStorage.historyClearError) throw bootStorage.historyClearError;
      return actual.clearHistory(...args);
    },
    acquirePersistenceBarrier: async () => {
      bootStorage.barrierAcquisitions += 1;
      return {
        release: async ({ replayBlocked }: { replayBlocked: boolean }) => {
          bootStorage.barrierReleases.push(replayBlocked);
          bootStorage.barrierReleaseHook?.(replayBlocked);
        }
      };
    },
    createFileRollback: (...args: Parameters<typeof actual.createFileRollback>) => {
      if (bootStorage.rollbackCreateError) throw bootStorage.rollbackCreateError;
      return actual.createFileRollback(...args);
    },
    saveSettings: (...args: Parameters<typeof actual.saveSettings>) => {
      if (bootStorage.settingsSaveError) throw bootStorage.settingsSaveError;
      return actual.saveSettings(...args);
    },
    saveSession: (...args: Parameters<typeof actual.saveSession>) => {
      if (bootStorage.sessionSaveError) throw bootStorage.sessionSaveError;
      return actual.saveSession(...args);
    }
  };
});

const tempDirs: string[] = [];
const liveControllers: AppController[] = [];

function createController(settings: AppSettings): AppController {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-controller-"));
  tempDirs.push(dir);
  const controller = Object.create(AppController.prototype) as any;
  controller.settings = settings;
  controller.storagePaths = createStoragePaths(dir);
  controller.manager = { setSettings: vi.fn(), persistNowSync: vi.fn() };
  controller.audit = vi.fn();
  controller.overlayLiveUsageCounters = vi.fn();
  controller.pruneRealDebridWebFallbacks = vi.fn();
  controller.realDebridWebFallbacks = new Map();
  return controller as AppController;
}

function queuedSession(): SessionState {
  return {
    ...emptySession(),
    packageOrder: ["pkg"],
    packages: {
      pkg: {
        id: "pkg",
        name: "Daily queue",
        outputDir: "C:\\Downloads",
        extractDir: "C:\\Downloads",
        status: "queued",
        itemIds: ["item"],
        cancelled: false,
        enabled: true,
        createdAt: 1,
        updatedAt: 1
      }
    },
    items: {
      item: {
        id: "item",
        packageId: "pkg",
        url: "https://example.test/file",
        provider: null,
        status: "queued",
        retries: 0,
        speedBps: 0,
        downloadedBytes: 0,
        totalBytes: null,
        progressPercent: 0,
        fileName: "file.bin",
        targetPath: "C:\\Downloads\\file.bin",
        resumable: true,
        attempts: 0,
        lastError: "",
        fullStatus: "",
        createdAt: 1,
        updatedAt: 1
      }
    }
  };
}

function tomorrowLocalDate(): string {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12, 0, 0, 0);
  return `${tomorrow.getFullYear().toString().padStart(4, "0")}-${(tomorrow.getMonth() + 1).toString().padStart(2, "0")}-${tomorrow.getDate().toString().padStart(2, "0")}`;
}

afterEach(async () => {
  for (const controller of liveControllers.splice(0)) {
    await controller.shutdown();
  }
  bootStorage.settings = null;
  bootStorage.loadResult = null;
  bootStorage.historyResetError = null;
  bootStorage.historyClearError = null;
  bootStorage.settingsSaveError = null;
  bootStorage.sessionSaveError = null;
  bootStorage.rollbackCreateError = null;
  bootStorage.barrierAcquisitions = 0;
  bootStorage.barrierReleases = [];
  bootStorage.barrierReleaseHook = null;
  statisticsStorage.saveError = null;
  debugStorage.configError = null;
  debugStorage.restartCalls = 0;
  debugStorage.restartErrors = [];
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("AppController collector persistence", () => {
  it("updates and synchronously flushes the latest collector state before returning", () => {
    const state: CollectorPersistenceState = { packages: [], collapsedPackageIds: [] };
    const operations: string[] = [];
    const controller = Object.create(AppController.prototype) as any;
    controller.collectorStore = {
      update: (value: CollectorPersistenceState) => {
        expect(value).toEqual(state);
        operations.push("update");
      },
      flushSync: () => { operations.push("flush"); },
      getState: () => {
        operations.push("get");
        return structuredClone(state);
      }
    };

    expect(controller.saveCollectorStateSync(state)).toEqual(state);
    expect(operations).toEqual(["update", "flush", "get"]);
  });
});

describe("AppController full backup history restore", () => {
  it("clears existing history when a full backup explicitly contains an empty history", async () => {
    const settings = { ...defaultSettings(), backupIncludeDownloads: true, historyRetentionMode: "permanent" as const };
    const controller = createController(settings) as any;
    controller.manager = {
      setSettings: vi.fn(),
      stop: vi.fn(),
      abortAllPostProcessing: vi.fn(),
      clearPersistTimer: vi.fn(),
      skipShutdownPersist: false,
      blockAllPersistence: false
    };
    controller.restoreRemoteDiagnosticsFromBackup = vi.fn();
    saveHistory(controller.storagePaths, [{ id: "existing", name: "Alt" } as never]);
    const payload = Buffer.from(JSON.stringify({
      version: 2,
      kind: "full",
      settings,
      session: emptySession(),
      history: []
    }), "utf8");

    expect((await controller.importBackup(payload)).restored).toBe(true);
    expect(bootStorage.barrierAcquisitions).toBe(1);
    expect(bootStorage.barrierReleases).toEqual([false]);
    expect(loadHistory(controller.storagePaths)).toEqual([]);
    expect(JSON.parse(fs.readFileSync(`${controller.storagePaths.historyFile}.bak`, "utf8"))).toEqual([]);
  });

  it("rejects a nonempty backup history when every entry is invalid", async () => {
    const settings = { ...defaultSettings(), backupIncludeDownloads: true, historyRetentionMode: "permanent" as const };
    const controller = createController(settings) as any;
    controller.manager = { setSettings: vi.fn() };
    saveHistory(controller.storagePaths, [{ id: "existing", name: "Alt" } as never]);
    const payload = Buffer.from(JSON.stringify({
      version: 2,
      kind: "full",
      settings,
      session: emptySession(),
      history: [null]
    }), "utf8");

    await expect(controller.importBackup(payload)).resolves.toMatchObject({ restored: false });
    expect(loadHistory(controller.storagePaths).map((entry) => entry.id)).toEqual(["existing"]);
  });

  it("keeps settings, session ownership, and existing history untouched when authoritative history replacement fails", async () => {
    const currentSettings = { ...defaultSettings(), outputDir: "C:\\Current", backupIncludeDownloads: true, historyRetentionMode: "permanent" as const };
    const importedSettings = { ...currentSettings, outputDir: "C:\\Imported" };
    const controller = createController(currentSettings) as any;
    controller.manager = {
      setSettings: vi.fn(),
      stop: vi.fn(),
      abortAllPostProcessing: vi.fn(),
      clearPersistTimer: vi.fn(),
      skipShutdownPersist: false,
      blockAllPersistence: false
    };
    controller.restoreRemoteDiagnosticsFromBackup = vi.fn();
    saveHistory(controller.storagePaths, [{ id: "existing", name: "Alt" } as never]);
    const payload = Buffer.from(JSON.stringify({
      version: 2,
      kind: "full",
      settings: importedSettings,
      session: emptySession(),
      history: [{ id: "imported", name: "Neu" }]
    }), "utf8");
    const renameFile = fs.renameSync.bind(fs);
    let failed = false;
    const rename = vi.spyOn(fs, "renameSync").mockImplementation((source, destination) => {
      if (!failed && String(destination) === controller.storagePaths.historyFile) {
        failed = true;
        throw Object.assign(new Error("history locked"), { code: "EPERM" });
      }
      return renameFile(source, destination);
    });

    try {
      await expect(controller.importBackup(payload)).rejects.toThrow("history locked");
    } finally {
      rename.mockRestore();
    }

    expect(controller.getSettings().outputDir).toBe("C:\\Current");
    expect(controller.manager.setSettings).not.toHaveBeenCalled();
    expect(controller.manager.stop).not.toHaveBeenCalled();
    expect(loadHistory(controller.storagePaths).map((entry) => entry.id)).toEqual(["existing"]);
    expect(bootStorage.barrierReleases).toEqual([true]);
  });

  it("restores existing history when a later full-import write fails", async () => {
    const currentSettings = { ...defaultSettings(), outputDir: "C:\\Current", backupIncludeDownloads: true, historyRetentionMode: "permanent" as const };
    const controller = createController(currentSettings) as any;
    controller.manager = {
      setSettings: vi.fn(),
      stop: vi.fn(),
      abortAllPostProcessing: vi.fn(),
      clearPersistTimer: vi.fn(),
      skipShutdownPersist: false,
      blockAllPersistence: false
    };
    controller.restoreRemoteDiagnosticsFromBackup = vi.fn();
    saveHistory(controller.storagePaths, [{ id: "existing", name: "Alt" } as never]);
    bootStorage.settingsSaveError = new Error("settings locked");
    const payload = Buffer.from(JSON.stringify({
      version: 2,
      kind: "full",
      settings: { ...currentSettings, outputDir: "C:\\Imported" },
      session: emptySession(),
      history: [{ id: "imported", name: "Neu" }]
    }), "utf8");

    await expect(controller.importBackup(payload)).rejects.toThrow("settings locked");

    expect(controller.getSettings().outputDir).toBe("C:\\Current");
    expect(controller.manager.setSettings).not.toHaveBeenCalled();
    expect(loadHistory(controller.storagePaths).map((entry) => entry.id)).toEqual(["existing"]);
  });

  it.each(["session", "statistics", "remote"] as const)("rolls back every persisted and runtime surface when %s persistence fails", async (failure) => {
    const currentSettings = { ...defaultSettings(), outputDir: "C:\\Current", backupIncludeDownloads: true, historyRetentionMode: "permanent" as const };
    const controller = createController(currentSettings) as any;
    controller.manager = {
      setSettings: vi.fn(),
      stop: vi.fn(),
      abortAllPostProcessing: vi.fn(),
      clearPersistTimer: vi.fn(),
      skipShutdownPersist: false,
      blockAllPersistence: false
    };
    const currentSession = queuedSession();
    saveSettings(controller.storagePaths, currentSettings);
    saveSession(controller.storagePaths, currentSession);
    saveHistory(controller.storagePaths, [{ id: "existing", name: "Alt" } as never]);
    saveStatisticsLedger(controller.storagePaths.statisticsFile, createStatisticsLedger(1_000));
    for (const [name, value] of [["debug_host.txt", "127.0.0.1\n"], ["debug_port.txt", "9868\n"], ["debug_allowlist.txt", "192.0.2.1\n"]]) {
      fs.writeFileSync(path.join(controller.storagePaths.baseDir, name), value, "utf8");
    }
    if (failure === "session") bootStorage.sessionSaveError = new Error("session locked");
    if (failure === "statistics") statisticsStorage.saveError = new Error("statistics locked");
    if (failure === "remote") debugStorage.configError = new Error("remote locked");
    const importedSession = emptySession();
    importedSession.packageOrder = ["imported-package"];
    const payload = Buffer.from(JSON.stringify({
      version: 2,
      kind: "full",
      settings: { ...currentSettings, outputDir: "C:\\Imported" },
      session: importedSession,
      history: [{ id: "imported", name: "Neu" }],
      statistics: createStatisticsLedger(2_000),
      remoteDiagnostics: { allowlist: ["198.51.100.8"] }
    }), "utf8");

    await expect(controller.importBackup(payload)).rejects.toThrow(`${failure} locked`);

    expect(controller.getSettings().outputDir).toBe("C:\\Current");
    expect(controller.manager.setSettings).not.toHaveBeenCalled();
    expect(controller.manager.stop).not.toHaveBeenCalled();
    expect(controller.manager.abortAllPostProcessing).not.toHaveBeenCalled();
    expect(loadSettings(controller.storagePaths).outputDir).toBe("C:\\Current");
    expect(loadSession(controller.storagePaths).packageOrder).toEqual(["pkg"]);
    expect(loadHistory(controller.storagePaths).map((entry) => entry.id)).toEqual(["existing"]);
    expect(loadStatisticsLedger(controller.storagePaths.statisticsFile).startedAt).toBe(1_000);
    expect(fs.readFileSync(path.join(controller.storagePaths.baseDir, "debug_allowlist.txt"), "utf8")).toBe("192.0.2.1\n");
  });

  it("restores runtime settings and persistence flags when full-import finalization fails", async () => {
    const currentSettings = { ...defaultSettings(), outputDir: "C:\\Current", backupIncludeDownloads: true };
    const importedSettings = { ...currentSettings, outputDir: "C:\\Imported" };
    const controller = createController(currentSettings) as any;
    controller.manager = {
      setSettings: vi.fn(),
      stop: vi.fn(() => { throw new Error("stop failed"); }),
      abortAllPostProcessing: vi.fn(),
      clearPersistTimer: vi.fn(),
      skipShutdownPersist: false,
      blockAllPersistence: false
    };
    saveSettings(controller.storagePaths, currentSettings);
    saveSession(controller.storagePaths, queuedSession());
    const payload = Buffer.from(JSON.stringify({
      version: 2,
      kind: "full",
      settings: importedSettings,
      session: emptySession(),
      history: []
    }), "utf8");

    await expect(controller.importBackup(payload)).rejects.toThrow("stop failed");

    expect(controller.getSettings().outputDir).toBe("C:\\Current");
    expect(loadSettings(controller.storagePaths).outputDir).toBe("C:\\Current");
    expect(controller.manager.setSettings).toHaveBeenNthCalledWith(1, expect.objectContaining({ outputDir: "C:\\Imported" }));
    expect(controller.manager.setSettings).toHaveBeenNthCalledWith(2, currentSettings, { settingsOnlyImport: true });
    expect(controller.manager.skipShutdownPersist).toBe(false);
    expect(controller.manager.blockAllPersistence).toBe(false);
    expect(bootStorage.barrierReleases).toEqual([true]);
    expect(controller.audit).not.toHaveBeenCalled();
  });
});

describe("AppController settings-only backup transactions", () => {
  it("applies runtime settings before releasing the successful import barrier", async () => {
    const currentSettings = { ...defaultSettings(), outputDir: "C:\\Current" };
    const importedSettings = { ...currentSettings, outputDir: "C:\\Imported" };
    const controller = createController(currentSettings) as any;
    const events: string[] = [];
    controller.manager.setSettings = vi.fn(() => { events.push("runtime"); });
    bootStorage.barrierReleaseHook = (replayBlocked) => { events.push(`release:${replayBlocked}`); };

    await controller.applySettingsOnlyBackup(importedSettings);

    expect(controller.getSettings().outputDir).toBe("C:\\Imported");
    expect(loadSettings(controller.storagePaths).outputDir).toBe("C:\\Imported");
    expect(events).toEqual(["runtime", "release:false"]);
    expect(bootStorage.barrierAcquisitions).toBe(1);
  });

  it("persists the current live session before discarding blocked saves after a settings-only import", async () => {
    const currentSettings = { ...defaultSettings(), outputDir: "C:\\Current" };
    const importedSettings = { ...currentSettings, outputDir: "C:\\Imported" };
    const controller = createController(currentSettings) as any;
    const staleSession = { ...emptySession(), summaryText: "before remote restart" };
    const liveSession = { ...emptySession(), summaryText: "completed during remote restart" };
    const events: string[] = [];
    saveSession(controller.storagePaths, staleSession);
    controller.manager = {
      setSettings: vi.fn(() => { events.push("runtime"); }),
      persistNowSync: vi.fn(() => {
        events.push("session");
        saveSession(controller.storagePaths, liveSession);
      })
    };
    bootStorage.barrierReleaseHook = (replayBlocked) => { events.push(`release:${replayBlocked}`); };

    await controller.applySettingsOnlyBackup(importedSettings);

    expect(loadSession(controller.storagePaths).summaryText).toBe("completed during remote restart");
    expect(events).toEqual(["runtime", "session", "release:false"]);
  });

  it("rolls back a settings-only import when the final live-session flush fails", async () => {
    const currentSettings = { ...defaultSettings(), outputDir: "C:\\Current" };
    const importedSettings = { ...currentSettings, outputDir: "C:\\Imported" };
    const controller = createController(currentSettings) as any;
    controller.manager = {
      setSettings: vi.fn(),
      persistNowSync: vi.fn(() => { throw new Error("live session flush failed"); })
    };
    saveSettings(controller.storagePaths, currentSettings);

    await expect(controller.applySettingsOnlyBackup(importedSettings)).rejects.toThrow("live session flush failed");

    expect(controller.getSettings().outputDir).toBe("C:\\Current");
    expect(loadSettings(controller.storagePaths).outputDir).toBe("C:\\Current");
    expect(controller.manager.setSettings).toHaveBeenNthCalledWith(1, expect.objectContaining({ outputDir: "C:\\Imported" }), { settingsOnlyImport: true });
    expect(controller.manager.setSettings).toHaveBeenNthCalledWith(2, currentSettings, { settingsOnlyImport: true });
    expect(bootStorage.barrierReleases).toEqual([true]);
    expect(controller.audit).not.toHaveBeenCalled();
  });

  it("releases the persistence barrier when the rollback snapshot cannot be created", async () => {
    const currentSettings = { ...defaultSettings(), outputDir: "C:\\Current" };
    const controller = createController(currentSettings) as any;
    bootStorage.rollbackCreateError = new Error("rollback snapshot unreadable");

    await expect(controller.applySettingsOnlyBackup({ ...currentSettings, outputDir: "C:\\Imported" }))
      .rejects.toThrow("rollback snapshot unreadable");

    expect(controller.getSettings().outputDir).toBe("C:\\Current");
    expect(bootStorage.barrierAcquisitions).toBe(1);
    expect(bootStorage.barrierReleases).toEqual([true]);
  });

  it("does not reconfigure logs or runtime settings before settings persistence succeeds", async () => {
    const currentSettings = { ...defaultSettings(), outputDir: "C:\\Current", logStorageLocation: "appdata" as const };
    const controller = createController(currentSettings) as any;
    controller.logDirectory = "C:\\CurrentLogs";
    controller.reconfigureLogStorage = vi.fn(() => {
      controller.logDirectory = "C:\\ChangedLogs";
      return true;
    });
    saveSettings(controller.storagePaths, currentSettings);
    bootStorage.settingsSaveError = new Error("settings-only locked");

    await expect(controller.applySettingsOnlyBackup({ ...currentSettings, outputDir: "C:\\Imported", logStorageLocation: "desktop" })).rejects.toThrow("settings-only locked");

    expect(controller.getSettings().outputDir).toBe("C:\\Current");
    expect(controller.logDirectory).toBe("C:\\CurrentLogs");
    expect(controller.reconfigureLogStorage).not.toHaveBeenCalled();
    expect(controller.manager.setSettings).not.toHaveBeenCalled();
    expect(loadSettings(controller.storagePaths).outputDir).toBe("C:\\Current");
  });

  it("rolls back settings when remote diagnostics persistence fails", async () => {
    const currentSettings = { ...defaultSettings(), outputDir: "C:\\Current" };
    const controller = createController(currentSettings) as any;
    saveSettings(controller.storagePaths, currentSettings);
    fs.writeFileSync(path.join(controller.storagePaths.baseDir, "debug_allowlist.txt"), "192.0.2.1\n", "utf8");
    debugStorage.configError = new Error("remote settings-only locked");

    await expect(controller.applySettingsOnlyBackup(
      { ...currentSettings, outputDir: "C:\\Imported" },
      { allowlist: ["198.51.100.8"] },
      true
    )).rejects.toThrow("remote settings-only locked");

    expect(controller.getSettings().outputDir).toBe("C:\\Current");
    expect(controller.manager.setSettings).not.toHaveBeenCalled();
    expect(loadSettings(controller.storagePaths).outputDir).toBe("C:\\Current");
    expect(fs.readFileSync(path.join(controller.storagePaths.baseDir, "debug_allowlist.txt"), "utf8")).toBe("192.0.2.1\n");
  });

  it("rejects and rolls back a settings-only import when the restored debug server cannot start", async () => {
    const currentSettings = { ...defaultSettings(), outputDir: "C:\\Current" };
    const importedSettings = { ...currentSettings, outputDir: "C:\\Imported" };
    const controller = createController(currentSettings) as any;
    controller.persistRemoteDiagnosticsFromBackup = vi.fn(() => ({
      host: "0.0.0.0",
      port: 9876,
      allowlist: ["198.51.100.8"]
    }));
    saveSettings(controller.storagePaths, currentSettings);
    debugStorage.restartErrors = [new Error("imported debug server failed")];

    await expect(controller.applySettingsOnlyBackup(
      importedSettings,
      { allowlist: ["198.51.100.8"] },
      true
    )).rejects.toThrow("imported debug server failed");

    expect(controller.getSettings().outputDir).toBe("C:\\Current");
    expect(loadSettings(controller.storagePaths).outputDir).toBe("C:\\Current");
    expect(controller.manager.setSettings).not.toHaveBeenCalled();
    expect(debugStorage.restartCalls).toBe(2);
    expect(controller.audit).not.toHaveBeenCalled();
    expect(bootStorage.barrierAcquisitions).toBe(1);
    expect(bootStorage.barrierReleases).toEqual([true]);
  });
});

describe("AppController history failure isolation", () => {
  it("does not abort package finalization when primary and backup history are unreadable", () => {
    const controller = createController({ ...defaultSettings(), historyRetentionMode: "permanent" }) as any;
    fs.writeFileSync(controller.storagePaths.historyFile, "{broken", "utf8");
    fs.writeFileSync(`${controller.storagePaths.historyFile}.bak`, "{also-broken", "utf8");

    expect(() => controller.recordHistoryEntry({ id: "history-failure", name: "Paket" } as never)).not.toThrow();
  });
});

describe("AppController history retention lifecycle", () => {
  function prepareBoot(retentionMode: "permanent" | "session"): void {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-controller-history-lifecycle-"));
    tempDirs.push(root);
    appState.userDataDir = root;
    bootStorage.settings = { ...defaultSettings(), historyRetentionMode: retentionMode } satisfies AppSettings;
    bootStorage.loadResult = { session: emptySession(), status: "ok", wasRunning: false };
  }

  it("logs and tolerates retention cleanup failures during startup", () => {
    prepareBoot("session");
    bootStorage.historyResetError = Object.assign(new Error("startup history busy"), { code: "EBUSY" });
    const warning = vi.spyOn(logger, "warn").mockImplementation(() => {});
    let controller: AppController | null = null;

    expect(() => { controller = new AppController(); }).not.toThrow();

    expect(warning).toHaveBeenCalledWith(expect.stringContaining("startup history busy"));
    if (controller) liveControllers.push(controller);
  });

  it("logs and tolerates retention cleanup failures during shutdown", async () => {
    prepareBoot("permanent");
    const controller = new AppController();
    (controller as any).settings.historyRetentionMode = "session";
    bootStorage.historyClearError = Object.assign(new Error("shutdown history busy"), { code: "EBUSY" });
    const warning = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await expect(controller.shutdown()).resolves.toBeUndefined();

    expect(warning).toHaveBeenCalledWith(expect.stringContaining("shutdown history busy"));
  });
});

describe("AppController history retention updates", () => {
  it("keeps the previous controller state when retention cleanup fails", () => {
    const controller = createController({ ...defaultSettings(), historyRetentionMode: "permanent" });
    bootStorage.historyResetError = Object.assign(new Error("retention history busy"), { code: "EBUSY" });

    expect(() => controller.updateSettings({ historyRetentionMode: "session" })).toThrow("retention history busy");

    expect(controller.getSettings().historyRetentionMode).toBe("permanent");
    expect((controller as any).manager.setSettings).not.toHaveBeenCalled();
  });

  it("restores history when settings persistence fails after retention cleanup", () => {
    const controller = createController({ ...defaultSettings(), historyRetentionMode: "permanent" });
    saveHistory((controller as any).storagePaths, [{ id: "kept", name: "Behalten" } as never]);
    bootStorage.settingsSaveError = new Error("settings history locked");

    expect(() => controller.updateSettings({ historyRetentionMode: "session" })).toThrow("settings history locked");

    expect(controller.getSettings().historyRetentionMode).toBe("permanent");
    expect(loadHistory((controller as any).storagePaths).map((entry) => entry.id)).toEqual(["kept"]);
  });
});

describe("AppController provider quota reset statistics", () => {
  it("persists quota settings before rebasing statistics and applying runtime settings", () => {
    const settings = {
      ...defaultSettings(),
      providerDailyUsageBytes: { realdebrid: 1_024 }
    };
    const controller = createController(settings) as any;
    controller.manager = {
      getSettings: vi.fn(() => settings),
      rebaseStatisticsProviderDailyUsage: vi.fn(),
      setSettings: vi.fn()
    };

    const result = controller.resetProviderDailyUsage("realdebrid");

    expect(result.providerDailyUsageBytes.realdebrid ?? 0).toBe(0);
    expect(controller.manager.rebaseStatisticsProviderDailyUsage).toHaveBeenCalledWith("realdebrid", 0);
    expect(controller.manager.rebaseStatisticsProviderDailyUsage.mock.invocationCallOrder[0])
      .toBeLessThan(controller.manager.setSettings.mock.invocationCallOrder[0]);
  });

  it("rolls back quota settings when statistics rebasing cannot be persisted", () => {
    const settings = {
      ...defaultSettings(),
      providerDailyUsageBytes: { realdebrid: 1_024 }
    };
    const controller = createController(settings) as any;
    controller.manager = {
      getSettings: vi.fn(() => settings),
      rebaseStatisticsProviderDailyUsage: vi.fn(() => { throw new Error("rebase ledger locked"); }),
      setSettings: vi.fn()
    };
    saveSettings(controller.storagePaths, settings);

    expect(() => controller.resetProviderDailyUsage("realdebrid")).toThrow("rebase ledger locked");

    expect(controller.getSettings().providerDailyUsageBytes.realdebrid).toBe(1_024);
    expect(controller.manager.setSettings).not.toHaveBeenCalled();
    expect(loadSettings(controller.storagePaths).providerDailyUsageBytes.realdebrid).toBe(1_024);
  });
});

describe("AppController daily start settings", () => {
  it("does not clear a legacy one-time schedule for an unprepared daily settings patch", () => {
    configureCredentialProtector({
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(value, "utf8"),
      decryptString: (value) => Buffer.from(value).toString("utf8")
    });
    const scheduledStartEpochMs = 1_800_000_000_000;
    const controller = createController({
      ...defaultSettings(),
      scheduledStartEpochMs
    });

    const updated = controller.updateSettings({
      dailyStartEnabled: true,
      dailyStartMinuteOfDay: 18 * 60 + 45,
      dailyStartFirstLocalDate: "2026-08-23"
    });

    expect(updated.scheduledStartEpochMs).toBe(scheduledStartEpochMs);
  });

  it("clears a legacy one-time schedule when an explicit daily rule is saved", () => {
    configureCredentialProtector({
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(value, "utf8"),
      decryptString: (value) => Buffer.from(value).toString("utf8")
    });
    const controller = createController({
      ...defaultSettings(),
      scheduledStartEpochMs: 1_800_000_000_000
    });

    const updated = controller.updateSettings(prepareDailyStartSettingsPatch({
      dailyStartEnabled: true,
      dailyStartMinuteOfDay: 18 * 60 + 45,
      dailyStartFirstLocalDate: "2026-08-23"
    }, controller.getSettings()));

    expect(updated.scheduledStartEpochMs).toBe(0);
    expect(updated).toMatchObject({
      dailyStartEnabled: true,
      dailyStartMinuteOfDay: 18 * 60 + 45,
      dailyStartFirstLocalDate: "2026-08-23"
    });
  });

  it("preserves a legacy one-time schedule when an account mutation saves a complete settings state", async () => {
    configureCredentialProtector({
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(value, "utf8"),
      decryptString: (value) => Buffer.from(value).toString("utf8")
    });
    const scheduledStartEpochMs = 1_800_000_000_000;
    const controller = createController({
      ...defaultSettings(),
      ddownloadLogin: "account@example.test",
      ddownloadPassword: "secret",
      scheduledStartEpochMs
    });

    await controller.executeAccountCommand({
      action: "delete",
      kind: "ddownload-login",
      accountId: "svc-ddownload"
    });

    expect(controller.getSettings().scheduledStartEpochMs).toBe(scheduledStartEpochMs);
  });

  it("preserves a legacy one-time schedule when a complete unchanged settings payload is prepared", () => {
    configureCredentialProtector({
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(value, "utf8"),
      decryptString: (value) => Buffer.from(value).toString("utf8")
    });
    const scheduledStartEpochMs = 1_800_000_000_000;
    const controller = createController({
      ...defaultSettings(),
      dailyStartEnabled: false,
      dailyStartMinuteOfDay: 18 * 60 + 45,
      dailyStartFirstLocalDate: "2026-08-23",
      scheduledStartEpochMs
    });
    const current = controller.getSettings();

    const updated = controller.updateSettings(prepareDailyStartSettingsPatch({ ...current }, current));

    expect(updated.scheduledStartEpochMs).toBe(scheduledStartEpochMs);
  });
});

describe("AppController boot auto-resume", () => {
  it.each([
    { wasRunning: false, expectedAutoResume: false },
    { wasRunning: true, expectedAutoResume: true }
  ])("uses persisted running evidence when a daily start is still in the future", async ({ wasRunning, expectedAutoResume }) => {
    configureCredentialProtector({
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(value, "utf8"),
      decryptString: (value) => Buffer.from(value).toString("utf8")
    });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-controller-boot-"));
    tempDirs.push(root);
    appState.userDataDir = root;
    bootStorage.settings = {
      ...defaultSettings(),
      token: "token",
      autoResumeOnStart: true,
      dailyStartEnabled: true,
      dailyStartMinuteOfDay: 0,
      dailyStartFirstLocalDate: tomorrowLocalDate()
    } satisfies AppSettings;
    bootStorage.loadResult = {
      session: queuedSession(),
      status: "ok",
      wasRunning
    };
    const controller = new AppController();
    liveControllers.push(controller);
    const beginAutoResume = vi.spyOn(controller as any, "beginAutoResume").mockImplementation(() => {});

    controller.onState = vi.fn();

    expect(beginAutoResume).toHaveBeenCalledTimes(expectedAutoResume ? 1 : 0);
  });
});
