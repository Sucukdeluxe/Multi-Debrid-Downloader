import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppController } from "../src/main/app-controller";
import { defaultSettings } from "../src/main/constants";
import { configureCredentialProtector } from "../src/main/credential-protection";
import { createStoragePaths } from "../src/main/storage";
import type { AppSettings } from "../src/shared/types";

vi.mock("electron", () => ({
  app: { getPath: () => "C:\\MDD\\Test" },
  BrowserWindow: class {},
  clipboard: {},
  dialog: {},
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: vi.fn(), decryptString: vi.fn() },
  shell: {},
  Tray: class {}
}));

const tempDirs: string[] = [];

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

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("AppController daily start settings", () => {
  it("clears a legacy one-time schedule when a new daily rule is saved", () => {
    configureCredentialProtector({
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(value, "utf8"),
      decryptString: (value) => Buffer.from(value).toString("utf8")
    });
    const controller = createController({
      ...defaultSettings(),
      scheduledStartEpochMs: 1_800_000_000_000
    });

    const updated = controller.updateSettings({
      dailyStartEnabled: true,
      dailyStartMinuteOfDay: 18 * 60 + 45,
      dailyStartFirstLocalDate: "2026-08-23"
    });

    expect(updated.scheduledStartEpochMs).toBe(0);
    expect(updated).toMatchObject({
      dailyStartEnabled: true,
      dailyStartMinuteOfDay: 18 * 60 + 45,
      dailyStartFirstLocalDate: "2026-08-23"
    });
  });
});
