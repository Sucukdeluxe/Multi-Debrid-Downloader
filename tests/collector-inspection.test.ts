import { describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/main/constants";
import {
  enrichCollectorPackages,
  prepareCollectorContainers,
  prepareCollectorText
} from "../src/main/collector-inspection";
import {
  COLLECTOR_MAX_NAME_LENGTH,
  validateCollectorContainerPreparationRequest,
  validateCollectorEnrichmentRequest,
  validateCollectorPersistenceState,
  validateCollectorTextPreparationRequest
} from "../src/shared/collector";
import type { CollectorInspectionResult } from "../src/shared/collector";

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

  it("prepares the app's queue export JSON as collector packages", () => {
    const rawText = JSON.stringify({
      version: 1,
      packages: [{
        name: "Roundtrip",
        links: ["https://example.test/one", "https://example.test/two"],
        fileNames: ["one.bin", "two.bin"]
      }]
    }, null, 2);

    const result = prepareCollectorText({ rawText, addedAt: 4_000 });

    expect(result.invalidCount).toBe(0);
    expect(result.duplicateCount).toBe(0);
    expect(result.packages).toEqual([expect.objectContaining({
      name: "Roundtrip",
      nameSource: "explicit",
      links: [
        expect.objectContaining({ url: "https://example.test/one", fileName: "one.bin" }),
        expect.objectContaining({ url: "https://example.test/two", fileName: "two.bin" })
      ]
    })]);
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

  it("normalizes package names from every preparation input to the persistence limit", async () => {
    const oversizedName = "n".repeat(COLLECTOR_MAX_NAME_LENGTH + 1);
    const textResult = prepareCollectorText({
      rawText: [`# Package: ${oversizedName}`, "# File: text.bin", "https://example.com/text"].join("\n"),
      addedAt: 3_100
    });
    const containerResult = await prepareCollectorContainers(
      ["C:\\Imports\\oversized.dlc"],
      3_200,
      {
        importContainers: async () => [{
          name: oversizedName,
          links: ["https://example.com/container"],
          fileNames: ["container.bin"]
        }]
      }
    );

    for (const result of [textResult, containerResult]) {
      expect(result.packages[0].name).toBe("n".repeat(COLLECTOR_MAX_NAME_LENGTH));
      expect(() => validateCollectorPersistenceState({
        packages: result.packages,
        collapsedPackageIds: []
      })).not.toThrow();
    }
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
      { requestId: "request-one", packages: prepared.packages },
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

    const firstRun = enrichCollectorPackages({ requestId: "request-first", packages: first.packages }, defaultSettings(), { checkOneFichier });
    const secondRun = enrichCollectorPackages({ requestId: "request-second", packages: second.packages }, defaultSettings(), { checkOneFichier });
    await vi.waitFor(() => expect(started).toHaveLength(2));
    resolvers.forEach((resolve) => resolve());
    await Promise.all([firstRun, secondRun]);

    expect(started).toEqual([
      "https://1fichier.com/?first",
      "https://1fichier.com/?second"
    ]);
  });

  it("reports finished RapidGator links before the complete enrichment resolves", async () => {
    const prepared = prepareCollectorText({
      rawText: [
        "https://rapidgator.net/file/aaaaaaaa/one.bin.html",
        "https://rapidgator.net/file/bbbbbbbb/two.bin.html"
      ].join("\n"),
      addedAt: 7_000
    });
    const resolvers = new Map<string, (value: { online: boolean; fileName: string; fileSizeBytes: number }) => void>();
    const progress: CollectorInspectionResult[] = [];
    let completed = false;
    const run = enrichCollectorPackages(
      { requestId: "request-progress", packages: prepared.packages },
      defaultSettings(),
      {
        checkRapidgator: (url) => new Promise((resolve) => resolvers.set(url, resolve))
      },
      (result) => progress.push(result)
    ).then((result) => {
      completed = true;
      return result;
    });

    await vi.waitFor(() => expect(resolvers.size).toBe(2));
    resolvers.get("https://rapidgator.net/file/aaaaaaaa/one.bin.html")?.({
      online: true,
      fileName: "one.part01.rar",
      fileSizeBytes: 100
    });
    await vi.waitFor(() => expect(progress.length).toBeGreaterThan(0));

    expect(completed).toBe(false);
    expect(progress.flatMap((entry) => entry.packages).flatMap((pkg) => pkg.links)).toEqual([
      expect.objectContaining({ fileName: "one.part01.rar", fileSizeBytes: 100, availability: "online" })
    ]);

    resolvers.get("https://rapidgator.net/file/bbbbbbbb/two.bin.html")?.({
      online: false,
      fileName: "two.bin",
      fileSizeBytes: 200
    });
    await run;
  });

  it("normalizes every external enrichment file name before progress and persistence", async () => {
    const urls = [
      "https://1fichier.com/?abc123def456ghi789jk",
      "https://rapidgator.net/file/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/opaque.html",
      "https://ddownload.com/abcdefghij",
      "https://example.com/"
    ];
    const prepared = prepareCollectorText({
      rawText: ["# Package: External", ...urls.slice(0, 3), "# File: download.bin", urls[3]].join("\n"),
      addedAt: 8_000
    });
    const externalFileName = "x".repeat(1_025);
    const progress: CollectorInspectionResult[] = [];

    const result = await enrichCollectorPackages(
      { requestId: "request-external-file-names", packages: prepared.packages },
      defaultSettings(),
      {
        checkOneFichier: async (links) => new Map(links.map((url) => [url, {
          online: true,
          fileName: externalFileName,
          fileSizeBytes: 100,
          accessRestricted: false
        }])),
        checkRapidgator: async () => ({ online: true, fileName: externalFileName, fileSizeBytes: 200 }),
        checkDdownload: async () => ({ online: true, fileName: externalFileName, fileSizeBytes: 300 }),
        resolveFilenames: async (links, onResolved) => {
          for (const url of links) onResolved?.(url, externalFileName);
          return new Map(links.map((url) => [url, externalFileName]));
        }
      },
      (entry) => progress.push(entry)
    );

    const finalLinks = result.packages.flatMap((pkg) => pkg.links);
    const progressLinks = progress.flatMap((entry) => entry.packages).flatMap((pkg) => pkg.links);
    expect(finalLinks.map((link) => link.url).sort()).toEqual([...urls].sort());
    expect([...new Set(progressLinks.map((link) => link.url))].sort()).toEqual([...urls].sort());
    for (const link of [...finalLinks, ...progressLinks]) {
      expect(link.fileName).toBe("x".repeat(1_024));
    }
    for (const entry of [...progress, result]) {
      expect(() => validateCollectorPersistenceState({
        packages: entry.packages,
        collapsedPackageIds: []
      })).not.toThrow();
    }
  });

  it("rejects enrichment payloads that do not contain prepared absolute links", () => {
    expect(() => validateCollectorEnrichmentRequest({ requestId: "request-empty", packages: [] })).toThrow(/ungültig/i);
    expect(() => validateCollectorEnrichmentRequest({
      requestId: "request-invalid",
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
