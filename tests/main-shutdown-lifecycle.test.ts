import { describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  return {
    handlers,
    app: {
      isPackaged: false,
      getPath: vi.fn(() => "C:\\MDD\\Test"),
      getAppPath: vi.fn(() => "C:\\MDD\\App"),
      requestSingleInstanceLock: vi.fn(() => true),
      on: vi.fn((name: string, handler: (...args: unknown[]) => void) => { handlers.set(name, handler); }),
      whenReady: vi.fn(() => new Promise<void>(() => {})),
      quit: vi.fn(),
      exit: vi.fn(),
      setPath: vi.fn()
    }
  };
});

vi.mock("electron", () => ({
  app: electron.app,
  BrowserWindow: class {
    public static getAllWindows(): unknown[] { return []; }
  },
  clipboard: {},
  dialog: {},
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: vi.fn(), decryptString: vi.fn() },
  shell: { openExternal: vi.fn() },
  Tray: class {}
}));

import { AppController } from "../src/main/app-controller";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("main shutdown lifecycle", () => {
  it("AppController waits for the bounded outbox drain before disposing runtime owners", async () => {
    const drain = deferred();
    const manager = { prepareForShutdown: vi.fn() };
    const controller = Object.create(AppController.prototype) as any;
    controller.runtimeStatsTimer = null;
    controller.notificationOutbox = { drainForShutdown: vi.fn(() => drain.promise) };
    controller.manager = manager;
    controller.megaWebFallback = { dispose: vi.fn() };
    controller.realDebridWebFallbacks = new Map();
    controller.pendingRealDebridWebAccountIds = new Map();
    controller.allDebridWebFallback = { dispose: vi.fn() };
    controller.bestDebridWebFallback = { dispose: vi.fn() };
    controller.shutdownLogStorage = vi.fn();
    controller.audit = vi.fn();
    controller.settings = { historyRetentionMode: "never" };

    const shutdown = controller.shutdown();

    expect(shutdown).toBeInstanceOf(Promise);
    expect(controller.notificationOutbox.drainForShutdown).toHaveBeenCalledWith(3000);
    expect(manager.prepareForShutdown).not.toHaveBeenCalled();
    drain.resolve();
    await shutdown;
    expect(manager.prepareForShutdown).toHaveBeenCalledTimes(1);
  });

  it("prevents quit once, waits for shutdown, then allows exactly one loop-free quit", async () => {
    const main = await import("../src/main/main");
    const shutdown = deferred();
    const cleanup = vi.fn();
    const continueQuit = vi.fn();
    const onError = vi.fn();
    const handler = main.createBeforeQuitHandler({
      cleanup,
      shutdown: vi.fn(() => shutdown.promise),
      continueQuit,
      onError
    });
    const first = { preventDefault: vi.fn() };
    const repeated = { preventDefault: vi.fn() };
    const resumed = { preventDefault: vi.fn() };

    handler(first);
    handler(repeated);
    expect(first.preventDefault).toHaveBeenCalledTimes(1);
    expect(repeated.preventDefault).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(continueQuit).not.toHaveBeenCalled();

    shutdown.resolve();
    await vi.waitFor(() => expect(continueQuit).toHaveBeenCalledTimes(1));
    handler(resumed);
    expect(resumed.preventDefault).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });
});
