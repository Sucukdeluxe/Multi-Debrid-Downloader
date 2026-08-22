import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DownloadManager } from "../src/main/download-manager";
import { defaultSettings } from "../src/main/constants";
import type { NotificationEvent } from "../src/main/notification-outbox";
import { createStoragePaths, emptySession } from "../src/main/storage";
import { shutdownItemLogs } from "../src/main/item-log";
import { shutdownPackageLogs } from "../src/main/package-log";
import { shutdownRenameLog } from "../src/main/rename-log";
import type { AppSettings, HistoryEntry, PackageEntry } from "../src/shared/types";

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

function setup(settings: Partial<AppSettings> = {}): {
  manager: DownloadManager;
  session: ReturnType<typeof emptySession>;
  events: NotificationEvent[];
  history: HistoryEntry[];
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-nh-"));
  tempDirs.push(root);
  const session = emptySession();
  const events: NotificationEvent[] = [];
  const history: HistoryEntry[] = [];
  const manager = new DownloadManager(
    {
      ...defaultSettings(),
      token: "rd-token",
      outputDir: path.join(root, "out"),
      extractDir: path.join(root, "extract"),
      notifyUrl: "https://discord.com/api/webhooks/123/abc",
      notifyOnPackageCompleted: true,
      notifyOnPackageFailed: true,
      notifyOnRunFinished: true,
      notifyPackageSuccessMode: "individual",
      autoExtract: false,
      ...settings
    },
    session,
    createStoragePaths(path.join(root, "state")),
    {
      enqueueNotification: async (event: NotificationEvent) => {
        events.push(event);
      },
      onHistoryEntry: (entry) => history.push(entry)
    }
  );
  return { manager, session, events, history };
}

function addPackage(
  session: ReturnType<typeof emptySession>,
  statuses: Array<"completed" | "failed" | "cancelled" | "queued"> = ["completed"],
  packageId = "pkg-1"
): PackageEntry {
  const startedAt = Date.now() - 30_000;
  const pkg: PackageEntry = {
    id: packageId,
    name: `Test ${packageId}`,
    outputDir: `C:/out/${packageId}`,
    extractDir: `C:/extract/${packageId}`,
    status: "queued",
    itemIds: statuses.map((_status, index) => `${packageId}-item-${index}`),
    cancelled: false,
    enabled: true,
    priority: "normal",
    downloadStartedAt: startedAt,
    downloadCompletedAt: startedAt + 10_000,
    downloadEndedAt: startedAt + 10_000,
    createdAt: startedAt,
    updatedAt: startedAt + 10_000
  };
  session.packages[packageId] = pkg;
  session.packageOrder.push(packageId);
  statuses.forEach((status, index) => {
    const itemId = `${packageId}-item-${index}`;
    session.items[itemId] = {
      id: itemId,
      packageId,
      url: `https://dummy/${packageId}/${index}`,
      provider: "realdebrid",
      status,
      retries: 0,
      speedBps: 0,
      downloadedBytes: status === "completed" ? 1_000 : 0,
      totalBytes: 1_000,
      progressPercent: status === "completed" ? 100 : 0,
      fileName: `${packageId}-${index}.rar`,
      targetPath: `C:/out/${packageId}/${packageId}-${index}.rar`,
      resumable: true,
      attempts: 1,
      lastError: status === "failed" ? "offline" : "",
      fullStatus: status === "completed" ? "Fertig" : status === "failed" ? "Offline" : "Wartet",
      createdAt: startedAt,
      updatedAt: startedAt + 10_000
    };
  });
  return pkg;
}

function internal(manager: DownloadManager): any {
  return manager as any;
}

async function flushNotifications(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("authoritative package completion", () => {
  it("waits for main, deferred, hybrid and file operations before emitting one package result", async () => {
    const { manager, session, events, history } = setup();
    const pkg = addPackage(session);
    const state = internal(manager);
    state.runPackageIds.add(pkg.id);
    state.packagePostProcessTasks.set(pkg.id, Promise.resolve());
    state.packageDeferredPostProcessTasks.set(pkg.id, new Set([Promise.resolve()]));
    state.packageHybridPostProcessTasks.set(pkg.id, new Set([Promise.resolve()]));
    state.packageFileOpChain.set(pkg.id, Promise.resolve());

    state.tryFinalizePackageResult?.(pkg.id);
    await flushNotifications();
    expect(events).toHaveLength(0);
    expect(history).toHaveLength(0);

    state.packagePostProcessTasks.delete(pkg.id);
    state.packageDeferredPostProcessTasks.delete(pkg.id);
    state.packageHybridPostProcessTasks.delete(pkg.id);
    state.tryFinalizePackageResult?.(pkg.id);
    await flushNotifications();
    expect(events).toHaveLength(0);

    state.packageFileOpChain.delete(pkg.id);
    state.tryFinalizePackageResult?.(pkg.id);
    await flushNotifications();

    expect(events.map((event) => event.type)).toEqual(["package_completed"]);
    expect(history).toHaveLength(1);
    expect(pkg.postProcessCompletedAt).toBeGreaterThan(0);
    expect(pkg.terminalAt).toBe(pkg.postProcessCompletedAt);
  });

  it("turns a deferred remux failure into one immediate failed package event", async () => {
    const { manager, session, events, history } = setup({ notifyPackageSuccessMode: "digest" });
    const pkg = addPackage(session);
    const state = internal(manager);
    state.runPackageIds.add(pkg.id);
    pkg.remuxOperations = [{
      id: "remux-1",
      fileName: "episode.mkv",
      startedAt: 10_000,
      completedAt: 14_000,
      durationMs: 4_000,
      status: "failed",
      errorCategory: "ffmpeg"
    }];
    state.packageDeferredPostProcessTasks.set(pkg.id, new Set([Promise.resolve()]));

    state.tryFinalizePackageResult?.(pkg.id);
    await flushNotifications();
    expect(events).toHaveLength(0);

    state.packageDeferredPostProcessTasks.delete(pkg.id);
    state.tryFinalizePackageResult?.(pkg.id);
    await flushNotifications();

    expect(events.map((event) => event.type)).toEqual(["package_failed"]);
    expect(events[0].priority).toBe("error");
    expect(history[0]).toMatchObject({ status: "failed", failurePhase: "remux", failedFiles: 1 });
  });

  it("emits a partial package result when the terminal downloads are mixed", async () => {
    const { manager, session, events, history } = setup();
    const pkg = addPackage(session, ["completed", "failed"]);
    session.running = true;
    internal(manager).runPackageIds.add(pkg.id);

    internal(manager).refreshPackageStatus(pkg);
    await flushNotifications();

    expect(pkg.status).toBe("failed");
    expect(events.map((event) => event.type)).toEqual(["package_partial"]);
    expect(history[0]).toMatchObject({ status: "partial", successfulFiles: 1, failedFiles: 1 });
  });

  it("creates a new result generation when extraction is retried", async () => {
    const { manager, session, events, history } = setup();
    const pkg = addPackage(session);
    const state = internal(manager);
    state.runPackageIds.add(pkg.id);
    pkg.archiveOperations = [{
      id: "archive-1",
      name: "episode.rar",
      itemIds: [...pkg.itemIds],
      partCount: 1,
      startedAt: 10_000,
      completedAt: 12_000,
      durationMs: 2_000,
      status: "failed",
      errorCategory: "crc_error"
    }];
    state.tryFinalizePackageResult?.(pkg.id);
    await flushNotifications();
    const firstId = events[0]?.id;

    const postProcess = vi.spyOn(state, "runPackagePostProcessing").mockResolvedValue(undefined);
    session.items[pkg.itemIds[0]].fullStatus = "Entpacken - Error";
    manager.retryExtraction(pkg.id);
    expect(postProcess).toHaveBeenCalledWith(pkg.id);
    pkg.archiveOperations = [{
      id: "archive-2",
      name: "episode.rar",
      itemIds: [...pkg.itemIds],
      partCount: 1,
      startedAt: 20_000,
      completedAt: 23_000,
      durationMs: 3_000,
      status: "completed",
      errorCategory: ""
    }];
    session.items[pkg.itemIds[0]].fullStatus = "Entpackt - Done (3.0s)";
    pkg.status = "completed";
    state.tryFinalizePackageResult?.(pkg.id);
    await flushNotifications();

    expect(events).toHaveLength(2);
    expect(events[1].id).not.toBe(firstId);
    expect(events[1].type).toBe("package_completed");
    expect(history).toHaveLength(2);
  });

  it("moves a pending success digest into the outbox before shutdown", async () => {
    const { manager, session, events } = setup({ notifyPackageSuccessMode: "digest" });
    const pkg = addPackage(session);
    const state = internal(manager);
    state.runPackageIds.add(pkg.id);

    state.tryFinalizePackageResult(pkg.id);
    await flushNotifications();
    expect(events).toHaveLength(0);

    await state.flushNotificationsForShutdown?.();
    await flushNotifications();

    expect(events.map((event) => event.type)).toEqual(["package_completed"]);
    expect(events[0].payload.title).toContain("Paket-Digest");
  });
});

describe("authoritative run completion", () => {
  it("emits run_stopped without run_completed for a manual stop", async () => {
    const { manager, session, events } = setup();
    const pkg = addPackage(session, ["completed", "queued"]);
    const state = internal(manager);
    session.running = true;
    session.runStartedAt = Date.now() - 10_000;
    state.runItemIds = new Set(pkg.itemIds);
    state.runPackageIds = new Set([pkg.id]);
    state.runOutcomes = new Map([[pkg.itemIds[0], "completed"]]);

    manager.stop();
    await flushNotifications();

    expect(events.map((event) => event.type)).toEqual(["run_stopped"]);
    expect(events.some((event) => event.type === "run_completed")).toBe(false);
  });

  it("waits for failed extraction package results before emitting the final run summary", async () => {
    const { manager, session, events } = setup({ notifyPackageSuccessMode: "digest" });
    const pkg = addPackage(session);
    const state = internal(manager);
    session.running = true;
    session.runStartedAt = Date.now() - 20_000;
    state.runItemIds = new Set(pkg.itemIds);
    state.runPackageIds = new Set([pkg.id]);
    state.runOutcomes = new Map([[pkg.itemIds[0], "completed"]]);
    state.packageDeferredPostProcessTasks.set(pkg.id, new Set([Promise.resolve()]));
    pkg.archiveOperations = [{
      id: "archive-failed",
      name: "episode.part01.rar",
      itemIds: [...pkg.itemIds],
      partCount: 16,
      startedAt: 10_000,
      completedAt: 18_000,
      durationMs: 8_000,
      status: "failed",
      errorCategory: "wrong_password"
    }];

    state.finishRun();
    await flushNotifications();
    expect(events).toHaveLength(0);

    state.packageDeferredPostProcessTasks.delete(pkg.id);
    state.tryFinalizePackageResult?.(pkg.id);
    await flushNotifications();

    expect(events.map((event) => event.type)).toEqual(["package_failed", "run_completed"]);
    const runEvent = events[1];
    expect(runEvent.payload.fields.some((field) => field.name === "Entpackfehler" && field.value === "1")).toBe(true);
    expect(runEvent.payload.fields.some((field) => field.name === "Dateien" && field.value === "0 erfolgreich · 1 fehlgeschlagen · 0 abgebrochen")).toBe(true);
  });

  it("flushes successful package digests before run_completed", async () => {
    const { manager, session, events } = setup({ notifyPackageSuccessMode: "digest" });
    const pkg = addPackage(session);
    const state = internal(manager);
    session.running = true;
    session.runStartedAt = Date.now() - 20_000;
    state.runItemIds = new Set(pkg.itemIds);
    state.runPackageIds = new Set([pkg.id]);
    state.runOutcomes = new Map([[pkg.itemIds[0], "completed"]]);

    state.finishRun();
    state.tryFinalizePackageResult?.(pkg.id);
    await flushNotifications();

    expect(events.map((event) => event.type)).toEqual(["package_completed", "run_completed"]);
    expect(events[0].payload.title).toContain("Paket-Digest");
  });

  it("keeps a finalized success in the digest after package_done removes its session package", async () => {
    const { manager, session, events } = setup({
      notifyPackageSuccessMode: "digest",
      completedCleanupPolicy: "package_done"
    });
    const pkg = addPackage(session);
    const state = internal(manager);
    session.running = true;
    session.runStartedAt = Date.now() - 20_000;
    state.runItemIds = new Set(pkg.itemIds);
    state.runPackageIds = new Set([pkg.id]);
    state.packageResultGenerations = new Map([[pkg.id, 1]]);
    state.runPackageGenerations = new Map([[pkg.id, 1]]);
    state.runOutcomes = new Map([[pkg.itemIds[0], "completed"]]);

    state.tryFinalizePackageResult(pkg.id);
    state.applyPackageDoneCleanup(pkg.id);
    expect(session.packages[pkg.id]).toBeUndefined();
    state.finishRun();
    await flushNotifications();

    expect(events.map((event) => event.type)).toEqual(["package_completed", "run_completed"]);
    expect(events[0].payload.title).toContain("Paket-Digest");
  });
});
