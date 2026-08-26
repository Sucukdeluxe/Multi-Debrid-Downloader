import { describe, expect, it } from "vitest";
import * as collector from "../src/shared/collector";
import * as collectorModel from "../src/renderer/views/collector/collector-model";
import type { CollectorLink, CollectorPackage } from "../src/shared/collector";

function link(index: number): CollectorLink {
  return {
    id: `link-${index}`,
    url: `https://example.test/${index}`,
    fileName: `file-${index}.bin`,
    fileSizeBytes: null,
    hoster: "example",
    availability: "unknown",
    status: "unknown",
    addedAt: 1
  };
}

function packageEntry(index: number, links: CollectorLink[] = [link(index)]): CollectorPackage {
  return {
    id: `package-${index}`,
    name: `Package ${index}`,
    nameSource: "explicit",
    links,
    addedAt: 1
  };
}

describe("collector capacity", () => {
  it("reports package and link overflow without cloning the state", () => {
    const inspect = (collector as unknown as {
      inspectCollectorCapacity?: (packages: CollectorPackage[]) => unknown;
    }).inspectCollectorCapacity;

    expect(inspect).toBeTypeOf("function");
    expect(inspect?.(Array.from({ length: 2_001 }, (_, index) => packageEntry(index)))).toEqual({
      ok: false,
      packageCount: 2_001,
      linkCount: 2_001,
      message: "Der Linksammler kann höchstens 2.000 Pakete enthalten."
    });
    expect(inspect?.([packageEntry(0, Array.from({ length: 20_001 }, (_, index) => link(index)))])).toEqual({
      ok: false,
      packageCount: 1,
      linkCount: 20_001,
      message: "Der Linksammler kann höchstens 20.000 Links enthalten."
    });
  });

  it("reports the exact serialized persistence overflow independently of count limits", () => {
    const inspectPersistence = (collector as unknown as {
      inspectCollectorPersistenceSize?: (state: { packages: CollectorPackage[]; collapsedPackageIds: string[] }, maximumBytes?: number) => { ok: boolean; byteCount: number; message?: string };
    }).inspectCollectorPersistenceSize;
    const state = { packages: [packageEntry(1)], collapsedPackageIds: ["package-1"] };

    expect(inspectPersistence).toBeTypeOf("function");
    const result = inspectPersistence?.(state, 128);
    expect(result?.ok).toBe(false);
    expect(result?.byteCount).toBeGreaterThan(128);
    expect(result?.message).toBe("Der Linksammler ist zu groß, um gespeichert zu werden.");
  });

  it("rejects only the cumulative post-merge result and leaves the current state untouched", () => {
    const mergeWithinCapacity = (collectorModel as unknown as {
      mergeCollectorPackagesWithinCapacity?: (current: CollectorPackage[], incoming: CollectorPackage[], enrichment?: boolean) => unknown;
    }).mergeCollectorPackagesWithinCapacity;
    const current = Array.from({ length: 1_999 }, (_, index) => packageEntry(index));
    const incoming = [packageEntry(1_999), packageEntry(2_000)];

    expect(mergeWithinCapacity).toBeTypeOf("function");
    expect(mergeWithinCapacity?.(current, incoming)).toEqual({
      ok: false,
      packageCount: 2_001,
      linkCount: 2_001,
      message: "Der Linksammler kann höchstens 2.000 Pakete enthalten."
    });
    expect(current).toHaveLength(1_999);
  });

  it("accepts an at-limit merge when the incoming link is only a duplicate", () => {
    const mergeWithinCapacity = (collectorModel as unknown as {
      mergeCollectorPackagesWithinCapacity?: (current: CollectorPackage[], incoming: CollectorPackage[], enrichment?: boolean) => { ok: boolean; value?: { packages: CollectorPackage[] } };
    }).mergeCollectorPackagesWithinCapacity;
    const current = Array.from({ length: 2_000 }, (_, index) => packageEntry(index));

    expect(mergeWithinCapacity).toBeTypeOf("function");
    const result = mergeWithinCapacity?.(current, [{ ...current[0], links: [{ ...current[0].links[0] }] }]);
    expect(result?.ok).toBe(true);
    expect(result?.value?.packages).toHaveLength(2_000);
  });
});
