import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { AppSettings, DailyStartSettings } from "../src/shared/types";
import { DailyStartScheduler, nextDailyStartEpochMs, prepareDailyStartSettingsPatch, shouldDeferAutoResumeToDailyStart } from "../src/main/daily-start-scheduler";
import { defaultSettings } from "../src/main/constants";
import { configureCredentialProtector } from "../src/main/credential-protection";
import { createStoragePaths, loadSettings, saveSettings } from "../src/main/storage";

const originalTimezone = process.env.TZ;
process.env.TZ = "Europe/Berlin";

afterAll(() => {
  if (originalTimezone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTimezone;
  }
});

function settings(overrides: Partial<DailyStartSettings> = {}): DailyStartSettings {
  return {
    dailyStartEnabled: true,
    dailyStartMinuteOfDay: 10 * 60,
    dailyStartFirstLocalDate: "2026-08-22",
    dailyStartLastHandledLocalDate: "",
    dailyStartPendingLocalDate: "",
    dailyStartLastOutcome: "",
    ...overrides
  };
}

class FakeDailyStartController {
  public settings: DailyStartSettings;
  public running = false;
  public paused = false;
  public canStart = true;
  public items: Record<string, { status: string; packageId: string }> = { queued: { status: "queued", packageId: "package" } };
  public packages: Record<string, { enabled: boolean; cancelled: boolean }> = {
    package: { enabled: true, cancelled: false }
  };
  public events: string[] = [];
  public start = vi.fn(async () => {
    this.events.push("start");
  });

  public constructor(
    value: DailyStartSettings,
    private readonly persist?: (value: DailyStartSettings) => void
  ) {
    this.settings = value;
  }

  public getSnapshot() {
    return {
      settings: this.settings,
      session: {
        running: this.running,
        paused: this.paused,
        items: this.items,
        packages: this.packages
      },
      canStart: this.canStart
    };
  }

  public updateSettings(partial: Partial<DailyStartSettings>): DailyStartSettings {
    Object.assign(this.settings, partial);
    if (partial.dailyStartPendingLocalDate) {
      this.events.push(`pending:${partial.dailyStartPendingLocalDate}`);
    }
    if (partial.dailyStartLastHandledLocalDate) {
      this.events.push(`handled:${partial.dailyStartLastHandledLocalDate}`);
    }
    this.persist?.(this.settings);
    return this.settings;
  }
}

describe("daily start scheduler", () => {
  it("keeps today's future and past targets on the local calendar date", () => {
    const futureNow = new Date(2026, 7, 22, 9, 15).getTime();
    const pastNow = new Date(2026, 7, 22, 12, 30).getTime();
    const expected = new Date(2026, 7, 22, 10, 0, 0, 0).getTime();

    expect(nextDailyStartEpochMs(settings(), futureNow)).toBe(expected);
    expect(nextDailyStartEpochMs(settings(), pastNow)).toBe(expected);
  });

  it("uses tomorrow as the first eligible local date", () => {
    const now = new Date(2026, 7, 22, 8, 0).getTime();

    expect(nextDailyStartEpochMs(settings({ dailyStartFirstLocalDate: "2026-08-23" }), now))
      .toBe(new Date(2026, 7, 23, 10, 0, 0, 0).getTime());
  });

  it("dispatches once on each of five eligible local days", async () => {
    let now = new Date(2026, 7, 22, 10, 5).getTime();
    const controller = new FakeDailyStartController(settings());
    const scheduler = new DailyStartScheduler(controller, () => now);

    for (let day = 22; day <= 26; day += 1) {
      now = new Date(2026, 7, day, 10, 5).getTime();
      await scheduler.reconcile();
    }

    expect(controller.start).toHaveBeenCalledTimes(5);
    expect(controller.settings.dailyStartLastHandledLocalDate).toBe("2026-08-26");
  });

  it("persists pending before dispatch and coalesces simultaneous reconciles", async () => {
    const now = new Date(2026, 7, 22, 10, 5).getTime();
    const controller = new FakeDailyStartController(settings());
    const scheduler = new DailyStartScheduler(controller, () => now);

    await Promise.all([scheduler.reconcile(), scheduler.reconcile()]);

    expect(controller.start).toHaveBeenCalledTimes(1);
    expect(controller.events).toEqual([
      "pending:2026-08-22",
      "start",
      "handled:2026-08-22"
    ]);
    expect(controller.settings.dailyStartPendingLocalDate).toBe("");
    expect(controller.settings.dailyStartLastOutcome).toBe("started");
  });

  it("catches an overdue target after a clock jump without dispatching twice", async () => {
    let now = new Date(2026, 7, 22, 9, 55).getTime();
    const controller = new FakeDailyStartController(settings());
    const scheduler = new DailyStartScheduler(controller, () => now);

    expect(await scheduler.reconcile()).toBeNull();
    now = new Date(2026, 7, 22, 11, 10).getTime();
    expect(await scheduler.reconcile()).toBe("started");
    expect(await scheduler.reconcile()).toBeNull();

    expect(controller.start).toHaveBeenCalledTimes(1);
  });

  it("does not redispatch when the local calendar moves behind a handled or pending day", async () => {
    const now = new Date(2026, 7, 22, 11, 0).getTime();
    const handledController = new FakeDailyStartController(settings({
      dailyStartLastHandledLocalDate: "2026-08-23"
    }));
    const pendingController = new FakeDailyStartController(settings({
      dailyStartPendingLocalDate: "2026-08-23"
    }));

    expect(await new DailyStartScheduler(handledController, () => now).reconcile()).toBeNull();
    expect(await new DailyStartScheduler(pendingController, () => now).reconcile()).toBeNull();

    expect(handledController.start).not.toHaveBeenCalled();
    expect(pendingController.start).not.toHaveBeenCalled();
    expect(handledController.settings.dailyStartLastHandledLocalDate).toBe("2026-08-23");
    expect(pendingController.settings.dailyStartPendingLocalDate).toBe("2026-08-23");
    expect(nextDailyStartEpochMs(handledController.settings, now)).toBe(new Date(2026, 7, 24, 10, 0).getTime());
    expect(nextDailyStartEpochMs(pendingController.settings, now)).toBe(new Date(2026, 7, 23, 10, 0).getTime());
  });

  it("does not regress last handled when an older pending receipt expires", async () => {
    const now = new Date(2026, 7, 23, 9, 0).getTime();
    const controller = new FakeDailyStartController(settings({
      dailyStartLastHandledLocalDate: "2026-08-22",
      dailyStartPendingLocalDate: "2026-08-21"
    }));

    expect(await new DailyStartScheduler(controller, () => now).reconcile()).toBe("missed");
    expect(controller.start).not.toHaveBeenCalled();
    expect(controller.settings.dailyStartLastHandledLocalDate).toBe("2026-08-22");
    expect(controller.settings.dailyStartPendingLocalDate).toBe("");
  });

  it("treats repeated suspend and resume reconciles as one daily dispatch", async () => {
    const now = new Date(2026, 7, 22, 10, 5).getTime();
    const controller = new FakeDailyStartController(settings());
    const scheduler = new DailyStartScheduler(controller, () => now);

    await scheduler.reconcile();
    await scheduler.reconcile();
    await scheduler.reconcile();

    expect(controller.start).toHaveBeenCalledTimes(1);
  });

  it("recovers a persisted pending receipt after restart and then deduplicates it", async () => {
    const now = new Date(2026, 7, 22, 10, 5).getTime();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-daily-restart-"));
    const paths = createStoragePaths(dir);
    configureCredentialProtector({
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(value, "utf8"),
      decryptString: (value) => Buffer.from(value).toString("utf8")
    });
    saveSettings(paths, {
      ...defaultSettings(),
      ...settings({ dailyStartPendingLocalDate: "2026-08-22" })
    });

    try {
      const restartedController = new FakeDailyStartController(
        loadSettings(paths),
        (value) => saveSettings(paths, value as AppSettings)
      );
      await new DailyStartScheduler(restartedController, () => now).reconcile();

      expect(restartedController.start).toHaveBeenCalledTimes(1);
      expect(restartedController.settings.dailyStartLastHandledLocalDate).toBe("2026-08-22");
      expect(restartedController.settings.dailyStartPendingLocalDate).toBe("");

      const secondRestartController = new FakeDailyStartController(loadSettings(paths));
      await new DailyStartScheduler(secondRestartController, () => now).reconcile();

      expect(secondRestartController.start).not.toHaveBeenCalled();
      expect(secondRestartController.settings.dailyStartLastHandledLocalDate).toBe("2026-08-22");
      expect(secondRestartController.settings.dailyStartPendingLocalDate).toBe("");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("marks an empty queue handled without calling start", async () => {
    const now = new Date(2026, 7, 22, 10, 5).getTime();
    const controller = new FakeDailyStartController(settings());
    controller.items = {};

    expect(await new DailyStartScheduler(controller, () => now).reconcile()).toBe("empty_queue");
    expect(controller.start).not.toHaveBeenCalled();
    expect(controller.settings.dailyStartLastHandledLocalDate).toBe("2026-08-22");
    expect(controller.settings.dailyStartLastOutcome).toBe("empty_queue");
  });

  it("treats queued items in disabled packages as an empty startable queue", async () => {
    const now = new Date(2026, 7, 22, 10, 5).getTime();
    const controller = new FakeDailyStartController(settings());
    controller.packages.package.enabled = false;

    expect(await new DailyStartScheduler(controller, () => now).reconcile()).toBe("empty_queue");
    expect(controller.start).not.toHaveBeenCalled();
    expect(controller.settings.dailyStartLastHandledLocalDate).toBe("2026-08-22");
    expect(controller.settings.dailyStartLastOutcome).toBe("empty_queue");
  });

  it("keeps a missing-account occurrence pending and retries after account recovery", async () => {
    const now = new Date(2026, 7, 22, 10, 5).getTime();
    const controller = new FakeDailyStartController(settings());
    controller.canStart = false;
    const scheduler = new DailyStartScheduler(controller, () => now);

    expect(await scheduler.reconcile()).toBe("missing_account");
    expect(controller.start).not.toHaveBeenCalled();
    expect(controller.settings.dailyStartPendingLocalDate).toBe("2026-08-22");
    expect(controller.settings.dailyStartLastHandledLocalDate).toBe("");

    controller.canStart = true;
    expect(await scheduler.reconcile()).toBe("started");
    expect(controller.start).toHaveBeenCalledTimes(1);
  });

  it("treats running and paused sessions as already active", async () => {
    let now = new Date(2026, 7, 22, 10, 5).getTime();
    const controller = new FakeDailyStartController(settings());
    controller.running = true;
    const scheduler = new DailyStartScheduler(controller, () => now);

    expect(await scheduler.reconcile()).toBe("already_active");
    controller.running = false;
    controller.paused = true;
    now = new Date(2026, 7, 23, 10, 5).getTime();
    expect(await scheduler.reconcile()).toBe("already_active");

    expect(controller.start).not.toHaveBeenCalled();
  });

  it("records a stale pending day as missed without disabling future days", async () => {
    const now = new Date(2026, 7, 23, 9, 0).getTime();
    const controller = new FakeDailyStartController(settings({ dailyStartPendingLocalDate: "2026-08-22" }));
    const scheduler = new DailyStartScheduler(controller, () => now);

    expect(await scheduler.reconcile()).toBe("missed");
    expect(controller.settings.dailyStartEnabled).toBe(true);
    expect(controller.settings.dailyStartLastHandledLocalDate).toBe("2026-08-22");
    expect(controller.settings.dailyStartLastOutcome).toBe("missed");
    expect(nextDailyStartEpochMs(controller.settings, now)).toBe(new Date(2026, 7, 23, 10, 0).getTime());
  });

  it("keeps start failures pending for a later retry", async () => {
    const now = new Date(2026, 7, 22, 10, 5).getTime();
    const controller = new FakeDailyStartController(settings());
    controller.start.mockRejectedValueOnce(new Error("start rejected"));
    const scheduler = new DailyStartScheduler(controller, () => now);

    await expect(scheduler.reconcile()).rejects.toThrow("start rejected");
    expect(controller.settings.dailyStartPendingLocalDate).toBe("2026-08-22");
    expect(controller.settings.dailyStartLastHandledLocalDate).toBe("");
    expect(controller.settings.dailyStartLastOutcome).toBe("start_failed");

    await scheduler.reconcile();
    expect(controller.start).toHaveBeenCalledTimes(2);
  });

  it("does not consume a pending day when shutdown invalidates an in-flight start", async () => {
    const now = new Date(2026, 7, 22, 10, 5).getTime();
    const controller = new FakeDailyStartController(settings());
    let resolveStart!: () => void;
    controller.start.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveStart = resolve;
    }));
    const scheduler = new DailyStartScheduler(controller, () => now);

    const reconcile = scheduler.reconcile();
    expect(controller.start).toHaveBeenCalledTimes(1);
    expect(controller.settings.dailyStartPendingLocalDate).toBe("2026-08-22");

    scheduler.end();
    resolveStart();

    expect(await reconcile).toBeNull();
    expect(controller.settings.dailyStartPendingLocalDate).toBe("2026-08-22");
    expect(controller.settings.dailyStartLastHandledLocalDate).toBe("");
    expect(controller.settings.dailyStartLastOutcome).toBe("");
  });

  it("constructs each DST target from local calendar fields instead of adding 24 hours", () => {
    const beforeDst = settings({
      dailyStartMinuteOfDay: 2 * 60 + 30,
      dailyStartFirstLocalDate: "2026-03-29"
    });
    const firstNow = new Date(2026, 2, 28, 12, 0).getTime();
    const firstTarget = nextDailyStartEpochMs(beforeDst, firstNow);
    const nextTarget = nextDailyStartEpochMs({
      ...beforeDst,
      dailyStartLastHandledLocalDate: "2026-03-29"
    }, new Date(2026, 2, 29, 12, 0).getTime());

    expect(firstTarget).toBe(new Date(2026, 2, 29, 2, 30, 0, 0).getTime());
    expect(nextTarget).toBe(new Date(2026, 2, 30, 2, 30, 0, 0).getTime());
    expect(nextTarget - firstTarget).toBe(23 * 60 * 60 * 1000);
  });

  it("clears a legacy one-time target only when a new daily rule is saved", () => {
    expect(prepareDailyStartSettingsPatch({
      dailyStartEnabled: true,
      dailyStartMinuteOfDay: 600,
      dailyStartFirstLocalDate: "2026-08-22"
    })).toEqual({
      dailyStartEnabled: true,
      dailyStartMinuteOfDay: 600,
      dailyStartFirstLocalDate: "2026-08-22",
      scheduledStartEpochMs: 0
    });
    expect(prepareDailyStartSettingsPatch({ dailyStartPendingLocalDate: "2026-08-22" }))
      .toEqual({ dailyStartPendingLocalDate: "2026-08-22" });
  });

  it("defers boot auto-resume for a future daily target unless the saved run was active", () => {
    const now = new Date(2026, 7, 22, 9, 0).getTime();
    const future = settings({ dailyStartMinuteOfDay: 10 * 60 });

    expect(shouldDeferAutoResumeToDailyStart(future, false, now)).toBe(true);
    expect(shouldDeferAutoResumeToDailyStart(future, true, now)).toBe(false);
    expect(shouldDeferAutoResumeToDailyStart({ ...future, dailyStartEnabled: false }, false, now)).toBe(false);
    expect(shouldDeferAutoResumeToDailyStart({ ...future, dailyStartMinuteOfDay: 8 * 60 }, false, now)).toBe(false);
  });

  it("reconciles at boot and at most sixty seconds after a target becomes due", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 22, 9, 59, 30));
    try {
      const controller = new FakeDailyStartController(settings());
      const scheduler = new DailyStartScheduler(controller);

      scheduler.begin();
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.start).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(60_000);
      expect(controller.start).toHaveBeenCalledTimes(1);

      scheduler.end();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(controller.start).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
