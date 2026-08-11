import { describe, expect, it } from "vitest";
import type { PackageEntry } from "../src/shared/types";
import { preservePackageOrderForDisplay } from "../src/renderer/package-order";

function createPackage(id: string, itemIds: string[], downloadStartedAt = 0): PackageEntry {
  const now = Date.now();
  return {
    id,
    name: id,
    outputDir: "",
    extractDir: "",
    status: "queued",
    itemIds,
    cancelled: false,
    enabled: true,
    priority: "normal",
    createdAt: now,
    updatedAt: now,
    downloadStartedAt
  };
}

describe("preservePackageOrderForDisplay", () => {
  it("keeps the exact queue order", () => {
    const packages = [
      createPackage("pkg-a", ["a1", "a2"]),
      createPackage("pkg-c", ["c1"]),
      createPackage("pkg-b", ["b1", "b2"])
    ];
    expect(preservePackageOrderForDisplay(packages).map((pkg) => pkg.id)).toEqual(["pkg-a", "pkg-c", "pkg-b"]);
  });

  it("keeps the visible queue order stable across start and completion metadata", () => {
    const packages = [
      createPackage("pkg-first", ["first-item"], 100),
      createPackage("pkg-second", ["second-item"], 200),
      createPackage("pkg-third", ["third-item"], 300)
    ];
    expect(preservePackageOrderForDisplay(packages).map((pkg) => pkg.id)).toEqual(["pkg-first", "pkg-second", "pkg-third"]);
  });
});
