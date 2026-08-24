import { describe, expect, it } from "vitest";
import type {
  ArchiveOperationMetric,
  DownloadItem,
  PackageEntry,
  PackageTelemetry,
  RemuxOperationMetric
} from "../src/shared/types";
import {
  durationMsToSeconds,
  durationSecondsBetween,
  finalizePackageResult
} from "../src/main/package-telemetry";
import { buildRunResult } from "../src/main/notification-events";
import { normalizeLoadedSession } from "../src/main/storage";

function packageEntry(overrides: Partial<PackageEntry> = {}): PackageEntry {
  return {
    id: "pkg-1",
    name: "Paket",
    outputDir: "C:\\Downloads\\Paket",
    extractDir: "C:\\Downloads\\Paket",
    status: "completed",
    itemIds: [],
    cancelled: false,
    enabled: true,
    downloadStartedAt: 1_000,
    downloadCompletedAt: 121_000,
    downloadEndedAt: 121_000,
    postProcessQueuedAt: 122_000,
    postProcessStartedAt: 130_000,
    postProcessCompletedAt: 160_000,
    terminalAt: 166_000,
    createdAt: 1_000,
    updatedAt: 166_000,
    ...overrides
  };
}

function downloadItem(id: string, status: DownloadItem["status"] = "completed"): DownloadItem {
  return {
    id,
    packageId: "pkg-1",
    url: `https://example.test/${id}`,
    provider: "realdebrid",
    status,
    retries: 0,
    speedBps: 0,
    downloadedBytes: status === "completed" ? 1_000 : 0,
    totalBytes: 1_000,
    progressPercent: status === "completed" ? 100 : 0,
    fileName: `${id}.rar`,
    targetPath: `C:\\Downloads\\Paket\\${id}.rar`,
    resumable: true,
    attempts: 1,
    lastError: status === "failed" ? "download-error" : "",
    fullStatus: "",
    createdAt: 1_000,
    updatedAt: 121_000
  };
}

function archiveOperation(overrides: Partial<ArchiveOperationMetric> = {}): ArchiveOperationMetric {
  return {
    id: "archive-1",
    name: "Paket.part01.rar",
    itemIds: ["item-1"],
    partCount: 1,
    startedAt: 130_000,
    completedAt: 160_000,
    durationMs: 30_000,
    status: "completed",
    errorCategory: "",
    ...overrides
  };
}

function remuxOperation(overrides: Partial<RemuxOperationMetric> = {}): RemuxOperationMetric {
  return {
    id: "remux-1",
    fileName: "episode.mkv",
    startedAt: 150_000,
    completedAt: 155_000,
    durationMs: 5_000,
    status: "completed",
    errorCategory: "",
    ...overrides
  };
}

function telemetry(overrides: Partial<PackageTelemetry> = {}): PackageTelemetry {
  const items = [downloadItem("item-1")];
  return {
    package: packageEntry({ itemIds: items.map((item) => item.id) }),
    items,
    archiveOperations: [],
    remuxOperations: [],
    outputCount: 0,
    cleanupErrorCategory: "",
    ...overrides
  };
}

describe("package lifecycle telemetry", () => {
  it("finalizes a successful package from explicit timestamps and operation durations", () => {
    const items = [downloadItem("item-1"), downloadItem("item-2")];
    const result = finalizePackageResult(telemetry({
      package: packageEntry({ itemIds: items.map((item) => item.id) }),
      items,
      archiveOperations: [archiveOperation({ itemIds: items.map((item) => item.id), partCount: 2 })],
      remuxOperations: [remuxOperation()],
      outputCount: 2
    }));

    expect(result).toEqual(expect.objectContaining({
      packageId: "pkg-1",
      status: "completed",
      downloadDurationSeconds: 120,
      extractionDurationSeconds: 30,
      remuxDurationSeconds: 5,
      postProcessDurationSeconds: 30,
      totalDurationSeconds: 165,
      successfulFiles: 2,
      failedFiles: 0,
      cancelledFiles: 0,
      archiveCount: 1,
      partCount: 2,
      outputCount: 2,
      failurePhase: null,
      averageDownloadSpeedBps: 16
    }));
  });

  it("uses the union of parallel extraction intervals", () => {
    const items = [downloadItem("item-1"), downloadItem("item-2")];
    const result = finalizePackageResult(telemetry({
      package: packageEntry({ itemIds: items.map((item) => item.id) }),
      items,
      archiveOperations: [
        archiveOperation({ id: "archive-a", startedAt: 130_000, completedAt: 160_000, durationMs: 30_000 }),
        archiveOperation({ id: "archive-b", startedAt: 130_000, completedAt: 160_000, durationMs: 30_000 })
      ]
    }));

    expect(result.extractionDurationSeconds).toBe(30);
  });

  it("adds non-overlapping extraction intervals", () => {
    const items = [downloadItem("item-1"), downloadItem("item-2")];
    const result = finalizePackageResult(telemetry({
      package: packageEntry({ itemIds: items.map((item) => item.id) }),
      items,
      archiveOperations: [
        archiveOperation({ id: "archive-a", startedAt: 100_000, completedAt: 130_000, durationMs: 30_000 }),
        archiveOperation({ id: "archive-b", startedAt: 130_000, completedAt: 160_000, durationMs: 30_000 })
      ]
    }));

    expect(result.extractionDurationSeconds).toBe(60);
  });

  it("keeps download file counts independent from a failed multipart archive", () => {
    const items = Array.from({ length: 16 }, (_, index) => downloadItem(`item-${index + 1}`));
    const result = finalizePackageResult(telemetry({
      package: packageEntry({ itemIds: items.map((item) => item.id) }),
      items,
      archiveOperations: [archiveOperation({
        itemIds: items.map((item) => item.id),
        partCount: 16,
        status: "failed",
        errorCategory: "checksum"
      })]
    }));

    expect(result).toEqual(expect.objectContaining({
      status: "partial",
      downloadDurationSeconds: 120,
      extractionDurationSeconds: 30,
      totalDurationSeconds: 165,
      successfulFiles: 16,
      failedFiles: 0,
      partCount: 16,
      archiveCount: 1,
      extractionFailures: 1,
      failurePhase: "extract",
      errorCategory: "Entpacken"
    }));
  });

  it("classifies a generic post-processing failure separately from cleanup", () => {
    const result = finalizePackageResult(telemetry({
      postProcessErrorCategory: "rename failed"
    }));

    expect(result).toEqual(expect.objectContaining({
      status: "partial",
      successfulFiles: 1,
      failedFiles: 0,
      cleanupFailures: 0,
      postProcessFailures: 1,
      failurePhase: "postprocess",
      errorCategory: "Nachbearbeitung"
    }));
  });

  it("classifies a package with no successful files and a download failure as failed", () => {
    const item = downloadItem("item-1", "failed");
    const result = finalizePackageResult(telemetry({
      package: packageEntry({ status: "failed", itemIds: [item.id] }),
      items: [item]
    }));

    expect(result).toEqual(expect.objectContaining({
      status: "failed",
      successfulFiles: 0,
      failedFiles: 1,
      cancelledFiles: 0,
      failurePhase: "download",
      errorCategory: "Download"
    }));
  });

  it("includes immediately cleaned successes and bytes in a mixed package result", () => {
    const failedItem = downloadItem("item-3", "failed");
    const result = finalizePackageResult(telemetry({
      package: packageEntry({
        status: "failed",
        itemIds: [failedItem.id],
        cleanedCompletedItemCount: 2,
        cleanedDownloadedBytes: 2_000,
        cleanedTotalBytes: 2_000
      }),
      items: [failedItem]
    }));

    expect(result).toEqual(expect.objectContaining({
      status: "partial",
      successfulFiles: 2,
      failedFiles: 1,
      downloadedBytes: 2_000,
      totalBytes: 3_000
    }));
  });

  it("classifies a failed download without error text as a download-phase failure", () => {
    const item = { ...downloadItem("item-1", "failed"), lastError: "", fullStatus: "" };
    const result = finalizePackageResult(telemetry({
      package: packageEntry({ status: "failed", itemIds: [item.id] }),
      items: [item]
    }));

    expect(result).toEqual(expect.objectContaining({
      status: "failed",
      failedFiles: 1,
      failurePhase: "download",
      errorCategory: "Download"
    }));
  });

  it("projects private download failure details to a fixed category", () => {
    const privateDetails = "https://private.example.test/hook C:/Private/target alice@example.test token=SUPERSECRET";
    const item = {
      ...downloadItem("item-1", "failed"),
      lastError: privateDetails,
      fullStatus: privateDetails
    };
    const result = finalizePackageResult(telemetry({
      package: packageEntry({ status: "failed", itemIds: [item.id] }),
      items: [item]
    }));

    expect(result.errorCategory).toBe("Download");
    expect(result.errorCategory).not.toContain("private.example.test");
    expect(result.errorCategory).not.toContain("C:/Private/target");
    expect(result.errorCategory).not.toContain("alice@example.test");
    expect(result.errorCategory).not.toContain("SUPERSECRET");
  });

  it.each([
    ["Host ist offline", "Offline"],
    ["Request ETIMEDOUT", "Timeout"],
    ["socket ECONNRESET", "Netzwerk"],
    ["ENOSPC: no space left on device", "Speicherplatz"],
    ["EACCES: permission denied", "Berechtigung"],
    ["nicht näher klassifizierbar", "Download"]
  ])("maps download failure detail %s to %s", (detail, expectedCategory) => {
    const item = { ...downloadItem("item-1", "failed"), lastError: detail };
    const result = finalizePackageResult(telemetry({
      package: packageEntry({ status: "failed", itemIds: [item.id] }),
      items: [item]
    }));

    expect(result.errorCategory).toBe(expectedCategory);
  });

  it("classifies a package with only cancelled work as cancelled", () => {
    const item = downloadItem("item-1", "cancelled");
    const result = finalizePackageResult(telemetry({
      package: packageEntry({ status: "cancelled", cancelled: true, itemIds: [item.id] }),
      items: [item]
    }));

    expect(result).toEqual(expect.objectContaining({
      status: "cancelled",
      successfulFiles: 0,
      failedFiles: 0,
      cancelledFiles: 1,
      failurePhase: null
    }));
  });

  it("reports zero postprocess durations when no postprocess phase ran", () => {
    const result = finalizePackageResult(telemetry({
      package: packageEntry({
        downloadCompletedAt: 61_000,
        downloadEndedAt: 61_000,
        postProcessQueuedAt: undefined,
        postProcessStartedAt: undefined,
        postProcessCompletedAt: undefined,
        terminalAt: 61_000,
        updatedAt: 61_000
      })
    }));

    expect(result).toEqual(expect.objectContaining({
      downloadDurationSeconds: 60,
      extractionDurationSeconds: 0,
      remuxDurationSeconds: 0,
      postProcessDurationSeconds: 0,
      totalDurationSeconds: 60
    }));
  });

  it("retains legacy download timing after session normalization", () => {
    const item = { ...downloadItem("item-1"), downloadedBytes: 240_000, totalBytes: 240_000 };
    const legacyPackage = packageEntry({
      itemIds: [item.id],
      downloadStartedAt: 1_000,
      downloadCompletedAt: 121_000,
      terminalAt: 121_000,
      updatedAt: 121_000
    });
    delete legacyPackage.downloadEndedAt;
    const normalized = normalizeLoadedSession({
      version: 2,
      packageOrder: [legacyPackage.id],
      packages: { [legacyPackage.id]: legacyPackage },
      items: { [item.id]: item },
      runStartedAt: 1_000,
      totalDownloadedBytes: 240_000,
      summaryText: "",
      reconnectUntil: 0,
      reconnectReason: "",
      paused: false,
      running: false,
      updatedAt: 121_000
    });
    const normalizedPackage = normalized.packages[legacyPackage.id];
    const result = finalizePackageResult({
      package: normalizedPackage,
      items: normalizedPackage.itemIds.map((itemId) => normalized.items[itemId])
    });

    expect(result).toEqual(expect.objectContaining({
      downloadEndedAt: 121_000,
      downloadDurationSeconds: 120,
      averageDownloadSpeedBps: 2_000
    }));
  });

  it("uses cleanup, remux, extract, and download as deterministic failure precedence", () => {
    const failedItem = downloadItem("item-1", "failed");
    const failedArchive = archiveOperation({ status: "failed", errorCategory: "archive-error" });
    const failedRemux = remuxOperation({ status: "failed", errorCategory: "remux-error" });
    const failures = [
      finalizePackageResult(telemetry({ items: [failedItem], archiveOperations: [failedArchive], remuxOperations: [failedRemux], cleanupErrorCategory: "cleanup-error" })),
      finalizePackageResult(telemetry({ items: [failedItem], archiveOperations: [failedArchive], remuxOperations: [failedRemux] })),
      finalizePackageResult(telemetry({ items: [failedItem], archiveOperations: [failedArchive] })),
      finalizePackageResult(telemetry({ items: [failedItem] }))
    ];

    expect(failures.map(({ failurePhase, errorCategory }) => ({ failurePhase, errorCategory }))).toEqual([
      { failurePhase: "cleanup", errorCategory: "Cleanup" },
      { failurePhase: "remux", errorCategory: "Remux" },
      { failurePhase: "extract", errorCategory: "Entpacken" },
      { failurePhase: "download", errorCategory: "Download" }
    ]);
  });

  it("retains additive failure counters when cleanup is the primary failure phase", () => {
    const failedItem = { ...downloadItem("item-1", "failed"), lastError: "Host ist offline" };
    const packageResult = finalizePackageResult(telemetry({
      items: [failedItem],
      archiveOperations: [archiveOperation({ status: "failed", errorCategory: "archive-error" })],
      remuxOperations: [remuxOperation({ status: "failed", errorCategory: "remux-error" })],
      cleanupErrorCategory: "cleanup-error"
    }));
    const runResult = buildRunResult({
      id: "mixed-failures",
      stopped: false,
      startedAt: 1_000,
      completedAt: 166_000,
      packages: [packageResult]
    });

    expect(packageResult).toEqual(expect.objectContaining({
      failurePhase: "cleanup",
      downloadFailures: 1,
      offlineFailures: 1,
      extractionFailures: 1,
      remuxFailures: 1,
      cleanupFailures: 1
    }));
    expect(runResult).toEqual(expect.objectContaining({
      downloadFailures: 1,
      offlineFailures: 1,
      extractionFailures: 1,
      remuxFailures: 1,
      cleanupFailures: 1
    }));
  });

  it("uses audio-strip outcomes when no individual remux operation was recorded", () => {
    const items = [downloadItem("item-1"), downloadItem("item-2")];
    const result = finalizePackageResult(telemetry({
      package: packageEntry({
        itemIds: items.map((item) => item.id),
        audioStripSummary: {
          at: 160_000,
          candidates: 2,
          remuxed: 1,
          keptSingle: 0,
          skippedNoGerman: 0,
          skippedNoTool: 0,
          failed: 1,
          files: []
        }
      }),
      items
    }));

    expect(result).toEqual(expect.objectContaining({
      status: "partial",
      successfulFiles: 2,
      failedFiles: 0,
      failurePhase: "remux"
    }));
  });

  it("clamps invalid and reversed durations instead of producing negative or non-finite values", () => {
    expect(durationMsToSeconds(1_999)).toBe(1);
    expect(durationMsToSeconds(-1)).toBe(0);
    expect(durationMsToSeconds(Number.NaN)).toBe(0);
    expect(durationSecondsBetween(5_000, 4_000)).toBe(0);
    expect(durationSecondsBetween(undefined, 5_000)).toBe(0);
  });
});
