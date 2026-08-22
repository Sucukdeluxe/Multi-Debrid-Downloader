import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
import {
  DownloadHealthMonitor,
  createDownloadHealthState,
  loadDownloadHealthState,
  saveDownloadHealthState,
  type DownloadHealthSnapshot
} from "../src/main/download-health-monitor";

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
