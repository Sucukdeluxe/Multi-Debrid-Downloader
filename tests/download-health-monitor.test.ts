import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DownloadHealthMonitor,
  createDownloadHealthState,
  evaluateDownloadHealth,
  loadDownloadHealthState,
  saveDownloadHealthState,
  type DownloadHealthSnapshot,
  type DownloadHealthState
} from "../src/main/download-health-monitor";

const RUN_FINGERPRINT = "a".repeat(64);
const QUEUE_FINGERPRINT = "b".repeat(64);
const OTHER_RUN_FINGERPRINT = "c".repeat(64);
const OTHER_QUEUE_FINGERPRINT = "d".repeat(64);
const tempDirs: string[] = [];

function snapshot(overrides: Partial<DownloadHealthSnapshot> = {}): DownloadHealthSnapshot {
  return {
    runActive: true,
    runFingerprint: RUN_FINGERPRINT,
    queueFingerprint: QUEUE_FINGERPRINT,
    openItems: 2,
    openPackages: 1,
    knownDownloadedBytes: 4096,
    activeTasks: 1,
    startableItems: 0,
    lastSchedulerTickAt: 0,
    downloadProgressSequence: 0,
    itemCompletionSequence: 0,
    lastPositiveByteAt: 0,
    technicalRecoveryCount: 0,
    paused: false,
    reconnectUntil: 0,
    nextRetryAt: 0,
    providerCooldownUntil: 0,
    blockedOnDisk: false,
    blockedOnThrottleUntil: 0,
    activePhaseDeadlineAt: 0,
    terminalFailure: false,
    manualStop: false,
    shuttingDown: false,
    currentSpeedBps: 0,
    ...overrides
  };
}

function evaluate(
  state: DownloadHealthState,
  current: DownloadHealthSnapshot,
  now: number,
  overrides: Partial<Parameters<typeof evaluateDownloadHealth>[3]> = {}
) {
  return evaluateDownloadHealth(state, current, now, {
    stallAfterMs: 90_000,
    cooldownMs: 600_000,
    notifyOnStall: true,
    notifyOnRecovery: true,
    ...overrides
  });
}

function sampleTimes(
  initial: DownloadHealthState,
  times: number[],
  current: DownloadHealthSnapshot = snapshot()
) {
  let state = initial;
  const events = [];
  for (const now of times) {
    const result = evaluate(state, current, now);
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}

function alertedState(now = 90_000): DownloadHealthState {
  return sampleTimes(createDownloadHealthState(), [0, 45_000, now]).state;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("evaluateDownloadHealth", () => {
  it("keeps a 20 to 30 second silent interval below the alert boundary", () => {
    const result = sampleTimes(createDownloadHealthState(), [0, 15_000, 30_000]);

    expect(result.events).toEqual([]);
    expect(result.state.status).toBe("suspect_no_data");
    expect(result.state.suspiciousDurationMs).toBe(30_000);
    expect(result.state.suspiciousSamples).toBe(3);
  });

  it("confirms a no-data stall only after 90 seconds and at least three suspicious samples", () => {
    const before = sampleTimes(createDownloadHealthState(), [0, 45_000]);
    const result = evaluate(before.state, snapshot(), 90_000);

    expect(before.events).toEqual([]);
    expect(result.state.status).toBe("alerted");
    expect(result.events).toEqual([
      expect.objectContaining({ type: "download_stalled", priority: "error" })
    ]);
  });

  it("does not alert from elapsed time until the third suspicious sample", () => {
    const result = sampleTimes(createDownloadHealthState(), [0, 90_000]);

    expect(result.events).toEqual([]);
    expect(result.state.suspiciousDurationMs).toBe(90_000);
    expect(result.state.suspiciousSamples).toBe(2);
  });

  it("classifies a startable queue with no scheduler as a scheduler suspicion", () => {
    const result = evaluate(createDownloadHealthState(), snapshot({
      activeTasks: 0,
      startableItems: 2,
      lastSchedulerTickAt: 0
    }), 45_000);

    expect(result.state.status).toBe("suspect_scheduler");
    expect(result.events).toEqual([]);
  });

  it("treats a recent scheduler tick without an active task as healthy startup activity", () => {
    const result = evaluate(createDownloadHealthState(), snapshot({
      activeTasks: 0,
      startableItems: 2,
      lastSchedulerTickAt: 29_000
    }), 30_000);

    expect(result.state.status).toBe("healthy");
    expect(result.state.suspiciousSamples).toBe(0);
  });

  it.each([
    ["pause", { paused: true }],
    ["reconnect", { reconnectUntil: 120_000 }],
    ["future retry", { activeTasks: 0, startableItems: 0, nextRetryAt: 120_000 }],
    ["provider cooldown", { activeTasks: 0, startableItems: 0, providerCooldownUntil: 120_000 }],
    ["disk wait", { blockedOnDisk: true }],
    ["bandwidth throttle", { blockedOnThrottleUntil: 120_000 }],
    ["valid phase deadline", { activePhaseDeadlineAt: 120_000 }]
  ])("freezes accumulated suspicion during %s", (_name, waitState) => {
    const suspicious = sampleTimes(createDownloadHealthState(), [0, 30_000]);
    const waiting = evaluate(suspicious.state, snapshot(waitState), 60_000);
    const resumed = evaluate(waiting.state, snapshot(), 90_000);

    expect(waiting.state.status).toBe("expected_wait");
    expect(waiting.state.suspiciousDurationMs).toBe(30_000);
    expect(waiting.state.suspiciousSamples).toBe(2);
    expect(resumed.events).toEqual([]);
    expect(resumed.state.suspiciousDurationMs).toBe(60_000);
  });

  it("resets suspicion after a positive byte sequence", () => {
    const suspicious = sampleTimes(createDownloadHealthState(), [0, 30_000]);
    const result = evaluate(suspicious.state, snapshot({
      downloadProgressSequence: 1,
      lastPositiveByteAt: 45_000
    }), 45_000);

    expect(result.events).toEqual([]);
    expect(result.state.status).toBe("healthy");
    expect(result.state.suspiciousDurationMs).toBe(0);
    expect(result.state.suspiciousSamples).toBe(0);
  });

  it("resets suspicion after a successful item completion sequence", () => {
    const suspicious = sampleTimes(createDownloadHealthState(), [0, 30_000]);
    const result = evaluate(suspicious.state, snapshot({ itemCompletionSequence: 1 }), 45_000);

    expect(result.events).toEqual([]);
    expect(result.state.status).toBe("healthy");
    expect(result.state.suspiciousDurationMs).toBe(0);
  });

  it("ignores speed, progress, item timestamps and global totals as progress evidence", () => {
    const suspicious = sampleTimes(createDownloadHealthState(), [0, 45_000]);
    const current = {
      ...snapshot({ currentSpeedBps: 900_000_000 }),
      progressPercent: 99,
      updatedAt: 90_000,
      totalDownloadedBytes: 10_000_000_000
    } as DownloadHealthSnapshot;
    const result = evaluate(suspicious.state, current, 90_000);

    expect(result.state.status).toBe("alerted");
    expect(result.events).toHaveLength(1);
  });

  it("does not treat sequence decreases or a technical recovery attempt as progress", () => {
    const initial = createDownloadHealthState({
      downloadProgressSequence: 8,
      itemCompletionSequence: 3
    });
    const result = sampleTimes(initial, [0, 45_000, 90_000], snapshot({
      downloadProgressSequence: 2,
      itemCompletionSequence: 1,
      technicalRecoveryCount: 1
    }));

    expect(result.state.status).toBe("alerted");
    expect(result.events).toHaveLength(1);
  });

  it("requires two positive-byte samples before recovering an alerted incident", () => {
    const alerted = alertedState();
    const first = evaluate(alerted, snapshot({
      downloadProgressSequence: 1,
      lastPositiveByteAt: 105_000
    }), 105_000);
    const second = evaluate(first.state, snapshot({
      downloadProgressSequence: 2,
      lastPositiveByteAt: 120_000
    }), 120_000);

    expect(first.state.status).toBe("recovering");
    expect(first.events).toEqual([]);
    expect(second.state.status).toBe("healthy");
    expect(second.events).toEqual([
      expect.objectContaining({ type: "download_recovered", priority: "success" })
    ]);
  });

  it("recovers immediately after a successful item completion", () => {
    const result = evaluate(alertedState(), snapshot({ itemCompletionSequence: 1 }), 105_000);

    expect(result.state.status).toBe("healthy");
    expect(result.events).toEqual([
      expect.objectContaining({ type: "download_recovered" })
    ]);
  });

  it.each([
    ["terminal failure", { terminalFailure: true }],
    ["manual stop", { runActive: false, manualStop: true }],
    ["shutdown", { runActive: false, shuttingDown: true }]
  ])("closes an alerted incident without recovery after %s", (_name, endState) => {
    const result = evaluate(alertedState(), snapshot(endState), 105_000);

    expect(result.state.status).toBe("idle");
    expect(result.events).toEqual([]);
    expect(result.state.alertedAt).toBe(0);
  });

  it("applies a ten-minute cooldown before another incident event", () => {
    const firstAlert = alertedState();
    const recovered = evaluate(firstAlert, snapshot({ itemCompletionSequence: 1 }), 105_000).state;
    const duringCooldown = sampleTimes(recovered, [120_000, 165_000, 210_000]);
    const afterCooldown = evaluate(duringCooldown.state, snapshot(), 690_000);

    expect(duringCooldown.events).toEqual([]);
    expect(duringCooldown.state.status).toBe("suspect_no_data");
    expect(afterCooldown.events).toEqual([
      expect.objectContaining({ type: "download_stalled" })
    ]);
  });

  it("keeps the incident event id stable when outbox persistence rejects the state transition", () => {
    const suspicious = sampleTimes(createDownloadHealthState(), [0, 45_000]).state;
    const firstAttempt = evaluate(suspicious, snapshot(), 90_000);
    const retryAttempt = evaluate(suspicious, snapshot(), 105_000);

    expect(firstAttempt.events[0].id).toBe(retryAttempt.events[0].id);
  });

  it("omits identifiers, paths, URLs, providers and accounts from incident and recovery payloads", () => {
    const incident = evaluate(sampleTimes(createDownloadHealthState(), [0, 45_000]).state, snapshot(), 90_000).events[0];
    const recovered = evaluate(alertedState(), snapshot({ itemCompletionSequence: 1 }), 105_000).events[0];
    const serialized = JSON.stringify([incident, recovered]);

    expect(serialized).not.toMatch(/https?:|\\|\/downloads\/|provider|account|item-|package-/i);
    expect(incident.payload.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Offene Dateien", value: "2" }),
      expect.objectContaining({ name: "Technische Wiederherstellungen", value: "0" })
    ]));
  });

  it("honors disabled incident and recovery settings independently", () => {
    const suspicious = sampleTimes(createDownloadHealthState(), [0, 45_000]).state;
    const disabledIncident = evaluate(suspicious, snapshot(), 90_000, { notifyOnStall: false });
    const disabledRecovery = evaluate(alertedState(), snapshot({ itemCompletionSequence: 1 }), 105_000, { notifyOnRecovery: false });

    expect(disabledIncident.events).toEqual([]);
    expect(disabledIncident.state.status).toBe("suspect_no_data");
    expect(disabledRecovery.events).toEqual([]);
    expect(disabledRecovery.state.status).toBe("healthy");
  });
});

describe("download health restart persistence", () => {
  it("preserves a persisted incident while startup is still idle", () => {
    const persisted = createDownloadHealthState({
      status: "alerted",
      runFingerprint: RUN_FINGERPRINT,
      queueFingerprint: QUEUE_FINGERPRINT,
      suspiciousDurationMs: 90_000,
      suspiciousSamples: 3,
      incidentStartedAt: 10_000,
      alertedAt: 90_000,
      restartPending: true
    });

    const result = evaluate(persisted, snapshot({ runActive: false, openItems: 0 }), 100_000);

    expect(result.events).toEqual([]);
    expect(result.state.status).toBe("suspended");
    expect(result.state.runFingerprint).toBe(RUN_FINGERPRINT);
    expect(result.state.queueFingerprint).toBe(QUEUE_FINGERPRINT);
    expect(result.state.restartPending).toBe(true);
  });

  it("requires two fresh samples before re-alerting the same persisted fingerprint", () => {
    const persisted = createDownloadHealthState({
      status: "suspect_no_data",
      runFingerprint: RUN_FINGERPRINT,
      queueFingerprint: QUEUE_FINGERPRINT,
      suspiciousDurationMs: 90_000,
      suspiciousSamples: 3,
      incidentStartedAt: 10_000,
      restartPending: true
    });
    const first = evaluate(persisted, snapshot(), 100_000);
    const second = evaluate(first.state, snapshot(), 115_000);

    expect(first.events).toEqual([]);
    expect(first.state.restartFreshSamples).toBe(1);
    expect(second.events).toEqual([
      expect.objectContaining({ type: "download_stalled" })
    ]);
  });

  it("discards a persisted incident when the queue fingerprint changes", () => {
    const persisted = createDownloadHealthState({
      status: "alerted",
      runFingerprint: RUN_FINGERPRINT,
      queueFingerprint: QUEUE_FINGERPRINT,
      suspiciousDurationMs: 90_000,
      suspiciousSamples: 4,
      incidentStartedAt: 10_000,
      alertedAt: 90_000,
      restartPending: true
    });
    const result = evaluate(persisted, snapshot({
      runFingerprint: OTHER_RUN_FINGERPRINT,
      queueFingerprint: OTHER_QUEUE_FINGERPRINT
    }), 100_000);

    expect(result.events).toEqual([]);
    expect(result.state.status).toBe("suspect_no_data");
    expect(result.state.suspiciousDurationMs).toBe(0);
    expect(result.state.alertedAt).toBe(0);
  });

  it("writes an allowlisted atomic state and reloads it with a fresh-sample gate", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-health-state-"));
    tempDirs.push(root);
    const filePath = path.join(root, "health.json");
    const state = {
      ...alertedState(),
      privateUrl: "https://private.example.test/file",
      privatePath: "C:\\private\\download.bin",
      privateAccount: "private@example.test"
    } as DownloadHealthState;

    saveDownloadHealthState(filePath, state);
    const persisted = fs.readFileSync(filePath, "utf8");
    const loaded = loadDownloadHealthState(filePath);

    expect(persisted).not.toMatch(/private|example\.test|download\.bin/i);
    expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);
    expect(loaded.runFingerprint).toBe(RUN_FINGERPRINT);
    expect(loaded.queueFingerprint).toBe(QUEUE_FINGERPRINT);
    expect(loaded.restartPending).toBe(true);
    expect(loaded.restartFreshSamples).toBe(0);
  });

  it("rejects malformed queue fingerprints instead of restoring an incident", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-health-invalid-"));
    tempDirs.push(root);
    const filePath = path.join(root, "health.json");
    fs.writeFileSync(filePath, JSON.stringify({
      ...alertedState(),
      queueFingerprint: "https://private.example.test/queue"
    }), "utf8");

    const loaded = loadDownloadHealthState(filePath);

    expect(loaded).toEqual(createDownloadHealthState());
  });

  it("does not commit an alert until the outbox accepts the event", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-health-outbox-failure-"));
    tempDirs.push(root);
    const filePath = path.join(root, "health.json");
    const suspicious = sampleTimes(createDownloadHealthState(), [0, 45_000]).state;
    const monitor = new DownloadHealthMonitor(filePath, suspicious);
    const eventIds: string[] = [];

    await expect(monitor.sample(snapshot(), 90_000, {
      stallAfterMs: 90_000,
      cooldownMs: 600_000,
      notifyOnStall: true,
      notifyOnRecovery: true
    }, async (event) => {
      eventIds.push(event.id);
      throw new Error("outbox unavailable");
    })).rejects.toThrow("outbox unavailable");
    await expect(monitor.sample(snapshot(), 105_000, {
      stallAfterMs: 90_000,
      cooldownMs: 600_000,
      notifyOnStall: true,
      notifyOnRecovery: true
    }, async (event) => {
      eventIds.push(event.id);
      throw new Error("outbox unavailable");
    })).rejects.toThrow("outbox unavailable");

    expect(eventIds[0]).toBe(eventIds[1]);
    expect(monitor.getState().status).toBe("suspect_no_data");
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("persists the alerted state after the outbox accepts the event", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-health-outbox-success-"));
    tempDirs.push(root);
    const filePath = path.join(root, "health.json");
    const suspicious = sampleTimes(createDownloadHealthState(), [0, 45_000]).state;
    const monitor = new DownloadHealthMonitor(filePath, suspicious);

    const result = await monitor.sample(snapshot(), 90_000, {
      stallAfterMs: 90_000,
      cooldownMs: 600_000,
      notifyOnStall: true,
      notifyOnRecovery: true
    }, async () => undefined);

    expect(result.events).toHaveLength(1);
    expect(monitor.getState().status).toBe("alerted");
    expect(loadDownloadHealthState(filePath)).toEqual(expect.objectContaining({
      status: "alerted",
      restartPending: true
    }));
  });
});
