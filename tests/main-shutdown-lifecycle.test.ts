import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const powerMonitor = { on: vi.fn(), removeListener: vi.fn() };
  return {
    handlers,
    powerMonitor,
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
  nativeTheme: { themeSource: "system" },
  powerMonitor: electron.powerMonitor,
  safeStorage: { isEncryptionAvailable: () => false, encryptString: vi.fn(), decryptString: vi.fn() },
  shell: { openExternal: vi.fn() },
  Tray: class {}
}));

import { AppController } from "../src/main/app-controller";
import {
  DownloadHealthMonitor,
  createDownloadHealthState,
  loadDownloadHealthState,
  saveDownloadHealthState,
  type DownloadHealthSnapshot
} from "../src/main/download-health-monitor";
import { NotificationOutbox, type NotificationEvent } from "../src/main/notification-outbox";
import { logger } from "../src/main/logger";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function shutdownEvent(id: string, priority: "success" | "error" = "success"): NotificationEvent {
  return {
    id,
    type: "package_completed",
    priority,
    createdAt: Date.now(),
    expiresAt: Date.now() + 6 * 60 * 60 * 1000,
    attempts: 0,
    nextAttemptAt: Date.now(),
    payload: { title: "Paket-Digest", fields: [] }
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("main shutdown lifecycle", () => {
  it("returns a validated collector snapshot through synchronous IPC", async () => {
    const main = await import("../src/main/main");
    const state = { packages: [], collapsedPackageIds: [] };
    const event = { returnValue: null as unknown };

    main.getCollectorStateFromSyncIpc({ getCollectorState: () => state }, event);

    expect(event.returnValue).toEqual(state);
    expect(event.returnValue).not.toBe(state);
  });

  it("returns null instead of a malformed synchronous collector snapshot", async () => {
    const main = await import("../src/main/main");
    const warning = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const event = { returnValue: { packages: [], collapsedPackageIds: [] } as unknown };
    try {
      main.getCollectorStateFromSyncIpc({
        getCollectorState: () => ({ packages: "invalid", collapsedPackageIds: [] }) as never
      }, event);

      expect(event.returnValue).toBeNull();
      expect(warning).toHaveBeenCalledWith(expect.stringContaining("Synchrones Laden"));
    } finally {
      warning.mockRestore();
    }
  });

  it("returns success only after the synchronous collector save completes", async () => {
    const main = await import("../src/main/main");
    const state = { packages: [], collapsedPackageIds: [] };
    const saveCollectorStateSync = vi.fn(() => state);
    const event = { returnValue: false };

    main.saveCollectorStateFromSyncIpc({ saveCollectorStateSync }, event, state);

    expect(saveCollectorStateSync).toHaveBeenCalledWith(state);
    expect(event.returnValue).toBe(true);
  });

  it("returns false and logs a synchronous collector write failure", async () => {
    const main = await import("../src/main/main");
    const warning = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const event = { returnValue: true };
    try {
      expect(() => main.saveCollectorStateFromSyncIpc({
        saveCollectorStateSync: () => { throw new Error("collector locked"); }
      }, event, { packages: [], collapsedPackageIds: [] })).not.toThrow();

      expect(event.returnValue).toBe(false);
      expect(warning).toHaveBeenCalledWith(expect.stringContaining("collector locked"));
    } finally {
      warning.mockRestore();
    }
  });

  it("continues the full shutdown when the collector state cannot be flushed", async () => {
    const controller = Object.create(AppController.prototype) as any;
    controller.runtimeStatsTimer = null;
    controller.collectorStore = { flushSync: vi.fn(() => { throw new Error("collector locked"); }) };
    controller.notificationOutbox = { drainForShutdown: vi.fn(async () => undefined) };
    controller.manager = {
      suspendDownloadHealthMonitoring: vi.fn(),
      prepareForShutdown: vi.fn(),
      flushNotificationsForShutdown: vi.fn(async () => undefined)
    };
    controller.downloadHealthTimer = null;
    controller.downloadHealthEvaluation = null;
    controller.downloadHealthMonitor = null;
    controller.megaWebFallback = { dispose: vi.fn() };
    controller.realDebridWebFallbacks = new Map();
    controller.pendingRealDebridWebAccountIds = new Map();
    controller.allDebridWebFallback = { dispose: vi.fn() };
    controller.bestDebridWebFallback = { dispose: vi.fn() };
    controller.shutdownLogStorage = vi.fn();
    controller.audit = vi.fn();
    controller.settings = { historyRetentionMode: "never" };

    await expect(controller.shutdown()).resolves.toBeUndefined();
    expect(controller.manager.prepareForShutdown).toHaveBeenCalledTimes(1);
    expect(controller.shutdownLogStorage).toHaveBeenCalledTimes(1);
  });

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
    const drainBudget = controller.notificationOutbox.drainForShutdown.mock.calls[0][0];
    expect(drainBudget).toBeGreaterThan(0);
    expect(drainBudget).toBeLessThanOrEqual(3000);
    expect(manager.prepareForShutdown).toHaveBeenCalledTimes(1);
    drain.resolve();
    await shutdown;
  });

  it("uses one three-second deadline even when a running health evaluation never settles", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const runningEvaluation = deferred();
    const controller = Object.create(AppController.prototype) as any;
    controller.downloadHealthTimer = setInterval(() => {}, 60_000);
    controller.downloadHealthEvaluation = runningEvaluation.promise;
    controller.downloadHealthMonitor = null;
    controller.runtimeStatsTimer = null;
    controller.notificationOutbox = { drainForShutdown: vi.fn(async () => undefined) };
    controller.manager = {
      suspendDownloadHealthMonitoring: vi.fn(),
      prepareForShutdown: vi.fn(),
      flushNotificationsForShutdown: vi.fn(async () => undefined)
    };
    controller.megaWebFallback = { dispose: vi.fn() };
    controller.realDebridWebFallbacks = new Map();
    controller.pendingRealDebridWebAccountIds = new Map();
    controller.allDebridWebFallback = { dispose: vi.fn() };
    controller.bestDebridWebFallback = { dispose: vi.fn() };
    controller.shutdownLogStorage = vi.fn();
    controller.audit = vi.fn();
    controller.settings = { historyRetentionMode: "never" };
    let completed = false;

    const shutdown = controller.shutdown().then(() => { completed = true; });
    await vi.advanceTimersByTimeAsync(2999);
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const completedAtDeadline = completed;
    runningEvaluation.resolve();
    await vi.runAllTimersAsync();
    await shutdown;

    expect(completedAtDeadline).toBe(true);
    expect(controller.manager.prepareForShutdown).toHaveBeenCalledTimes(1);
  });

  it("persists a digest completed inside the shared shutdown window while an earlier send is blocked", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-shutdown-outbox-"));
    const filePath = path.join(root, "outbox.json");
    let releaseSend = (_sent: boolean) => {};
    let markSendStarted = () => {};
    const sendStarted = new Promise<void>((resolve) => { markSendStarted = resolve; });
    const blockedSend = new Promise<boolean>((resolve) => { releaseSend = resolve; });
    const lateEnqueued = deferred();
    const outbox = new NotificationOutbox({
      filePath,
      now: Date.now,
      send: async (event) => {
        if (event.id === "already-sending") {
          markSendStarted();
          return blockedSend;
        }
        return true;
      }
    });
    await outbox.enqueue(shutdownEvent("already-sending", "error"));
    const activeDrain = outbox.drain();
    await sendStarted;
    const controller = Object.create(AppController.prototype) as any;
    controller.downloadHealthTimer = null;
    controller.downloadHealthEvaluation = null;
    controller.downloadHealthMonitor = null;
    controller.runtimeStatsTimer = null;
    controller.notificationOutbox = outbox;
    controller.manager = {
      suspendDownloadHealthMonitoring: vi.fn(),
      prepareForShutdown: vi.fn(),
      flushNotificationsForShutdown: vi.fn(() => new Promise<void>((resolve) => {
        setTimeout(() => {
          void outbox.enqueue(shutdownEvent("late-digest")).then(() => {
            lateEnqueued.resolve();
            resolve();
          });
        }, 500);
      }))
    };
    controller.megaWebFallback = { dispose: vi.fn() };
    controller.realDebridWebFallbacks = new Map();
    controller.pendingRealDebridWebAccountIds = new Map();
    controller.allDebridWebFallback = { dispose: vi.fn() };
    controller.bestDebridWebFallback = { dispose: vi.fn() };
    controller.shutdownLogStorage = vi.fn();
    controller.audit = vi.fn();
    controller.settings = { historyRetentionMode: "never" };
    let completed = false;

    const shutdown = controller.shutdown().then(() => { completed = true; });
    await vi.advanceTimersByTimeAsync(500);
    await lateEnqueued.promise;
    const stateDuringWindow = JSON.parse(fs.readFileSync(filePath, "utf8")) as { events: NotificationEvent[] };
    await vi.advanceTimersByTimeAsync(2500);
    const completedAtDeadline = completed;
    releaseSend(true);
    await vi.runAllTimersAsync();
    await activeDrain;
    await shutdown;

    expect(stateDuringWindow.events.map((event) => event.id)).toContain("late-digest");
    expect(completedAtDeadline).toBe(true);
    expect(controller.manager.prepareForShutdown.mock.invocationCallOrder[0])
      .toBeLessThan(controller.manager.flushNotificationsForShutdown.mock.invocationCallOrder[0]);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("prevents quit once, waits for shutdown, then allows exactly one loop-free quit", async () => {
    const main = await import("../src/main/main");
    const shutdown = deferred();
    const cleanup = vi.fn();
    const continueQuit = vi.fn();
    const onError = vi.fn();
    const optionsShutdown = vi.fn(() => shutdown.promise);
    const handler = main.createBeforeQuitHandler({
      cleanup,
      shutdown: optionsShutdown,
      continueQuit,
      forceQuit: vi.fn(),
      onError,
      onTimeout: vi.fn(),
      timeoutMs: main.APP_SHUTDOWN_TIMEOUT_MS
    });
    const first = { preventDefault: vi.fn() };
    const repeated = { preventDefault: vi.fn() };
    const resumed = { preventDefault: vi.fn() };

    handler(first);
    handler(repeated);
    expect(first.preventDefault).toHaveBeenCalledTimes(1);
    expect(repeated.preventDefault).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(cleanup.mock.invocationCallOrder[0]).toBeLessThan(optionsShutdown.mock.invocationCallOrder[0]);
    expect(continueQuit).not.toHaveBeenCalled();

    shutdown.resolve();
    await vi.waitFor(() => expect(continueQuit).toHaveBeenCalledTimes(1));
    handler(resumed);
    expect(resumed.preventDefault).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("stops the daily scheduler, clears the legacy timer, and removes power listeners before controller shutdown", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    electron.powerMonitor.removeListener.mockClear();
    const main = await import("../src/main/main");
    const scheduler = { end: vi.fn() };
    const timer = setTimeout(() => {}, 60_000);
    const shutdown = vi.fn(async () => undefined);
    const continueQuit = vi.fn();
    const handler = main.createBeforeQuitHandler({
      cleanup: () => main.cleanupSchedulerLifecycle(scheduler, timer),
      shutdown,
      continueQuit,
      forceQuit: vi.fn(),
      onError: vi.fn(),
      onTimeout: vi.fn(),
      timeoutMs: main.APP_SHUTDOWN_TIMEOUT_MS
    });

    handler({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(shutdown).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(continueQuit).toHaveBeenCalledTimes(1));

    expect(scheduler.end).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(electron.powerMonitor.removeListener).toHaveBeenCalledWith("suspend", expect.any(Function));
    expect(electron.powerMonitor.removeListener).toHaveBeenCalledWith("resume", expect.any(Function));
    expect(scheduler.end.mock.invocationCallOrder[0]).toBeLessThan(shutdown.mock.invocationCallOrder[0]);
    expect(electron.powerMonitor.removeListener.mock.invocationCallOrder[1]).toBeLessThan(shutdown.mock.invocationCallOrder[0]);
  });

  it("forces process exit when shutdown never settles", async () => {
    vi.useFakeTimers();
    const main = await import("../src/main/main");
    const continueQuit = vi.fn();
    const forceQuit = vi.fn();
    const onTimeout = vi.fn();
    const handler = main.createBeforeQuitHandler({
      cleanup: vi.fn(),
      shutdown: () => new Promise<void>(() => {}),
      continueQuit,
      forceQuit,
      onError: vi.fn(),
      onTimeout,
      timeoutMs: main.APP_SHUTDOWN_TIMEOUT_MS
    });
    const first = { preventDefault: vi.fn() };
    const resumed = { preventDefault: vi.fn() };

    handler(first);
    await vi.advanceTimersByTimeAsync(main.APP_SHUTDOWN_TIMEOUT_MS - 1);
    expect(forceQuit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(forceQuit).toHaveBeenCalledTimes(1);
    expect(continueQuit).not.toHaveBeenCalled();
    handler(resumed);
    expect(resumed.preventDefault).not.toHaveBeenCalled();
  });

  it("requests a controlled quit after the main window closes while a hidden provider window remains", async () => {
    const main = await import("../src/main/main");
    const hiddenProviderWindow = { visible: false };
    const remainingWindows = [hiddenProviderWindow];
    let currentWindow: object | null = {};
    const quit = vi.fn();
    const handler = main.createMainWindowClosedHandler({
      isCurrentWindow: () => currentWindow !== null,
      clearCurrentWindow: () => { currentWindow = null; },
      isShutdownStarted: () => false,
      quit,
      platform: "win32"
    });

    handler();

    expect(remainingWindows).toEqual([hiddenProviderWindow]);
    expect(currentWindow).toBeNull();
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it("allows a normal close to reach the renderer beforeunload save", async () => {
    const main = await import("../src/main/main");
    const hide = vi.fn();
    const event = { preventDefault: vi.fn() };
    const handler = main.createMainWindowCloseHandler({
      isShutdownStarted: () => false,
      shouldMinimizeToTray: () => false,
      hide
    });

    handler(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(hide).not.toHaveBeenCalled();
  });

  it("keeps the normal minimize-to-tray close behavior", async () => {
    const main = await import("../src/main/main");
    const hide = vi.fn();
    const event = { preventDefault: vi.fn() };
    const handler = main.createMainWindowCloseHandler({
      isShutdownStarted: () => false,
      shouldMinimizeToTray: () => true,
      hide
    });

    handler(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("does not let tray handling intercept a shutdown-owned window close", async () => {
    const main = await import("../src/main/main");
    const hide = vi.fn();
    const event = { preventDefault: vi.fn() };
    const handler = main.createMainWindowCloseHandler({
      isShutdownStarted: () => true,
      shouldMinimizeToTray: () => true,
      hide
    });

    handler(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(hide).not.toHaveBeenCalled();
  });

  it("forces exit when BrowserWindows veto the confirmed quit", async () => {
    vi.useFakeTimers();
    const main = await import("../src/main/main");
    const requestQuit = vi.fn();
    const forceQuit = vi.fn();
    const onTimeout = vi.fn();
    const handler = main.createConfirmedQuitHandler({
      requestQuit,
      forceQuit,
      onQuit: vi.fn(),
      onTimeout,
      timeoutMs: main.APP_QUIT_CONFIRM_TIMEOUT_MS
    });

    handler();
    await vi.advanceTimersByTimeAsync(main.APP_QUIT_CONFIRM_TIMEOUT_MS - 1);
    expect(forceQuit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(requestQuit).toHaveBeenCalledTimes(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(forceQuit).toHaveBeenCalledTimes(1);
  });

  it("cancels the forced exit after Electron confirms quit", async () => {
    vi.useFakeTimers();
    const main = await import("../src/main/main");
    let confirmQuit = () => {};
    const forceQuit = vi.fn();
    const handler = main.createConfirmedQuitHandler({
      requestQuit: vi.fn(),
      forceQuit,
      onQuit: (listener) => { confirmQuit = listener; },
      onTimeout: vi.fn(),
      timeoutMs: main.APP_QUIT_CONFIRM_TIMEOUT_MS
    });

    handler();
    confirmQuit();
    await vi.advanceTimersByTimeAsync(main.APP_QUIT_CONFIRM_TIMEOUT_MS);

    expect(forceQuit).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recreates a missing main window when a second instance starts", async () => {
    const main = await import("../src/main/main");
    const createdWindow = {
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn()
    };
    const create = vi.fn(() => createdWindow);
    const bind = vi.fn();

    const result = main.restoreOrCreateMainWindow(null, create, bind);

    expect(result).toEqual({ window: createdWindow, created: true });
    expect(bind).toHaveBeenCalledWith(createdWindow);
    expect(createdWindow.show).toHaveBeenCalledTimes(1);
    expect(createdWindow.focus).toHaveBeenCalledTimes(1);
  });

  it("schedules exactly one relaunch when starts arrive during shutdown", async () => {
    const main = await import("../src/main/main");
    const relaunch = vi.fn();
    const schedule = main.createRelaunchScheduler(relaunch);

    expect(schedule()).toBe(true);
    expect(schedule()).toBe(false);
    expect(schedule()).toBe(false);
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it("waits for a running health sample and persistently closes an alerted incident before shutdown returns", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-health-shutdown-"));
    try {
      const filePath = path.join(root, "health.json");
      const runFingerprint = "a".repeat(64);
      const queueFingerprint = "b".repeat(64);
      saveDownloadHealthState(filePath, createDownloadHealthState({
        status: "alerted",
        runFingerprint,
        queueFingerprint,
        suspiciousDurationMs: 90_000,
        suspiciousSamples: 3,
        incidentStartedAt: 10_000,
        alertedAt: 90_000,
        lastAlertAt: 90_000,
        cooldownUntil: 690_000
      }));
      let shuttingDown = false;
      const healthSnapshot = (completionSequence: number): DownloadHealthSnapshot => ({
        runActive: true,
        runFingerprint,
        queueFingerprint,
        openItems: 1,
        openPackages: 1,
        knownDownloadedBytes: 4096,
        activeTasks: 1,
        startableItems: 0,
        lastSchedulerTickAt: 100_000,
        downloadProgressSequence: 0,
        itemCompletionSequence: completionSequence,
        lastPositiveByteAt: 0,
        technicalRecoveryCount: 0,
        paused: false,
        reconnectUntil: 0,
        nextRetryAt: 0,
        providerCooldownUntil: 0,
        blockedOnDisk: false,
        blockedOnThrottleUntil: 0,
        activePhaseDeadlineAt: 0,
        terminalFailure: false,
        manualStop: false,
        shuttingDown,
        currentSpeedBps: 0
      });
      const runningEvaluation = deferred();
      const controller = Object.create(AppController.prototype) as any;
      controller.downloadHealthTimer = setInterval(() => {}, 60_000);
      controller.downloadHealthTimer.unref?.();
      controller.downloadHealthMonitor = new DownloadHealthMonitor(filePath);
      controller.downloadHealthEvaluation = runningEvaluation.promise.finally(() => {
        controller.downloadHealthEvaluation = null;
      });
      controller.runtimeStatsTimer = null;
      controller.notificationOutbox = {
        enqueue: vi.fn(async () => undefined),
        drainForShutdown: vi.fn(async () => undefined)
      };
      controller.manager = {
        suspendDownloadHealthMonitoring: vi.fn(() => { shuttingDown = true; }),
        getDownloadHealthSnapshot: vi.fn(() => healthSnapshot(1)),
        flushNotificationsForShutdown: vi.fn(async () => undefined),
        prepareForShutdown: vi.fn()
      };
      controller.megaWebFallback = { dispose: vi.fn() };
      controller.realDebridWebFallbacks = new Map();
      controller.pendingRealDebridWebAccountIds = new Map();
      controller.allDebridWebFallback = { dispose: vi.fn() };
      controller.bestDebridWebFallback = { dispose: vi.fn() };
      controller.shutdownLogStorage = vi.fn();
      controller.audit = vi.fn();
      controller.settings = {
        historyRetentionMode: "never",
        notifyUrl: "https://discord.example.test/webhook",
        notifyOnDownloadStall: true,
        notifyOnDownloadRecovery: true,
        notifyStallAfterSeconds: 90,
        notifyStallCooldownMinutes: 10
      };

      const shutdown = controller.shutdown();

      expect(controller.downloadHealthTimer).toBeNull();
      expect(controller.notificationOutbox.drainForShutdown).not.toHaveBeenCalled();
      runningEvaluation.resolve();
      await shutdown;

      const closed = loadDownloadHealthState(filePath);
      expect(closed.status).toBe("idle");
      expect(closed.alertedAt).toBe(0);
      expect(closed.restartPending).toBe(false);

      const recoveredEvents: unknown[] = [];
      const restarted = new DownloadHealthMonitor(filePath);
      await restarted.sample(healthSnapshot(1), 120_000, {
        stallAfterMs: 90_000,
        cooldownMs: 600_000,
        notifyOnStall: true,
        notifyOnRecovery: true
      }, async (event) => { recoveredEvents.push(event); });
      await restarted.sample(healthSnapshot(2), 135_000, {
        stallAfterMs: 90_000,
        cooldownMs: 600_000,
        notifyOnStall: true,
        notifyOnRecovery: true
      }, async (event) => { recoveredEvents.push(event); });

      expect(recoveredEvents).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
