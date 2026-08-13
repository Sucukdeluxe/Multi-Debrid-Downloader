import { promises as fsp } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import AdmZip from "adm-zip";
import { APP_VERSION } from "./constants";
import { getAccountRotationLogPath } from "./account-rotation-log";
import { getConversionLogPath } from "./conversion-trace";
import { getAuditLogPath } from "./audit-log";
import { getDebugSetupCheck } from "./debug-setup";
import { flushLogger, getLogFilePath } from "./logger";
import { getRecentErrors } from "./error-ring";
import { getRenameLogPath } from "./rename-log";
import { getDesktopRenameLogPath } from "./desktop-rename-log";
import { flushSessionLog, getSessionLogPath } from "./session-log";
import { createStoragePaths, loadSettings } from "./storage";
import { buildAccountSummary, buildRedactedSettingsPayload, buildStatsPayload } from "./support-data";
import { flushTraceLog, getTraceConfig, getTraceConfigPath, getTraceLogPath } from "./trace-log";
import { flushPackageLogs, getPackageLogPath as getPersistedPackageLogPath } from "./package-log";
import { flushItemLogs, getItemLogPath as getPersistedItemLogPath } from "./item-log";
import { getCachedWindowsHostDiagnostics, getWindowsHostDiagnostics } from "./windows-host-diagnostics";
import { parseDebridLinkApiKeys } from "../shared/debrid-link-keys";
import {
  getMegaDebridAccountsForMode,
  getMegaDebridDisabledAccountIdsForMode,
  maskMegaDebridLogin,
  type MegaDebridAccountMode
} from "../shared/mega-debrid-accounts";
import { getProviderRuntimeSnapshot, type ProviderRuntimeCooldown, type ProviderRuntimeSnapshot } from "./debrid";
import type { DownloadManager } from "./download-manager";
import type { DownloadItem, HistoryEntry, PackageEntry, SessionState } from "../shared/types";

const SUPPORT_MANIFEST_FILE = "debug_support_manifest.json";
const SUPPORT_BUNDLE_LOG_WINDOW_MS = 8 * 60 * 60 * 1000;
const MAX_TEXT_FILE_BYTES = 128 * 1024;
const MAX_RUNTIME_FILE_BYTES = 64 * 1024;
const MAX_TOTAL_TEXT_BYTES = 4 * 1024 * 1024;
const MAX_DIRECTORY_SCAN_FILES = 2_048;
const MAX_SESSION_LOG_FILES = 4;
const MAX_PACKAGE_LOG_FILES = 8;
const MAX_ITEM_LOG_FILES = 16;
const MAX_PACKAGE_DTOS = 200;
const MAX_ITEM_DTOS = 500;
const MAX_HISTORY_FILE_BYTES = 1024 * 1024;
const MAX_HISTORY_ENTRIES = 100;

interface TextBudget {
  remainingBytes: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function addSensitiveValue(output: Set<string>, value: string): void {
  const trimmed = value.trim();
  if (trimmed) {
    output.add(trimmed);
  }
}

function collectSensitiveValues(value: unknown, key = "", output = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    if (/token|api.?key|password|passwd|secret|cookie|authorization|credential|login|username/i.test(key)) {
      for (const candidate of [value, ...value.split(/\r?\n/)]) {
        const trimmed = candidate.trim();
        addSensitiveValue(output, trimmed);
        if (/credential/i.test(key)) {
          const separator = trimmed.indexOf(":");
          if (separator > 0) {
            const login = trimmed.slice(0, separator).trim();
            const password = trimmed.slice(separator + 1).trim();
            addSensitiveValue(output, login);
            addSensitiveValue(output, password);
            if (/mega.?debrid/i.test(key)) {
              addSensitiveValue(output, maskMegaDebridLogin(login));
            }
          }
        }
        if (/debrid.?link.*api.?keys?/i.test(key)) {
          for (const entry of parseDebridLinkApiKeys(trimmed)) {
            addSensitiveValue(output, entry.token);
            addSensitiveValue(output, entry.masked);
          }
        }
      }
    }
    return output;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectSensitiveValues(entry, key, output);
    }
    return output;
  }
  if (value && typeof value === "object") {
    for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
      collectSensitiveValues(entryValue, entryKey, output);
    }
  }
  return output;
}

function redactSupportText(value: string, sensitiveValues: ReadonlySet<string>): string {
  const raw = String(value || "").replace(/\0/g, "");
  const findMarker = (source: string, offset: number): string => {
    for (let index = offset; index < 0x1900; index += 1) {
      const marker = String.fromCharCode(0xe000 + index);
      if (!source.includes(marker) && [...sensitiveValues].every((secret) => !secret.includes(marker))) {
        return marker;
      }
    }
    return String.fromCharCode(0xf8ff - offset);
  };
  const urlMarker = findMarker(raw, 0);
  let output = raw.replace(/\b(?:https?|file):(?:\\?\/){2}[^\s"'<>]+/gi, urlMarker);
  const pathMarker = findMarker(output, 1);
  output = output.replace(/\b[A-Z]:[\\/][^\r\n|"<>]+/gi, pathMarker);
  output = output.replace(/\\\\[^\r\n|"<>]+/g, pathMarker);
  output = output.replace(/\/(?:home|Users|var|tmp)\/[^\r\n|"<>]+/g, pathMarker);
  output = output.replace(/\b(?:authorization|proxy-authorization)\s*[:=]\s*[^\r\n]+/gi, "Authorization: <redacted>");
  output = output.replace(/\b(?:set-cookie|cookie)\s*[:=]\s*[^\r\n]+/gi, "Cookie: <redacted>");
  output = output.replace(/\b((?:Account|Key)\s+\d+(?:\/\d+)?)\s*,\s*[^)\r\n]+(?=\))/gi, "$1, <redacted-account>");
  output = output.replace(/\b((?:Account|Key)\s+\d+(?:\/\d+)?)\s*\([^)\r\n]*\)/gi, "$1 (<redacted-account>)");
  output = output.replace(/(["']?(?:authorization|proxy-authorization|set-cookie|cookie|password|passwd|pwd|token|access[_-]?token|refresh[_-]?token|api[_ -]?key|secret|client[_-]?secret|auth|login|username|user)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/gi, "$1\"<redacted>\"");
  output = output.replace(/\b(password|passwd|pwd|token|access[_-]?token|refresh[_-]?token|api[_ -]?key|secret|client[_-]?secret|auth|login|username|user)\b(\s*[:=]\s*)[^\s,;|]+/gi, "$1$2<redacted>");
  const secretVariants = new Set<string>();
  for (const secret of sensitiveValues) {
    secretVariants.add(secret);
    const jsonEscaped = JSON.stringify(secret).slice(1, -1);
    if (jsonEscaped) {
      secretVariants.add(jsonEscaped);
    }
  }
  for (const secret of [...secretVariants].sort((a, b) => b.length - a.length)) {
    const escaped = escapeRegExp(secret);
    output = secret.length >= 4
      ? output.replace(new RegExp(escaped, "g"), "<redacted>")
      : output.replace(new RegExp(`(^|[^A-Za-z0-9])${escaped}(?=$|[^A-Za-z0-9])`, "g"), "$1<redacted>");
  }
  output = output.replace(/\b[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g, "<redacted>");
  output = output.replace(/\b(?=[A-Za-z0-9+/_=-]{24,}\b)(?=[A-Za-z0-9+/_=-]*[A-Za-z])(?=[A-Za-z0-9+/_=-]*\d)[A-Za-z0-9+/_=-]+\b/g, "<redacted>");
  output = output.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "<redacted-email>");
  return output.replaceAll(urlMarker, "<redacted-url>").replaceAll(pathMarker, "<local-path>");
}

function redactSupportValue(value: unknown, sensitiveValues: ReadonlySet<string>, key = ""): unknown {
  if (typeof value === "string") {
    if (/token|api.?key|password|passwd|secret|cookie|authorization|credential|login|username/i.test(key) && value.trim()) {
      return "<redacted>";
    }
    return redactSupportText(value, sensitiveValues);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactSupportValue(entry, sensitiveValues, key));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([entryKey, entryValue]) => [entryKey, redactSupportValue(entryValue, sensitiveValues, entryKey)]));
  }
  return value;
}

function sanitizeArchivePath(zipPath: string, sensitiveValues: ReadonlySet<string>, redactFileName: boolean): string {
  const parts = zipPath.split("/");
  return parts
    .map((part, index) => {
      const redacted = redactFileName && index === parts.length - 1
        ? redactSupportText(part, sensitiveValues)
        : part;
      const extension = path.posix.extname(redacted);
      const name = extension ? redacted.slice(0, -extension.length) : redacted;
      const safeName = name.replace(/[<>:"\\|?*\x00-\x1f]/g, "_").replace(/\.+$/g, "_") || "entry";
      const safeExtension = extension.replace(/[<>:"\\|?*\x00-\x1f]/g, "_");
      const uniqueness = redacted === part ? "" : `-${randomUUID().slice(0, 12)}`;
      return `${safeName}${uniqueness}${safeExtension}`;
    })
    .join("/");
}

async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function addJson(zip: AdmZip, zipPath: string, value: unknown, sensitiveValues: ReadonlySet<string>): Promise<void> {
  const redacted = redactSupportValue(value, sensitiveValues);
  const buffer = Buffer.from(`${JSON.stringify(redacted, null, 2)}\n`, "utf8");
  await yieldToEventLoop();
  zip.addFile(zipPath, buffer);
}

async function safeReadBoundedJson(filePath: string, maxBytes: number): Promise<unknown> {
  try {
    const stats = await fsp.stat(filePath);
    if (!stats.isFile() || stats.size > maxBytes) {
      return null;
    }
    return JSON.parse(await fsp.readFile(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function getSourcePathKey(sourcePath: string): string {
  const resolved = path.resolve(sourcePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function readTextTail(filePath: string, maxBytes: number): Promise<string> {
  const stats = await fsp.stat(filePath);
  const bytesToRead = Math.min(stats.size, Math.max(0, maxBytes));
  if (bytesToRead <= 0) {
    return "";
  }
  const handle = await fsp.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, Math.max(0, stats.size - bytesToRead));
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    return stats.size > bytesRead ? `[gekürzt: letzte ${bytesRead} Bytes]\n${text}` : text;
  } finally {
    await handle.close();
  }
}

async function addTextFileIfExists(
  zip: AdmZip,
  sourcePath: string | null,
  zipPath: string,
  includedSourcePaths: Set<string>,
  sensitiveValues: ReadonlySet<string>,
  budget: TextBudget,
  maxFileBytes: number,
  maxAgeMs?: number,
  redactArchiveFileName = false
): Promise<boolean> {
  if (!sourcePath || budget.remainingBytes <= 0) {
    return false;
  }
  const sourcePathKey = getSourcePathKey(sourcePath);
  if (includedSourcePaths.has(sourcePathKey)) {
    return false;
  }
  try {
    if (maxAgeMs !== undefined && (await fsp.stat(sourcePath)).mtimeMs < Date.now() - maxAgeMs) {
      return false;
    }
    const allowedBytes = Math.min(maxFileBytes, budget.remainingBytes);
    const text = redactSupportText(await readTextTail(sourcePath, allowedBytes), sensitiveValues);
    let buffer = Buffer.from(text, "utf8");
    if (buffer.length > allowedBytes) {
      buffer = Buffer.from(buffer.subarray(buffer.length - allowedBytes).toString("utf8"), "utf8");
    }
    await yieldToEventLoop();
    zip.addFile(sanitizeArchivePath(zipPath, sensitiveValues, redactArchiveFileName), buffer);
    includedSourcePaths.add(sourcePathKey);
    budget.remainingBytes = Math.max(0, budget.remainingBytes - buffer.length);
    return true;
  } catch {
    return false;
  }
}

async function addRecentDirectoryFiles(
  zip: AdmZip,
  dirPath: string,
  zipRoot: string,
  maxAgeMs: number,
  maxFiles: number,
  includedSourcePaths: Set<string>,
  sensitiveValues: ReadonlySet<string>,
  budget: TextBudget
): Promise<number> {
  if (maxFiles <= 0 || budget.remainingBytes <= 0) {
    return 0;
  }
  const candidates: Array<{ name: string; fullPath: string; mtimeMs: number }> = [];
  let directory;
  try {
    directory = await fsp.opendir(dirPath);
  } catch {
    return 0;
  }
  const cutoff = Date.now() - maxAgeMs;
  let scanned = 0;
  for await (const entry of directory) {
    if (scanned >= MAX_DIRECTORY_SCAN_FILES) {
      break;
    }
    scanned += 1;
    if (!entry.isFile()) {
      continue;
    }
    const fullPath = path.join(dirPath, entry.name);
    try {
      const stats = await fsp.stat(fullPath);
      if (stats.mtimeMs >= cutoff) {
        candidates.push({ name: entry.name, fullPath, mtimeMs: stats.mtimeMs });
        candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
        if (candidates.length > maxFiles) {
          candidates.length = maxFiles;
        }
      }
    } catch {
    }
  }
  let added = 0;
  for (const candidate of candidates) {
    if (budget.remainingBytes <= 0) {
      break;
    }
    if (await addTextFileIfExists(
      zip,
      candidate.fullPath,
      path.posix.join(zipRoot, candidate.name),
      includedSourcePaths,
      sensitiveValues,
      budget,
      MAX_TEXT_FILE_BYTES,
      undefined,
      true
    )) {
      added += 1;
    }
  }
  return added;
}

async function addRelevantLogFiles<T extends { id: string }>(
  zip: AdmZip,
  entries: readonly T[],
  resolveSourcePath: (id: string) => string | null,
  zipRoot: string,
  maxFiles: number,
  includedSourcePaths: Set<string>,
  sensitiveValues: ReadonlySet<string>,
  budget: TextBudget
): Promise<number> {
  let added = 0;
  for (const entry of entries.slice(0, maxFiles)) {
    if (budget.remainingBytes <= 0) {
      break;
    }
    const sourcePath = resolveSourcePath(entry.id);
    if (!sourcePath) {
      continue;
    }
    if (await addTextFileIfExists(
      zip,
      sourcePath,
      path.posix.join(zipRoot, path.basename(sourcePath)),
      includedSourcePaths,
      sensitiveValues,
      budget,
      MAX_TEXT_FILE_BYTES,
      undefined,
      true
    )) {
      added += 1;
    }
  }
  return added;
}

function isActiveStatus(status: unknown): boolean {
  return !new Set(["completed", "failed", "cancelled", "extracted", "deleted"]).has(String(status || ""));
}

function getBundleAliasExtension(value: string): string {
  const extension = path.extname(String(value || "")).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : "";
}

function createBundleAlias(prefix: "package" | "item" | "history", index: number, sourceName = ""): string {
  const extension = getBundleAliasExtension(sourceName);
  return `${prefix}-${String(index + 1).padStart(3, "0")}${extension}`;
}

function createPackageDto(
  entry: PackageEntry,
  name: string,
  items: Readonly<Record<string, DownloadItem>>
): Record<string, unknown> {
  const currentItems = entry.itemIds.map((id) => items[id]).filter((item): item is DownloadItem => Boolean(item));
  const downloadedBytes = Math.max(0, Number(entry.cleanedDownloadedBytes || 0))
    + currentItems.reduce((sum, item) => sum + Math.max(0, Number(item.downloadedBytes || 0)), 0);
  const currentKnownTotals = currentItems
    .map((item) => item.totalBytes)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
  const hasKnownTotal = typeof entry.cleanedTotalBytes === "number" || currentKnownTotals.length > 0;
  const totalBytes = hasKnownTotal
    ? Math.max(0, Number(entry.cleanedTotalBytes || 0)) + currentKnownTotals.reduce((sum, value) => sum + value, 0)
    : null;
  return {
    id: entry.id,
    name,
    status: entry.status,
    itemCount: entry.itemIds.length,
    downloadedBytes,
    totalBytes,
    cancelled: entry.cancelled,
    enabled: entry.enabled,
    priority: entry.priority,
    postProcessLabel: entry.postProcessLabel,
    outputPath: entry.outputDir ? "<local-path>" : "",
    extractPath: entry.extractDir ? "<local-path>" : "",
    cleanedItemCount: entry.cleanedCompletedItemCount,
    cleanedUrlCount: entry.cleanedUrls?.length || 0,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  };
}

function getSourceHost(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function createItemDto(entry: DownloadItem, fileName: string): Record<string, unknown> {
  return {
    id: entry.id,
    packageId: entry.packageId,
    sourceHost: getSourceHost(entry.url),
    provider: entry.provider,
    providerLabel: entry.providerLabel,
    providerAccountLabel: entry.providerAccountLabel,
    status: entry.status,
    retries: entry.retries,
    speedBps: entry.speedBps,
    downloadedBytes: entry.downloadedBytes,
    totalBytes: entry.totalBytes,
    progressPercent: entry.progressPercent,
    fileName,
    targetPath: entry.targetPath ? "<local-path>" : "",
    resumable: entry.resumable,
    attempts: entry.attempts,
    lastError: entry.lastError,
    fullStatus: entry.fullStatus,
    resumeLinkRenewalFailures: entry.resumeLinkRenewalFailures,
    resumeHardResetUsed: entry.resumeHardResetUsed,
    resumeResetPending: entry.resumeResetPending,
    http416FreshRestarts: entry.http416FreshRestarts,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    onlineStatus: entry.onlineStatus
  };
}

function selectRelevantEntries<T extends { status: unknown; updatedAt: number }>(entries: T[], limit: number): T[] {
  return entries.sort((a, b) => Number(isActiveStatus(b.status)) - Number(isActiveStatus(a.status)) || b.updatedAt - a.updatedAt).slice(0, limit);
}

function createSessionDto(session: SessionState): Record<string, unknown> {
  return {
    version: session.version,
    runStartedAt: session.runStartedAt,
    totalDownloadedBytes: session.totalDownloadedBytes,
    summaryText: session.summaryText,
    reconnectUntil: session.reconnectUntil,
    reconnectReason: session.reconnectReason,
    paused: session.paused,
    running: session.running,
    updatedAt: session.updatedAt,
    packageCount: Object.keys(session.packages).length,
    itemCount: Object.keys(session.items).length
  };
}

function createHistoryDto(entry: HistoryEntry, name: string): Record<string, unknown> {
  return {
    id: entry.id,
    name,
    status: entry.status,
    provider: entry.provider,
    fileCount: entry.fileCount,
    totalBytes: entry.totalBytes,
    downloadedBytes: entry.downloadedBytes,
    durationSeconds: entry.durationSeconds,
    completedAt: entry.completedAt,
    outputPath: entry.outputDir ? "<local-path>" : "",
    urlCount: Array.isArray(entry.urls) ? entry.urls.length : 0
  };
}

async function loadBoundedHistory(filePath: string): Promise<{ total: number | null; entries: Array<Record<string, unknown>>; omitted: number | null }> {
  try {
    const stats = await fsp.stat(filePath);
    if (!stats.isFile() || stats.size > MAX_HISTORY_FILE_BYTES) {
      return { total: null, entries: [], omitted: null };
    }
    const parsed = JSON.parse(await fsp.readFile(filePath, "utf8")) as unknown;
    if (!Array.isArray(parsed)) {
      return { total: 0, entries: [], omitted: 0 };
    }
    const entries = parsed.slice(0, MAX_HISTORY_ENTRIES)
      .map((entry, index) => createHistoryDto(
        entry as HistoryEntry,
        createBundleAlias("history", index, String((entry as HistoryEntry).name || ""))
      ));
    return { total: parsed.length, entries, omitted: Math.max(0, parsed.length - entries.length) };
  } catch {
    return { total: 0, entries: [], omitted: 0 };
  }
}

function formatTimestampForFileName(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${y}-${mo}-${d}_${h}-${mi}-${s}`;
}

export function getSupportBundleDefaultFileName(): string {
  return `rd-support-bundle-${formatTimestampForFileName(new Date())}.zip`;
}

export interface SupportBundleExportResult {
  saved: boolean;
  busy: boolean;
  filePath?: string;
  message?: string;
}

interface SupportBundleExportSuccess {
  filePath: string;
  bytes: number;
}

export type SupportBundleExportPhase = "busy" | "cancel" | "build" | "write" | "success" | "failure";

export interface SupportBundleExportLifecycleEvent {
  phase: SupportBundleExportPhase;
  durationMs: number;
  totalDurationMs: number;
  bytes?: number;
  failedPhase?: "choose" | "build" | "write";
  code?: string;
}

export class SupportBundleExportError extends Error {
  public readonly phase: "choose" | "build" | "write";
  public readonly durationMs: number;
  public readonly code?: string;

  public constructor(phase: "choose" | "build" | "write", durationMs: number, code?: string) {
    super(`Support-Bundle-Export fehlgeschlagen (${phase}${code ? `, ${code}` : ""}).`);
    this.name = "SupportBundleExportError";
    this.phase = phase;
    this.durationMs = durationMs;
    this.code = code;
  }
}

interface SupportBundleExportRunnerOptions {
  chooseFile: () => Promise<string | null>;
  build: () => Promise<Buffer>;
  write: (filePath: string, buffer: Buffer) => Promise<void>;
  now?: () => number;
  onStart?: (result: { filePath: string }) => Promise<void> | void;
  onSuccess?: (result: SupportBundleExportSuccess) => Promise<void> | void;
  onFailure?: (error: SupportBundleExportError) => Promise<void> | void;
  onLifecycle?: (event: SupportBundleExportLifecycleEvent) => Promise<void> | void;
}

function getExportErrorCode(error: unknown): string | undefined {
  const code = String((error as NodeJS.ErrnoException | null)?.code || "").trim().toUpperCase();
  return /^[A-Z0-9_]{1,32}$/.test(code) ? code : undefined;
}

export function createSupportBundleExportRunner(
  options: SupportBundleExportRunnerOptions
): () => Promise<SupportBundleExportResult> {
  let active = false;
  const now = options.now || Date.now;
  const emitLifecycle = async (event: SupportBundleExportLifecycleEvent): Promise<void> => {
    if (!options.onLifecycle) {
      return;
    }
    try {
      await options.onLifecycle(event);
    } catch {
    }
  };
  return async () => {
    if (active) {
      await emitLifecycle({ phase: "busy", durationMs: 0, totalDurationMs: 0 });
      return {
        saved: false,
        busy: true,
        message: "Support-Bundle wird bereits erstellt."
      };
    }
    active = true;
    const startedAt = now();
    let phase: "choose" | "build" | "write" = "choose";
    let phaseStartedAt = startedAt;
    try {
      const filePath = await options.chooseFile();
      if (!filePath) {
        const finishedAt = now();
        await emitLifecycle({
          phase: "cancel",
          durationMs: Math.max(0, finishedAt - phaseStartedAt),
          totalDurationMs: Math.max(0, finishedAt - startedAt)
        });
        return { saved: false, busy: false };
      }
      if (options.onStart) {
        try {
          await options.onStart({ filePath });
        } catch {
        }
      }
      phase = "build";
      phaseStartedAt = now();
      const buffer = await options.build();
      let finishedAt = now();
      await emitLifecycle({
        phase: "build",
        durationMs: Math.max(0, finishedAt - phaseStartedAt),
        totalDurationMs: Math.max(0, finishedAt - startedAt),
        bytes: buffer.length
      });
      phase = "write";
      phaseStartedAt = now();
      await options.write(filePath, buffer);
      finishedAt = now();
      await emitLifecycle({
        phase: "write",
        durationMs: Math.max(0, finishedAt - phaseStartedAt),
        totalDurationMs: Math.max(0, finishedAt - startedAt),
        bytes: buffer.length
      });
      if (options.onSuccess) {
        try {
          await options.onSuccess({ filePath, bytes: buffer.length });
        } catch {
        }
      }
      await emitLifecycle({
        phase: "success",
        durationMs: Math.max(0, finishedAt - startedAt),
        totalDurationMs: Math.max(0, finishedAt - startedAt),
        bytes: buffer.length
      });
      return { saved: true, busy: false, filePath };
    } catch (error) {
      const failedAt = now();
      const code = getExportErrorCode(error);
      const safeError = new SupportBundleExportError(phase, Math.max(0, failedAt - startedAt), code);
      await emitLifecycle({
        phase: "failure",
        failedPhase: phase,
        durationMs: Math.max(0, failedAt - phaseStartedAt),
        totalDurationMs: Math.max(0, failedAt - startedAt),
        ...(code ? { code } : {})
      });
      if (options.onFailure) {
        try {
          await options.onFailure(safeError);
        } catch {
        }
      }
      throw safeError;
    } finally {
      active = false;
    }
  };
}

export async function writeSupportBundleAtomically(filePath: string, buffer: Buffer): Promise<void> {
  const targetPath = path.resolve(filePath);
  const targetDirectory = path.dirname(targetPath);
  const temporaryPath = path.join(targetDirectory, `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof fsp.open>> | null = null;
  try {
    handle = await fsp.open(temporaryPath, "wx");
    await handle.writeFile(buffer);
    await handle.sync();
    await handle.close();
    handle = null;
    await fsp.rename(temporaryPath, targetPath);
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => undefined);
    }
    await fsp.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

type HostDiagnosticsMode = "full" | "cached" | "none";

interface BuildSupportBundleOptions {
  hostDiagnosticsMode?: HostDiagnosticsMode;
  debugSetupMode?: "full" | "deferred";
}

function createDeferredHostDiagnostics(reason: string): unknown {
  return {
    collectedAt: new Date().toISOString(),
    supported: process.platform === "win32",
    platform: process.platform,
    crashControl: null,
    recentKernelPower: [],
    recentWerKernel: [],
    recentKernelDump: [],
    recentAppCrashes: [],
    recentMinidumps: [],
    assessmentHints: [
      reason
    ],
    errors: []
  };
}

function resolveHostDiagnostics(mode: HostDiagnosticsMode): unknown {
  if (mode === "none") {
    return createDeferredHostDiagnostics("Host-Diagnose wurde fuer diesen Bundle-Export deaktiviert.");
  }
  if (mode === "cached") {
    const cached = getCachedWindowsHostDiagnostics();
    if (cached) {
      return cached;
    }
    return createDeferredHostDiagnostics("Host-Diagnose wurde uebersprungen, um den Export nicht zu blockieren. Fuer eine Voll-Diagnose /host/diagnostics nutzen.");
  }
  return getWindowsHostDiagnostics();
}

function createCooldownDto(cooldown: ProviderRuntimeCooldown | null): Record<string, unknown> | null {
  if (!cooldown) {
    return null;
  }
  return {
    category: cooldown.category,
    remainingMs: Math.max(0, cooldown.remainingMs),
    untilRestart: cooldown.untilRestart === true
  };
}

function createMegaDebridPoolRuntime(
  settings: ReturnType<typeof loadSettings>,
  runtime: ProviderRuntimeSnapshot,
  mode: MegaDebridAccountMode
): Record<string, unknown> {
  const accounts = getMegaDebridAccountsForMode(settings, mode);
  const disabledIds = new Set(getMegaDebridDisabledAccountIdsForMode(settings, mode));
  const enabled = mode === "api" ? settings.megaDebridApiEnabled : settings.megaDebridWebEnabled;
  const runtimeByKey = new Map(runtime.megaDebrid.accounts.map((entry) => [entry.key, entry]));
  const runtimeAccounts = accounts.flatMap((account, index) => {
    const state = runtimeByKey.get(`${account.id}:${mode}`);
    if (!state || (!state.cooldown && state.inFlight <= 0 && state.emptyResponseStreak <= 0)) {
      return [];
    }
    return [{
      account: `Account ${index + 1}/${accounts.length}`,
      inFlight: state.inFlight,
      emptyResponseStreak: state.emptyResponseStreak,
      cooldown: createCooldownDto(state.cooldown)
    }];
  });
  const configuredKeys = new Set(accounts.map((account) => `${account.id}:${mode}`));
  return {
    enabled,
    configuredCount: accounts.length,
    activeCount: enabled ? accounts.filter((account) => !disabledIds.has(account.id)).length : 0,
    disabledCount: accounts.filter((account) => disabledIds.has(account.id)).length,
    inFlight: accounts.reduce((sum, account) => sum + (runtimeByKey.get(`${account.id}:${mode}`)?.inFlight || 0), 0),
    accounts: runtimeAccounts,
    unmappedRuntimeEntryCount: runtime.megaDebrid.accounts
      .filter((entry) => entry.key.endsWith(`:${mode}`) && !configuredKeys.has(entry.key)).length
  };
}

function createProviderRuntimeDto(settings: ReturnType<typeof loadSettings>): Record<string, unknown> {
  const runtime = getProviderRuntimeSnapshot();
  const debridKeys = parseDebridLinkApiKeys(settings.debridLinkApiKeys);
  const disabledDebridKeys = new Set(settings.debridLinkDisabledKeyIds || []);
  const debridRuntimeById = new Map(runtime.debridLink.keys.map((entry) => [entry.keyId, entry]));
  const configuredDebridIds = new Set(debridKeys.map((entry) => entry.id));
  const debridRuntimeKeys = debridKeys.flatMap((entry, index) => {
    const state = debridRuntimeById.get(entry.id);
    if (!state || (!state.cooldown && !state.runtimeStatus)) {
      return [];
    }
    return [{
      account: `Key ${index + 1}/${debridKeys.length}`,
      cooldown: createCooldownDto(state.cooldown),
      runtimeState: state.runtimeStatus?.state || null,
      runtimeUpdatedAt: state.runtimeStatus?.updatedAt || null
    }];
  });
  const hostCooldowns = runtime.debridLink.hostCooldowns.flatMap((entry) => {
    const separator = entry.key.indexOf("|");
    const keyId = separator >= 0 ? entry.key.slice(0, separator) : entry.key;
    const host = separator >= 0 ? entry.key.slice(separator + 1) : "";
    const index = debridKeys.findIndex((candidate) => candidate.id === keyId);
    if (index < 0) {
      return [];
    }
    return [{
      account: `Key ${index + 1}/${debridKeys.length}`,
      host,
      cooldown: createCooldownDto(entry.cooldown)
    }];
  });
  return {
    capturedAtMs: runtime.capturedAtMs,
    megaDebrid: {
      rotationCursor: runtime.megaDebrid.rotationCursor,
      stickyCount: runtime.megaDebrid.stickyCount,
      pools: {
        api: createMegaDebridPoolRuntime(settings, runtime, "api"),
        web: createMegaDebridPoolRuntime(settings, runtime, "web")
      }
    },
    debridLink: {
      configuredCount: debridKeys.length,
      activeCount: debridKeys.filter((entry) => !disabledDebridKeys.has(entry.id)).length,
      disabledCount: debridKeys.filter((entry) => disabledDebridKeys.has(entry.id)).length,
      keys: debridRuntimeKeys,
      hostCooldowns,
      unmappedRuntimeEntryCount: runtime.debridLink.keys.filter((entry) => !configuredDebridIds.has(entry.keyId)).length,
      unmappedHostCooldownCount: runtime.debridLink.hostCooldowns.filter((entry) => {
        const separator = entry.key.indexOf("|");
        const keyId = separator >= 0 ? entry.key.slice(0, separator) : entry.key;
        return !configuredDebridIds.has(keyId);
      }).length
    }
  };
}

export async function buildSupportBundle(manager: DownloadManager, baseDir: string, options: BuildSupportBundleOptions = {}): Promise<Buffer> {
  const zip = new AdmZip();
  const includedSourcePaths = new Set<string>();
  const textBudget: TextBudget = { remainingBytes: MAX_TOTAL_TEXT_BYTES };
  const hostDiagnosticsMode = options.hostDiagnosticsMode || "full";
  const debugSetupMode = options.debugSetupMode || "full";
  const generatedAt = new Date().toISOString();
  const storagePaths = createStoragePaths(baseDir);
  const settings = loadSettings(storagePaths);
  const sensitiveValues = collectSensitiveValues(settings);
  const snapshot = manager.getSnapshot();
  const packageEntries = Object.values(snapshot.session.packages);
  const itemEntries = Object.values(snapshot.session.items);
  const selectedPackageEntries = selectRelevantEntries(packageEntries, MAX_PACKAGE_DTOS);
  const selectedItemEntries = selectRelevantEntries(itemEntries, MAX_ITEM_DTOS);
  const selectedPackages = selectedPackageEntries
    .map((entry, index) => createPackageDto(entry, createBundleAlias("package", index, entry.name), snapshot.session.items));
  const selectedItems = selectedItemEntries
    .map((entry, index) => createItemDto(entry, createBundleAlias("item", index, entry.fileName)));
  const history = await loadBoundedHistory(storagePaths.historyFile);
  const debugSetup = debugSetupMode === "deferred"
    ? { status: "deferred", generatedAt: new Date().toISOString(), reason: "Tiefer Setup-Scan wurde beim interaktiven Export ausgelassen." }
    : getDebugSetupCheck(baseDir);

  await addJson(zip, "overview/meta.json", {
    appVersion: APP_VERSION,
    generatedAt,
    runtimeBaseDir: "<local-path>",
    packageCount: packageEntries.length,
    itemCount: itemEntries.length,
    limits: {
      packageDtos: MAX_PACKAGE_DTOS,
      itemDtos: MAX_ITEM_DTOS,
      textBytes: MAX_TOTAL_TEXT_BYTES,
      textFileBytes: MAX_TEXT_FILE_BYTES,
      directoryLogDiscoveryWindowHours: SUPPORT_BUNDLE_LOG_WINDOW_MS / 60 / 60 / 1000,
      currentAndRelevantLogsIgnoreAgeFilter: true
    }
  }, sensitiveValues);
  await addJson(zip, "overview/status.json", createSessionDto(snapshot.session), sensitiveValues);
  await addJson(zip, "overview/settings.json", buildRedactedSettingsPayload(settings), sensitiveValues);
  await addJson(zip, "overview/accounts.json", buildAccountSummary(settings), sensitiveValues);
  await addJson(zip, "overview/stats.json", {
    ...buildStatsPayload(snapshot),
    allTime: {
      totalDownloadedAllTime: settings.totalDownloadedAllTime,
      totalCompletedFilesAllTime: settings.totalCompletedFilesAllTime,
      totalRuntimeAllTimeMs: settings.totalRuntimeAllTimeMs
    }
  }, sensitiveValues);
  await addJson(zip, "overview/debug-setup.json", debugSetup, sensitiveValues);
  await addJson(zip, "overview/history.json", history, sensitiveValues);
  await addJson(zip, "overview/packages.json", {
    count: packageEntries.length,
    included: selectedPackages.length,
    omitted: Math.max(0, packageEntries.length - selectedPackages.length),
    packages: selectedPackages
  }, sensitiveValues);
  await addJson(zip, "overview/items.json", {
    count: itemEntries.length,
    included: selectedItems.length,
    omitted: Math.max(0, itemEntries.length - selectedItems.length),
    items: selectedItems
  }, sensitiveValues);
  await addJson(zip, "overview/runtime-diagnostics.json", {
    bundleBuild: {
      state: "building",
      startedAt: generatedAt,
      hostDiagnosticsMode,
      debugSetupMode
    },
    rotationEvents: (snapshot.rotationEvents || []).slice(0, 60),
    diskWaitEvents: (snapshot.diskWaitEvents || []).slice(-60),
    providerRuntime: createProviderRuntimeDto(settings)
  }, sensitiveValues);
  await addJson(zip, "overview/host-diagnostics.json", resolveHostDiagnostics(hostDiagnosticsMode), sensitiveValues);
  await addJson(zip, "overview/trace-config.json", getTraceConfig(), sensitiveValues);
  const recentErrors = getRecentErrors().slice(-100);
  await addJson(zip, "overview/recent-errors.json", { count: recentErrors.length, entries: recentErrors }, sensitiveValues);

  const addRuntimeFile = (sourcePath: string | null, zipPath: string): Promise<boolean> => addTextFileIfExists(
    zip,
    sourcePath,
    zipPath,
    includedSourcePaths,
    sensitiveValues,
    textBudget,
    MAX_RUNTIME_FILE_BYTES
  );
  const addCurrentLog = (sourcePath: string | null, zipPath: string): Promise<boolean> => addTextFileIfExists(
    zip,
    sourcePath,
    zipPath,
    includedSourcePaths,
    sensitiveValues,
    textBudget,
    MAX_TEXT_FILE_BYTES
  );
  const addRotatedLog = (sourcePath: string | null, zipPath: string): Promise<boolean> => addTextFileIfExists(
    zip,
    sourcePath,
    zipPath,
    includedSourcePaths,
    sensitiveValues,
    textBudget,
    MAX_TEXT_FILE_BYTES,
    SUPPORT_BUNDLE_LOG_WINDOW_MS
  );

  await addRuntimeFile(path.join(baseDir, SUPPORT_MANIFEST_FILE), `runtime/${SUPPORT_MANIFEST_FILE}`);
  await addRuntimeFile(path.join(baseDir, "debug_host.txt"), "runtime/debug_host.txt");
  await addRuntimeFile(path.join(baseDir, "debug_port.txt"), "runtime/debug_port.txt");
  await addRuntimeFile(getTraceConfigPath(), "runtime/trace_config.json");

  await flushLogger();
  flushSessionLog();
  flushPackageLogs();
  flushItemLogs();
  flushTraceLog();

  const relevantPackageLogCount = await addRelevantLogFiles(
    zip,
    selectedPackageEntries,
    getPersistedPackageLogPath,
    "logs/package-logs",
    MAX_PACKAGE_LOG_FILES,
    includedSourcePaths,
    sensitiveValues,
    textBudget
  );
  const relevantItemLogCount = await addRelevantLogFiles(
    zip,
    selectedItemEntries,
    getPersistedItemLogPath,
    "logs/item-logs",
    MAX_ITEM_LOG_FILES,
    includedSourcePaths,
    sensitiveValues,
    textBudget
  );

  const mainLogPath = getLogFilePath();
  const auditLogPath = getAuditLogPath();
  const renameLogPath = getRenameLogPath();
  const traceLogPath = getTraceLogPath();
  const accountRotationLogPath = getAccountRotationLogPath();
  const conversionLogPath = getConversionLogPath();
  await addCurrentLog(mainLogPath, "logs/rd_downloader.log");
  await addRotatedLog(`${mainLogPath}.old`, "logs/rd_downloader.log.old");
  await addCurrentLog(auditLogPath, "logs/audit.log");
  await addRotatedLog(auditLogPath ? `${auditLogPath}.old` : null, "logs/audit.log.old");
  await addCurrentLog(renameLogPath, "logs/rename.log");
  await addRotatedLog(renameLogPath ? `${renameLogPath}.old` : null, "logs/rename.log.old");
  await addCurrentLog(getDesktopRenameLogPath(), "logs/rename-session-desktop.txt");
  await addCurrentLog(getSessionLogPath(), "logs/session.log");
  await addCurrentLog(traceLogPath, "logs/trace.log");
  await addRotatedLog(traceLogPath ? `${traceLogPath}.old` : null, "logs/trace.log.old");
  await addCurrentLog(accountRotationLogPath, "logs/account-rotation.log");
  await addRotatedLog(accountRotationLogPath ? `${accountRotationLogPath}.old` : null, "logs/account-rotation.log.old");
  await addCurrentLog(conversionLogPath, "logs/conversion.log");
  await addRotatedLog(conversionLogPath ? `${conversionLogPath}.old` : null, "logs/conversion.log.old");

  await addRecentDirectoryFiles(zip, path.join(baseDir, "session-logs"), "logs/session-logs", SUPPORT_BUNDLE_LOG_WINDOW_MS, MAX_SESSION_LOG_FILES, includedSourcePaths, sensitiveValues, textBudget);
  await addRecentDirectoryFiles(zip, path.join(baseDir, "package-logs"), "logs/package-logs", SUPPORT_BUNDLE_LOG_WINDOW_MS, Math.max(0, MAX_PACKAGE_LOG_FILES - relevantPackageLogCount), includedSourcePaths, sensitiveValues, textBudget);
  await addRecentDirectoryFiles(zip, path.join(baseDir, "item-logs"), "logs/item-logs", SUPPORT_BUNDLE_LOG_WINDOW_MS, Math.max(0, MAX_ITEM_LOG_FILES - relevantItemLogCount), includedSourcePaths, sensitiveValues, textBudget);

  const supportManifest = await safeReadBoundedJson(path.join(baseDir, SUPPORT_MANIFEST_FILE), MAX_RUNTIME_FILE_BYTES);
  if (supportManifest) {
    await addJson(zip, "overview/support-manifest.json", supportManifest, sensitiveValues);
  }

  return await zip.toBufferPromise();
}
