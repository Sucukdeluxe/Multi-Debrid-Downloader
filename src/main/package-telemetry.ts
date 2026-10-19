import type {
  ArchiveOperationMetric,
  FailurePhase,
  PackageResult,
  PackageResultStatus,
  PackageTelemetry,
  RemuxOperationMetric
} from "../shared/types";

export type PackageFailureCategory =
  | "Netzwerk"
  | "Timeout"
  | "Offline"
  | "Speicherplatz"
  | "Berechtigung"
  | "Download"
  | "Entpacken"
  | "Remux"
  | "Cleanup"
  | "Nachbearbeitung"
  | "Unbekannt";

const packageFailureCategories = new Map<string, PackageFailureCategory>([
  ["netzwerk", "Netzwerk"],
  ["timeout", "Timeout"],
  ["offline", "Offline"],
  ["speicherplatz", "Speicherplatz"],
  ["berechtigung", "Berechtigung"],
  ["download", "Download"],
  ["entpacken", "Entpacken"],
  ["remux", "Remux"],
  ["cleanup", "Cleanup"],
  ["nachbearbeitung", "Nachbearbeitung"],
  ["unbekannt", "Unbekannt"]
]);

function finiteNonNegative(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function durationMsToSeconds(durationMs: number): number {
  return Math.floor(finiteNonNegative(durationMs) / 1_000);
}

export function durationSecondsBetween(startedAt: number | undefined, completedAt: number | undefined): number {
  const start = finiteNonNegative(startedAt);
  const end = finiteNonNegative(completedAt);
  return start > 0 && end > start ? durationMsToSeconds(end - start) : 0;
}

export function sumOperationDurationSeconds(operations: readonly { durationMs: number }[]): number {
  return durationMsToSeconds(operations.reduce((total, operation) => total + finiteNonNegative(operation.durationMs), 0));
}

export function unionOperationDurationSeconds(operations: readonly { startedAt: number; completedAt: number; durationMs: number }[]): number {
  const intervals = operations
    .map((operation) => ({ start: finiteNonNegative(operation.startedAt), end: finiteNonNegative(operation.completedAt) }))
    .filter((interval) => interval.start > 0 && interval.end > interval.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  let durationMs = operations
    .filter((operation) => finiteNonNegative(operation.completedAt) <= finiteNonNegative(operation.startedAt))
    .reduce((total, operation) => total + finiteNonNegative(operation.durationMs), 0);
  let currentStart = 0;
  let currentEnd = 0;
  for (const interval of intervals) {
    if (currentEnd === 0) {
      currentStart = interval.start;
      currentEnd = interval.end;
    } else if (interval.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.end);
    } else {
      durationMs += currentEnd - currentStart;
      currentStart = interval.start;
      currentEnd = interval.end;
    }
  }
  if (currentEnd > currentStart) {
    durationMs += currentEnd - currentStart;
  }
  return durationMsToSeconds(durationMs);
}

export function projectPackageFailureCategory(failurePhase: FailurePhase, detail: unknown): PackageFailureCategory {
  const normalized = String(detail ?? "").trim().slice(0, 2048).toLowerCase();
  const knownCategory = packageFailureCategories.get(normalized);
  if (knownCategory) {
    return knownCategory;
  }
  if (/\b(?:e?timed?[\s_-]*out|timeout)\b|zeit(?:ü|ue)berschreitung/.test(normalized)) {
    return "Timeout";
  }
  if (/\boffline\b|not[\s_-]*found|nicht[\s_-]*gefunden|dead[\s_-]*link|http\s*404/.test(normalized)) {
    return "Offline";
  }
  if (/\benospc\b|disk[\s_-]*full|no[\s_-]+space[\s_-]+left|not[\s_-]+enough[\s_-]+(?:disk[\s_-]+)?space|insufficient[\s_-]+(?:disk[\s_-]+)?space|speicherplatz|datenträger[^\n]*voll/.test(normalized)) {
    return "Speicherplatz";
  }
  if (/\beacces\b|\beperm\b|permission|access[\s_-]*denied|zugriff[^\n]*verweigert|berechtigung/.test(normalized)) {
    return "Berechtigung";
  }
  if (/network|netzwerk|\beconn|\benet|\behost|\beai_again\b|\bdns\b|socket|connection|verbindung|fetch[\s_-]*failed/.test(normalized)) {
    return "Netzwerk";
  }
  if (failurePhase === "download") return "Download";
  if (failurePhase === "extract") return "Entpacken";
  if (failurePhase === "remux") return "Remux";
  if (failurePhase === "cleanup") return "Cleanup";
  if (failurePhase === "postprocess") return "Nachbearbeitung";
  return "Unbekannt";
}

function classifyStatus(
  successfulFiles: number,
  failedFiles: number,
  cancelledFiles: number,
  postProcessFailures: number,
  postProcessCancellations: number,
  packageCancelled: boolean
): PackageResultStatus {
  if (successfulFiles > 0 && (failedFiles > 0 || cancelledFiles > 0 || postProcessFailures > 0 || postProcessCancellations > 0 || packageCancelled)) {
    return "partial";
  }
  if (failedFiles > 0 || postProcessFailures > 0) {
    return "failed";
  }
  if (cancelledFiles > 0 || postProcessCancellations > 0 || packageCancelled) {
    return "cancelled";
  }
  return "completed";
}

function getFailure(
  cleanupErrorCategory: string,
  postProcessErrorCategory: string,
  remuxOperations: readonly RemuxOperationMetric[],
  remuxFallbackFailures: number,
  archiveOperations: readonly ArchiveOperationMetric[],
  downloadErrors: readonly string[]
): { failurePhase: FailurePhase; errorCategory: string } {
  if (cleanupErrorCategory) {
    return { failurePhase: "cleanup", errorCategory: projectPackageFailureCategory("cleanup", cleanupErrorCategory) };
  }
  if (postProcessErrorCategory) {
    return { failurePhase: "postprocess", errorCategory: projectPackageFailureCategory("postprocess", postProcessErrorCategory) };
  }
  const failedRemux = remuxOperations.find((operation) => operation.status === "failed");
  if (failedRemux || remuxFallbackFailures > 0) {
    return { failurePhase: "remux", errorCategory: projectPackageFailureCategory("remux", failedRemux?.errorCategory) };
  }
  const failedArchive = archiveOperations.find((operation) => operation.status === "failed");
  if (failedArchive) {
    return { failurePhase: "extract", errorCategory: projectPackageFailureCategory("extract", failedArchive.errorCategory) };
  }
  const downloadError = downloadErrors.find(Boolean);
  if (downloadErrors.length > 0) {
    return { failurePhase: "download", errorCategory: projectPackageFailureCategory("download", downloadError) };
  }
  return { failurePhase: null, errorCategory: "" };
}

export function finalizePackageResult(telemetry: PackageTelemetry): PackageResult {
  const packageEntry = telemetry.package;
  const archiveOperations = (telemetry.archiveOperations ?? packageEntry.archiveOperations ?? [])
    .map((operation) => ({ ...operation, itemIds: [...operation.itemIds] }));
  const remuxOperations = (telemetry.remuxOperations ?? packageEntry.remuxOperations ?? [])
    .map((operation) => ({ ...operation }));
  const cleanedCompletedDownloads = Math.max(0, Math.floor(finiteNonNegative(packageEntry.cleanedCompletedItemCount)));
  const completedDownloads = cleanedCompletedDownloads + telemetry.items.filter((item) => item.status === "completed").length;
  const failedDownloads = telemetry.items.filter((item) => item.status === "failed");
  const cancelledDownloads = telemetry.items.filter((item) => item.status === "cancelled").length;
  const failedArchives = archiveOperations.filter((operation) => operation.status === "failed").length;
  const cancelledArchives = archiveOperations.filter((operation) => operation.status === "cancelled").length;
  const failedRemuxOperations = remuxOperations.filter((operation) => operation.status === "failed").length;
  const cancelledRemuxOperations = remuxOperations.filter((operation) => operation.status === "cancelled").length;
  const audioStripFailures = Math.max(0, Math.floor(finiteNonNegative(packageEntry.audioStripSummary?.failed)));
  const remuxFailures = Math.max(failedRemuxOperations, audioStripFailures);
  const cleanupErrorCategory = String(telemetry.cleanupErrorCategory ?? packageEntry.cleanupErrorCategory ?? "").trim();
  const postProcessErrorCategory = String(telemetry.postProcessErrorCategory ?? packageEntry.postProcessErrorCategory ?? "").trim();
  const downloadFailureCategories = failedDownloads.map((item) =>
    projectPackageFailureCategory("download", item.lastError || item.fullStatus)
  );
  const offlineFailures = downloadFailureCategories.filter((category) => category === "Offline").length;
  const cleanupFailures = cleanupErrorCategory ? 1 : 0;
  const postProcessFailures = postProcessErrorCategory ? 1 : 0;
  const operationFailures = failedArchives + remuxFailures + cleanupFailures + postProcessFailures;
  const postProcessCancellations = cancelledArchives + cancelledRemuxOperations;
  const failedFiles = failedDownloads.length;
  const cancelledFiles = cancelledDownloads;
  const successfulFiles = completedDownloads;
  const startedAt = finiteNonNegative(packageEntry.downloadStartedAt);
  const downloadEndedAt = finiteNonNegative(packageEntry.downloadEndedAt) || finiteNonNegative(packageEntry.downloadCompletedAt);
  const postProcessStartedAt = finiteNonNegative(packageEntry.postProcessStartedAt);
  const postProcessCompletedAt = finiteNonNegative(packageEntry.postProcessCompletedAt);
  const completedAt = finiteNonNegative(packageEntry.terminalAt);
  const downloadedBytes = finiteNonNegative(packageEntry.cleanedDownloadedBytes)
    + telemetry.items.reduce((total, item) => total + finiteNonNegative(item.downloadedBytes), 0);
  const totalBytes = finiteNonNegative(packageEntry.cleanedTotalBytes)
    + telemetry.items.reduce((total, item) => total + finiteNonNegative(item.totalBytes ?? item.downloadedBytes), 0);
  const downloadDurationSeconds = durationSecondsBetween(startedAt, downloadEndedAt);
  const extractionDurationSeconds = unionOperationDurationSeconds(archiveOperations);
  const remuxDurationSeconds = sumOperationDurationSeconds(remuxOperations);
  const postProcessDurationSeconds = durationSecondsBetween(postProcessStartedAt, postProcessCompletedAt);
  const totalDurationSeconds = durationSecondsBetween(startedAt, completedAt);
  const failure = getFailure(
    cleanupErrorCategory,
    postProcessErrorCategory,
    remuxOperations,
    audioStripFailures,
    archiveOperations,
    failedDownloads.map((item) => item.lastError || item.fullStatus)
  );

  return {
    packageId: packageEntry.id,
    name: packageEntry.name,
    status: classifyStatus(successfulFiles, failedFiles, cancelledFiles, operationFailures, postProcessCancellations, packageEntry.cancelled),
    startedAt,
    downloadEndedAt,
    postProcessStartedAt,
    completedAt,
    downloadDurationSeconds,
    extractionDurationSeconds,
    remuxDurationSeconds,
    postProcessDurationSeconds,
    totalDurationSeconds,
    totalBytes,
    downloadedBytes,
    averageDownloadSpeedBps: downloadDurationSeconds > 0 ? Math.floor(downloadedBytes / downloadDurationSeconds) : 0,
    successfulFiles,
    failedFiles,
    cancelledFiles,
    downloadFailures: failedDownloads.length,
    offlineFailures,
    extractionFailures: failedArchives,
    remuxFailures,
    cleanupFailures,
    postProcessFailures,
    archiveCount: archiveOperations.length,
    partCount: archiveOperations.reduce((total, operation) => total + Math.max(0, Math.floor(finiteNonNegative(operation.partCount))), 0),
    outputCount: Math.max(0, Math.floor(finiteNonNegative(telemetry.outputCount ?? packageEntry.outputCount))),
    failurePhase: failure.failurePhase,
    errorCategory: failure.errorCategory,
    archiveOperations,
    remuxOperations
  };
}
