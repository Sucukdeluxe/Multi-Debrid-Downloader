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
    const handler = main.createBeforeQuitHandler({
      cleanup: () => main.cleanupSchedulerLifecycle(scheduler, timer),
      shutdown,
      continueQuit: vi.fn(),
      onError: vi.fn()
    });

    handler({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(shutdown).toHaveBeenCalledTimes(1));

    expect(scheduler.end).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(electron.powerMonitor.removeListener).toHaveBeenCalledWith("suspend", expect.any(Function));
    expect(electron.powerMonitor.removeListener).toHaveBeenCalledWith("resume", expect.any(Function));
    expect(scheduler.end.mock.invocationCallOrder[0]).toBeLessThan(shutdown.mock.invocationCallOrder[0]);
    expect(electron.powerMonitor.removeListener.mock.invocationCallOrder[1]).toBeLessThan(shutdown.mock.invocationCallOrder[0]);
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
