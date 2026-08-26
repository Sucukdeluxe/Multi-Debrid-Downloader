import { describe, expect, it } from "vitest";
import {
  beginCollectorEnrichment,
  filterCurrentCollectorEnrichment
} from "../src/renderer/collector-enrichment";
import type { CollectorPackage } from "../src/shared/collector";

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
});
