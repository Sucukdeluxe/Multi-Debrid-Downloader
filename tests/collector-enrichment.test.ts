import { describe, expect, it } from "vitest";
import * as collectorEnrichment from "../src/renderer/collector-enrichment";
import type { CollectorPackage } from "../src/shared/collector";

const {
  beginCollectorEnrichment,
  filterCurrentCollectorEnrichment
} = collectorEnrichment;

type PruneCollectorEnrichmentGenerations = (
  current: Map<string, number>,
  packages: CollectorPackage[],
  activeSnapshots: Iterable<ReadonlyMap<string, number>>
) => void;

function pruner(): PruneCollectorEnrichmentGenerations | undefined {
  return (collectorEnrichment as unknown as {
    pruneCollectorEnrichmentGenerations?: PruneCollectorEnrichmentGenerations;
  }).pruneCollectorEnrichmentGenerations;
}

function collectorPackage(url: string, status: "ready" | "offline" | "unknown" = "unknown"): CollectorPackage {
  return {
    id: `package-${url}`,
    name: "Paket",
    nameSource: "inferred",
    addedAt: 1,
    links: [{
      id: `link-${url}`,
      url,
      fileName: "download.bin",
      fileSizeBytes: null,
      hoster: "example",
      availability: status === "ready" ? "online" : status,
      status,
      addedAt: 1
    }]
  };
}

describe("collector enrichment generations", () => {
  it("rejects an older response after the same URL starts a newer enrichment", () => {
    const current = new Map<string, number>();
    const packages = [collectorPackage("https://example.test/file")];
    const first = beginCollectorEnrichment(packages, current);
    const second = beginCollectorEnrichment(packages, current);

    expect(filterCurrentCollectorEnrichment([collectorPackage("https://example.test/file", "offline")], first, current)).toEqual([]);
    expect(filterCurrentCollectorEnrichment([collectorPackage("https://example.test/file", "ready")], second, current)).toHaveLength(1);
  });

  it("retains an in-flight removed URL so reimport cannot reuse its generation", () => {
    const url = "https://example.test/reimported";
    const current = new Map<string, number>();
    const first = beginCollectorEnrichment([collectorPackage(url)], current);
    const activeSnapshots = new Map([["request-1", first]]);

    expect(pruner()).toBeTypeOf("function");
    pruner()?.(current, [], activeSnapshots.values());
    expect(current).toEqual(new Map([[url, 1]]));

    const second = beginCollectorEnrichment([collectorPackage(url)], current);

    expect(second.get(url)).toBe(2);
    expect(filterCurrentCollectorEnrichment([collectorPackage(url, "offline")], first, current)).toEqual([]);
    expect(filterCurrentCollectorEnrichment([collectorPackage(url, "ready")], second, current)).toHaveLength(1);
  });

  it("removes the last generation after its request ends and the collector stays empty", () => {
    const url = "https://example.test/completed";
    const current = new Map<string, number>();
    const snapshot = beginCollectorEnrichment([collectorPackage(url)], current);

    pruner()?.(current, [], [snapshot]);
    expect(current.size).toBe(1);

    pruner()?.(current, [], []);

    expect(current.size).toBe(0);
  });

  it("does not grow across many unique import and removal cycles", () => {
    const current = new Map<string, number>();

    for (let index = 0; index < 5_000; index += 1) {
      const pkg = collectorPackage(`https://example.test/cycle-${index}`);
      beginCollectorEnrichment([pkg], current);
      pruner()?.(current, [pkg], []);
      expect(current.size).toBe(1);
      pruner()?.(current, [], []);
      expect(current.size).toBe(0);
    }
  });
});
