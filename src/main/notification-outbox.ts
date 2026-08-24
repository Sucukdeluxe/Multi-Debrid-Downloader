import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { DiscordEmbedFieldPayload } from "./notify";
import { projectPackageFailureCategory } from "./package-telemetry";
import type { FailurePhase } from "../shared/types";

export type NotificationEventType =
  | "package_completed"
  | "package_partial"
  | "package_failed"
  | "package_cancelled"
  | "run_completed"
  | "run_stopped"
  | "remaining_threshold_crossed"
  | "download_stalled"
  | "download_recovered";

export type NotificationPriority = "success" | "error";

export interface NotificationEventPayload {
  title: string;
  description?: string;
  color?: number;
  fields: DiscordEmbedFieldPayload[];
}

export interface NotificationEvent {
  id: string;
  type: NotificationEventType;
  priority: NotificationPriority;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  nextAttemptAt: number;
  payload: NotificationEventPayload;
}

export interface NotificationOutboxStatus {
  queued: number;
  lastSuccessAt: number;
  lastFailureAt: number;
}

export interface NotificationOutboxOptions {
  filePath: string;
  send: (event: NotificationEvent) => Promise<boolean>;
  onDelivered?: (event: NotificationEvent, deliveredAt: number) => void | Promise<void>;
  now?: () => number;
  autoDrain?: boolean;
}

interface PersistedNotificationOutbox {
  version: 1;
  events: NotificationEvent[];
  lastSuccessAt: number;
  lastFailureAt: number;
}

const EVENT_TYPES = new Set<NotificationEventType>([
  "package_completed",
  "package_partial",
  "package_failed",
  "package_cancelled",
  "run_completed",
  "run_stopped",
  "remaining_threshold_crossed",
  "download_stalled",
  "download_recovered"
]);
const MAX_EVENTS = 250;
const MAX_RETRY_DELAY_MS = 10 * 60 * 1000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 3000;
const PACKAGE_FAILURE_EVENT_TYPES = new Set<NotificationEventType>([
  "package_partial",
  "package_failed",
  "package_cancelled"
]);
const PACKAGE_FAILURE_PHASES = new Map<string, FailurePhase>([
  ["Download", "download"],
  ["Entpacken", "extract"],
  ["Remux", "remux"],
  ["Aufräumen", "cleanup"],
  ["Nachbearbeitung", "postprocess"]
]);

function finiteInteger(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : fallback;
}

function sanitizePackageFailureFieldValue(value: string): string {
  const match = /^(Download|Entpacken|Remux|Aufräumen|Nachbearbeitung)(?:\s*·\s*(.*))?$/s.exec(value.trim());
  if (!match) {
    return "Unbekannt";
  }
  const phase = PACKAGE_FAILURE_PHASES.get(match[1]) ?? null;
  return `${match[1]} · ${projectPackageFailureCategory(phase, match[2])}`;
}

function sanitizeEvent(value: unknown): NotificationEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Partial<NotificationEvent>;
  const id = typeof raw.id === "string" ? raw.id.trim().slice(0, 256) : "";
  const type = EVENT_TYPES.has(raw.type as NotificationEventType) ? raw.type as NotificationEventType : null;
  const priority = raw.priority === "success" || raw.priority === "error" ? raw.priority : null;
  const payload = raw.payload && typeof raw.payload === "object" && !Array.isArray(raw.payload)
    ? raw.payload as NotificationEventPayload
    : null;
  const title = typeof payload?.title === "string" ? payload.title.slice(0, 4096) : "";
  if (!id || !type || !priority || !payload || !title) {
    return null;
  }
  const fields = Array.isArray(payload.fields)
    ? payload.fields.slice(0, 25).flatMap((field) => {
      if (!field || typeof field !== "object") {
        return [];
      }
      const name = typeof field.name === "string" ? field.name.slice(0, 1024) : "";
      const rawFieldValue = typeof field.value === "string" ? field.value.slice(0, 4096) : "";
      const fieldValue = name === "Fehler" && PACKAGE_FAILURE_EVENT_TYPES.has(type)
        ? sanitizePackageFailureFieldValue(rawFieldValue)
        : rawFieldValue;
      return name && fieldValue ? [{ name, value: fieldValue, inline: Boolean(field.inline) }] : [];
    })
    : [];
  const description = typeof payload.description === "string" ? payload.description.slice(0, 8192) : undefined;
  const color = Number.isFinite(payload.color)
    ? Math.max(0, Math.min(0xffffff, Math.floor(payload.color as number)))
    : undefined;
  return {
    id,
    type,
    priority,
    createdAt: finiteInteger(raw.createdAt),
    expiresAt: finiteInteger(raw.expiresAt),
    attempts: finiteInteger(raw.attempts),
    nextAttemptAt: finiteInteger(raw.nextAttemptAt),
    payload: {
      title,
      ...(description !== undefined ? { description } : {}),
      ...(color !== undefined ? { color } : {}),
      fields
    }
  };
}

function oldestIndex(events: NotificationEvent[], predicate: (event: NotificationEvent) => boolean): number {
  let selected = -1;
  for (let index = 0; index < events.length; index += 1) {
    if (!predicate(events[index])) {
      continue;
    }
    if (selected < 0 || events[index].createdAt < events[selected].createdAt) {
      selected = index;
    }
  }
  return selected;
}

function retryDelayMs(attempts: number): number {
  return Math.min(MAX_RETRY_DELAY_MS, 1000 * (2 ** Math.min(30, Math.max(0, attempts - 1))));
}

export class NotificationOutbox {
  private events: NotificationEvent[] = [];
  private lastSuccessAt = 0;
  private lastFailureAt = 0;
  private operationChain: Promise<void> = Promise.resolve();
  private readonly filePath: string;
  private readonly sendEvent: (event: NotificationEvent) => Promise<boolean>;
  private readonly onDelivered: ((event: NotificationEvent, deliveredAt: number) => void | Promise<void>) | null;
  private readonly clock: () => number;
  private readonly autoDrain: boolean;
  private retryTimer: NodeJS.Timeout | null = null;
  private shutdownRequested = false;
  private drainOperation: Promise<void> | null = null;
  private inFlightEvent: NotificationEvent | null = null;
  private persistenceRequired = false;
  private persistenceRetryAttempts = 0;

  public constructor(options: NotificationOutboxOptions) {
    this.filePath = options.filePath;
    this.sendEvent = options.send;
    this.onDelivered = options.onDelivered || null;
    this.clock = options.now || Date.now;
    this.autoDrain = Boolean(options.autoDrain);
    this.load();
    if (this.autoDrain && this.events.length > 0) {
      this.scheduleDrain(Math.max(0, this.events[0].nextAttemptAt - this.clock()));
    }
  }

  public async enqueue(event: NotificationEvent): Promise<void> {
    await this.runExclusive(async () => {
      const normalized = sanitizeEvent(event);
      if (normalized && !this.events.some((queuedEvent) => queuedEvent.id === normalized.id)) {
        this.events.push(normalized);
      }
      await this.persist(this.clock());
    });
    if (this.autoDrain) {
      this.scheduleDrain(0);
    }
  }

  public drain(now?: number): Promise<void> {
    if (this.drainOperation) {
      return this.drainOperation;
    }
    const operation = this.performDrain(now).finally(() => {
      if (this.drainOperation === operation) {
        this.drainOperation = null;
      }
    });
    this.drainOperation = operation;
    return operation;
  }

  public async drainForShutdown(timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS): Promise<void> {
    this.shutdownRequested = true;
    this.clearRetryTimer();
    let timer: NodeJS.Timeout | null = null;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, Math.max(0, finiteInteger(timeoutMs, DEFAULT_SHUTDOWN_TIMEOUT_MS)));
    });
    const shutdownDrain = Promise.all([this.recoverPersistence(), this.drain()]).then(() => undefined);
    await Promise.race([shutdownDrain, timeout]);
    if (timer) {
      clearTimeout(timer);
    }
  }

  public getStatus(): NotificationOutboxStatus {
    return {
      queued: this.events.length,
      lastSuccessAt: this.lastSuccessAt,
      lastFailureAt: this.lastFailureAt
    };
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationChain.then(operation, operation);
    this.operationChain = result.then(() => undefined, () => undefined);
    return result;
  }

  private async performDrain(now?: number): Promise<void> {
    let currentNow = finiteInteger(now ?? this.clock());
    while (true) {
      const current = await this.runExclusive(async () => {
        if (this.persistenceRequired) {
          await this.persist(currentNow);
        }
        this.enforceLimits(currentNow);
        const next = this.events[0] || null;
        if (!next) {
          this.clearRetryTimer();
          await this.persist(finiteInteger(this.clock(), currentNow));
          return null;
        }
        if (next.nextAttemptAt > currentNow) {
          await this.persist(currentNow);
          if (this.autoDrain) {
            this.scheduleDrain(Math.max(0, next.nextAttemptAt - this.clock()));
          }
          return null;
        }
        this.inFlightEvent = next;
        return next;
      });
      if (!current) {
        return;
      }
      let sent = false;
      try {
        sent = await this.sendEvent(current);
      } catch {
        sent = false;
      }
      const outcomeAt = finiteInteger(this.clock(), currentNow);
      const delivered = await this.runExclusive(async () => {
        const index = this.events.indexOf(current);
        this.inFlightEvent = null;
        if (index < 0) {
          return false;
        }
        if (!sent) {
          const queued = this.events[index];
          queued.attempts += 1;
          queued.nextAttemptAt = outcomeAt + retryDelayMs(queued.attempts);
          this.lastFailureAt = outcomeAt;
          await this.persist(outcomeAt);
          if (this.autoDrain) {
            this.scheduleDrain(Math.max(0, queued.nextAttemptAt - this.clock()));
          }
          return false;
        }
        this.events.splice(index, 1);
        this.lastSuccessAt = outcomeAt;
        await this.persist(outcomeAt);
        return true;
      });
      if (!sent) {
        return;
      }
      if (delivered && this.onDelivered) {
        try {
          await this.onDelivered(current, outcomeAt);
        } catch {
        }
      }
      currentNow = finiteInteger(this.clock(), outcomeAt);
    }
  }

  private scheduleDrain(delayMs: number): void {
    if (this.shutdownRequested) {
      return;
    }
    this.clearRetryTimer();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.drain().catch(() => {});
    }, delayMs);
    this.retryTimer.unref?.();
  }

  private schedulePersistenceRetry(delayMs: number): void {
    if (this.shutdownRequested) {
      return;
    }
    this.clearRetryTimer();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.recoverPersistence()
        .then(() => {
          if (!this.shutdownRequested) {
            void this.drain().catch(() => {});
          }
        })
        .catch(() => {});
    }, delayMs);
    this.retryTimer.unref?.();
  }

  private recoverPersistence(): Promise<void> {
    return this.runExclusive(async () => {
      if (this.persistenceRequired) {
        await this.persist(this.clock());
      }
    });
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) {
      return;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<PersistedNotificationOutbox>;
      this.events = Array.isArray(parsed.events)
        ? parsed.events.flatMap((event) => {
          const normalized = sanitizeEvent(event);
          return normalized ? [normalized] : [];
        })
        : [];
      this.lastSuccessAt = finiteInteger(parsed.lastSuccessAt);
      this.lastFailureAt = finiteInteger(parsed.lastFailureAt);
      this.enforceLimits(this.clock());
    } catch {
      this.events = [];
      this.lastSuccessAt = 0;
      this.lastFailureAt = 0;
    }
    this.persistSync(this.clock());
  }

  private enforceLimits(now: number): void {
    this.events = this.events.filter((event) => event === this.inFlightEvent || event.expiresAt > now);
    while (this.events.length > MAX_EVENTS) {
      const successIndex = oldestIndex(this.events, (event) => event !== this.inFlightEvent && event.priority === "success");
      const removeIndex = successIndex >= 0
        ? successIndex
        : oldestIndex(this.events, (event) => event !== this.inFlightEvent);
      if (removeIndex < 0) {
        break;
      }
      this.events.splice(removeIndex, 1);
    }
  }

  private async persist(now: number): Promise<void> {
    this.persistenceRequired = true;
    this.enforceLimits(now);
    const tempPath = `${this.filePath}.tmp`;
    const state: PersistedNotificationOutbox = {
      version: 1,
      events: this.events,
      lastSuccessAt: this.lastSuccessAt,
      lastFailureAt: this.lastFailureAt
    };
    try {
      await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
      await fsp.writeFile(tempPath, JSON.stringify(state), "utf8");
      await fsp.rename(tempPath, this.filePath);
      this.persistenceRequired = false;
      this.persistenceRetryAttempts = 0;
    } catch (error) {
      await fsp.rm(tempPath, { force: true }).catch(() => {});
      this.persistenceRetryAttempts += 1;
      if (this.autoDrain) {
        this.schedulePersistenceRetry(retryDelayMs(this.persistenceRetryAttempts));
      }
      throw error;
    }
  }

  private persistSync(now: number): void {
    this.enforceLimits(now);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    const state: PersistedNotificationOutbox = {
      version: 1,
      events: this.events,
      lastSuccessAt: this.lastSuccessAt,
      lastFailureAt: this.lastFailureAt
    };
    try {
      fs.writeFileSync(tempPath, JSON.stringify(state), "utf8");
      fs.renameSync(tempPath, this.filePath);
    } catch (error) {
      try {
        fs.rmSync(tempPath, { force: true });
      } catch {
      }
      throw error;
    }
  }
}
