import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { logTimestamp } from "./log-timestamp";
import { formatDiagnosticLink, sanitizeDiagnosticAccountLabel, sanitizeDiagnosticFields, sanitizeDiagnosticText } from "./diagnostic-sanitizer";

export interface ConversionPhase {
  atMs: number;
  phase: string;
  provider?: string;
  account?: string;
  tokenState?: string;
  queueWaitMs?: number;
  workMs?: number;
  outcome?: string;
  detail?: string;
}

export interface ConversionTrace {
  startedAt: number;
  attemptId?: string;
  itemId: string;
  packageId?: string;
  itemName: string;
  link: string;
  providerOrder: string;
  notes: Record<string, string | number>;
  phases: ConversionPhase[];
}

const conversionContext = new AsyncLocalStorage<ConversionTrace>();

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeConversionText(value: unknown, itemName = ""): string {
  let safeValue = sanitizeDiagnosticText(value)
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,63}#[a-f0-9]{10}\b/gi, "<redacted-link>");
  const safeItemName = sanitizeDiagnosticText(itemName).trim();
  if (safeItemName) {
    safeValue = safeValue.replace(new RegExp(escapeRegExp(safeItemName), "gi"), "<redacted-item>");
  }
  return safeValue;
}

export function traceConversionPhase(phase: Omit<ConversionPhase, "atMs">): void {
  const trace = conversionContext.getStore();
  if (!trace) {
    return;
  }
  trace.phases.push({
    ...phase,
    phase: sanitizeDiagnosticText(phase.phase),
    provider: phase.provider ? sanitizeDiagnosticText(phase.provider) : undefined,
    account: phase.account ? sanitizeDiagnosticAccountLabel(phase.account) : undefined,
    tokenState: phase.tokenState ? sanitizeDiagnosticText(phase.tokenState) : undefined,
    outcome: phase.outcome ? sanitizeDiagnosticText(phase.outcome) : undefined,
    detail: phase.detail ? sanitizeDiagnosticText(phase.detail) : undefined,
    atMs: Date.now() - trace.startedAt
  });
}

export function traceConversionNote(key: string, value: string | number): void {
  const trace = conversionContext.getStore();
  if (!trace) {
    return;
  }
  const safeKey = sanitizeDiagnosticText(key);
  const safeValue = sanitizeDiagnosticFields({ [key]: value })?.[key];
  trace.notes[safeKey] = typeof safeValue === "number" ? safeValue : sanitizeDiagnosticText(safeValue);
}

export function hasActiveConversionTrace(): boolean {
  return conversionContext.getStore() !== undefined;
}

export function formatConversionBlock(
  trace: ConversionTrace,
  outcome: string,
  detail: string,
  totalMs: number
): string {
  const safeNotes = sanitizeDiagnosticFields(trace.notes) || {};
  const noteParts = Object.entries(safeNotes)
    .map(([key, value]) => `${sanitizeConversionText(key, trace.itemName)}=${sanitizeConversionText(value, trace.itemName)}`)
    .join(" ");
  const safeOrder = sanitizeConversionText(trace.providerOrder || "?", trace.itemName);
  const safeOutcome = sanitizeConversionText(outcome, trace.itemName);
  const safeDetail = sanitizeConversionText(detail, trace.itemName);
  const correlation = [
    trace.attemptId ? `attemptId=${sanitizeConversionText(trace.attemptId)}` : "",
    `itemId=${sanitizeConversionText(trace.itemId)}`,
    trace.packageId ? `packageId=${sanitizeConversionText(trace.packageId)}` : ""
  ].filter(Boolean).join(" | ");
  const header = `${logTimestamp()} [CONV] ${correlation} | order=${safeOrder}`
    + ` | result=${safeOutcome}${safeDetail ? ` (${safeDetail})` : ""} | total=${totalMs}ms${noteParts ? ` | ${noteParts}` : ""}`;
  const lines = trace.phases.map((p) => {
    const parts: string[] = [];
    if (p.provider) parts.push(`provider=${sanitizeConversionText(p.provider, trace.itemName)}`);
    if (p.account) parts.push(`account=${sanitizeDiagnosticAccountLabel(p.account)}`);
    if (p.tokenState) parts.push(`token=${sanitizeConversionText(p.tokenState, trace.itemName)}`);
    if (typeof p.queueWaitMs === "number") parts.push(`queueWaitMs=${p.queueWaitMs}`);
    if (typeof p.workMs === "number") parts.push(`workMs=${p.workMs}`);
    if (p.outcome) parts.push(`outcome=${sanitizeConversionText(p.outcome, trace.itemName)}`);
    if (p.detail) parts.push(`detail=${sanitizeConversionText(p.detail, trace.itemName)}`);
    return `    +${p.atMs}ms ${sanitizeConversionText(p.phase, trace.itemName)}${parts.length ? ` | ${parts.join(" | ")}` : ""}`;
  });
  return [header, ...lines].join("\n");
}

const CONVERSION_LOG_MAX_FILE_BYTES = Number(process.env.RD_CONVERSION_LOG_MAX_BYTES || 5 * 1024 * 1024);
const CONVERSION_LOG_RETENTION_DAYS = Number(process.env.RD_CONVERSION_LOG_RETENTION_DAYS || 14);

let conversionLogPath: string | null = null;

function rotateIfNeeded(filePath: string): void {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size < CONVERSION_LOG_MAX_FILE_BYTES) {
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
    const cutoff = Date.now() - CONVERSION_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    if (stat.mtimeMs < cutoff) {
      fs.rmSync(backup, { force: true });
    }
  } catch {
  }
}

export function initConversionLog(baseDir: string): void {
  conversionLogPath = path.join(baseDir, "conversion.log");
  try {
    fs.mkdirSync(path.dirname(conversionLogPath), { recursive: true });
    cleanupOldBackup(conversionLogPath);
    if (!fs.existsSync(conversionLogPath)) {
      fs.writeFileSync(conversionLogPath, "", "utf8");
    }
    rotateIfNeeded(conversionLogPath);
    if (!fs.existsSync(conversionLogPath)) {
      fs.writeFileSync(conversionLogPath, "", "utf8");
    }
    fs.appendFileSync(conversionLogPath, `=== Conversion Log Start: ${logTimestamp()} ===\n`, "utf8");
  } catch {
    conversionLogPath = null;
  }
}

export function getConversionLogPath(): string | null {
  if (!conversionLogPath) {
    return null;
  }
  return fs.existsSync(conversionLogPath) ? conversionLogPath : null;
}

export function shutdownConversionLog(): void {
  if (!conversionLogPath) {
    return;
  }
  try {
    fs.appendFileSync(conversionLogPath, `=== Conversion Log Ende: ${logTimestamp()} ===\n`, "utf8");
  } catch {
  }
  conversionLogPath = null;
}

function writeConversionBlock(block: string): void {
  if (!conversionLogPath) {
    return;
  }
  try {
    rotateIfNeeded(conversionLogPath);
    if (!fs.existsSync(conversionLogPath)) {
      fs.writeFileSync(conversionLogPath, "", "utf8");
    }
    fs.appendFileSync(conversionLogPath, `${block}\n`, "utf8");
  } catch {
  }
}

export async function runWithConversionTrace<T>(
  meta: { attemptId?: string; itemId: string; packageId?: string; itemName: string; link: string; providerOrder: string },
  fn: () => Promise<T>
): Promise<T> {
  const trace: ConversionTrace = {
    startedAt: Date.now(),
    attemptId: meta.attemptId ? sanitizeDiagnosticText(meta.attemptId) : undefined,
    itemId: sanitizeDiagnosticText(meta.itemId),
    packageId: meta.packageId ? sanitizeDiagnosticText(meta.packageId) : undefined,
    itemName: sanitizeDiagnosticText(meta.itemName),
    link: formatDiagnosticLink(meta.link),
    providerOrder: sanitizeDiagnosticText(meta.providerOrder),
    notes: {},
    phases: []
  };
  let outcome = "OK";
  let detail = "";
  try {
    const result = await conversionContext.run(trace, fn);
    return result;
  } catch (error) {
    outcome = "FAIL";
    detail = sanitizeDiagnosticText(String((error as { message?: string })?.message || error || "").replace(/^Error:\s*/i, "").slice(0, 160));
    throw error;
  } finally {
    const totalMs = Date.now() - trace.startedAt;
    writeConversionBlock(formatConversionBlock(trace, outcome, detail, totalMs));
  }
}
