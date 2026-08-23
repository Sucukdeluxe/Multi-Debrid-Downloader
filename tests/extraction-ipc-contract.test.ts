import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import { IPC_CHANNELS } from "../src/shared/ipc";
import type { ElectronApi } from "../src/shared/preload-api";

const electron = vi.hoisted(() => ({
  api: undefined as ElectronApi | undefined,
  ipcHandlers: new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>(),
  invoke: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
  appHandlers: new Map<string, (...args: unknown[]) => void>(),
  app: {
    isPackaged: false,
    getPath: vi.fn(() => "C:\\MDD\\Test"),
    getAppPath: vi.fn(() => "C:\\MDD\\App"),
    requestSingleInstanceLock: vi.fn(() => true),
    on: vi.fn((name: string, handler: (...args: unknown[]) => void) => {
      electron.appHandlers.set(name, handler);
    }),
    whenReady: vi.fn(() => new Promise<void>(() => {})),
    quit: vi.fn(),
    exit: vi.fn(),
    setPath: vi.fn()
  }
}));

vi.mock("electron", () => ({
  app: electron.app,
  BrowserWindow: class {
    public static getAllWindows(): unknown[] { return []; }
  },
  clipboard: { readText: vi.fn(() => ""), writeText: vi.fn() },
  contextBridge: {
    exposeInMainWorld: (_name: string, api: ElectronApi) => {
      electron.api = api;
    }
  },
  dialog: {},
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
      electron.ipcHandlers.set(channel, handler);
    }),
    on: vi.fn()
  },
  ipcRenderer: {
    invoke: electron.invoke,
    on: vi.fn(),
    removeListener: vi.fn(),
    send: vi.fn()
  },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
  nativeTheme: { themeSource: "system" },
  powerMonitor: { on: vi.fn(), removeListener: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: vi.fn(), decryptString: vi.fn() },
  shell: {},
  Tray: class {}
}));

import { AppController } from "../src/main/app-controller";
import { registerExtractionIpcHandlers } from "../src/main/extraction-ipc";

function trustedEvent(): IpcMainInvokeEvent {
  return {} as IpcMainInvokeEvent;
}

function registerHandlers(target: Parameters<typeof registerExtractionIpcHandlers>[1]): void {
  registerExtractionIpcHandlers((channel, handler) => {
    electron.ipcHandlers.set(channel, handler);
  }, target);
}

function createController(manager: {
  retryExtraction: (packageId: string) => Promise<void>;
  extractNow: (request: { packageIds: string[]; itemIds: string[] }) => Promise<void>;
}): AppController {
  const controller = Object.create(AppController.prototype) as {
    manager: typeof manager;
    audit: ReturnType<typeof vi.fn>;
  };
  controller.manager = manager;
  controller.audit = vi.fn();
  return controller as unknown as AppController;
}

describe("manual extraction error propagation", () => {
  beforeAll(async () => {
    await import("../src/preload/preload");
  });

  beforeEach(() => {
    electron.ipcHandlers.clear();
    electron.invoke.mockReset();
  });

  it.each([
    ["stale", "Paket existiert nicht mehr"],
    ["deleted", "Ausgewählte Datei wurde gelöscht"],
    ["non-extractable", "Kein vollständiger entpackbarer Archivsatz ausgewählt"]
  ])("keeps a %s manager rejection intact through AppController", async (_caseName, message) => {
    const controller = createController({
      retryExtraction: vi.fn(async () => { throw new Error(message); }),
      extractNow: vi.fn(async () => { throw new Error(message); })
    });

    await expect(controller.retryExtraction("package-id")).rejects.toThrow(message);
    await expect(controller.extractNow({ packageIds: [], itemIds: ["item-id"] })).rejects.toThrow(message);
  });

  it("rejects an empty extract-now request at the trusted main-process IPC boundary", async () => {
    const controller = {
      retryExtraction: vi.fn(async () => undefined),
      extractNow: vi.fn(async () => undefined)
    };
    registerHandlers(controller);
    const handler = electron.ipcHandlers.get(IPC_CHANNELS.EXTRACT_NOW);

    await expect(Promise.resolve().then(() => handler?.(trustedEvent(), { packageIds: [], itemIds: [] })))
      .rejects.toThrow("extractNow benötigt mindestens ein Ziel");
    expect(controller.extractNow).not.toHaveBeenCalled();
  });

  it.each([
    ["", "packageId muss ein nicht-leerer String sein"],
    ["   ", "packageId muss ein nicht-leerer String sein"],
    ["p".repeat(257), "packageId darf höchstens 256 Zeichen lang sein"]
  ])("rejects an invalid retry package ID before calling the controller", async (packageId, message) => {
    const controller = {
      retryExtraction: vi.fn(async () => undefined),
      extractNow: vi.fn(async () => undefined)
    };
    registerHandlers(controller);
    const handler = electron.ipcHandlers.get(IPC_CHANNELS.RETRY_EXTRACTION);

    await expect(Promise.resolve().then(() => handler?.(trustedEvent(), packageId))).rejects.toThrow(message);
    expect(controller.retryExtraction).not.toHaveBeenCalled();
  });

  it.each([
    [IPC_CHANNELS.RETRY_EXTRACTION, "Paket existiert nicht mehr", ["stale-package"]],
    [IPC_CHANNELS.EXTRACT_NOW, "Ausgewählte Datei wurde gelöscht", [{ packageIds: [], itemIds: ["deleted-item"] }]],
    [IPC_CHANNELS.EXTRACT_NOW, "Kein vollständiger entpackbarer Archivsatz ausgewählt", [{ packageIds: [], itemIds: ["plain-file"] }]]
  ])("returns the controller rejection from %s to ipcRenderer.invoke", async (channel, message, args) => {
    const controller = {
      retryExtraction: vi.fn(async () => { throw new Error(message); }),
      extractNow: vi.fn(async () => { throw new Error(message); })
    };
    registerHandlers(controller);
    const handler = electron.ipcHandlers.get(channel);

    await expect(Promise.resolve(handler?.(trustedEvent(), ...args))).rejects.toThrow(message);
  });

  it("exposes main-process extraction rejections unchanged to the renderer API", async () => {
    electron.invoke
      .mockRejectedValueOnce(new Error("Paket existiert nicht mehr"))
      .mockRejectedValueOnce(new Error("Kein vollständiger entpackbarer Archivsatz ausgewählt"));

    await expect(electron.api?.retryExtraction("stale-package")).rejects.toThrow("Paket existiert nicht mehr");
    await expect(electron.api?.extractNow({ packageIds: [], itemIds: ["plain-file"] }))
      .rejects.toThrow("Kein vollständiger entpackbarer Archivsatz ausgewählt");
  });
});
