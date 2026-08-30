import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DownloadItem, PackageEntry, SessionState } from "../src/shared/types";
import {
  cancelPendingAsyncSaves,
  createStoragePaths,
  emptySession,
  loadSession,
  loadSessionWithStatus,
  loadSettings,
  saveSession,
  saveSessionAsync,
  saveSettings,
  saveSettingsAsync
} from "../src/main/storage";
import { defaultSettings } from "../src/main/constants";
import { DownloadManager } from "../src/main/download-manager";
import { shutdownItemLogs } from "../src/main/item-log";
import { shutdownPackageLogs } from "../src/main/package-log";
import { NotificationEvent, NotificationOutbox } from "../src/main/notification-outbox";

const tempDirs: string[] = [];

afterEach(async () => {
  shutdownItemLogs();
  shutdownPackageLogs();
  for (const dir of tempDirs.splice(0)) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
    }
  }
});

function makePackage(id: string, itemId: string): PackageEntry {
  return {
    id,
    name: `Package ${id}`,
    outputDir: "C:/tmp/out",
    extractDir: "C:/tmp/extract",
    status: "queued",
    itemIds: [itemId],
    cancelled: false,
    enabled: true,
    downloadStartedAt: 0,
    downloadCompletedAt: 0,
    createdAt: 1,
    updatedAt: 1
  };
}

function makeItem(id: string, packageId: string): DownloadItem {
  return {
    id,
    packageId,
    url: `https://example.com/${id}`,
    provider: null,
    status: "queued",
    retries: 0,
    speedBps: 0,
    downloadedBytes: 0,
    totalBytes: null,
    progressPercent: 0,
    fileName: `${id}.rar`,
    targetPath: "",
    resumable: true,
    attempts: 0,
    lastError: "",
    fullStatus: "Wartet",
    createdAt: 1,
    updatedAt: 1
  };
}

function sessionWith(ids: string[]): SessionState {
  const s = emptySession();
  for (const id of ids) {
    const itemId = `${id}-item`;
    s.packageOrder.push(id);
    s.packages[id] = makePackage(id, itemId);
    s.items[itemId] = makeItem(itemId, id);
  }
  return s;
}

const settle = (ms = 250): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function primaryPackageKeys(sessionFile: string): string[] {
  if (!fs.existsSync(sessionFile)) {
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(sessionFile, "utf8")) as { packages?: Record<string, unknown> };
    return Object.keys(parsed.packages || {});
  } catch {
    return ["<unparseable>"];
  }
}

describe("session restart loss", () => {
  it("recovers and sends a persisted notification after restart", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-notification-restart-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);
    const queuedEvent: NotificationEvent = {
      id: "package:pkg-1:g1",
      type: "package_failed",
      priority: "error",
      createdAt: 1000,
      expiresAt: 86401000,
      attempts: 0,
      nextAttemptAt: 1000,
      payload: { title: "Paket fehlgeschlagen", fields: [] }
    };

    const firstProcess = new NotificationOutbox({
      filePath: paths.notificationOutboxFile,
      send: async () => true,
      now: () => 1000
    });
    await firstProcess.enqueue(queuedEvent);

    const delivered: NotificationEvent[] = [];
    const restartedProcess = new NotificationOutbox({
      filePath: paths.notificationOutboxFile,
      send: async (event) => {
        delivered.push(event);
        return true;
      },
      now: () => 1000
    });
    await restartedProcess.drain();

    expect(delivered).toEqual([queuedEvent]);
    expect(restartedProcess.getStatus()).toEqual({ queued: 0, lastSuccessAt: 1000, lastFailureAt: 0 });
  });

  it("does not let a queued stale async save clobber a newer synchronous save", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-loss-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);

    cancelPendingAsyncSaves();
    await settle(50);

    saveSession(paths, sessionWith(["A", "B"]));

    const inflight = saveSessionAsync(paths, sessionWith(["A", "B"]));
    const queued = saveSessionAsync(paths, sessionWith(["A", "B"]));
    saveSession(paths, sessionWith(["A", "B", "C"]));

    await inflight;
    await queued;
    await settle();

    const loaded = loadSession(paths);
    expect(Object.keys(loaded.packages).sort()).toEqual(["A", "B", "C"]);
  });

  it("recovers packages from the backup when the primary session file is absent", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-loss-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);

    fs.writeFileSync(`${paths.sessionFile}.bak`, JSON.stringify(sessionWith(["A", "B"])), "utf8");
    expect(fs.existsSync(paths.sessionFile)).toBe(false);

    const loaded = loadSession(paths);
    expect(Object.keys(loaded.packages).sort()).toEqual(["A", "B"]);
  });

  it("still treats a truly fresh install (no primary, no backup, no temp) as empty", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-loss-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);

    const loaded = loadSession(paths);
    expect(Object.keys(loaded.packages)).toEqual([]);
    expect(Object.keys(loaded.items)).toEqual([]);
  });

  it("keeps a valid empty primary authoritative over an older populated backup", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-loss-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);

    fs.writeFileSync(paths.sessionFile, JSON.stringify(emptySession()), "utf8");
    fs.writeFileSync(`${paths.sessionFile}.bak`, JSON.stringify(sessionWith(["A", "B"])), "utf8");

    const loaded = loadSession(paths);
    expect(Object.keys(loaded.packages)).toEqual([]);
  });

  it("does not let an in-flight/queued async settings save clobber a newer synchronous saveSettings", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-settings-race-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);

    cancelPendingAsyncSaves();
    await settle(50);

    const withName = (name: string) => ({ ...defaultSettings(), packageName: name });

    saveSettings(paths, withName("OLD"));
    const inflight = saveSettingsAsync(paths, withName("OLD"));
    const queued = saveSettingsAsync(paths, withName("OLD"));
    saveSettings(paths, withName("NEW"));

    await inflight;
    await queued;
    await settle();

    expect(loadSettings(paths).packageName).toBe("NEW");
  });
});

describe("session load status classification", () => {
  it("a readable populated primary reports status ok", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-status-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);
    saveSession(paths, sessionWith(["A", "B"]));

    const result = loadSessionWithStatus(paths);
    expect(result.status).toBe("ok");
    expect(Object.keys(result.session.packages).sort()).toEqual(["A", "B"]);
  });

  it("a truly fresh install reports status empty-fresh (no protection needed)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-status-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);

    expect(loadSessionWithStatus(paths).status).toBe("empty-fresh");
  });

  it("a corrupt primary with a good backup reports recovered-backup, not empty", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-status-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);

    fs.writeFileSync(paths.sessionFile, "{ this is not valid json", "utf8");
    fs.writeFileSync(`${paths.sessionFile}.bak`, JSON.stringify(sessionWith(["A", "B"])), "utf8");

    const result = loadSessionWithStatus(paths);
    expect(result.status).toBe("recovered-backup");
    expect(Object.keys(result.session.packages).sort()).toEqual(["A", "B"]);
  });

  it("THE BUG SIGNATURE: corrupt primary AND corrupt backup (no temp) reports empty-unreadable", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-status-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);

    fs.writeFileSync(paths.sessionFile, "   ", "utf8");
    fs.writeFileSync(`${paths.sessionFile}.bak`, "garbage not json", "utf8");

    const result = loadSessionWithStatus(paths);
    expect(result.status).toBe("empty-unreadable");
    expect(Object.keys(result.session.packages)).toEqual([]);
  });

  it("an empty-but-valid primary is status ok (a legitimate empty queue), NOT empty-unreadable", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-status-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);

    saveSession(paths, emptySession());

    const result = loadSessionWithStatus(paths);
    expect(result.status).toBe("ok");
  });
});

describe("durable session writes", () => {
  it("fsyncs the temp file before renaming on a synchronous save", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-fsync-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);

    const fsyncSpy = vi.spyOn(fs, "fsyncSync");
    try {
      saveSession(paths, sessionWith(["A"]));
      expect(fsyncSpy).toHaveBeenCalled();
    } finally {
      fsyncSpy.mockRestore();
    }
    expect(Object.keys(loadSession(paths).packages)).toEqual(["A"]);
  });

  it("an async save round-trips correctly (close-before-rename works on this platform)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-fsync-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);

    cancelPendingAsyncSaves();
    await settle(50);
    await saveSessionAsync(paths, sessionWith(["A", "B", "C"]));
    await settle();

    expect(Object.keys(loadSession(paths).packages).sort()).toEqual(["A", "B", "C"]);
  });

  it("retries a transiently locked session file and recovers (EBUSY)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-retry-"));
    tempDirs.push(dir);
    const paths = createStoragePaths(dir);
    saveSession(paths, sessionWith(["A"]));

    const realRead = fs.readFileSync;
    let lockedReads = 0;
    const readSpy = vi.spyOn(fs, "readFileSync").mockImplementation(((p: fs.PathOrFileDescriptor, options?: unknown) => {
      if (String(p) === paths.sessionFile && lockedReads < 2) {
        lockedReads += 1;
        const err = new Error("locked") as NodeJS.ErrnoException;
        err.code = "EBUSY";
        throw err;
      }
      return (realRead as (a: unknown, b: unknown) => unknown)(p, options);
    }) as typeof fs.readFileSync);
    try {
      const loaded = loadSession(paths);
      expect(Object.keys(loaded.packages)).toEqual(["A"]);
      expect(lockedReads).toBe(2);
    } finally {
      readSpy.mockRestore();
    }
  });
});

describe("empty-clobber guard", () => {
  const managerSettings = (root: string) => ({
    ...defaultSettings(),
    token: "rd-token",
    outputDir: path.join(root, "downloads"),
    extractDir: path.join(root, "extract"),
    autoExtract: false,
    autoReconnect: false,
    autoResumeOnStart: false,
    retryLimit: 0
  });

  it("after an unreadable load, a sync save does NOT overwrite the on-disk data with empty; a later real change persists, and a genuine clear still works", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-guard-"));
    tempDirs.push(root);
    const paths = createStoragePaths(path.join(root, "state"));

    saveSession(paths, sessionWith(["GOOD"]));
    expect(Object.keys(loadSession(paths).packages)).toEqual(["GOOD"]);

    const manager = new DownloadManager(managerSettings(root), emptySession(), paths, { protectEmptyClobber: true });
    try {
      manager.persistNowSync();
      expect(Object.keys(loadSession(paths).packages)).toEqual(["GOOD"]);

      const real = sessionWith(["NEW"]);
      const m = manager as unknown as { session: SessionState; protectAgainstEmptyClobber: boolean };
      m.session.packageOrder = real.packageOrder;
      m.session.packages = real.packages;
      m.session.items = real.items;

      manager.persistNowSync();
      expect(primaryPackageKeys(paths.sessionFile)).toEqual(["NEW"]);
      expect(m.protectAgainstEmptyClobber).toBe(false);

      m.session.packageOrder = [];
      m.session.packages = {};
      m.session.items = {};
      manager.persistNowSync();
      expect(primaryPackageKeys(paths.sessionFile)).toEqual([]);
    } finally {
      manager.blockAllPersistence = true;
      manager.clearPersistTimer();
    }
  });

  it("a normal start (status ok) does NOT protect, so removing the last package persists empty immediately", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-guard-"));
    tempDirs.push(root);
    const paths = createStoragePaths(path.join(root, "state"));

    saveSession(paths, sessionWith(["GOOD"]));

    const manager = new DownloadManager(managerSettings(root), sessionWith(["GOOD"]), paths, { protectEmptyClobber: false });
    try {
      const m = manager as unknown as { session: SessionState };
      m.session.packageOrder = [];
      m.session.packages = {};
      m.session.items = {};
      manager.persistNowSync();
      expect(primaryPackageKeys(paths.sessionFile)).toEqual([]);
    } finally {
      manager.blockAllPersistence = true;
      manager.clearPersistTimer();
    }
  });
});
