import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/main/constants";
import { DownloadManager } from "../src/main/download-manager";
import { createStoragePaths, emptySession } from "../src/main/storage";
import {
  aggregateStatisticsRange,
  createStatisticsLedger,
  loadStatisticsLedger,
  recordStatisticsActiveInterval,
  recordStatisticsBytes,
  recordStatisticsOutcome,
  saveStatisticsLedger
} from "../src/main/statistics-ledger";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function localTime(day: number, hour = 12): number {
  return new Date(2026, 7, day, hour, 0, 0, 0).getTime();
}

describe("statistics ledger", () => {
  it("aggregates every available day inside a rolling seven-day window without requiring seven complete days", () => {
    let ledger = createStatisticsLedger(localTime(10));
    ledger = recordStatisticsBytes(ledger, "realdebrid", 100, localTime(7));
    ledger = recordStatisticsOutcome(ledger, "realdebrid", "completed", localTime(7));
    ledger = recordStatisticsBytes(ledger, "debridlink", 200, localTime(8));
    ledger = recordStatisticsOutcome(ledger, "debridlink", "failed", localTime(8));
    ledger = recordStatisticsBytes(ledger, "realdebrid", 300, localTime(10));
    ledger = recordStatisticsOutcome(ledger, "realdebrid", "completed", localTime(10));

    const aggregate = aggregateStatisticsRange(ledger, 7, localTime(10));

    expect(aggregate).toMatchObject({
      downloadedBytes: 600,
      completedFiles: 2,
      failedFiles: 1,
      coveredDays: 3
    });
    expect(aggregate.providers).toEqual({
      debridlink: { bytes: 200, completed: 0, failed: 1 },
      realdebrid: { bytes: 400, completed: 2, failed: 0 }
    });
  });

  it("excludes data outside the requested calendar window and computes average speed from measured active time", () => {
    let ledger = createStatisticsLedger(localTime(10));
    ledger = recordStatisticsBytes(ledger, "realdebrid", 8_000, localTime(10));
    ledger = recordStatisticsActiveInterval(ledger, localTime(10, 10), localTime(10, 10) + 2_000);
    ledger = recordStatisticsBytes(ledger, "debridlink", 99_000, localTime(3));
    ledger = recordStatisticsActiveInterval(ledger, localTime(3, 10), localTime(3, 10) + 1_000);

    const today = aggregateStatisticsRange(ledger, 1, localTime(10));
    const week = aggregateStatisticsRange(ledger, 7, localTime(10));
    const month = aggregateStatisticsRange(ledger, 30, localTime(10));

    expect(today).toMatchObject({ downloadedBytes: 8_000, activeDownloadMs: 2_000, averageSpeedBps: 4_000 });
    expect(week.downloadedBytes).toBe(8_000);
    expect(month).toMatchObject({ downloadedBytes: 107_000, activeDownloadMs: 3_000 });
  });

  it("splits active intervals across local calendar days", () => {
    const start = new Date(2026, 7, 9, 23, 59, 59, 500).getTime();
    const end = new Date(2026, 7, 10, 0, 0, 0, 500).getTime();
    const ledger = recordStatisticsActiveInterval(createStatisticsLedger(start), start, end);

    expect(aggregateStatisticsRange(ledger, 1, localTime(10)).activeDownloadMs).toBe(500);
    expect(aggregateStatisticsRange(ledger, 1, localTime(9)).activeDownloadMs).toBe(500);
  });

  it("persists normalized statistics and recovers safely from malformed files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-statistics-ledger-"));
    roots.push(root);
    const filePath = path.join(root, "rd_statistics.json");
    const ledger = recordStatisticsOutcome(
      recordStatisticsBytes(createStatisticsLedger(localTime(10)), "realdebrid", 4_096, localTime(10)),
      "realdebrid",
      "completed",
      localTime(10)
    );

    saveStatisticsLedger(filePath, ledger);
    expect(loadStatisticsLedger(filePath, localTime(10))).toEqual(ledger);

    fs.writeFileSync(filePath, "{broken", "utf8");
    expect(loadStatisticsLedger(filePath, localTime(11))).toEqual(createStatisticsLedger(localTime(11)));
  });

  it("retries transient Windows rename failures while preserving the statistics file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-statistics-rename-"));
    roots.push(root);
    const filePath = path.join(root, "rd_statistics.json");
    const ledger = recordStatisticsBytes(createStatisticsLedger(localTime(10)), "realdebrid", 8_192, localTime(10));
    const rename = fs.renameSync.bind(fs);
    let attempts = 0;
    const spy = vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      attempts += 1;
      if (attempts < 3) {
        throw Object.assign(new Error("busy"), { code: "EPERM" });
      }
      return rename(source, target);
    });

    saveStatisticsLedger(filePath, ledger);

    expect(attempts).toBe(3);
    expect(loadStatisticsLedger(filePath, localTime(10))).toEqual(ledger);
    spy.mockRestore();
  });

  it("records provider bytes and terminal outcomes through the download manager and restores them after restart", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-statistics-manager-"));
    roots.push(root);
    const paths = createStoragePaths(root);
    const session = emptySession();
    session.items.item = {
      id: "item",
      packageId: "package",
      url: "https://example.test/file",
      provider: "realdebrid",
      providerLabel: "Real-Debrid",
      status: "completed",
      retries: 0,
      speedBps: 0,
      downloadedBytes: 4_096,
      totalBytes: 4_096,
      progressPercent: 100,
      fileName: "file.bin",
      targetPath: path.join(root, "file.bin"),
      resumable: true,
      attempts: 1,
      lastError: "",
      fullStatus: "Fertig",
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    const manager = new DownloadManager(defaultSettings(), session, paths);

    (manager as any).runItemIds.add("item");
    (manager as any).recordProviderDownloadedBytes("realdebrid", 4_096);
    (manager as any).recordRunOutcome("item", "completed");
    manager.persistNowSync();

    const current = aggregateStatisticsRange(manager.getStats().statistics, 1);
    expect(current).toMatchObject({ downloadedBytes: 4_096, completedFiles: 1, failedFiles: 0 });
    expect(current.providers.realdebrid).toEqual({ bytes: 4_096, completed: 1, failed: 0 });
    expect(fs.existsSync(paths.statisticsFile)).toBe(true);

    const restored = new DownloadManager(defaultSettings(), emptySession(), paths);
    expect(aggregateStatisticsRange(restored.getStats().statistics, 1)).toMatchObject({
      downloadedBytes: 4_096,
      completedFiles: 1
    });
  });
});
