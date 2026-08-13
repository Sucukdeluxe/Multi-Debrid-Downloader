import fs from "node:fs";
import { logTimestamp } from "./log-timestamp";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import type { RotationEvent } from "../shared/types";
import { sanitizeDiagnosticAccountLabel, sanitizeDiagnosticFields, sanitizeDiagnosticText } from "./diagnostic-sanitizer";

export interface RotationCorrelationContext {
  attemptId?: string;
  itemId?: string;
  packageId?: string;
}

export type CorrelatedRotationEvent = RotationEvent & RotationCorrelationContext;
export type RotationItemSink = (event: CorrelatedRotationEvent) => void;

interface RotationItemContext extends RotationCorrelationContext {
  sink: RotationItemSink;
}

const rotationItemContext = new AsyncLocalStorage<RotationItemContext>();

export function runWithRotationItemSink<T>(
  sink: RotationItemSink,
  fn: () => Promise<T>,
  correlation: RotationCorrelationContext = {}
): Promise<T> {
  return rotationItemContext.run({ ...correlation, sink }, fn);
}

type RotationLevel = "INFO" | "WARN" | "ERROR";

const ROTATION_EVENT_RING_MAX = 60;
const rotationEventRing: CorrelatedRotationEvent[] = [];
let rotationEventSeq = 0;
let rotationEventListener: ((event: CorrelatedRotationEvent) => void) | null = null;

export function setRotationEventListener(listener: ((event: CorrelatedRotationEvent) => void) | null): void {
  rotationEventListener = listener;
}

export function getRecentRotationEvents(limit = ROTATION_EVENT_RING_MAX): CorrelatedRotationEvent[] {
  const slice = rotationEventRing.slice(-limit);
  slice.reverse();
  return slice;
}

function pushRotationEvent(
  level: RotationLevel,
  provider: string,
  accountLabel: string,
  event: string,
  fields?: Record<string, unknown>,
  at = Date.now()
): CorrelatedRotationEvent {
  rotationEventSeq += 1;
  const context = rotationItemContext.getStore();
  const entry: CorrelatedRotationEvent = {
    id: `rot_${at}_${rotationEventSeq}`,
    at,
    level,
    provider,
    accountLabel,
    event,
    reason: fields && fields.reason != null ? String(fields.reason) : undefined,
    category: fields && fields.category != null ? String(fields.category) : undefined,
    cooldownSec: fields && fields.cooldownSec != null ? Number(fields.cooldownSec) || 0 : undefined,
    next: fields && fields.next != null ? String(fields.next) : undefined,
    attemptId: context?.attemptId ? sanitizeDiagnosticText(context.attemptId) : undefined,
    itemId: context?.itemId ? sanitizeDiagnosticText(context.itemId) : undefined,
    packageId: context?.packageId ? sanitizeDiagnosticText(context.packageId) : undefined
  };

  if (context) {
    try {
      context.sink(entry);
    } catch {
    }
  }

  const uiEntry = event === "TIMEOUT_COOLDOWN"
    ? { ...entry, reason: entry.reason ? `Versuch fehlgeschlagen: ${entry.reason}` : "Versuch fehlgeschlagen" }
    : entry;
  rotationEventRing.push(uiEntry);
  if (rotationEventRing.length > ROTATION_EVENT_RING_MAX) {
    rotationEventRing.splice(0, rotationEventRing.length - ROTATION_EVENT_RING_MAX);
  }
  if (rotationEventListener) {
    try {
      rotationEventListener(uiEntry);
    } catch {
    }
  }
  return entry;
}

const ROTATION_LOG_MAX_FILE_BYTES = Number(process.env.RD_ACCOUNT_ROTATION_LOG_MAX_BYTES || 5 * 1024 * 1024);
const ROTATION_LOG_RETENTION_DAYS = Number(process.env.RD_ACCOUNT_ROTATION_LOG_RETENTION_DAYS || 14);

let rotationLogPath: string | null = null;

function sanitizeFieldValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return sanitizeDiagnosticText(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return sanitizeDiagnosticText(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function formatFields(fields?: Record<string, unknown>): string {
  if (!fields) {
    return "";
  }
  const parts = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && sanitizeFieldValue(value) !== "")
    .map(([key, value]) => `${key}=${sanitizeFieldValue(value)}`);
  return parts.length > 0 ? ` | ${parts.join(" | ")}` : "";
}

function rotateIfNeeded(filePath: string): void {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size < ROTATION_LOG_MAX_FILE_BYTES) {
      return;
    }
    const backup = `${filePath}.old`;
    try {
      fs.rmSync(backup, { force: true });
    } catch {
    }
    fs.renameSync(filePath, backup);
  } catch {
  }
}

function cleanupOldBackup(filePath: string): void {
  const backup = `${filePath}.old`;
  try {
    const stat = fs.statSync(backup);
    const cutoff = Date.now() - ROTATION_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    if (stat.mtimeMs < cutoff) {
      fs.rmSync(backup, { force: true });
    }
  } catch {
  }
}

export function initAccountRotationLog(baseDir: string): void {
  rotationLogPath = path.join(baseDir, "account-rotation.log");
  try {
    fs.mkdirSync(path.dirname(rotationLogPath), { recursive: true });
    cleanupOldBackup(rotationLogPath);
    if (!fs.existsSync(rotationLogPath)) {
      fs.writeFileSync(rotationLogPath, "", "utf8");
    }
    rotateIfNeeded(rotationLogPath);
    if (!fs.existsSync(rotationLogPath)) {
      fs.writeFileSync(rotationLogPath, "", "utf8");
    }
    fs.appendFileSync(
      rotationLogPath,
      `=== Account-Rotation Log Start: ${logTimestamp()} ===\n`,
      "utf8"
    );
  } catch {
    rotationLogPath = null;
  }
}

export function logAccountRotation(
  level: RotationLevel,
  provider: string,
  accountLabel: string,
  event: string,
  fields?: Record<string, unknown>
): void {
  const safeProvider = sanitizeDiagnosticText(provider);
  const safeAccountLabel = sanitizeDiagnosticAccountLabel(accountLabel);
  const safeEvent = sanitizeDiagnosticText(event);
  const safeFields = sanitizeDiagnosticFields(fields);
  const entry = pushRotationEvent(level, safeProvider, safeAccountLabel, safeEvent, safeFields);
  if (!rotationLogPath) {
    return;
  }
  try {
    rotateIfNeeded(rotationLogPath);
    if (!fs.existsSync(rotationLogPath)) {
      fs.writeFileSync(rotationLogPath, "", "utf8");
    }
    const head = `${logTimestamp()} [${level}] ${safeProvider} | ${safeAccountLabel} | ${safeEvent}`;
    const logFields = {
      ...safeFields,
      ...(entry.attemptId ? { attemptId: entry.attemptId } : {}),
      ...(entry.itemId ? { itemId: entry.itemId } : {}),
      ...(entry.packageId ? { packageId: entry.packageId } : {})
    };
    fs.appendFileSync(rotationLogPath, `${head}${formatFields(logFields)}\n`, "utf8");
  } catch {
  }
}

export function getAccountRotationLogPath(): string | null {
  if (!rotationLogPath) {
    return null;
  }
  return fs.existsSync(rotationLogPath) ? rotationLogPath : null;
}

export function shutdownAccountRotationLog(): void {
  if (!rotationLogPath) {
    return;
  }
  try {
    fs.appendFileSync(
      rotationLogPath,
      `=== Account-Rotation Log Ende: ${logTimestamp()} ===\n`,
      "utf8"
    );
  } catch {
  }
  rotationLogPath = null;
}
