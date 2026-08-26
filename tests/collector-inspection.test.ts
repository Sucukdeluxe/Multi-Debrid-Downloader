import { describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/main/constants";
import {
  enrichCollectorPackages,
  prepareCollectorContainers,
  prepareCollectorText
} from "../src/main/collector-inspection";
import {
  validateCollectorContainerPreparationRequest,
  validateCollectorEnrichmentRequest,
  validateCollectorTextPreparationRequest
} from "../src/shared/collector";

describe("collector preparation", () => {
  it("returns a stable package skeleton without requesting metadata", () => {
    const fetchRequest = vi.spyOn(globalThis, "fetch");
    const rawText = [
      "# Package: Staffel A",
      "# File: episode.part01.rar",
      "https://example.com/a",
      "https://example.com/a",
      "invalid"
    ].join("\n");

    const first = prepareCollectorText({ rawText, addedAt: 1_000 });
    const second = prepareCollectorText({ rawText, addedAt: 2_000 });

    expect(fetchRequest).not.toHaveBeenCalled();
    expect(first.invalidCount).toBe(1);
    expect(first.duplicateCount).toBe(1);
    expect(first.packages).toHaveLength(1);
    expect(first.packages[0]).toEqual(expect.objectContaining({
      name: "Staffel A",
      nameSource: "explicit"
    }));
    expect(first.packages[0].links[0]).toEqual(expect.objectContaining({
      url: "https://example.com/a",
      fileName: "episode.part01.rar",
      availability: "unknown",
      status: "ready"
    }));
    expect(second.packages[0].id).toBe(first.packages[0].id);
    expect(second.packages[0].links[0].id).toBe(first.packages[0].links[0].id);
    fetchRequest.mockRestore();
  });

  it("decrypts selected DLC files into a skeleton without metadata enrichment", async () => {
    const importContainers = vi.fn(async () => [{
      name: "DLC Paket",
      links: ["https://1fichier.com/?abc123def456ghi789jk"],
      fileNames: ["episode.part01.rar"]
    }]);

    const result = await prepareCollectorContainers(
      ["C:\\Imports\\sample.dlc"],
      3_000,
      { importContainers }
    );

    expect(importContainers).toHaveBeenCalledWith(["C:\\Imports\\sample.dlc"]);
    expect(result.packages[0]).toEqual(expect.objectContaining({
      name: "DLC Paket",
      nameSource: "explicit"
    }));
    expect(result.packages[0].links[0]).toEqual(expect.objectContaining({
      fileName: "episode.part01.rar",
      availability: "unknown",
      status: "ready"
    }));
  });

  it("rejects oversized text and invalid container paths", () => {
    expect(() => validateCollectorTextPreparationRequest({ rawText: "x".repeat(2_000_001), addedAt: 1 })).toThrow(/ungültig/i);
    expect(() => validateCollectorTextPreparationRequest({ rawText: "ä".repeat(1_100_000), addedAt: 1 })).toThrow(/ungültig/i);
    expect(() => validateCollectorContainerPreparationRequest({
      filePaths: Array.from({ length: 101 }, (_, index) => `C:\\Imports\\${index}.dlc`),
      addedAt: 1
    })).toThrow(/ungültig/i);
    expect(() => validateCollectorContainerPreparationRequest({ filePaths: ["relative.dlc"], addedAt: 1 })).toThrow(/ungültig/i);
  });
});

describe("collector enrichment", () => {
  it("updates known links by URL while preserving their stable ids", async () => {
    const prepared = prepareCollectorText({
      rawText: "https://1fichier.com/?abc123def456ghi789jk",
      addedAt: 4_000
    });
    const linkBefore = prepared.packages[0].links[0];

    const result = await enrichCollectorPackages(
      { packages: prepared.packages },
      defaultSettings(),
      {
        checkOneFichier: async () => new Map([[linkBefore.url, {
          online: true,
          fileName: "Show.S01E01.part01.rar",
          fileSizeBytes: 471_859_200,
          accessRestricted: false
        }]])
      }
    );

    expect(result.packages).toHaveLength(1);
    expect(result.packages[0].name).toBe("Show.S01E01");
    expect(result.packages[0].links[0]).toEqual(expect.objectContaining({
      id: linkBefore.id,
      url: linkBefore.url,
      fileName: "Show.S01E01.part01.rar",
      fileSizeBytes: 471_859_200,
      availability: "online",
      status: "ready"
    }));
  });

  it("runs independent enrichments concurrently instead of serializing them globally", async () => {
    const first = prepareCollectorText({ rawText: "https://1fichier.com/?first", addedAt: 5_000 });
    const second = prepareCollectorText({ rawText: "https://1fichier.com/?second", addedAt: 6_000 });
    const started: string[] = [];
    const resolvers: Array<() => void> = [];
    const checkOneFichier = async (links: string[]) => {
      started.push(links[0]);
      await new Promise<void>((resolve) => resolvers.push(resolve));
      return new Map();
    };

    const firstRun = enrichCollectorPackages({ packages: first.packages }, defaultSettings(), { checkOneFichier });
    const secondRun = enrichCollectorPackages({ packages: second.packages }, defaultSettings(), { checkOneFichier });
    await vi.waitFor(() => expect(started).toHaveLength(2));
    resolvers.forEach((resolve) => resolve());
    await Promise.all([firstRun, secondRun]);

    expect(started).toEqual([
      "https://1fichier.com/?first",
      "https://1fichier.com/?second"
    ]);
  });

  it("rejects enrichment payloads that do not contain prepared absolute links", () => {
    expect(() => validateCollectorEnrichmentRequest({ packages: [] })).toThrow(/ungültig/i);
    expect(() => validateCollectorEnrichmentRequest({
      packages: [{
        id: "package",
        name: "Paket",
        nameSource: "inferred",
        addedAt: 1,
        links: [{
          id: "link",
          url: "relative",
          fileName: "",
          fileSizeBytes: null,
          hoster: "",
          availability: "unknown",
          status: "unknown",
          addedAt: 1
        }]
      }]
    })).toThrow(/ungültig/i);
  });
});
