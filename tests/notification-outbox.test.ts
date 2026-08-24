import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationEvent, NotificationOutbox } from "../src/main/notification-outbox";
import { buildPackageNotificationEvent } from "../src/main/notification-events";
import { buildNotifyRequest, sendNotification } from "../src/main/notify";
import { finalizePackageResult } from "../src/main/package-telemetry";
import type { DownloadItem, PackageEntry, PackageResult, PackageTelemetry, RemuxOperationMetric } from "../src/shared/types";

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

const privateFailureDetails = "https://private.example.test/hook C:/Private/target alice@example.test token=SUPERSECRET";
const privateFailureValues = [
  "https://private.example.test/hook",
  "C:/Private/target",
  "alice@example.test",
  "token=SUPERSECRET"
];

function privateFailureTelemetry(source: "fullStatus" | "remux" | "cleanup"): PackageTelemetry {
  const item: DownloadItem = {
    id: "item-private",
    packageId: "pkg-private",
    url: "https://download.example.test/file",
    provider: "realdebrid",
    status: source === "fullStatus" ? "failed" : "completed",
    retries: 0,
    speedBps: 0,
    downloadedBytes: source === "fullStatus" ? 0 : 1000,
    totalBytes: 1000,
    progressPercent: source === "fullStatus" ? 0 : 100,
    fileName: "file.bin",
    targetPath: "C:\\Downloads\\Paket\\file.bin",
    resumable: true,
    attempts: 1,
    lastError: "",
    fullStatus: source === "fullStatus" ? privateFailureDetails : "Fertig",
    createdAt: 1000,
    updatedAt: 2000
  };
  const packageEntry: PackageEntry = {
    id: "pkg-private",
    name: "Paket",
    outputDir: "C:\\Downloads\\Paket",
    extractDir: "C:\\Downloads\\Paket",
    status: "failed",
    itemIds: [item.id],
    cancelled: false,
    enabled: true,
    downloadStartedAt: 1000,
    downloadCompletedAt: 2000,
    downloadEndedAt: 2000,
    postProcessQueuedAt: 2000,
    postProcessStartedAt: 2000,
    postProcessCompletedAt: 3000,
    terminalAt: 3000,
    createdAt: 1000,
    updatedAt: 3000
  };
  const remuxOperations: RemuxOperationMetric[] = source === "remux" ? [{
    id: "remux-private",
    fileName: "file.mkv",
    startedAt: 2000,
    completedAt: 3000,
    durationMs: 1000,
    status: "failed",
    errorCategory: privateFailureDetails
  }] : [];
  return {
    package: packageEntry,
    items: [item],
    archiveOperations: [],
    remuxOperations,
    outputCount: 0,
    cleanupErrorCategory: source === "cleanup" ? privateFailureDetails : ""
  };
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

  it("retries a temporary persistence failure before sending without another enqueue", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const filePath = createOutboxFile();
    const renameFile = fsp.rename.bind(fsp);
    let renameAttempts = 0;
    let markRetryStarted = () => {};
    const retryStarted = new Promise<void>((resolve) => { markRetryStarted = resolve; });
    const rename = vi.spyOn(fsp, "rename").mockImplementation(async (oldPath, newPath) => {
      renameAttempts += 1;
      if (renameAttempts === 1) {
        throw new Error("temporary rename failure");
      }
      if (renameAttempts === 2) {
        markRetryStarted();
      }
      await renameFile(oldPath, newPath);
    });
    const persistedBeforeSend: string[][] = [];
    let markSendStarted = () => {};
    let releaseSend = (_sent: boolean) => {};
    const sendStarted = new Promise<void>((resolve) => { markSendStarted = resolve; });
    const sendResult = new Promise<boolean>((resolve) => { releaseSend = resolve; });
    const send = vi.fn().mockImplementation(async () => {
      persistedBeforeSend.push(fs.existsSync(filePath)
        ? persisted(filePath).events.map((queuedEvent) => queuedEvent.id)
        : []);
      markSendStarted();
      return sendResult;
    });
    const outbox = new NotificationOutbox({ filePath, send, autoDrain: true });

    try {
      await expect(outbox.enqueue(event("persistence-retry"))).rejects.toThrow("temporary rename failure");
      expect(outbox.getStatus().queued).toBe(1);
      expect(send).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(999);
      expect(send).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await retryStarted;
      await sendStarted;
      const retryDrain = outbox.drain();
      releaseSend(true);
      await retryDrain;

      expect(send).toHaveBeenCalledTimes(1);
      expect(persistedBeforeSend).toEqual([["persistence-retry"]]);
      expect(outbox.getStatus()).toEqual({ queued: 0, lastSuccessAt: 2000, lastFailureAt: 0 });
      expect(persisted(filePath).events).toEqual([]);
    } finally {
      rename.mockRestore();
    }
  });

  it("backs off repeated persistence retries without a busy loop", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const filePath = createOutboxFile();
    const renameFile = fsp.rename.bind(fsp);
    const removeFile = fsp.rm.bind(fsp);
    let renameAttempts = 0;
    let cleanupAttempts = 0;
    let markSecondAttemptStarted = () => {};
    let markSecondCleanupCompleted = () => {};
    const secondAttemptStarted = new Promise<void>((resolve) => { markSecondAttemptStarted = resolve; });
    const secondCleanupCompleted = new Promise<void>((resolve) => { markSecondCleanupCompleted = resolve; });
    const rename = vi.spyOn(fsp, "rename").mockImplementation(async (oldPath, newPath) => {
      renameAttempts += 1;
      if (renameAttempts === 1) {
        throw new Error("first temporary rename failure");
      }
      if (renameAttempts === 2) {
        markSecondAttemptStarted();
        throw new Error("second temporary rename failure");
      }
      await renameFile(oldPath, newPath);
    });
    const remove = vi.spyOn(fsp, "rm").mockImplementation(async (targetPath, options) => {
      await removeFile(targetPath, options);
      cleanupAttempts += 1;
      if (cleanupAttempts === 2) {
        markSecondCleanupCompleted();
      }
    });
    const sentAttempts: number[] = [];
    let markSendStarted = () => {};
    let releaseSend = (_sent: boolean) => {};
    const sendStarted = new Promise<void>((resolve) => { markSendStarted = resolve; });
    const sendResult = new Promise<boolean>((resolve) => { releaseSend = resolve; });
    const send = vi.fn().mockImplementation(async (queuedEvent: NotificationEvent) => {
      sentAttempts.push(queuedEvent.attempts);
      markSendStarted();
      return sendResult;
    });
    const outbox = new NotificationOutbox({ filePath, send, autoDrain: true });

    try {
      await expect(outbox.enqueue(event("persistence-backoff"))).rejects.toThrow("first temporary rename failure");
      expect(rename).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(999);
      expect(rename).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await secondAttemptStarted;
      await secondCleanupCompleted;
      await Promise.resolve();
      expect(rename).toHaveBeenCalledTimes(2);
      expect(send).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1999);
      expect(rename).toHaveBeenCalledTimes(2);
      expect(send).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await sendStarted;
      const successfulRetryDrain = outbox.drain();
      releaseSend(true);
      await successfulRetryDrain;

      expect(send).toHaveBeenCalledTimes(1);
      expect(sentAttempts).toEqual([0]);
      expect(persisted(filePath).events).toEqual([]);
    } finally {
      remove.mockRestore();
      rename.mockRestore();
    }
  });

  it("persists a retry while an earlier delivery remains blocked", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const filePath = createOutboxFile();
    const renameFile = fsp.rename.bind(fsp);
    let renameAttempts = 0;
    let markRecoveryPersisted = () => {};
    const recoveryPersisted = new Promise<void>((resolve) => { markRecoveryPersisted = resolve; });
    const rename = vi.spyOn(fsp, "rename").mockImplementation(async (oldPath, newPath) => {
      const attempt = ++renameAttempts;
      if (attempt === 2) {
        throw new Error("temporary blocked rename failure");
      }
      await renameFile(oldPath, newPath);
      if (attempt === 3) {
        markRecoveryPersisted();
      }
    });
    const sent: string[] = [];
    let markSendStarted = () => {};
    const sendStarted = new Promise<void>((resolve) => { markSendStarted = resolve; });
    const blockedSend = new Promise<boolean>(() => {});
    const outbox = new NotificationOutbox({
      filePath,
      autoDrain: true,
      send: async (queuedEvent) => {
        sent.push(queuedEvent.id);
        markSendStarted();
        return blockedSend;
      }
    });

    try {
      await outbox.enqueue(event("blocked-a"));
      await vi.advanceTimersByTimeAsync(0);
      await sendStarted;
      await expect(outbox.enqueue(event("late-b"))).rejects.toThrow("temporary blocked rename failure");

      await vi.advanceTimersByTimeAsync(999);
      expect(persisted(filePath).events.map((queuedEvent) => queuedEvent.id)).toEqual(["blocked-a"]);
      await vi.advanceTimersByTimeAsync(1);
      await recoveryPersisted;

      expect(persisted(filePath).events.map((queuedEvent) => queuedEvent.id)).toEqual(["blocked-a", "late-b"]);
      expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);
      expect(sent).toEqual(["blocked-a"]);
      expect(outbox.getStatus().queued).toBe(2);
    } finally {
      rename.mockRestore();
    }
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

  it("persists a cleaned empty legacy file atomically during load", () => {
    const filePath = createOutboxFile();
    const rename = vi.spyOn(fs, "renameSync");
    fs.writeFileSync(filePath, JSON.stringify({
      version: 1,
      events: [
        event("expired-private", {
          expiresAt: 999,
          payload: {
            title: "Paket fehlgeschlagen",
            fields: [{ name: "Fehler", value: `Download · ${privateFailureDetails}`, inline: false }]
          }
        }),
        { id: "", privateSentinel: privateFailureDetails }
      ],
      lastSuccessAt: 0,
      lastFailureAt: 0,
      privateSentinel: privateFailureDetails
    }), "utf8");

    const outbox = new NotificationOutbox({ filePath, send: async () => true, now: () => 1000 });

    const raw = fs.readFileSync(filePath, "utf8");
    expect(outbox.getStatus().queued).toBe(0);
    expect(JSON.parse(raw).events).toEqual([]);
    expect(raw).not.toContain("private.example.test");
    expect(raw).not.toContain("SUPERSECRET");
    expect(rename).toHaveBeenCalledWith(`${filePath}.tmp`, filePath);
    expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);
    rename.mockRestore();
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

  it("keeps private package failure details out of events, requests, and persisted state", async () => {
    const filePath = createOutboxFile();
    const privateDetails = "https://private.example.test/hook C:/Private/target alice@example.test token=SUPERSECRET";
    const result: PackageResult = {
      packageId: "pkg-private",
      name: "Paket",
      status: "failed",
      startedAt: 1000,
      downloadEndedAt: 2000,
      postProcessStartedAt: 0,
      completedAt: 2000,
      downloadDurationSeconds: 1,
      extractionDurationSeconds: 0,
      remuxDurationSeconds: 0,
      postProcessDurationSeconds: 0,
      totalDurationSeconds: 1,
      totalBytes: 1000,
      downloadedBytes: 0,
      averageDownloadSpeedBps: 0,
      successfulFiles: 0,
      failedFiles: 1,
      cancelledFiles: 0,
      downloadFailures: 1,
      offlineFailures: 0,
      extractionFailures: 0,
      remuxFailures: 0,
      cleanupFailures: 0,
      postProcessFailures: 0,
      archiveCount: 0,
      partCount: 0,
      outputCount: 0,
      failurePhase: "download",
      errorCategory: privateDetails,
      archiveOperations: [],
      remuxOperations: []
    };
    const notificationEvent = buildPackageNotificationEvent({ generation: 1, result }, 1000);
    const request = buildNotifyRequest("https://discord.com/api/webhooks/123/abc", {
      title: notificationEvent.payload.title,
      message: notificationEvent.payload.description || "",
      color: notificationEvent.payload.color,
      fields: notificationEvent.payload.fields,
      timestamp: notificationEvent.createdAt
    });
    const outbox = new NotificationOutbox({ filePath, send: async () => true, now: () => 1000 });

    await outbox.enqueue(notificationEvent);

    const eventText = JSON.stringify(notificationEvent);
    const requestText = String(request.init.body);
    const persistedText = fs.readFileSync(filePath, "utf8");
    const sensitiveValues = [
      "https://private.example.test/hook",
      "C:/Private/target",
      "alice@example.test",
      "token=SUPERSECRET"
    ];
    expect(notificationEvent.payload.fields.find((field) => field.name === "Fehler")?.value).toBe("Download · Download");
    for (const sensitiveValue of sensitiveValues) {
      expect(eventText).not.toContain(sensitiveValue);
      expect(requestText).not.toContain(sensitiveValue);
      expect(persistedText).not.toContain(sensitiveValue);
    }
  });

  it("keeps the fixed post-processing phase while sanitizing a persisted package failure", async () => {
    const filePath = createOutboxFile();
    fs.writeFileSync(filePath, JSON.stringify({
      version: 1,
      events: [event("postprocess-private", {
        payload: {
          title: "Paket teilweise fertig",
          fields: [{ name: "Fehler", value: `Nachbearbeitung · ${privateFailureDetails}`, inline: false }]
        }
      })],
      lastSuccessAt: 0,
      lastFailureAt: 0
    }), "utf8");
    const outbox = new NotificationOutbox({ filePath, send: async () => true, now: () => 1000 });

    await outbox.enqueue(event("safe"));

    expect(persisted(filePath).events[0].payload.fields[0]?.value).toBe("Nachbearbeitung · Nachbearbeitung");
    expect(fs.readFileSync(filePath, "utf8")).not.toContain(privateFailureDetails);
  });

  it("includes post-processing duration in package notifications", () => {
    const result = finalizePackageResult({
      ...privateFailureTelemetry("cleanup"),
      cleanupErrorCategory: "",
      postProcessErrorCategory: "rename failed",
      package: {
        ...privateFailureTelemetry("cleanup").package,
        postProcessStartedAt: 3_000,
        postProcessCompletedAt: 10_000,
        terminalAt: 10_000
      }
    });

    const notificationEvent = buildPackageNotificationEvent({ generation: 1, result }, 10_000);

    expect(notificationEvent.payload.fields.find((field) => field.name === "Zeiten")?.value).toContain("Nachbearbeitung 0:07");
  });

  it("persists cancelled package events without coercing them to failures", async () => {
    const filePath = createOutboxFile();
    const result = finalizePackageResult({
      ...privateFailureTelemetry("fullStatus"),
      package: { ...privateFailureTelemetry("fullStatus").package, cancelled: true },
      items: [{ ...privateFailureTelemetry("fullStatus").items[0], status: "cancelled", lastError: "", fullStatus: "Abgebrochen" }]
    });
    const cancelledEvent = buildPackageNotificationEvent({ generation: 1, result }, 3_000);
    const outbox = new NotificationOutbox({ filePath, send: async () => true, now: () => 1_000 });

    await outbox.enqueue(cancelledEvent);

    expect(cancelledEvent.type).toBe("package_cancelled");
    expect(persisted(filePath).events[0].type).toBe("package_cancelled");
  });

  it("sanitizes unexpected failure details on persisted cancelled package events", async () => {
    const filePath = createOutboxFile();
    const outbox = new NotificationOutbox({ filePath, send: async () => true, now: () => 1_000 });

    await outbox.enqueue(event("cancelled-private", {
      type: "package_cancelled",
      payload: {
        title: "Paket abgebrochen",
        fields: [{ name: "Fehler", value: `Nachbearbeitung · ${privateFailureDetails}`, inline: false }]
      }
    }));

    expect(persisted(filePath).events[0].payload.fields[0]?.value).toBe("Nachbearbeitung · Nachbearbeitung");
    expect(fs.readFileSync(filePath, "utf8")).not.toContain(privateFailureDetails);
  });

  it.each([
    ["fullStatus fallback", "fullStatus", "Download · Download"],
    ["remux operation", "remux", "Remux · Remux"],
    ["cleanup failure", "cleanup", "Aufräumen · Cleanup"]
  ] as const)("redacts private %s details through telemetry, Discord request, and persisted outbox", async (_label, source, expectedFailure) => {
    const filePath = createOutboxFile();
    const result = finalizePackageResult(privateFailureTelemetry(source));
    const notificationEvent = buildPackageNotificationEvent({ generation: 1, result }, 3000);
    const request = buildNotifyRequest("https://discord.com/api/webhooks/123/abc", {
      title: notificationEvent.payload.title,
      message: notificationEvent.payload.description || "",
      color: notificationEvent.payload.color,
      fields: notificationEvent.payload.fields,
      timestamp: notificationEvent.createdAt
    });
    const outbox = new NotificationOutbox({ filePath, send: async () => true, now: () => 3000 });

    await outbox.enqueue(notificationEvent);

    const eventText = JSON.stringify(notificationEvent);
    const requestText = String(request.init.body);
    const persistedText = fs.readFileSync(filePath, "utf8");
    expect(notificationEvent.payload.fields.find((field) => field.name === "Fehler")?.value).toBe(expectedFailure);
    for (const sensitiveValue of privateFailureValues) {
      expect(eventText).not.toContain(sensitiveValue);
      expect(requestText).not.toContain(sensitiveValue);
      expect(persistedText).not.toContain(sensitiveValue);
    }
  });

  it("projects private failure details from an existing outbox before persisting again", async () => {
    const filePath = createOutboxFile();
    const privateDetails = "https://private.example.test/hook C:/Private/target alice@example.test token=SUPERSECRET";
    const legacyEvent = event("legacy-private", {
      payload: {
        title: "Paket fehlgeschlagen",
        description: "Paket",
        fields: [{ name: "Fehler", value: `Download · ${privateDetails}`, inline: false }]
      }
    });
    fs.writeFileSync(filePath, JSON.stringify({
      version: 1,
      events: [legacyEvent],
      lastSuccessAt: 0,
      lastFailureAt: 0
    }), "utf8");
    const outbox = new NotificationOutbox({ filePath, send: async () => true, now: () => 1000 });

    await outbox.enqueue(event("safe"));

    const persistedText = fs.readFileSync(filePath, "utf8");
    expect(persisted(filePath).events[0].payload.fields[0]?.value).toBe("Download · Download");
    expect(persistedText).not.toContain("https://private.example.test/hook");
    expect(persistedText).not.toContain("C:/Private/target");
    expect(persistedText).not.toContain("alice@example.test");
    expect(persistedText).not.toContain("token=SUPERSECRET");
  });

  it("redacts a legacy persisted failure before automatic drain and Discord request creation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const filePath = createOutboxFile();
    const legacyEvent = event("legacy-private-auto-drain", {
      payload: {
        title: "Paket fehlgeschlagen",
        description: "Paket",
        fields: [{ name: "Fehler", value: `Download · ${privateFailureDetails}`, inline: false }]
      }
    });
    fs.writeFileSync(filePath, JSON.stringify({
      version: 1,
      events: [legacyEvent],
      lastSuccessAt: 0,
      lastFailureAt: 0
    }), "utf8");
    const sentEvents: NotificationEvent[] = [];
    const requestBodies: string[] = [];
    const outbox = new NotificationOutbox({
      filePath,
      autoDrain: true,
      send: async (queuedEvent) => {
        sentEvents.push(queuedEvent);
        requestBodies.push(String(buildNotifyRequest("https://discord.com/api/webhooks/123/abc", {
          title: queuedEvent.payload.title,
          message: queuedEvent.payload.description || "",
          color: queuedEvent.payload.color,
          fields: queuedEvent.payload.fields,
          timestamp: queuedEvent.createdAt
        }).init.body));
        return true;
      }
    });

    await vi.advanceTimersByTimeAsync(0);
    await outbox.drain(1000);

    expect(sentEvents).toHaveLength(1);
    expect(sentEvents[0].payload.fields[0]?.value).toBe("Download · Download");
    expect(outbox.getStatus().queued).toBe(0);
    expect(persisted(filePath).events).toEqual([]);
    const emittedText = `${JSON.stringify(sentEvents)} ${requestBodies.join(" ")} ${fs.readFileSync(filePath, "utf8")}`;
    for (const sensitiveValue of privateFailureValues) {
      expect(emittedText).not.toContain(sensitiveValue);
    }
  });

  it("persists an enqueue while an earlier delivery is blocked", async () => {
    const filePath = createOutboxFile();
    let releaseSend = (_sent: boolean) => {};
    let markSendStarted = () => {};
    const sendStarted = new Promise<void>((resolve) => { markSendStarted = resolve; });
    const sendResult = new Promise<boolean>((resolve) => { releaseSend = resolve; });
    const outbox = new NotificationOutbox({
      filePath,
      send: async () => {
        markSendStarted();
        return sendResult;
      },
      now: () => 1000
    });
    await outbox.enqueue(event("blocked"));
    const draining = outbox.drain();
    await sendStarted;

    const lateEnqueue = outbox.enqueue(event("late-digest", {
      type: "package_completed",
      priority: "success"
    }));
    const persistedBeforeRelease = await Promise.race([
      lateEnqueue.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 25))
    ]);
    const stateBeforeRelease = persisted(filePath);
    releaseSend(true);
    await draining;
    await lateEnqueue;

    expect(persistedBeforeRelease).toBe(true);
    expect(stateBeforeRelease.events.map((queuedEvent) => queuedEvent.id)).toContain("late-digest");
  });

  it("acknowledges a successful in-flight delivery after a parallel enqueue expires it", async () => {
    const filePath = createOutboxFile();
    let now = 1000;
    let releaseSend = (_sent: boolean) => {};
    let markSendStarted = () => {};
    const sendStarted = new Promise<void>((resolve) => { markSendStarted = resolve; });
    const sendResult = new Promise<boolean>((resolve) => { releaseSend = resolve; });
    const delivered: Array<{ id: string; deliveredAt: number }> = [];
    const outbox = new NotificationOutbox({
      filePath,
      now: () => now,
      send: async () => {
        markSendStarted();
        return sendResult;
      },
      onDelivered: (queuedEvent, deliveredAt) => {
        delivered.push({ id: queuedEvent.id, deliveredAt });
      }
    });
    await outbox.enqueue(event("expires-in-flight", { expiresAt: 1500 }));
    const draining = outbox.drain();
    await sendStarted;

    now = 2000;
    await outbox.enqueue(event("late", { createdAt: 2000, nextAttemptAt: 3000 }));
    expect(persisted(filePath).events.map((queuedEvent) => queuedEvent.id)).toContain("expires-in-flight");
    releaseSend(true);
    await draining;

    expect(delivered).toEqual([{ id: "expires-in-flight", deliveredAt: 2000 }]);
    expect(outbox.getStatus()).toEqual({ queued: 1, lastSuccessAt: 2000, lastFailureAt: 0 });
    expect(persisted(filePath).events.map((queuedEvent) => queuedEvent.id)).toEqual(["late"]);
  });

  it("keeps a failed in-flight delivery queued for retry during a capacity-enforcing enqueue", async () => {
    const filePath = createOutboxFile();
    const queuedEvents = [
      event("fails-in-flight", { createdAt: 1 }),
      ...Array.from({ length: 249 }, (_, index) => event(`queued-${index}`, { createdAt: index + 2 }))
    ];
    fs.writeFileSync(filePath, JSON.stringify({
      version: 1,
      events: queuedEvents,
      lastSuccessAt: 0,
      lastFailureAt: 0
    }), "utf8");
    let releaseSend = (_sent: boolean) => {};
    let markSendStarted = () => {};
    const sendStarted = new Promise<void>((resolve) => { markSendStarted = resolve; });
    const sendResult = new Promise<boolean>((resolve) => { releaseSend = resolve; });
    const outbox = new NotificationOutbox({
      filePath,
      now: () => 1000,
      send: async () => {
        markSendStarted();
        return sendResult;
      }
    });
    const draining = outbox.drain();
    await sendStarted;

    await outbox.enqueue(event("late-capacity", { createdAt: 10000 }));
    expect(persisted(filePath).events.map((queuedEvent) => queuedEvent.id)).toContain("fails-in-flight");
    releaseSend(false);
    await draining;

    const state = persisted(filePath);
    expect(state.events).toHaveLength(250);
    expect(state.events[0]).toMatchObject({ id: "fails-in-flight", attempts: 1, nextAttemptAt: 2000 });
    expect(state.lastFailureAt).toBe(1000);
  });

  it("acknowledges only successful delivery with its actual completion time", async () => {
    const filePath = createOutboxFile();
    let now = 1000;
    const delivered: Array<{ id: string; deliveredAt: number }> = [];
    const failedOutbox = new NotificationOutbox({
      filePath,
      now: () => now,
      send: async () => {
        now = 2000;
        return false;
      },
      onDelivered: (queuedEvent, deliveredAt) => {
        delivered.push({ id: queuedEvent.id, deliveredAt });
      }
    });

    await failedOutbox.enqueue(event("failed"));
    await failedOutbox.drain();
    expect(delivered).toEqual([]);

    const deliveredFilePath = createOutboxFile();
    now = 3000;
    const deliveredOutbox = new NotificationOutbox({
      filePath: deliveredFilePath,
      now: () => now,
      send: async () => true,
      onDelivered: (queuedEvent, deliveredAt) => {
        delivered.push({ id: queuedEvent.id, deliveredAt });
      }
    });
    await deliveredOutbox.enqueue(event("delivered", { nextAttemptAt: 3000 }));
    await deliveredOutbox.drain();

    expect(delivered).toEqual([{ id: "delivered", deliveredAt: 3000 }]);
  });

  it("does not redeliver or block later events when delivery acknowledgement fails", async () => {
    const filePath = createOutboxFile();
    const sent: string[] = [];
    const outbox = new NotificationOutbox({
      filePath,
      now: () => 1000,
      send: async (queuedEvent) => {
        sent.push(queuedEvent.id);
        return true;
      },
      onDelivered: (queuedEvent) => {
        if (queuedEvent.id === "first") {
          throw new Error("health state unavailable");
        }
      }
    });
    await outbox.enqueue(event("first"));
    await outbox.enqueue(event("second"));

    await expect(outbox.drain()).resolves.toBeUndefined();

    expect(sent).toEqual(["first", "second"]);
    expect(persisted(filePath).events).toEqual([]);
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

  it("persists a retry during shutdown while an earlier delivery remains blocked", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const filePath = createOutboxFile();
    const renameFile = fsp.rename.bind(fsp);
    let renameAttempts = 0;
    let markRecoveryPersisted = () => {};
    const recoveryPersisted = new Promise<void>((resolve) => { markRecoveryPersisted = resolve; });
    const rename = vi.spyOn(fsp, "rename").mockImplementation(async (oldPath, newPath) => {
      const attempt = ++renameAttempts;
      if (attempt === 2) {
        throw new Error("temporary shutdown rename failure");
      }
      await renameFile(oldPath, newPath);
      if (attempt === 3) {
        markRecoveryPersisted();
      }
    });
    const sent: string[] = [];
    let markSendStarted = () => {};
    const sendStarted = new Promise<void>((resolve) => { markSendStarted = resolve; });
    const blockedSend = new Promise<boolean>(() => {});
    const outbox = new NotificationOutbox({
      filePath,
      autoDrain: true,
      send: async (queuedEvent) => {
        sent.push(queuedEvent.id);
        markSendStarted();
        return blockedSend;
      }
    });

    try {
      await outbox.enqueue(event("shutdown-a"));
      await vi.advanceTimersByTimeAsync(0);
      await sendStarted;
      await expect(outbox.enqueue(event("shutdown-b"))).rejects.toThrow("temporary shutdown rename failure");

      let completed = false;
      const shutdown = outbox.drainForShutdown(100).then(() => { completed = true; });
      await recoveryPersisted;

      expect(persisted(filePath).events.map((queuedEvent) => queuedEvent.id)).toEqual(["shutdown-a", "shutdown-b"]);
      expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);
      expect(sent).toEqual(["shutdown-a"]);
      expect(completed).toBe(false);

      await vi.advanceTimersByTimeAsync(99);
      expect(completed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await shutdown;
      expect(completed).toBe(true);
      expect(sent).toEqual(["shutdown-a"]);
    } finally {
      rename.mockRestore();
    }
  });
});
