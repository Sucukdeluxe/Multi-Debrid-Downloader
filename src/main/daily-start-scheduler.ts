import type { DailyStartOutcome, DailyStartSettings } from "../shared/types";

interface DailyStartSnapshot {
  settings: DailyStartSettings;
  session: {
    running: boolean;
    paused: boolean;
    items: Record<string, { status: string; packageId: string }>;
    packages: Record<string, { enabled: boolean; cancelled: boolean }>;
  };
  canStart: boolean;
}

interface DailyStartController {
  getSnapshot(): DailyStartSnapshot;
  updateSettings(partial: Partial<DailyStartSettings>): unknown;
  start(): Promise<void>;
}

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

function parseLocalDate(value: string): LocalDateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (year < 1000 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return { year, month, day };
}

function formatLocalDate(date: Date): string {
  return `${date.getFullYear().toString().padStart(4, "0")}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}`;
}

function addLocalDays(value: string, days: number): string {
  const parts = parseLocalDate(value);
  if (!parts) {
    return "";
  }
  return formatLocalDate(new Date(parts.year, parts.month - 1, parts.day + days, 12, 0, 0, 0));
}

function localTargetEpochMs(value: string, minuteOfDay: number): number {
  const parts = parseLocalDate(value);
  if (!parts) {
    return 0;
  }
  const minute = Math.max(0, Math.min(1_439, Math.floor(minuteOfDay)));
  return new Date(parts.year, parts.month - 1, parts.day, Math.floor(minute / 60), minute % 60, 0, 0).getTime();
}

export function isValidLocalDate(value: string): boolean {
  return parseLocalDate(value) !== null;
}

export function nextDailyStartEpochMs(settings: DailyStartSettings, nowEpochMs = Date.now()): number {
  if (!settings.dailyStartEnabled || !Number.isFinite(settings.dailyStartMinuteOfDay)) {
    return 0;
  }
  const firstDate = parseLocalDate(settings.dailyStartFirstLocalDate);
  if (!firstDate) {
    return 0;
  }
  const now = new Date(nowEpochMs);
  const today = formatLocalDate(now);
  let candidate = settings.dailyStartFirstLocalDate > today ? settings.dailyStartFirstLocalDate : today;
  const pending = isValidLocalDate(settings.dailyStartPendingLocalDate)
    ? settings.dailyStartPendingLocalDate
    : "";
  if (pending && candidate < pending) {
    candidate = pending;
  }
  const handled = isValidLocalDate(settings.dailyStartLastHandledLocalDate)
    ? settings.dailyStartLastHandledLocalDate
    : "";
  if (handled && candidate <= handled) {
    candidate = addLocalDays(handled, 1);
  }
  return localTargetEpochMs(candidate, settings.dailyStartMinuteOfDay);
}

export function hasDailyStartRulePatch(partial: object): boolean {
  const value = partial as Record<string, unknown>;
  return ["dailyStartEnabled", "dailyStartMinuteOfDay", "dailyStartFirstLocalDate"]
    .some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

export function prepareDailyStartSettingsPatch<T extends object>(
  partial: T,
  current: DailyStartSettings
): T & { scheduledStartEpochMs?: number } {
  const value = partial as Record<string, unknown>;
  const changed = (
    Object.prototype.hasOwnProperty.call(value, "dailyStartEnabled")
      && value.dailyStartEnabled !== current.dailyStartEnabled
  ) || (
    Object.prototype.hasOwnProperty.call(value, "dailyStartMinuteOfDay")
      && value.dailyStartMinuteOfDay !== current.dailyStartMinuteOfDay
  ) || (
    Object.prototype.hasOwnProperty.call(value, "dailyStartFirstLocalDate")
      && value.dailyStartFirstLocalDate !== current.dailyStartFirstLocalDate
  );
  return changed
    ? { ...partial, scheduledStartEpochMs: 0 }
    : { ...partial };
}

export function shouldDeferAutoResumeToDailyStart(
  settings: DailyStartSettings,
  wasRunning: boolean,
  nowEpochMs = Date.now()
): boolean {
  return !wasRunning && nextDailyStartEpochMs(settings, nowEpochMs) > nowEpochMs;
}

export class DailyStartScheduler {
  private reconcileInFlight: Promise<DailyStartOutcome | null> | null = null;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private lifecycleGeneration = 0;

  public constructor(
    private readonly controller: DailyStartController,
    private readonly now: () => number = Date.now
  ) {}

  public reconcile(): Promise<DailyStartOutcome | null> {
    if (this.reconcileInFlight) {
      return this.reconcileInFlight;
    }
    const operation = this.reconcileOnce(this.lifecycleGeneration);
    this.reconcileInFlight = operation;
    void operation.finally(() => {
      if (this.reconcileInFlight === operation) {
        this.reconcileInFlight = null;
      }
    }).catch(() => {});
    return operation;
  }

  public begin(onError: (error: unknown) => void = () => {}): void {
    this.end();
    void this.reconcile().catch(onError);
    this.reconcileTimer = setInterval(() => {
      void this.reconcile().catch(onError);
    }, 60_000);
    this.reconcileTimer.unref?.();
  }

  public end(): void {
    this.lifecycleGeneration += 1;
    if (this.reconcileTimer !== null) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
  }

  private finish(localDate: string, outcome: DailyStartOutcome): DailyStartOutcome {
    this.controller.updateSettings({
      dailyStartLastHandledLocalDate: localDate,
      dailyStartPendingLocalDate: "",
      dailyStartLastOutcome: outcome
    });
    return outcome;
  }

  private async reconcileOnce(generation: number): Promise<DailyStartOutcome | null> {
    const nowEpochMs = this.now();
    let settings = this.controller.getSnapshot().settings;
    if (!settings.dailyStartEnabled || !isValidLocalDate(settings.dailyStartFirstLocalDate)) {
      return null;
    }

    const today = formatLocalDate(new Date(nowEpochMs));
    const handledDate = isValidLocalDate(settings.dailyStartLastHandledLocalDate)
      ? settings.dailyStartLastHandledLocalDate
      : "";
    const pendingDate = isValidLocalDate(settings.dailyStartPendingLocalDate)
      ? settings.dailyStartPendingLocalDate
      : "";
    if ((handledDate && today <= handledDate) || (pendingDate && today < pendingDate)) {
      return null;
    }
    let missed: DailyStartOutcome | null = null;
    if (isValidLocalDate(settings.dailyStartPendingLocalDate) && settings.dailyStartPendingLocalDate < today) {
      const missedDate = settings.dailyStartPendingLocalDate;
      const lastHandledLocalDate = handledDate > missedDate ? handledDate : missedDate;
      this.controller.updateSettings({
        dailyStartLastHandledLocalDate: lastHandledLocalDate,
        dailyStartPendingLocalDate: "",
        dailyStartLastOutcome: "missed"
      });
      settings = {
        ...settings,
        dailyStartLastHandledLocalDate: lastHandledLocalDate,
        dailyStartPendingLocalDate: "",
        dailyStartLastOutcome: "missed"
      };
      missed = "missed";
    }

    if (today < settings.dailyStartFirstLocalDate || settings.dailyStartLastHandledLocalDate === today) {
      return missed;
    }
    const targetEpochMs = localTargetEpochMs(today, settings.dailyStartMinuteOfDay);
    if (!targetEpochMs || targetEpochMs > nowEpochMs) {
      return missed;
    }

    if (settings.dailyStartPendingLocalDate === today) {
      return this.finish(today, settings.dailyStartLastOutcome || "start_failed");
    }

    const snapshot = this.controller.getSnapshot();
    if (snapshot.session.running || snapshot.session.paused) {
      return this.finish(today, "already_active");
    }
    const hasQueuedItems = Object.values(snapshot.session.items).some((item) => {
      if (item.status !== "queued" && item.status !== "reconnect_wait") {
        return false;
      }
      const pkg = snapshot.session.packages[item.packageId];
      return Boolean(pkg && pkg.enabled && !pkg.cancelled);
    });
    if (!hasQueuedItems) {
      return this.finish(today, "empty_queue");
    }
    if (!snapshot.canStart) {
      this.controller.updateSettings({ dailyStartLastOutcome: "missing_account" });
      return "missing_account";
    }

    this.controller.updateSettings({
      dailyStartPendingLocalDate: today,
      dailyStartLastOutcome: "start_failed"
    });
    try {
      await this.controller.start();
    } catch (error) {
      if (generation !== this.lifecycleGeneration) {
        return null;
      }
      this.controller.updateSettings({
        dailyStartPendingLocalDate: "",
        dailyStartLastOutcome: "start_failed"
      });
      throw error;
    }
    if (generation !== this.lifecycleGeneration) {
      return null;
    }
    return this.finish(today, "started");
  }
}
