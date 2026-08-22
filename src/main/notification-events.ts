import { createHash } from "node:crypto";
import type {
  DebridProvider,
  HistoryEntry,
  PackageResult,
  PackageResultStatus
} from "../shared/types";
import type {
  NotificationEvent,
  NotificationEventType,
  NotificationPriority
} from "./notification-outbox";

export interface PackageResultEnvelope {
  generation: number;
  result: PackageResult;
}

export interface RunResult {
  id: string;
  stopped: boolean;
  startedAt: number;
  completedAt: number;
  totalDurationSeconds: number;
  totalPackages: number;
  completedPackages: number;
  partialPackages: number;
  failedPackages: number;
  cancelledPackages: number;
  successfulFiles: number;
  failedFiles: number;
  cancelledFiles: number;
  totalBytes: number;
  downloadedBytes: number;
  averageDownloadSpeedBps: number;
  downloadDurationSeconds: number;
  extractionDurationSeconds: number;
  remuxDurationSeconds: number;
  postProcessDurationSeconds: number;
  extractionFailures: number;
  remuxFailures: number;
  downloadFailures: number;
  offlineFailures: number;
}

export interface RunResultInput {
  id: string;
  stopped: boolean;
  startedAt: number;
  completedAt: number;
  packages: readonly PackageResult[];
  totalPackages?: number;
  successfulFiles?: number;
  failedFiles?: number;
  cancelledFiles?: number;
}

export interface HistoryEntryContext {
  generation: number;
  outputDir: string;
  urls: string[];
  provider: DebridProvider | null;
}

const SUCCESS_TTL_MS = 6 * 60 * 60 * 1000;
const IMPORTANT_TTL_MS = 24 * 60 * 60 * 1000;
const DIGEST_PACKAGE_LIMIT = 20;

const numberFormatter = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

function finiteNonNegative(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function formatBytes(bytes: number): string {
  let value = finiteNonNegative(bytes);
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${numberFormatter.format(value)} ${units[index]}`;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(finiteNonNegative(seconds)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function statusLabel(status: PackageResultStatus): string {
  if (status === "completed") return "Abgeschlossen";
  if (status === "partial") return "Teilweise abgeschlossen";
  if (status === "failed") return "Fehlgeschlagen";
  return "Abgebrochen";
}

function failurePhaseLabel(result: PackageResult): string {
  if (result.failurePhase === "download") return "Download";
  if (result.failurePhase === "extract") return "Entpacken";
  if (result.failurePhase === "remux") return "Remux";
  if (result.failurePhase === "cleanup") return "Aufräumen";
  return "—";
}

function event(
  id: string,
  type: NotificationEventType,
  priority: NotificationPriority,
  createdAt: number,
  title: string,
  description: string,
  color: number,
  fields: NotificationEvent["payload"]["fields"]
): NotificationEvent {
  return {
    id,
    type,
    priority,
    createdAt,
    expiresAt: createdAt + (priority === "success" ? SUCCESS_TTL_MS : IMPORTANT_TTL_MS),
    attempts: 0,
    nextAttemptAt: createdAt,
    payload: { title, description, color, fields }
  };
}

function packageEventType(status: PackageResultStatus): NotificationEventType {
  if (status === "completed") return "package_completed";
  if (status === "partial") return "package_partial";
  return "package_failed";
}

export function buildPackageNotificationEvent(
  envelope: PackageResultEnvelope,
  createdAt: number
): NotificationEvent {
  const { generation, result } = envelope;
  const type = packageEventType(result.status);
  const priority: NotificationPriority = result.status === "completed" ? "success" : "error";
  const title = result.status === "completed"
    ? "✅ Paket fertig"
    : result.status === "partial"
      ? "⚠️ Paket teilweise fertig"
      : result.status === "cancelled"
        ? "⏹️ Paket abgebrochen"
        : "❌ Paket fehlgeschlagen";
  const fields = [
    { name: "Paket", value: result.name || "—", inline: false },
    { name: "Ergebnis", value: statusLabel(result.status), inline: true },
    { name: "Dateien", value: `${result.successfulFiles} erfolgreich · ${result.failedFiles} fehlgeschlagen · ${result.cancelledFiles} abgebrochen`, inline: false },
    { name: "Downloadgröße", value: `${formatBytes(result.downloadedBytes)} / ${formatBytes(result.totalBytes)}`, inline: true },
    { name: "Zeiten", value: `Download ${formatDuration(result.downloadDurationSeconds)} · Entpacken ${formatDuration(result.extractionDurationSeconds)} · Remux ${formatDuration(result.remuxDurationSeconds)} · Gesamt ${formatDuration(result.totalDurationSeconds)}`, inline: false },
    { name: "Aktive Downloadgeschwindigkeit", value: result.averageDownloadSpeedBps > 0 ? `${formatBytes(result.averageDownloadSpeedBps)}/s` : "—", inline: true },
    { name: "Archive", value: `${result.archiveCount} Gruppen · ${result.partCount} Parts · ${result.outputCount} Ausgaben`, inline: true }
  ];
  if (result.failurePhase) {
    fields.push({
      name: "Fehler",
      value: `${failurePhaseLabel(result)}${result.errorCategory ? ` · ${result.errorCategory.slice(0, 256)}` : ""}`,
      inline: false
    });
  }
  return event(
    `package:${result.packageId}:${generation}:${type}`,
    type,
    priority,
    createdAt,
    title,
    result.name,
    priority === "success" ? 0x2ecc71 : 0xe74c3c,
    fields
  );
}

export function buildPackageDigestEvents(
  envelopes: readonly PackageResultEnvelope[],
  createdAt: number
): NotificationEvent[] {
  const sorted = [...envelopes].sort((left, right) => {
    const byCompleted = left.result.completedAt - right.result.completedAt;
    if (byCompleted !== 0) return byCompleted;
    const byPackage = left.result.packageId.localeCompare(right.result.packageId);
    return byPackage !== 0 ? byPackage : left.generation - right.generation;
  });
  const digestKey = createHash("sha256")
    .update(sorted.map((entry) => `${entry.result.packageId}:${entry.generation}`).join("|"))
    .digest("hex")
    .slice(0, 16);
  const events: NotificationEvent[] = [];
  for (let offset = 0; offset < sorted.length; offset += DIGEST_PACKAGE_LIMIT) {
    const chunk = sorted.slice(offset, offset + DIGEST_PACKAGE_LIMIT);
    const page = Math.floor(offset / DIGEST_PACKAGE_LIMIT) + 1;
    const totalPages = Math.ceil(sorted.length / DIGEST_PACKAGE_LIMIT);
    const fields = chunk.map(({ result }) => ({
      name: result.name || "Paket",
      value: `${result.successfulFiles} Dateien · ${formatBytes(result.downloadedBytes)} · ${formatDuration(result.totalDurationSeconds)}`,
      inline: false
    }));
    events.push(event(
      `package-digest:${digestKey}:${page}`,
      "package_completed",
      "success",
      createdAt,
      totalPages > 1 ? `✅ Paket-Digest ${page}/${totalPages}` : "✅ Paket-Digest",
      `${sorted.length} Pakete abgeschlossen`,
      0x2ecc71,
      fields
    ));
  }
  return events;
}

export function buildRunResult(input: RunResultInput): RunResult {
  const packages = [...input.packages];
  const sum = (select: (result: PackageResult) => number): number => packages.reduce((total, result) => total + finiteNonNegative(select(result)), 0);
  const downloadedBytes = sum((result) => result.downloadedBytes);
  const downloadDurationSeconds = sum((result) => result.downloadDurationSeconds);
  const successfulFiles = input.successfulFiles ?? sum((result) => result.successfulFiles);
  const failedFiles = input.failedFiles ?? sum((result) => result.failedFiles);
  const cancelledFiles = input.cancelledFiles ?? sum((result) => result.cancelledFiles);
  return {
    id: input.id,
    stopped: input.stopped,
    startedAt: finiteNonNegative(input.startedAt),
    completedAt: finiteNonNegative(input.completedAt),
    totalDurationSeconds: Math.max(0, Math.floor((finiteNonNegative(input.completedAt) - finiteNonNegative(input.startedAt)) / 1000)),
    totalPackages: Math.max(packages.length, Math.floor(finiteNonNegative(input.totalPackages))),
    completedPackages: packages.filter((result) => result.status === "completed").length,
    partialPackages: packages.filter((result) => result.status === "partial").length,
    failedPackages: packages.filter((result) => result.status === "failed").length,
    cancelledPackages: packages.filter((result) => result.status === "cancelled").length,
    successfulFiles,
    failedFiles,
    cancelledFiles,
    totalBytes: sum((result) => result.totalBytes),
    downloadedBytes,
    averageDownloadSpeedBps: downloadDurationSeconds > 0 ? Math.floor(downloadedBytes / downloadDurationSeconds) : 0,
    downloadDurationSeconds,
    extractionDurationSeconds: sum((result) => result.extractionDurationSeconds),
    remuxDurationSeconds: sum((result) => result.remuxDurationSeconds),
    postProcessDurationSeconds: sum((result) => result.postProcessDurationSeconds),
    extractionFailures: packages.reduce((total, result) => total + result.archiveOperations.filter((operation) => operation.status === "failed").length, 0),
    remuxFailures: packages.reduce((total, result) => total + result.remuxOperations.filter((operation) => operation.status === "failed").length, 0),
    downloadFailures: packages.filter((result) => result.failurePhase === "download").reduce((total, result) => total + result.failedFiles, 0),
    offlineFailures: packages.filter((result) => /offline|not found|nicht gefunden/i.test(result.errorCategory)).reduce((total, result) => total + result.failedFiles, 0)
  };
}

export function buildRunNotificationEvent(result: RunResult): NotificationEvent {
  const priority: NotificationPriority = result.stopped || result.failedFiles > 0 || result.partialPackages > 0 || result.failedPackages > 0
    ? "error"
    : "success";
  const type: NotificationEventType = result.stopped ? "run_stopped" : "run_completed";
  const title = result.stopped
    ? "⏹️ Durchlauf gestoppt"
    : priority === "success"
      ? "🏁 Durchlauf beendet"
      : "⚠️ Durchlauf mit Fehlern beendet";
  return event(
    `run:${result.id}:${type}`,
    type,
    priority,
    result.completedAt,
    title,
    result.stopped ? "Offene Dateien bleiben in der Warteschlange." : "Alle Paketresultate sind final.",
    priority === "success" ? 0x2ecc71 : 0xe67e22,
    [
      { name: "Pakete", value: `${result.completedPackages} fertig · ${result.partialPackages} teilweise · ${result.failedPackages} fehlgeschlagen · ${result.cancelledPackages} abgebrochen`, inline: false },
      { name: "Dateien", value: `${result.successfulFiles} erfolgreich · ${result.failedFiles} fehlgeschlagen · ${result.cancelledFiles} abgebrochen`, inline: false },
      { name: "Dauer", value: `Download ${formatDuration(result.downloadDurationSeconds)} · Entpacken ${formatDuration(result.extractionDurationSeconds)} · Remux ${formatDuration(result.remuxDurationSeconds)} · Nachbearbeitung ${formatDuration(result.postProcessDurationSeconds)} · Gesamt ${formatDuration(result.totalDurationSeconds)}`, inline: false },
      { name: "Downloadgröße", value: `${formatBytes(result.downloadedBytes)} / ${formatBytes(result.totalBytes)}`, inline: true },
      { name: "Aktive Downloadgeschwindigkeit", value: result.averageDownloadSpeedBps > 0 ? `${formatBytes(result.averageDownloadSpeedBps)}/s` : "—", inline: true },
      { name: "Entpackfehler", value: String(result.extractionFailures), inline: true },
      { name: "Remuxfehler", value: String(result.remuxFailures), inline: true },
      { name: "Downloadfehler", value: String(result.downloadFailures), inline: true },
      { name: "Offline", value: String(result.offlineFailures), inline: true }
    ]
  );
}

export function buildHistoryEntry(
  result: PackageResult,
  context: HistoryEntryContext
): HistoryEntry {
  return {
    id: `hist-${result.packageId}-${context.generation}`,
    name: result.name,
    totalBytes: result.totalBytes,
    downloadedBytes: result.downloadedBytes,
    fileCount: result.successfulFiles + result.failedFiles + result.cancelledFiles,
    provider: context.provider,
    completedAt: result.completedAt,
    durationSeconds: result.downloadDurationSeconds,
    status: result.status,
    outputDir: context.outputDir,
    urls: [...new Set(context.urls.filter(Boolean))],
    startedAt: result.startedAt,
    downloadEndedAt: result.downloadEndedAt,
    postProcessStartedAt: result.postProcessStartedAt,
    downloadDurationSeconds: result.downloadDurationSeconds,
    extractionDurationSeconds: result.extractionDurationSeconds,
    remuxDurationSeconds: result.remuxDurationSeconds,
    postProcessDurationSeconds: result.postProcessDurationSeconds,
    totalDurationSeconds: result.totalDurationSeconds,
    successfulFiles: result.successfulFiles,
    failedFiles: result.failedFiles,
    cancelledFiles: result.cancelledFiles,
    archiveCount: result.archiveCount,
    partCount: result.partCount,
    outputCount: result.outputCount,
    failurePhase: result.failurePhase,
    archiveOperations: result.archiveOperations.map((operation) => ({ ...operation, itemIds: [...operation.itemIds] })),
    remuxOperations: result.remuxOperations.map((operation) => ({ ...operation }))
  };
}
