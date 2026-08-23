import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppController } from "../src/main/app-controller";
import { defaultSettings } from "../src/main/constants";
import { configureCredentialProtector } from "../src/main/credential-protection";
import { prepareDailyStartSettingsPatch } from "../src/main/daily-start-scheduler";
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
  controller.manager = { setSettings: vi.fn(), applyDebridAccountStatuses: vi.fn() };
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

    const updated = controller.updateSettings(prepareDailyStartSettingsPatch({
      dailyStartEnabled: true,
      dailyStartMinuteOfDay: 18 * 60 + 45,
      dailyStartFirstLocalDate: "2026-08-23"
    }));

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
});

describe("AppController AllDebrid account checks", () => {
  it("routes a stored AllDebrid API account through the AllDebrid user endpoint and persists its status", async () => {
    const controller = createController({
      ...defaultSettings(),
      allDebridToken: "fixture-all-api-key"
    }) as any;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      status: "success",
      data: {
        user: {
          username: "all-user",
          email: "all@example.test",
          isPremium: true,
          premiumUntil: "1800000000"
        }
      }
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const status = await controller.checkAccountCredentials({
      kind: "alldebrid-api",
      accountId: "svc-alldebrid"
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.alldebrid.com/v4/user");
    expect(status).toMatchObject({
      accountId: "svc-alldebrid",
      provider: "alldebrid",
      valid: true,
      isPremium: true,
      username: "all-user",
      email: "all@example.test"
    });
    expect(controller.manager.applyDebridAccountStatuses).toHaveBeenCalledWith([status]);
  });

  it("stores a PIN-issued API key, enables AllDebrid and applies the checked account status", async () => {
    configureCredentialProtector({
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(value, "utf8"),
      decryptString: (value) => Buffer.from(value).toString("utf8")
    });
    const controller = createController({
      ...defaultSettings(),
      allDebridToken: "",
      allDebridUseWebLogin: false,
      disabledProviders: ["alldebrid"]
    }) as any;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      status: "success",
      data: {
        user: {
          username: "pin-user",
          email: "pin@example.test",
          isPremium: true,
          premiumUntil: "1800000000"
        }
      }
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await controller.completeAllDebridLogin("fixture-pin-api-key");

    expect(controller.getSettings()).toMatchObject({
      allDebridToken: "fixture-pin-api-key",
      allDebridUseWebLogin: true
    });
    expect(controller.getSettings().disabledProviders).not.toContain("alldebrid");
    expect(controller.manager.applyDebridAccountStatuses).toHaveBeenCalledWith([
      expect.objectContaining({
        accountId: "svc-alldebrid",
        provider: "alldebrid",
        valid: true,
        username: "pin-user"
      })
    ]);
  });
});
