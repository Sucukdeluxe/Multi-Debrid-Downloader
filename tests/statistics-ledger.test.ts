import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/main/constants";
import { DownloadManager } from "../src/main/download-manager";
import { createStoragePaths, emptySession } from "../src/main/storage";
import {
  RollingAccountStatisticsAccumulator,
  addStatisticsAccountBytesInPlace,
  aggregateStatisticsRange,
  createStatisticsLedger,
  loadStatisticsLedger,
  normalizeStatisticsLedger,
  projectStatisticsLedger,
  rebaseStatisticsProviderSeedBaseline,
  recordStatisticsActiveInterval,
  recordStatisticsBytes,
  recordStatisticsOutcome,
  saveStatisticsLedger,
  seedStatisticsDayProviderBytes,
  suppressStatisticsProviderSeedForDay
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
  it("normalizes and records Deepbrid provider statistics", () => {
    const now = localTime(10);
    let ledger = recordStatisticsBytes(createStatisticsLedger(now), "deepbrid", 2_048, now);
    ledger = recordStatisticsOutcome(ledger, "deepbrid", "completed", now);
    addStatisticsAccountBytesInPlace(ledger, "deepbrid", 1_024, "svc-deepbrid", "Deepbrid", now);

    const normalized = normalizeStatisticsLedger(ledger, now);
    expect(normalized.days[0]?.providers.deepbrid).toEqual({ bytes: 2_048, completed: 1, failed: 0 });
    expect(normalized.minutes[0]?.accounts["svc-deepbrid"]).toEqual({
      provider: "deepbrid",
      label: "Deepbrid",
      bytes: 1_024
    });
  });

  it("migrates version one ledgers without inventing minute history", () => {
    const now = localTime(10);
    const legacy = {
      version: 1,
      startedAt: now - 1_000,
      days: [{
        day: "2026-08-10",
        downloadedBytes: 1_024,
        measuredBytes: 1_024,
        completedFiles: 1,
        failedFiles: 0,
        activeDownloadMs: 100,
        providers: { realdebrid: { bytes: 1_024, completed: 1, failed: 0 } }
      }]
    };

    const migrated = normalizeStatisticsLedger(legacy, now);

    expect(migrated.version).toBe(2);
    expect(migrated.startedAt).toBe(legacy.startedAt);
    expect(migrated.minuteTrackingStartedAt).toBe(now);
    expect(migrated.days).toEqual(legacy.days);
    expect(migrated.minutes).toEqual([]);
  });

  it("preserves the persisted minute tracking coverage start", () => {
    const now = localTime(10);
    const minuteTrackingStartedAt = now - (25 * 60 * 60 * 1_000);
    const ledger = createStatisticsLedger(now);

    expect(ledger.minuteTrackingStartedAt).toBe(now);
    expect(normalizeStatisticsLedger({ ...ledger, minuteTrackingStartedAt }, now).minuteTrackingStartedAt).toBe(minuteTrackingStartedAt);
  });

  it("normalizes, merges, and bounds sparse account minute history", () => {
    const now = localTime(10);
    const currentMinute = Math.floor(now / 60_000) * 60_000;
    const keptMinute = currentMinute - (47 * 60 * 60 * 1_000);
    const raw = {
      version: 2,
      startedAt: now - 1_000,
      days: [],
      minutes: [
        {
          minute: keptMinute,
          downloadedBytes: 1,
          accounts: {
            rdw_one: { provider: "realdebrid", label: "secret@example.test", bytes: 20 }
          }
        },
        {
          minute: keptMinute,
          downloadedBytes: 1,
          accounts: {
            rdw_one: { provider: "realdebrid", label: "New label", bytes: 30 },
            "https://unsafe": { provider: "realdebrid", label: "Unsafe", bytes: 99 }
          }
        },
        {
          minute: currentMinute - (49 * 60 * 60 * 1_000),
          accounts: { rdw_old: { provider: "realdebrid", label: "Old", bytes: 500 } }
        },
        {
          minute: currentMinute + 120_000,
          accounts: { rdw_future: { provider: "realdebrid", label: "Future", bytes: 500 } }
        }
      ]
    };

    const normalized = normalizeStatisticsLedger(raw, now);

    expect(normalized.minutes).toHaveLength(1);
    expect(normalized.minutes[0].minute).toBe(keptMinute);
    expect(normalized.minutes[0].downloadedBytes).toBe(50);
    expect(normalized.minutes[0].accounts.rdw_one.bytes).toBe(50);
    expect(normalized.minutes[0].accounts.rdw_one.label).not.toContain("secret@example.test");
    expect(normalized.minutes[0].accounts).not.toHaveProperty("https://unsafe");
  });

  it("records separate accounts and projects no minute history into renderer snapshots", () => {
    const now = localTime(10);
    const ledger = createStatisticsLedger(now);

    addStatisticsAccountBytesInPlace(ledger, "realdebrid", 50, "rdw_one", "Primary", now);
    addStatisticsAccountBytesInPlace(ledger, "realdebrid", 75, "rdw_two", "Secondary", now);
    addStatisticsAccountBytesInPlace(ledger, "debridlink", 25, undefined, undefined, now);

    expect(ledger.minutes).toHaveLength(1);
    expect(ledger.minutes[0].downloadedBytes).toBe(150);
    expect(ledger.minutes[0].accounts).toMatchObject({
      rdw_one: { provider: "realdebrid", label: "Primary", bytes: 50 },
      rdw_two: { provider: "realdebrid", label: "Secondary", bytes: 75 },
      "provider:debridlink": { provider: "debridlink", label: "Debrid-Link", bytes: 25 }
    });
    expect(projectStatisticsLedger(ledger, now).minutes).toEqual([]);
    expect(ledger.minutes).toHaveLength(1);
  });

  it("maintains rolling account totals incrementally and expires the boundary minute", () => {
    const now = localTime(10);
    const oldMinute = now - (24 * 60 * 60 * 1_000) - 60_000;
    const boundaryMinute = Math.floor((now - (24 * 60 * 60 * 1_000)) / 60_000) * 60_000;
    const ledger = createStatisticsLedger(now);
    addStatisticsAccountBytesInPlace(ledger, "realdebrid", 500, "rdw_old", "Old", oldMinute);
    addStatisticsAccountBytesInPlace(ledger, "realdebrid", 100, "rdw_boundary", "Boundary", boundaryMinute);
    const accumulator = new RollingAccountStatisticsAccumulator(ledger, now);

    accumulator.record("realdebrid", 50, "rdw_one", "Primary", now);
    accumulator.record("realdebrid", 75, "rdw_two", "Secondary", now);
    const current = accumulator.snapshot(now);

    expect(current.downloadedBytes).toBe(225);
    expect(current.accounts.map((account) => [account.id, account.bytes])).toEqual([
      ["rdw_boundary", 100],
      ["rdw_two", 75],
      ["rdw_one", 50]
    ]);
    expect(current.accounts).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "rdw_old" })]));

    const expired = accumulator.snapshot(now + 60_000);
    expect(expired.downloadedBytes).toBe(125);
    expect(expired.accounts).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "rdw_boundary" })]));
  });

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

  it("reconciles provider usage unless the day carries an explicit reset marker", () => {
    const previousDay = recordStatisticsBytes(createStatisticsLedger(localTime(9)), "debridlink", 200, localTime(9));
    const migrated = seedStatisticsDayProviderBytes(previousDay, { realdebrid: 500 }, localTime(10));

    expect(migrated.days).toEqual([
      expect.objectContaining({ day: "2026-08-09", downloadedBytes: 200 }),
      expect.objectContaining({ day: "2026-08-10", downloadedBytes: 500, providers: { realdebrid: expect.objectContaining({ bytes: 500 }) } })
    ]);

    const existingToday = recordStatisticsBytes(createStatisticsLedger(localTime(10)), "realdebrid", 200, localTime(10));
    expect(seedStatisticsDayProviderBytes(existingToday, { realdebrid: 500 }, localTime(10)).days[0]).toMatchObject({
      downloadedBytes: 500,
      providers: { realdebrid: expect.objectContaining({ bytes: 500 }) }
    });

    const resetDay = suppressStatisticsProviderSeedForDay(createStatisticsLedger(localTime(10)), localTime(10));
    const preserved = seedStatisticsDayProviderBytes(resetDay, { realdebrid: 500 }, localTime(10));

    expect(preserved.providerSeedSuppressedDay).toBe("2026-08-10");
    expect(preserved.days).toEqual([]);
  });

  it("catches up only provider traffic recorded after a statistics reset baseline", () => {
    const now = localTime(10);
    const reset = suppressStatisticsProviderSeedForDay(
      createStatisticsLedger(now),
      now,
      { realdebrid: 500, debridlink: 200 }
    );
    const staleSavedLedger = recordStatisticsBytes(reset, "realdebrid", 100, now);

    const caughtUp = seedStatisticsDayProviderBytes(
      staleSavedLedger,
      { realdebrid: 650, debridlink: 200, deepbrid: 50 },
      now
    );

    expect(caughtUp.providerSeedSuppressedDay).toBe("2026-08-10");
    expect(caughtUp.providerSeedBaselineBytes).toEqual({ realdebrid: 500, debridlink: 200 });
    expect(caughtUp.providerBytesOnlyDays).toEqual(["2026-08-10"]);
    expect(caughtUp.days[0]).toMatchObject({
      downloadedBytes: 200,
      providers: {
        realdebrid: { bytes: 150 },
        deepbrid: { bytes: 50 }
      }
    });
    expect(caughtUp.days[0].providers.debridlink).toBeUndefined();
  });

  it("normalizes reset baselines and preserves legacy marker suppression", () => {
    const now = localTime(10);
    const normalized = normalizeStatisticsLedger({
      ...createStatisticsLedger(now),
      providerSeedSuppressedDay: "2026-08-10",
      providerSeedBaselineBytes: { realdebrid: 100.9, deepbrid: -5, unsafe: 999 }
    }, now);

    expect(normalized.providerSeedBaselineBytes).toEqual({ realdebrid: 100, deepbrid: -5 });

    const legacy = normalizeStatisticsLedger({
      ...createStatisticsLedger(now),
      providerSeedSuppressedDay: "2026-08-10"
    }, now);
    expect(legacy.providerSeedBaselineBytes).toBeUndefined();
    expect(seedStatisticsDayProviderBytes(legacy, { realdebrid: 500 }, now).days).toEqual([]);

    const nextDay = seedStatisticsDayProviderBytes(normalized, { realdebrid: 25 }, localTime(11));
    expect(nextDay.providerSeedSuppressedDay).toBeUndefined();
    expect(nextDay.providerSeedBaselineBytes).toBeUndefined();
    expect(nextDay.days[0]?.providers.realdebrid?.bytes).toBe(25);
  });

  it("rebases an active provider quota baseline without losing post-reset statistics", () => {
    const now = localTime(10);
    const reset = suppressStatisticsProviderSeedForDay(createStatisticsLedger(now), now, {
      realdebrid: 500,
      debridlink: 200
    });
    const withPostResetTraffic = recordStatisticsBytes(reset, "realdebrid", 200, now);

    const rebased = rebaseStatisticsProviderSeedBaseline(withPostResetTraffic, "realdebrid", 0, now);
    const afterMoreTraffic = seedStatisticsDayProviderBytes(rebased, { realdebrid: 100, debridlink: 200 }, now);

    expect(rebased.providerSeedBaselineBytes).toEqual({ realdebrid: -200, debridlink: 200 });
    expect(rebased.days[0]?.providers.realdebrid?.bytes).toBe(200);
    expect(afterMoreTraffic.days[0]?.providers.realdebrid?.bytes).toBe(300);
    expect(afterMoreTraffic.days[0]?.downloadedBytes).toBe(300);
  });

  it("establishes a catch-up baseline when quota usage is reset without a statistics reset", () => {
    const now = localTime(10);
    const existing = recordStatisticsBytes(createStatisticsLedger(now), "realdebrid", 500, now);
    const rebased = rebaseStatisticsProviderSeedBaseline(existing, "realdebrid", 0, now);
    const restored = seedStatisticsDayProviderBytes(rebased, { realdebrid: 100 }, now);

    expect(rebased.providerSeedSuppressedDay).toBe("2026-08-10");
    expect(rebased.providerSeedBaselineBytes).toEqual({ realdebrid: -500 });
    expect(restored.days[0]?.providers.realdebrid?.bytes).toBe(600);
    expect(restored.days[0]?.downloadedBytes).toBe(600);
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
    ledger.providerBytesOnlyDays = ["2026-08-10"];

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
