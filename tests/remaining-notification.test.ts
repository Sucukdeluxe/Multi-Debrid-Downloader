import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DownloadManager } from "../src/main/download-manager";
import { defaultSettings } from "../src/main/constants";
import {
  evaluateRemainingThreshold,
  type RunRemainingSnapshot
} from "../src/main/notification-events";
import type { NotificationEvent } from "../src/main/notification-outbox";
import { createStoragePaths, emptySession } from "../src/main/storage";
import { shutdownItemLogs } from "../src/main/item-log";
import { shutdownPackageLogs } from "../src/main/package-log";
import { shutdownRenameLog } from "../src/main/rename-log";
import type { AppSettings, PackageEntry } from "../src/shared/types";

const GIB = 1024 ** 3;
const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  shutdownItemLogs();
  shutdownPackageLogs();
  shutdownRenameLog();
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
    }
  }
});

function snapshot(overrides: Partial<RunRemainingSnapshot> = {}): RunRemainingSnapshot {
  return {
    remainingBytes: 51 * GIB,
    openItems: 2,
    openPackages: 1,
    unknownCount: 0,
    finalizingItems: 0,
    speedBps: 1024 ** 2,
    etaSeconds: 51 * 1024,
    ...overrides
  };
}

function setupManager(settings: Partial<AppSettings> = {}, session = emptySession()): {
  manager: DownloadManager;
  session: ReturnType<typeof emptySession>;
  events: NotificationEvent[];
  settings: AppSettings;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-remaining-"));
  tempDirs.push(root);
  const events: NotificationEvent[] = [];
  const resolvedSettings = {
    ...defaultSettings(),
    token: "rd-token",
    outputDir: path.join(root, "out"),
    extractDir: path.join(root, "extract"),
    notifyUrl: "https://discord.com/api/webhooks/123/abc",
    notifyOnPackageCompleted: false,
    notifyOnPackageFailed: false,
    notifyOnRunFinished: false,
    notifyOnRemainingBelow: true,
    notifyRemainingThresholdGb: 50,
    autoExtract: false,
    ...settings
  };
  const manager = new DownloadManager(
    resolvedSettings,
    session,
    createStoragePaths(path.join(root, "state")),
    {
      enqueueNotification: async (event: NotificationEvent) => {
        events.push(event);
      }
    }
  );
  return { manager, session, events, settings: resolvedSettings };
}

function addPackage(
  session: ReturnType<typeof emptySession>,
  packageId: string,
  totalBytes: number | null,
  downloadedBytes = 0,
  enabled = true
): PackageEntry {
  const now = Date.now();
  const itemId = `${packageId}-item`;
  const pkg: PackageEntry = {
    id: packageId,
    name: packageId,
    outputDir: `C:/out/${packageId}`,
    extractDir: `C:/extract/${packageId}`,
    status: "queued",
    itemIds: [itemId],
    cancelled: false,
    enabled,
    priority: "normal",
    createdAt: now,
    updatedAt: now
  };
  session.packages[packageId] = pkg;
  session.packageOrder.push(packageId);
  session.items[itemId] = {
    id: itemId,
    packageId,
    url: `https://dummy/${packageId}`,
    provider: null,
    status: "queued",
    retries: 0,
    speedBps: 0,
    downloadedBytes,
    totalBytes,
    progressPercent: totalBytes && totalBytes > 0 ? Math.floor((downloadedBytes / totalBytes) * 100) : 0,
    fileName: `${packageId}.bin`,
    targetPath: "",
    resumable: true,
    attempts: 0,
    lastError: "",
    fullStatus: "Wartet",
    createdAt: now,
    updatedAt: now
  };
  return pkg;
}

function internal(manager: DownloadManager): any {
  return manager as any;
}

async function flushNotifications(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("remaining threshold evaluation", () => {
  it("emits when known remaining bytes cross from above to exactly the threshold", () => {
    const previous = snapshot();
    const current = snapshot({ remainingBytes: 50 * GIB, etaSeconds: 50 * 1024 });

    expect(evaluateRemainingThreshold(previous, current, 50 * GIB)).toEqual({
      emit: true,
      remainingBytes: 50 * GIB
    });
  });

  it("blocks a crossing when either snapshot contains an unknown open size", () => {
    const above = snapshot();
    const below = snapshot({ remainingBytes: 49 * GIB, etaSeconds: 49 * 1024 });

    expect(evaluateRemainingThreshold(above, { ...below, unknownCount: 1 }, 50 * GIB)).toEqual({ emit: false });
    expect(evaluateRemainingThreshold({ ...above, unknownCount: 1 }, below, 50 * GIB)).toEqual({ emit: false });
  });

  it("suppresses a crossing when no open run item remains", () => {
    expect(evaluateRemainingThreshold(
      snapshot(),
      snapshot({ remainingBytes: 0, openItems: 0, openPackages: 0, etaSeconds: 0 }),
      50 * GIB
    )).toEqual({ emit: false });
  });

  it("emits once per crossing and re-arms only after remaining work rises above the threshold", () => {
    const above = snapshot();
    const below = snapshot({ remainingBytes: 49 * GIB, etaSeconds: 49 * 1024 });

    expect(evaluateRemainingThreshold(above, below, 50 * GIB).emit).toBe(true);
    expect(evaluateRemainingThreshold(below, below, 50 * GIB).emit).toBe(false);
    expect(evaluateRemainingThreshold(below, above, 50 * GIB).emit).toBe(false);
    expect(evaluateRemainingThreshold(above, below, 50 * GIB).emit).toBe(true);
  });

  it("does not synthesize a crossing for a new or restored run that first appears below the threshold", () => {
    const below = snapshot({ remainingBytes: 49 * GIB, etaSeconds: 49 * 1024 });

    expect(evaluateRemainingThreshold(null, below, 50 * GIB)).toEqual({ emit: false });
  });
});

describe("run-scoped remaining notifications", () => {
  it("waits for real HTTP finalization before crossing and keeps genuine remaining work in the event", async () => {
    const payload = Buffer.alloc(256 * 1024, 7);
    const server = http.createServer((_request, response) => {
      response.statusCode = 200;
      response.setHeader("Accept-Ranges", "bytes");
      response.setHeader("Content-Length", String(payload.length));
      response.end(payload);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }

    const { manager, session, events, settings } = setupManager({
      notifyRemainingThresholdGb: (128 * 1024) / GIB
    });
    const downloadingPackage = addPackage(session, "http-final-package", payload.length);
    downloadingPackage.outputDir = path.join(settings.outputDir, downloadingPackage.id);
    downloadingPackage.extractDir = path.join(settings.extractDir, downloadingPackage.id);
    const remainingPackage = addPackage(session, "genuine-remaining-package", 64 * 1024);
    remainingPackage.outputDir = path.join(settings.outputDir, remainingPackage.id);
    remainingPackage.extractDir = path.join(settings.extractDir, remainingPackage.id);
    const downloadingItem = session.items[downloadingPackage.itemIds[0]];
    const state = internal(manager);
    vi.spyOn(state, "ensureScheduler").mockResolvedValue(undefined);
    state.debridService.unrestrictLink = vi.fn(async () => ({
      fileName: downloadingItem.fileName,
      directUrl: `http://127.0.0.1:${address.port}/download`,
      fileSize: payload.length,
      retriesUsed: 0,
      provider: "realdebrid",
      providerLabel: "Real-Debrid"
    }));
    const eventStatuses: string[] = [];
    state.enqueueNotificationCallback = async (event: NotificationEvent) => {
      events.push(event);
      eventStatuses.push(downloadingItem.status);
    };

    try {
      await manager.start();
      const active = {
        itemId: downloadingItem.id,
        packageId: downloadingPackage.id,
        abortController: new AbortController(),
        abortReason: "none",
        resumable: true,
        nonResumableCounted: false,
        stallRetries: 0,
        genericErrorRetries: 0,
        unrestrictRetries: 0
      };
      state.activeTasks.set(downloadingItem.id, active);

      await state.processItem(active);
      await flushNotifications();

      expect(downloadingItem.status).toBe("completed");
      expect(events.filter((event) => event.type === "remaining_threshold_crossed")).toHaveLength(1);
      expect(eventStatuses).toEqual(["completed"]);
      expect(events[0].payload.fields).toContainEqual({ name: "Restmenge", value: "64 KB", inline: true });
      expect(events[0].payload.fields).toContainEqual({ name: "Offene Dateien", value: "1", inline: true });
    } finally {
      manager.stop();
      server.close();
      await once(server, "close");
    }
  }, 15_000);

  it("creates a stable run context when public download work joins a postprocess-only start", async () => {
    const { manager, session, events } = setupManager();
    const postprocessPackage = addPackage(session, "postprocess-only-package", GIB, GIB);
    const postprocessItem = session.items[postprocessPackage.itemIds[0]];
    postprocessItem.status = "completed";
    postprocessItem.progressPercent = 100;
    postprocessItem.fullStatus = "Fertig";
    postprocessPackage.status = "completed";
    const state = internal(manager);
    vi.spyOn(state, "ensureScheduler").mockResolvedValue(undefined);
    let releasePostprocess = (): void => {};
    const postprocessGate = new Promise<void>((resolve) => {
      releasePostprocess = resolve;
    });
    state.handlePackagePostProcessing = vi.fn(async () => postprocessGate);
    const postprocessTask = state.runPackagePostProcessing(postprocessPackage.id);
    await Promise.resolve();

    await manager.start();
    expect(session.running).toBe(true);
    expect(state.activeRunContextId).toBeNull();

    manager.addPackages([{
      name: "late-download-package",
      links: ["https://dummy/late-download.bin"],
      fileNames: ["late-download.bin"]
    }]);
    const latePackageId = session.packageOrder.find((packageId) => packageId !== postprocessPackage.id);
    if (!latePackageId) {
      throw new Error("late package missing");
    }
    const latePackage = session.packages[latePackageId];
    const lateItem = session.items[latePackage.itemIds[0]];
    lateItem.totalBytes = 51 * GIB;
    await manager.startItems([lateItem.id]);
    const runContextId = state.activeRunContextId;
    expect(runContextId).toEqual(expect.any(String));
    expect(state.runContexts.get(runContextId)?.packageGenerations.has(latePackage.id)).toBe(true);

    lateItem.downloadedBytes = 2 * GIB;
    manager.setPackagePriority(latePackage.id, "high");
    await flushNotifications();

    expect(state.activeRunContextId).toBe(runContextId);
    expect(events.filter((event) => event.type === "remaining_threshold_crossed")).toHaveLength(1);

    manager.stop();
    releasePostprocess();
    await postprocessTask;
  });

  it("derives speed and ETA only from open enabled current run items", async () => {
    const { manager, session } = setupManager();
    const activePackage = addPackage(session, "scoped-speed-package", 60 * GIB, 10 * GIB);
    const disabledPackage = addPackage(session, "disabled-speed-package", 100 * GIB);
    const removedPackage = addPackage(session, "removed-speed-package", 200 * GIB);
    const activeItem = session.items[activePackage.itemIds[0]];
    const disabledItem = session.items[disabledPackage.itemIds[0]];
    const removedItem = session.items[removedPackage.itemIds[0]];
    activeItem.speedBps = 2 * GIB;
    disabledItem.speedBps = 100 * GIB;
    removedItem.speedBps = 200 * GIB;
    const state = internal(manager);
    vi.spyOn(state, "ensureScheduler").mockResolvedValue(undefined);

    await manager.start();
    disabledPackage.enabled = false;
    delete session.items[removedItem.id];
    state.speedBytesLastWindow = 500 * GIB;

    expect(state.buildRunRemainingSnapshot()).toEqual({
      remainingBytes: 50 * GIB,
      openItems: 1,
      openPackages: 1,
      unknownCount: 0,
      finalizingItems: 0,
      speedBps: 2 * GIB,
      etaSeconds: 25
    });
  });

  it("calculates known remainder, speed and ETA only from open enabled items in the active run", async () => {
    const { manager, session } = setupManager();
    const active = addPackage(session, "active-package", 60 * GIB, 9 * GIB);
    const disabled = addPackage(session, "disabled-package", null, 0, false);
    const notStarted = addPackage(session, "not-started-package", 400 * GIB);
    const completedItemId = `${active.id}-completed-item`;
    active.itemIds.push(completedItemId);
    session.items[completedItemId] = {
      ...session.items[active.itemIds[0]],
      id: completedItemId,
      status: "completed",
      downloadedBytes: 300 * GIB,
      totalBytes: 300 * GIB,
      progressPercent: 100,
      fullStatus: "Fertig"
    };
    const overrunItemId = `${active.id}-overrun-item`;
    active.itemIds.push(overrunItemId);
    session.items[overrunItemId] = {
      ...session.items[active.itemIds[0]],
      id: overrunItemId,
      downloadedBytes: 2 * GIB,
      totalBytes: GIB,
      progressPercent: 100
    };
    const state = internal(manager);
    vi.spyOn(state, "ensureScheduler").mockResolvedValue(undefined);

    await manager.start({ excludePackageIds: new Set([notStarted.id]) });
    session.items[active.itemIds[0]].speedBps = GIB;
    state.speedBytesLastWindow = GIB;

    expect(state.buildRunRemainingSnapshot()).toEqual({
      remainingBytes: 51 * GIB,
      openItems: 2,
      openPackages: 1,
      unknownCount: 0,
      finalizingItems: 0,
      speedBps: GIB,
      etaSeconds: 51
    });
    expect(state.runPackageIds).toEqual(new Set([active.id]));
    expect(state.runPackageIds.has(disabled.id)).toBe(false);
  });

  it("enqueues one complete event per crossing and re-arms after new work raises the remainder", async () => {
    const { manager, session, events } = setupManager();
    const pkg = addPackage(session, "crossing-package", 51 * GIB);
    const item = session.items[pkg.itemIds[0]];
    const state = internal(manager);
    vi.spyOn(state, "ensureScheduler").mockResolvedValue(undefined);

    await manager.start();
    item.speedBps = GIB;
    state.speedBytesLastWindow = GIB;
    item.downloadedBytes = GIB;
    state.evaluateRemainingNotification();
    state.evaluateRemainingNotification();
    await flushNotifications();

    expect(events.filter((event) => event.type === "remaining_threshold_crossed")).toHaveLength(1);
    expect(events[0].payload.fields).toEqual([
      { name: "Restmenge", value: "50 GB", inline: true },
      { name: "Offene Pakete", value: "1", inline: true },
      { name: "Offene Dateien", value: "1", inline: true },
      { name: "Geschwindigkeit", value: "1 GB/s", inline: true },
      { name: "ETA", value: "0:50", inline: true }
    ]);

    item.downloadedBytes = 0;
    state.evaluateRemainingNotification();
    item.downloadedBytes = 2 * GIB;
    state.evaluateRemainingNotification();
    await flushNotifications();

    expect(events.filter((event) => event.type === "remaining_threshold_crossed")).toHaveLength(2);
    expect(new Set(events.map((event) => event.id)).size).toBe(2);
  });

  it("waits for unknown sizes to become known above the threshold before allowing a crossing", async () => {
    const { manager, session, events } = setupManager();
    const pkg = addPackage(session, "unknown-package", null);
    const item = session.items[pkg.itemIds[0]];
    const state = internal(manager);
    vi.spyOn(state, "ensureScheduler").mockResolvedValue(undefined);

    await manager.start();
    item.totalBytes = 49 * GIB;
    state.evaluateRemainingNotification();
    await flushNotifications();
    expect(events).toHaveLength(0);

    item.totalBytes = 60 * GIB;
    state.evaluateRemainingNotification();
    item.downloadedBytes = 11 * GIB;
    state.evaluateRemainingNotification();
    await flushNotifications();

    expect(events.filter((event) => event.type === "remaining_threshold_crossed")).toHaveLength(1);
  });

  it("allows the same package to cross again in a new run", async () => {
    const { manager, session, events } = setupManager();
    const pkg = addPackage(session, "new-run-package", 51 * GIB);
    const item = session.items[pkg.itemIds[0]];
    const state = internal(manager);
    vi.spyOn(state, "ensureScheduler").mockResolvedValue(undefined);

    await manager.start();
    item.downloadedBytes = 2 * GIB;
    state.evaluateRemainingNotification();
    manager.stop();

    item.downloadedBytes = 0;
    await manager.start();
    item.downloadedBytes = 2 * GIB;
    state.evaluateRemainingNotification();
    await flushNotifications();

    expect(events.filter((event) => event.type === "remaining_threshold_crossed")).toHaveLength(2);
    expect(new Set(events.map((event) => event.id)).size).toBe(2);
  });

  it("does not duplicate a prior crossing when a restored queue first appears below the threshold", async () => {
    const first = setupManager();
    const pkg = addPackage(first.session, "restart-package", 51 * GIB);
    const item = first.session.items[pkg.itemIds[0]];
    const firstState = internal(first.manager);
    vi.spyOn(firstState, "ensureScheduler").mockResolvedValue(undefined);

    await first.manager.start();
    item.downloadedBytes = 2 * GIB;
    firstState.evaluateRemainingNotification();
    await flushNotifications();
    expect(first.events).toHaveLength(1);

    const restored = setupManager({}, first.session);
    const restoredState = internal(restored.manager);
    vi.spyOn(restoredState, "ensureScheduler").mockResolvedValue(undefined);
    await restored.manager.start();
    restoredState.evaluateRemainingNotification();
    await flushNotifications();

    expect(restored.events).toHaveLength(0);
  });

  it("suppresses a threshold event when the same evaluation completes the last open item", async () => {
    const { manager, session, events } = setupManager();
    const pkg = addPackage(session, "final-package", 51 * GIB);
    const item = session.items[pkg.itemIds[0]];
    const state = internal(manager);
    vi.spyOn(state, "ensureScheduler").mockResolvedValue(undefined);

    await manager.start();
    item.status = "completed";
    item.downloadedBytes = 51 * GIB;
    item.progressPercent = 100;
    item.fullStatus = "Fertig";
    pkg.status = "completed";
    state.runOutcomes.set(item.id, "completed");
    state.evaluateRemainingNotification();
    state.finishRun();
    await flushNotifications();

    expect(events.filter((event) => event.type === "remaining_threshold_crossed")).toHaveLength(0);
  });
});
