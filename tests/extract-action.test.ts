import { describe, expect, it } from "vitest";
import type { DownloadItem, PackageEntry } from "../src/shared/types";
import { buildExtractNowContextAction } from "../src/renderer/views/downloads/extract-action";

function item(id: string, packageId: string, status: DownloadItem["status"], fullStatus: string): DownloadItem {
  return {
    id,
    packageId,
    url: `https://example.invalid/${id}`,
    provider: "realdebrid",
    status,
    retries: 0,
    speedBps: 0,
    downloadedBytes: status === "completed" ? 100 : 0,
    totalBytes: 100,
    progressPercent: status === "completed" ? 100 : 0,
    fileName: `${id}.part1.rar`,
    targetPath: `C:\\Downloads\\${id}.part1.rar`,
    resumable: true,
    attempts: 0,
    lastError: "",
    fullStatus,
    createdAt: 1,
    updatedAt: 1
  };
}

function pkg(id: string, itemIds: string[]): PackageEntry {
  return {
    id,
    name: id,
    outputDir: `C:\\Downloads\\${id}`,
    extractDir: `C:\\Downloads\\_entpackt\\${id}`,
    itemIds,
    enabled: true,
    cancelled: false,
    status: "completed",
    priority: "normal",
    createdAt: 1,
    updatedAt: 1
  };
}

describe("extract now context action", () => {
  it("targets one completed child item so the manager can resolve its complete archive set", () => {
    const items = { part2: item("part2", "pkg-1", "completed", "Fertig") };
    const action = buildExtractNowContextAction({
      contextItemId: "part2",
      selectedPackageIds: [],
      selectedItemIds: ["part2"],
      packages: { "pkg-1": pkg("pkg-1", ["part2"]) },
      items
    });

    expect(action).toEqual({
      label: "Jetzt entpacken",
      request: { packageIds: [], itemIds: ["part2"] },
      targetCount: 1
    });
  });

  it("targets every selected package that has completed unextracted files", () => {
    const items = {
      a: item("a", "pkg-a", "completed", "Entpack-Fehler: Passwort"),
      b: item("b", "pkg-b", "completed", "Entpacken - Ausstehend"),
      c: item("c", "pkg-c", "queued", "Wartet")
    };
    const action = buildExtractNowContextAction({
      selectedPackageIds: ["pkg-a", "pkg-b", "pkg-c"],
      selectedItemIds: [],
      packages: {
        "pkg-a": pkg("pkg-a", ["a"]),
        "pkg-b": pkg("pkg-b", ["b"]),
        "pkg-c": pkg("pkg-c", ["c"])
      },
      items
    });

    expect(action).toEqual({
      label: "Jetzt entpacken (2)",
      request: { packageIds: ["pkg-a", "pkg-b"], itemIds: [] },
      targetCount: 2
    });
  });

  it("hides the action for extracted or incomplete selections", () => {
    const items = {
      extracted: item("extracted", "pkg-1", "completed", "Entpackt in 4s"),
      queued: item("queued", "pkg-2", "queued", "Wartet")
    };
    expect(buildExtractNowContextAction({
      selectedPackageIds: ["pkg-1", "pkg-2"],
      selectedItemIds: [],
      packages: {
        "pkg-1": pkg("pkg-1", ["extracted"]),
        "pkg-2": pkg("pkg-2", ["queued"])
      },
      items
    })).toBeNull();
  });
});
