import { afterAll, describe, expect, it, vi } from "vitest";
import type { DailyStartSettings } from "../src/shared/types";
import { DailyStartScheduler, nextDailyStartEpochMs, prepareDailyStartSettingsPatch, shouldDeferAutoResumeToDailyStart } from "../src/main/daily-start-scheduler";

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
  public items: Record<string, { status: string }> = { queued: { status: "queued" } };
  public events: string[] = [];
  public start = vi.fn(async () => {
    this.events.push("start");
  });

  public constructor(value: DailyStartSettings) {
    this.settings = value;
  }

  public getSnapshot() {
    return {
      settings: this.settings,
      session: {
        running: this.running,
        paused: this.paused,
        items: this.items
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
    const controller = new FakeDailyStartController(settings({ dailyStartPendingLocalDate: "2026-08-22" }));

    await new DailyStartScheduler(controller, () => now).reconcile();
    await new DailyStartScheduler(controller, () => now).reconcile();

    expect(controller.start).toHaveBeenCalledTimes(1);
    expect(controller.settings.dailyStartLastHandledLocalDate).toBe("2026-08-22");
    expect(controller.settings.dailyStartPendingLocalDate).toBe("");
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
