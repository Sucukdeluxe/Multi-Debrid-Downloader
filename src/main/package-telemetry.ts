import type {
  ArchiveOperationMetric,
  FailurePhase,
  PackageResult,
  PackageResultStatus,
  PackageTelemetry,
  RemuxOperationMetric
} from "../shared/types";

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

function classifyStatus(successfulFiles: number, failedFiles: number, cancelledFiles: number, packageCancelled: boolean): PackageResultStatus {
  if (successfulFiles > 0 && (failedFiles > 0 || cancelledFiles > 0 || packageCancelled)) {
    return "partial";
  }
  if (failedFiles > 0) {
    return "failed";
  }
  if (cancelledFiles > 0 || packageCancelled) {
    return "cancelled";
  }
  return "completed";
}

function getFailure(
  cleanupErrorCategory: string,
  remuxOperations: readonly RemuxOperationMetric[],
  remuxFallbackFailures: number,
  archiveOperations: readonly ArchiveOperationMetric[],
  downloadErrors: readonly string[]
): { failurePhase: FailurePhase; errorCategory: string } {
  if (cleanupErrorCategory) {
    return { failurePhase: "cleanup", errorCategory: cleanupErrorCategory };
  }
  const failedRemux = remuxOperations.find((operation) => operation.status === "failed");
  if (failedRemux || remuxFallbackFailures > 0) {
    return { failurePhase: "remux", errorCategory: failedRemux?.errorCategory || "remux" };
  }
  const failedArchive = archiveOperations.find((operation) => operation.status === "failed");
  if (failedArchive) {
    return { failurePhase: "extract", errorCategory: failedArchive.errorCategory };
  }
  const downloadError = downloadErrors.find(Boolean);
  if (downloadErrors.length > 0) {
    return { failurePhase: "download", errorCategory: downloadError || "download" };
  }
  return { failurePhase: null, errorCategory: "" };
}

export function finalizePackageResult(telemetry: PackageTelemetry): PackageResult {
  const packageEntry = telemetry.package;
  const archiveOperations = (telemetry.archiveOperations ?? packageEntry.archiveOperations ?? [])
    .map((operation) => ({ ...operation, itemIds: [...operation.itemIds] }));
  const remuxOperations = (telemetry.remuxOperations ?? packageEntry.remuxOperations ?? [])
    .map((operation) => ({ ...operation }));
  const completedDownloads = telemetry.items.filter((item) => item.status === "completed").length;
  const failedDownloads = telemetry.items.filter((item) => item.status === "failed");
  const cancelledDownloads = telemetry.items.filter((item) => item.status === "cancelled").length;
  const failedArchives = archiveOperations.filter((operation) => operation.status === "failed").length;
  const cancelledArchives = archiveOperations.filter((operation) => operation.status === "cancelled").length;
  const failedRemuxOperations = remuxOperations.filter((operation) => operation.status === "failed").length;
  const cancelledRemuxOperations = remuxOperations.filter((operation) => operation.status === "cancelled").length;
  const audioStripFailures = Math.max(0, Math.floor(finiteNonNegative(packageEntry.audioStripSummary?.failed)));
  const remuxFailures = Math.max(failedRemuxOperations, audioStripFailures);
  const cleanupErrorCategory = String(telemetry.cleanupErrorCategory ?? packageEntry.cleanupErrorCategory ?? "").trim();
  const postProcessFailures = failedArchives + remuxFailures + (cleanupErrorCategory ? 1 : 0);
  const postProcessCancellations = cancelledArchives + cancelledRemuxOperations;
  const failedFiles = failedDownloads.length + postProcessFailures;
  const cancelledFiles = cancelledDownloads + postProcessCancellations;
  const successfulFiles = Math.max(0, completedDownloads - postProcessFailures - postProcessCancellations);
  const startedAt = finiteNonNegative(packageEntry.downloadStartedAt);
  const downloadEndedAt = finiteNonNegative(packageEntry.downloadEndedAt) || finiteNonNegative(packageEntry.downloadCompletedAt);
  const postProcessStartedAt = finiteNonNegative(packageEntry.postProcessStartedAt);
  const postProcessCompletedAt = finiteNonNegative(packageEntry.postProcessCompletedAt);
  const completedAt = finiteNonNegative(packageEntry.terminalAt);
  const downloadedBytes = telemetry.items.reduce((total, item) => total + finiteNonNegative(item.downloadedBytes), 0);
  const totalBytes = telemetry.items.reduce((total, item) => total + finiteNonNegative(item.totalBytes ?? item.downloadedBytes), 0);
  const downloadDurationSeconds = durationSecondsBetween(startedAt, downloadEndedAt);
  const extractionDurationSeconds = sumOperationDurationSeconds(archiveOperations);
  const remuxDurationSeconds = sumOperationDurationSeconds(remuxOperations);
  const postProcessDurationSeconds = durationSecondsBetween(postProcessStartedAt, postProcessCompletedAt);
  const totalDurationSeconds = durationSecondsBetween(startedAt, completedAt);
  const failure = getFailure(
    cleanupErrorCategory,
    remuxOperations,
    audioStripFailures,
    archiveOperations,
    failedDownloads.map((item) => item.lastError || item.fullStatus)
  );

  return {
    packageId: packageEntry.id,
    name: packageEntry.name,
    status: classifyStatus(successfulFiles, failedFiles, cancelledFiles, packageEntry.cancelled),
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
    archiveCount: archiveOperations.length,
    partCount: archiveOperations.reduce((total, operation) => total + Math.max(0, Math.floor(finiteNonNegative(operation.partCount))), 0),
    outputCount: Math.max(0, Math.floor(finiteNonNegative(telemetry.outputCount ?? packageEntry.outputCount))),
    failurePhase: failure.failurePhase,
    errorCategory: failure.errorCategory,
    archiveOperations,
    remuxOperations
  };
}
