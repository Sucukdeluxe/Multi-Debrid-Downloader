import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/main/constants";
import { AppController } from "../src/main/app-controller";
import { createStoragePaths, loadHistory, loadSettings, saveHistory, saveSettings } from "../src/main/storage";

const electronState = vi.hoisted(() => ({ userDataDir: "" }));

vi.mock("electron", () => ({
  app: {
    getPath: () => electronState.userDataDir
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

const tempDirs: string[] = [];

function createHistoryEntry(outputDir: string) {
  return {
    id: "history-locked",
    name: "locked",
    totalBytes: 1,
    downloadedBytes: 1,
    fileCount: 1,
    provider: "realdebrid" as const,
    completedAt: 100,
    durationSeconds: 1,
    status: "completed" as const,
    outputDir,
    urls: []
  };
}

function failHistoryDeletion(historyFile: string) {
  const originalUnlink = fs.unlinkSync;
  return vi.spyOn(fs, "unlinkSync").mockImplementation((target) => {
    if (target === historyFile) {
      const error = new Error("EPERM: history file is locked") as NodeJS.ErrnoException;
      error.code = "EPERM";
      throw error;
    }
    return originalUnlink(target);
  });
}

beforeEach(() => {
  electronState.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-controller-history-"));
  tempDirs.push(electronState.userDataDir);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("AppController history retention", () => {
  it("remains startable when session-history cleanup returns EPERM", () => {
    const paths = createStoragePaths(path.join(electronState.userDataDir, "runtime"));
    saveSettings(paths, { ...defaultSettings(), historyRetentionMode: "session" });
    saveHistory(paths, [createHistoryEntry(path.join(electronState.userDataDir, "out"))]);
    const unlinkSpy = failHistoryDeletion(paths.historyFile);

    let controller!: AppController;
    expect(() => {
      controller = new AppController();
    }).not.toThrow();
    expect(loadHistory(paths)).toHaveLength(1);

    unlinkSpy.mockRestore();
    controller.shutdown();
  });

  it("rolls back a retention update when history deletion fails", () => {
    const paths = createStoragePaths(path.join(electronState.userDataDir, "runtime"));
    saveSettings(paths, { ...defaultSettings(), historyRetentionMode: "permanent" });
    saveHistory(paths, [createHistoryEntry(path.join(electronState.userDataDir, "out"))]);
    const controller = new AppController();
    const unlinkSpy = failHistoryDeletion(paths.historyFile);

    const result = controller.updateSettings({ historyRetentionMode: "session" });

    expect(result.historyRetentionMode).toBe("permanent");
    expect(controller.getSettings().historyRetentionMode).toBe("permanent");
    expect(loadSettings(paths).historyRetentionMode).toBe("permanent");
    expect(loadHistory(paths)).toHaveLength(1);

    unlinkSpy.mockRestore();
    controller.shutdown();
  });

  it("keeps manual history deletion failures visible without auditing false success", () => {
    const paths = createStoragePaths(path.join(electronState.userDataDir, "runtime"));
    saveSettings(paths, { ...defaultSettings(), historyRetentionMode: "permanent" });
    saveHistory(paths, [createHistoryEntry(path.join(electronState.userDataDir, "out"))]);
    const controller = new AppController();
    const audit = vi.fn();
    (controller as unknown as { audit: typeof audit }).audit = audit;
    const unlinkSpy = failHistoryDeletion(paths.historyFile);

    expect(() => controller.clearHistory()).toThrow(/EPERM/);
    expect(loadHistory(paths)).toHaveLength(1);
    expect(audit.mock.calls.map((call) => call[1])).toEqual(["Verlauf konnte nicht geleert werden"]);

    unlinkSpy.mockRestore();
    controller.shutdown();
  });
});
