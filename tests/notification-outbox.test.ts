import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationEvent, NotificationOutbox } from "../src/main/notification-outbox";
import { sendNotification } from "../src/main/notify";

const tempDirs: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createOutboxFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-notification-outbox-"));
  tempDirs.push(dir);
  return path.join(dir, "notification-outbox.json");
}

function event(id: string, overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    id,
    type: "package_failed",
    priority: "error",
    createdAt: 1000,
    expiresAt: 86401000,
    attempts: 0,
    nextAttemptAt: 1000,
    payload: {
      title: "Paket fehlgeschlagen",
      description: "Eine Datei ist fehlgeschlagen.",
      fields: []
    },
    ...overrides
  };
}

function persisted(filePath: string): { events: NotificationEvent[]; lastSuccessAt: number; lastFailureAt: number } {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as { events: NotificationEvent[]; lastSuccessAt: number; lastFailureAt: number };
}

describe("NotificationOutbox", () => {
  it("sends due events serially in stable enqueue order and removes each success", async () => {
    const filePath = createOutboxFile();
    const sent: string[] = [];
    const outbox = new NotificationOutbox({
      filePath,
      now: () => 1000,
      send: async (queuedEvent) => {
        sent.push(queuedEvent.id);
        return true;
      }
    });

    await outbox.enqueue(event("first"));
    await outbox.enqueue(event("second", { createdAt: 900 }));
    await outbox.enqueue(event("third"));
    await outbox.drain(1000);

    expect(sent).toEqual(["first", "second", "third"]);
    expect(outbox.getStatus()).toEqual({ queued: 0, lastSuccessAt: 1000, lastFailureAt: 0 });
    expect(persisted(filePath).events).toEqual([]);
  });

  it("backs off a failed event without allowing later events to overtake it", async () => {
    const filePath = createOutboxFile();
    let now = 1000;
    const outcomes = [false, true, true];
    const sent: string[] = [];
    const outbox = new NotificationOutbox({
      filePath,
      now: () => now,
      send: async (queuedEvent) => {
        sent.push(queuedEvent.id);
        return outcomes.shift() ?? true;
      }
    });

    await outbox.enqueue(event("first"));
    await outbox.enqueue(event("second"));
    await outbox.drain();
    expect(sent).toEqual(["first"]);
    expect(persisted(filePath).events[0]).toMatchObject({ id: "first", attempts: 1, nextAttemptAt: 2000 });
    expect(outbox.getStatus()).toEqual({ queued: 2, lastSuccessAt: 0, lastFailureAt: 1000 });

    now = 1999;
    await outbox.drain();
    expect(sent).toEqual(["first"]);
    now = 2000;
    await outbox.drain();
    expect(sent).toEqual(["first", "first", "second"]);
  });

  it("uses the actual failure time for retry backoff", async () => {
    const filePath = createOutboxFile();
    let now = 1000;
    const outbox = new NotificationOutbox({
      filePath,
      now: () => now,
      send: async () => {
        now = 4500;
        return false;
      }
    });

    await outbox.enqueue(event("late-failure"));
    await outbox.drain();

    expect(persisted(filePath).events[0]).toMatchObject({ attempts: 1, nextAttemptAt: 5500 });
    expect(outbox.getStatus().lastFailureAt).toBe(4500);
  });

  it("rechecks expiration after each send before delivering the next event", async () => {
    const filePath = createOutboxFile();
    let now = 1000;
    const sent: string[] = [];
    const outbox = new NotificationOutbox({
      filePath,
      now: () => now,
      send: async (queuedEvent) => {
        sent.push(queuedEvent.id);
        now = 2000;
        return true;
      }
    });

    await outbox.enqueue(event("first", { expiresAt: 5000 }));
    await outbox.enqueue(event("expires-during-send", { expiresAt: 1500 }));
    await outbox.drain();

    expect(sent).toEqual(["first"]);
    expect(outbox.getStatus()).toEqual({ queued: 0, lastSuccessAt: 2000, lastFailureAt: 0 });
  });

  it("caps exponential retry backoff at ten minutes after many attempts", async () => {
    const filePath = createOutboxFile();
    let now = 1000;
    const outbox = new NotificationOutbox({
      filePath,
      now: () => now,
      send: async () => {
        now = 2000;
        return false;
      }
    });

    await outbox.enqueue(event("many-attempts", { attempts: 20 }));
    await outbox.drain();

    expect(persisted(filePath).events[0]).toMatchObject({ attempts: 21, nextAttemptAt: 602000 });
  });

  it("restores a future retry timer and reads changed URL and mention only when retrying", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const filePath = createOutboxFile();
    const firstUrl = "https://discord.example.test/api/webhooks/first";
    const secondUrl = "https://discord.example.test/api/webhooks/second";
    let settings = { url: firstUrl, mention: "111111" };
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const sender = (queuedEvent: NotificationEvent): Promise<boolean> => sendNotification(settings.url, {
      title: queuedEvent.payload.title,
      message: queuedEvent.payload.description || "",
      mention: settings.mention,
      fields: queuedEvent.payload.fields,
      timestamp: queuedEvent.createdAt
    }, fetchFn, async () => {});
    const firstProcess = new NotificationOutbox({ filePath, send: sender });

    await firstProcess.enqueue(event("restart-retry"));
    await firstProcess.drain();
    expect(persisted(filePath).events[0]).toMatchObject({ attempts: 1, nextAttemptAt: 2000 });

    settings = { url: secondUrl, mention: "222222" };
    const restartedProcess = new NotificationOutbox({ filePath, send: sender, autoDrain: true });
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[0][0]).toBe(firstUrl);
    expect(fetchFn.mock.calls[1][0]).toBe(secondUrl);
    expect(JSON.parse(String(fetchFn.mock.calls[0][1]?.body)).content).toBe("<@111111>");
    expect(JSON.parse(String(fetchFn.mock.calls[1][1]?.body)).content).toBe("<@222222>");
    await restartedProcess.drain();
    expect(persisted(filePath).events).toEqual([]);
  });

  it("automatically drains new events and retries them at the persisted deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const filePath = createOutboxFile();
    const outcomes = [false, true];
    const send = vi.fn().mockImplementation(async () => outcomes.shift() ?? true);
    const outbox = new NotificationOutbox({ filePath, send, autoDrain: true });

    await outbox.enqueue(event("automatic"));
    await vi.advanceTimersByTimeAsync(0);
    await outbox.drain(1000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(outbox.getStatus().queued).toBe(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(outbox.getStatus().queued).toBe(0);
  });

  it("persists through a temporary file and atomic rename", async () => {
    const filePath = createOutboxFile();
    const rename = vi.spyOn(fsp, "rename");
    try {
      const outbox = new NotificationOutbox({ filePath, send: async () => true, now: () => 1000 });
      await outbox.enqueue(event("atomic"));
      expect(rename).toHaveBeenCalledWith(`${filePath}.tmp`, filePath);
      expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);
      expect(persisted(filePath).events.map((queuedEvent) => queuedEvent.id)).toEqual(["atomic"]);
    } finally {
      rename.mockRestore();
    }
  });

  it("drops expired events before persisting or sending", async () => {
    const filePath = createOutboxFile();
    const send = vi.fn().mockResolvedValue(true);
    const outbox = new NotificationOutbox({ filePath, send, now: () => 2000 });

    await outbox.enqueue(event("expired", { expiresAt: 1999 }));
    await outbox.drain(2000);

    expect(send).not.toHaveBeenCalled();
    expect(outbox.getStatus().queued).toBe(0);
    expect(persisted(filePath).events).toEqual([]);
  });

  it("caps the queue at 250 and evicts the oldest success before errors", async () => {
    const filePath = createOutboxFile();
    const outbox = new NotificationOutbox({ filePath, send: async () => true, now: () => 1000 });
    for (let index = 0; index < 249; index += 1) {
      await outbox.enqueue(event(`error-${index}`, { createdAt: 1000 + index }));
    }
    await outbox.enqueue(event("success-old", { type: "package_completed", priority: "success", createdAt: 500 }));
    await outbox.enqueue(event("success-new", { type: "package_completed", priority: "success", createdAt: 2000 }));

    const ids = persisted(filePath).events.map((queuedEvent) => queuedEvent.id);
    expect(ids).toHaveLength(250);
    expect(ids).not.toContain("success-old");
    expect(ids).toContain("success-new");
    expect(ids.filter((id) => id.startsWith("error-"))).toHaveLength(249);
  });

  it("never persists webhook or mention fields supplied outside the event contract", async () => {
    const filePath = createOutboxFile();
    const outbox = new NotificationOutbox({ filePath, send: async () => true, now: () => 1000 });
    const unsafe = {
      ...event("safe"),
      url: "https://discord.example.test/private-webhook",
      mention: "@private",
      payload: {
        ...event("safe").payload,
        url: "https://discord.example.test/nested-private-webhook",
        mention: "@nested-private"
      }
    } as unknown as NotificationEvent;

    await outbox.enqueue(unsafe);

    const raw = fs.readFileSync(filePath, "utf8");
    expect(raw).not.toContain("private-webhook");
    expect(raw).not.toContain("@private");
    expect(persisted(filePath).events[0]).toEqual(event("safe"));
  });

  it("returns after the default three-second shutdown budget when sending hangs", async () => {
    vi.useFakeTimers();
    const filePath = createOutboxFile();
    const outbox = new NotificationOutbox({ filePath, send: async () => new Promise<boolean>(() => {}), now: () => 1000 });
    await outbox.enqueue(event("hanging"));

    let completed = false;
    const draining = outbox.drainForShutdown().then(() => { completed = true; });
    await vi.advanceTimersByTimeAsync(2999);
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await draining;
    expect(completed).toBe(true);
    expect(outbox.getStatus().queued).toBe(1);
  });
});
