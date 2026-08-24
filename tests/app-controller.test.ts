import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppController } from "../src/main/app-controller";
import { defaultSettings } from "../src/main/constants";
import { configureCredentialProtector } from "../src/main/credential-protection";
import { prepareDailyStartSettingsPatch } from "../src/main/daily-start-scheduler";
import { createStoragePaths, emptySession } from "../src/main/storage";
import type { AppSettings, SessionState } from "../src/shared/types";

const appState = vi.hoisted(() => ({ userDataDir: "C:\\MDD\\Test" }));
const bootStorage = vi.hoisted(() => ({
  settings: null as unknown,
  loadResult: null as unknown
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
    stopDebugServer: vi.fn()
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
      : actual.loadSessionWithStatus(...args)
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
  controller.manager = { setSettings: vi.fn() };
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
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
