import fs from "node:fs";
import path from "node:path";
import type { NotificationEvent } from "./notification-outbox";

export type DownloadHealthStatus =
  | "idle"
  | "suspended"
  | "expected_wait"
  | "healthy"
  | "suspect_scheduler"
  | "suspect_no_data"
  | "alerted"
  | "recovering";

export type DownloadHealthIncidentType = "scheduler" | "no_data";

export interface DownloadHealthSnapshot {
  runActive: boolean;
  runFingerprint: string;
  queueFingerprint: string;
  openItems: number;
  openPackages: number;
  knownDownloadedBytes: number;
  activeTasks: number;
  startableItems: number;
  lastSchedulerTickAt: number;
  downloadProgressSequence: number;
  itemCompletionSequence: number;
  lastPositiveByteAt: number;
  technicalRecoveryCount: number;
  paused: boolean;
  reconnectUntil: number;
  nextRetryAt: number;
  providerCooldownUntil: number;
  blockedOnDisk: boolean;
  blockedOnThrottleUntil: number;
  activePhaseDeadlineAt: number;
  terminalFailure: boolean;
  manualStop: boolean;
  shuttingDown: boolean;
  currentSpeedBps: number;
}

export interface DownloadHealthState {
  version: 1;
  status: DownloadHealthStatus;
  runFingerprint: string | null;
  queueFingerprint: string | null;
  suspiciousDurationMs: number;
  suspiciousSamples: number;
  incidentStartedAt: number;
  incidentType: DownloadHealthIncidentType | null;
  alertedAt: number;
  lastAlertAt: number;
  cooldownUntil: number;
  recoverySamples: number;
  lastSampleAt: number | null;
  downloadProgressSequence: number;
  itemCompletionSequence: number;
  lastPositiveByteAt: number;
  technicalRecoveryCount: number;
  restartPending: boolean;
  restartFreshSamples: number;
}

export interface DownloadHealthOptions {
  stallAfterMs: number;
  cooldownMs: number;
  notifyOnStall: boolean;
  notifyOnRecovery: boolean;
}

export interface DownloadHealthEvaluation {
  state: DownloadHealthState;
  events: NotificationEvent[];
}

const HEALTH_STATUSES = new Set<DownloadHealthStatus>([
  "idle",
  "suspended",
  "expected_wait",
  "healthy",
  "suspect_scheduler",
  "suspect_no_data",
  "alerted",
  "recovering"
]);
const INCIDENT_TYPES = new Set<DownloadHealthIncidentType>(["scheduler", "no_data"]);
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const MIN_SUSPICIOUS_SAMPLES = 3;
const SCHEDULER_STALE_AFTER_MS = 30_000;
const ERROR_EVENT_TTL_MS = 24 * 60 * 60 * 1000;
const SUCCESS_EVENT_TTL_MS = 6 * 60 * 60 * 1000;

function finiteInteger(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : fallback;
}

function validFingerprint(value: unknown): string | null {
  return typeof value === "string" && FINGERPRINT_PATTERN.test(value) ? value : null;
}

function durationText(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds} s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`;
}

function byteText(bytes: number): string {
  const value = Math.max(0, finiteInteger(bytes));
  if (value < 1024) {
    return `${value} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let amount = value / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && amount >= 1024; index += 1) {
    amount /= 1024;
    unit = units[index];
  }
  return `${amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)} ${unit}`;
}

function incidentEvent(
  state: DownloadHealthState,
  snapshot: DownloadHealthSnapshot,
  now: number
): NotificationEvent {
  const durationMs = Math.max(state.suspiciousDurationMs, now - state.incidentStartedAt);
  return {
    id: `health:stall:${snapshot.runFingerprint.slice(0, 16)}:${state.incidentStartedAt}`,
    type: "download_stalled",
    priority: "error",
    createdAt: now,
    expiresAt: now + ERROR_EVENT_TTL_MS,
    attempts: 0,
    nextAttemptAt: now,
    payload: {
      title: "Downloadstillstand bestätigt",
      description: `Seit ${durationText(durationMs)} wurde kein bestätigter Downloadfortschritt erkannt.`,
      color: 0xe67e22,
      fields: [
        { name: "Dauer", value: durationText(durationMs), inline: true },
        { name: "Offene Pakete", value: String(snapshot.openPackages), inline: true },
        { name: "Offene Dateien", value: String(snapshot.openItems), inline: true },
        { name: "Bekannte Mindestmenge", value: byteText(snapshot.knownDownloadedBytes), inline: true },
        { name: "Aktiv / startfähig", value: `${snapshot.activeTasks} / ${snapshot.startableItems}`, inline: true },
        { name: "Technische Wiederherstellungen", value: String(snapshot.technicalRecoveryCount), inline: true }
      ]
    }
  };
}

function recoveryEvent(
  state: DownloadHealthState,
  snapshot: DownloadHealthSnapshot,
  now: number
): NotificationEvent {
  return {
    id: `health:recovery:${snapshot.runFingerprint.slice(0, 16)}:${state.alertedAt}`,
    type: "download_recovered",
    priority: "success",
    createdAt: now,
    expiresAt: now + SUCCESS_EVENT_TTL_MS,
    attempts: 0,
    nextAttemptAt: now,
    payload: {
      title: "Download läuft wieder",
      description: "Nach dem bestätigten Stillstand wurde neuer Fortschritt erkannt.",
      color: 0x2ecc71,
      fields: [
        { name: "Incident-Dauer", value: durationText(Math.max(0, now - state.incidentStartedAt)), inline: true },
        { name: "Aktive Downloads", value: String(snapshot.activeTasks), inline: true },
        { name: "Aktuelle Geschwindigkeit", value: `${byteText(snapshot.currentSpeedBps)}/s`, inline: true }
      ]
    }
  };
}

export function createDownloadHealthState(overrides: Partial<DownloadHealthState> = {}): DownloadHealthState {
  return {
    version: 1,
    status: "idle",
    runFingerprint: null,
    queueFingerprint: null,
    suspiciousDurationMs: 0,
    suspiciousSamples: 0,
    incidentStartedAt: 0,
    incidentType: null,
    alertedAt: 0,
    lastAlertAt: 0,
    cooldownUntil: 0,
    recoverySamples: 0,
    lastSampleAt: null,
    downloadProgressSequence: 0,
    itemCompletionSequence: 0,
    lastPositiveByteAt: 0,
    technicalRecoveryCount: 0,
    restartPending: false,
    restartFreshSamples: 0,
    ...overrides
  };
}

function resetForSnapshot(
  state: DownloadHealthState,
  snapshot: DownloadHealthSnapshot,
  now: number
): DownloadHealthState {
  return createDownloadHealthState({
    runFingerprint: snapshot.runFingerprint,
    queueFingerprint: snapshot.queueFingerprint,
    lastAlertAt: state.lastAlertAt,
    cooldownUntil: state.cooldownUntil,
    lastSampleAt: now,
    downloadProgressSequence: finiteInteger(snapshot.downloadProgressSequence),
    itemCompletionSequence: finiteInteger(snapshot.itemCompletionSequence),
    lastPositiveByteAt: finiteInteger(snapshot.lastPositiveByteAt),
    technicalRecoveryCount: finiteInteger(snapshot.technicalRecoveryCount)
  });
}

function endIncident(state: DownloadHealthState): DownloadHealthState {
  return createDownloadHealthState({
    lastAlertAt: state.lastAlertAt,
    cooldownUntil: state.cooldownUntil,
    downloadProgressSequence: state.downloadProgressSequence,
    itemCompletionSequence: state.itemCompletionSequence,
    lastPositiveByteAt: state.lastPositiveByteAt,
    technicalRecoveryCount: state.technicalRecoveryCount
  });
}

function expectedWait(snapshot: DownloadHealthSnapshot, now: number): boolean {
  return snapshot.paused
    || snapshot.reconnectUntil > now
    || snapshot.nextRetryAt > now
    || snapshot.providerCooldownUntil > now
    || snapshot.blockedOnDisk
    || snapshot.blockedOnThrottleUntil > now
    || snapshot.activePhaseDeadlineAt > now;
}

function suspicionType(snapshot: DownloadHealthSnapshot, now: number): DownloadHealthIncidentType | null {
  if (snapshot.activeTasks === 0 && snapshot.startableItems > 0) {
    if (snapshot.lastSchedulerTickAt <= 0 || now - snapshot.lastSchedulerTickAt >= SCHEDULER_STALE_AFTER_MS) {
      return "scheduler";
    }
    return null;
  }
  return "no_data";
}

export function evaluateDownloadHealth(
  previous: DownloadHealthState,
  snapshot: DownloadHealthSnapshot,
  nowValue: number,
  options: DownloadHealthOptions
): DownloadHealthEvaluation {
  const now = finiteInteger(nowValue);
  let state = createDownloadHealthState(previous);
  const events: NotificationEvent[] = [];
  const runFingerprint = validFingerprint(snapshot.runFingerprint);
  const queueFingerprint = validFingerprint(snapshot.queueFingerprint);

  if (state.restartPending && !snapshot.runActive && !snapshot.terminalFailure && !snapshot.manualStop && !snapshot.shuttingDown) {
    state.status = "suspended";
    state.lastSampleAt = null;
    return { state, events };
  }

  if (!snapshot.runActive || snapshot.openItems <= 0 || snapshot.terminalFailure || snapshot.manualStop || snapshot.shuttingDown || !runFingerprint || !queueFingerprint) {
    state.downloadProgressSequence = Math.max(state.downloadProgressSequence, finiteInteger(snapshot.downloadProgressSequence));
    state.itemCompletionSequence = Math.max(state.itemCompletionSequence, finiteInteger(snapshot.itemCompletionSequence));
    state.lastPositiveByteAt = Math.max(state.lastPositiveByteAt, finiteInteger(snapshot.lastPositiveByteAt));
    state.technicalRecoveryCount = Math.max(state.technicalRecoveryCount, finiteInteger(snapshot.technicalRecoveryCount));
    return { state: endIncident(state), events };
  }

  if (state.runFingerprint !== runFingerprint || state.queueFingerprint !== queueFingerprint) {
    state = resetForSnapshot(state, snapshot, now);
  }

  state.runFingerprint = runFingerprint;
  state.queueFingerprint = queueFingerprint;

  if (state.restartPending) {
    state.restartFreshSamples += 1;
    state.lastSampleAt = now;
    if (state.restartFreshSamples < 2) {
      state.downloadProgressSequence = finiteInteger(snapshot.downloadProgressSequence);
      state.itemCompletionSequence = finiteInteger(snapshot.itemCompletionSequence);
      state.lastPositiveByteAt = finiteInteger(snapshot.lastPositiveByteAt);
      state.technicalRecoveryCount = finiteInteger(snapshot.technicalRecoveryCount);
      return { state, events };
    }
    state.restartPending = false;
  }

  const progressSequence = finiteInteger(snapshot.downloadProgressSequence);
  const completionSequence = finiteInteger(snapshot.itemCompletionSequence);
  const positiveByteProgress = progressSequence > state.downloadProgressSequence;
  const completionProgress = completionSequence > state.itemCompletionSequence;
  const progress = positiveByteProgress || completionProgress;
  state.downloadProgressSequence = Math.max(state.downloadProgressSequence, progressSequence);
  state.itemCompletionSequence = Math.max(state.itemCompletionSequence, completionSequence);
  state.lastPositiveByteAt = Math.max(state.lastPositiveByteAt, finiteInteger(snapshot.lastPositiveByteAt));
  state.technicalRecoveryCount = Math.max(state.technicalRecoveryCount, finiteInteger(snapshot.technicalRecoveryCount));

  if (state.alertedAt > 0 && progress) {
    state.recoverySamples = completionProgress ? 2 : state.recoverySamples + 1;
    if (state.recoverySamples >= 2) {
      if (options.notifyOnRecovery) {
        events.push(recoveryEvent(state, snapshot, now));
      }
      const recovered = resetForSnapshot(state, snapshot, now);
      recovered.status = "healthy";
      recovered.lastAlertAt = state.lastAlertAt;
      recovered.cooldownUntil = state.cooldownUntil;
      return { state: recovered, events };
    }
    state.status = "recovering";
    state.lastSampleAt = now;
    return { state, events };
  }

  if (state.alertedAt > 0) {
    if (expectedWait(snapshot, now)) {
      state.status = "expected_wait";
    } else {
      state.status = "alerted";
    }
    state.lastSampleAt = now;
    return { state, events };
  }

  if (expectedWait(snapshot, now)) {
    state.status = "expected_wait";
    state.lastSampleAt = now;
    return { state, events };
  }

  if (progress) {
    state.status = "healthy";
    state.suspiciousDurationMs = 0;
    state.suspiciousSamples = 0;
    state.incidentStartedAt = 0;
    state.incidentType = null;
    state.recoverySamples = 0;
    state.lastSampleAt = now;
    return { state, events };
  }

  const incidentType = suspicionType(snapshot, now);
  if (!incidentType) {
    state.status = "healthy";
    state.suspiciousDurationMs = 0;
    state.suspiciousSamples = 0;
    state.incidentStartedAt = 0;
    state.incidentType = null;
    state.lastSampleAt = now;
    return { state, events };
  }

  const elapsed = state.lastSampleAt === null ? 0 : Math.max(0, now - state.lastSampleAt);
  if (state.incidentStartedAt <= 0) {
    state.incidentStartedAt = now;
  }
  state.suspiciousDurationMs += elapsed;
  state.suspiciousSamples += 1;
  state.incidentType = incidentType;
  state.status = incidentType === "scheduler" ? "suspect_scheduler" : "suspect_no_data";
  state.lastSampleAt = now;

  const stallAfterMs = Math.max(0, finiteInteger(options.stallAfterMs, 90_000));
  const cooldownMs = Math.max(0, finiteInteger(options.cooldownMs, 600_000));
  const confirmed = state.suspiciousDurationMs >= stallAfterMs
    && state.suspiciousSamples >= MIN_SUSPICIOUS_SAMPLES;
  if (confirmed && options.notifyOnStall && now >= state.cooldownUntil) {
    state.status = "alerted";
    state.alertedAt = now;
    state.lastAlertAt = now;
    state.cooldownUntil = now + cooldownMs;
    state.recoverySamples = 0;
    events.push(incidentEvent(state, snapshot, now));
  }

  return { state, events };
}

function persistedState(state: DownloadHealthState): Omit<DownloadHealthState, "restartPending" | "restartFreshSamples"> {
  return {
    version: 1,
    status: state.status,
    runFingerprint: state.runFingerprint,
    queueFingerprint: state.queueFingerprint,
    suspiciousDurationMs: finiteInteger(state.suspiciousDurationMs),
    suspiciousSamples: finiteInteger(state.suspiciousSamples),
    incidentStartedAt: finiteInteger(state.incidentStartedAt),
    incidentType: state.incidentType,
    alertedAt: finiteInteger(state.alertedAt),
    lastAlertAt: finiteInteger(state.lastAlertAt),
    cooldownUntil: finiteInteger(state.cooldownUntil),
    recoverySamples: finiteInteger(state.recoverySamples),
    lastSampleAt: state.lastSampleAt === null ? null : finiteInteger(state.lastSampleAt),
    downloadProgressSequence: finiteInteger(state.downloadProgressSequence),
    itemCompletionSequence: finiteInteger(state.itemCompletionSequence),
    lastPositiveByteAt: finiteInteger(state.lastPositiveByteAt),
    technicalRecoveryCount: finiteInteger(state.technicalRecoveryCount)
  };
}

export function saveDownloadHealthState(filePath: string, state: DownloadHealthState): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(persistedState(state)), "utf8");
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
    }
    throw error;
  }
}

export function loadDownloadHealthState(filePath: string): DownloadHealthState {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    const runFingerprint = raw.runFingerprint === null ? null : validFingerprint(raw.runFingerprint);
    const queueFingerprint = raw.queueFingerprint === null ? null : validFingerprint(raw.queueFingerprint);
    if (raw.version !== 1 || !HEALTH_STATUSES.has(raw.status as DownloadHealthStatus)) {
      return createDownloadHealthState();
    }
    if ((raw.runFingerprint !== null && !runFingerprint) || (raw.queueFingerprint !== null && !queueFingerprint)) {
      return createDownloadHealthState();
    }
    const incidentType = INCIDENT_TYPES.has(raw.incidentType as DownloadHealthIncidentType)
      ? raw.incidentType as DownloadHealthIncidentType
      : null;
    return createDownloadHealthState({
      status: raw.status as DownloadHealthStatus,
      runFingerprint,
      queueFingerprint,
      suspiciousDurationMs: finiteInteger(raw.suspiciousDurationMs),
      suspiciousSamples: finiteInteger(raw.suspiciousSamples),
      incidentStartedAt: finiteInteger(raw.incidentStartedAt),
      incidentType,
      alertedAt: finiteInteger(raw.alertedAt),
      lastAlertAt: finiteInteger(raw.lastAlertAt),
      cooldownUntil: finiteInteger(raw.cooldownUntil),
      recoverySamples: finiteInteger(raw.recoverySamples),
      lastSampleAt: null,
      downloadProgressSequence: finiteInteger(raw.downloadProgressSequence),
      itemCompletionSequence: finiteInteger(raw.itemCompletionSequence),
      lastPositiveByteAt: finiteInteger(raw.lastPositiveByteAt),
      technicalRecoveryCount: finiteInteger(raw.technicalRecoveryCount),
      restartPending: Boolean(runFingerprint && queueFingerprint),
      restartFreshSamples: 0
    });
  } catch {
    return createDownloadHealthState();
  }
}

export class DownloadHealthMonitor {
  private state: DownloadHealthState;

  public constructor(private readonly filePath: string, initialState?: DownloadHealthState) {
    this.state = initialState ? createDownloadHealthState(initialState) : loadDownloadHealthState(filePath);
  }

  public getState(): DownloadHealthState {
    return createDownloadHealthState(this.state);
  }

  public async sample(
    snapshot: DownloadHealthSnapshot,
    now: number,
    options: DownloadHealthOptions,
    enqueue: (event: NotificationEvent) => Promise<void>
  ): Promise<DownloadHealthEvaluation> {
    const evaluation = evaluateDownloadHealth(this.state, snapshot, now, options);
    for (const event of evaluation.events) {
      await enqueue(event);
    }
    saveDownloadHealthState(this.filePath, evaluation.state);
    this.state = evaluation.state;
    return evaluation;
  }
}
