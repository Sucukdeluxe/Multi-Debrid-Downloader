import { describe, expect, it } from "vitest";
import type { PackageEntry } from "../src/shared/types";
import {
  preservePackageOrderForDisplay,
  reconcileCollapsedPackageState,
  reconcileOptimisticPackageOrder
} from "../src/renderer/package-order";

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

describe("reconcileCollapsedPackageState", () => {
  it("keeps user collapse choices stable while package metadata and order change", () => {
    const previous = { "pkg-first": true, "pkg-second": false };
    const packages = {
      "pkg-first": { ...createPackage("pkg-first", ["first-item"], 300), status: "downloading" as const },
      "pkg-second": { ...createPackage("pkg-second", ["second-item"], 100), status: "completed" as const }
    };

    const next = reconcileCollapsedPackageState(previous, ["pkg-second", "pkg-first"], packages, true);

    expect(next).toBe(previous);
    expect(next).toEqual({ "pkg-first": true, "pkg-second": false });
  });

  it("defaults only new packages and removes packages that disappeared", () => {
    const previous = { "pkg-old": false, "pkg-stale": true };
    const packages = {
      "pkg-old": createPackage("pkg-old", ["old-item"]),
      "pkg-new": createPackage("pkg-new", ["new-item"])
    };

    expect(reconcileCollapsedPackageState(previous, ["pkg-old", "pkg-new"], packages, true)).toEqual({
      "pkg-old": false,
      "pkg-new": true
    });
  });
});

describe("reconcileOptimisticPackageOrder", () => {
  it("keeps the optimistic order visible while an older state event arrives", () => {
    const pending = ["pkg-a", "pkg-c", "pkg-b"];

    expect(reconcileOptimisticPackageOrder(
      ["pkg-a", "pkg-b", "pkg-c"],
      pending,
      1_000,
      1_500
    )).toEqual({
      displayOrder: pending,
      pendingOrder: pending,
      pendingAt: 1_000,
      status: "pending"
    });
  });

  it("accepts the authoritative order once it acknowledges the optimistic change", () => {
    const pending = ["pkg-a", "pkg-c", "pkg-b"];

    expect(reconcileOptimisticPackageOrder(
      pending,
      pending,
      1_000,
      1_500
    )).toEqual({
      displayOrder: pending,
      pendingOrder: null,
      pendingAt: 0,
      status: "acknowledged"
    });
  });

  it("returns to the authoritative order after the optimistic hold times out", () => {
    const authoritative = ["pkg-a", "pkg-b", "pkg-c"];

    expect(reconcileOptimisticPackageOrder(
      authoritative,
      ["pkg-a", "pkg-c", "pkg-b"],
      1_000,
      2_500
    )).toEqual({
      displayOrder: authoritative,
      pendingOrder: null,
      pendingAt: 0,
      status: "timed-out"
    });
  });
});
