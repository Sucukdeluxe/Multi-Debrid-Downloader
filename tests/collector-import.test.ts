import { describe, expect, it } from "vitest";
import { parseCollectorQueueExport } from "../src/main/collector-import";

describe("collector queue export import", () => {
  it("leaves non-JSON text to the regular collector parser", () => {
    expect(parseCollectorQueueExport([
      "# package: Staffel 1",
      "https://example.com/episode-1.mkv"
    ].join("\n"))).toBeNull();
  });

  it("preserves URL and file-name positions while normalizing duplicate packages and links", () => {
    const result = parseCollectorQueueExport(JSON.stringify({
      version: 1,
      packages: [{
        name: "Staffel? 1",
        links: [
          " https://example.com/episode-1.mkv ",
          "https://example.com/episode-2.mkv",
          "https://example.com/episode-2.mkv"
        ],
        fileNames: ["Episode 1.mkv", "", "Episode 2.mkv"]
      }, {
        name: "Staffel 1",
        links: [
          "https://example.com/episode-2.mkv",
          "https://example.com/episode-3.mkv"
        ],
        fileNames: ["ignored.mkv", "Episode 3.mkv"]
      }]
    }));

    expect(result).toEqual([{
      name: "Staffel 1",
      links: [
        "https://example.com/episode-1.mkv",
        "https://example.com/episode-2.mkv",
        "https://example.com/episode-3.mkv"
      ],
      fileNames: ["Episode 1.mkv", "Episode 2.mkv", "Episode 3.mkv"]
    }]);
  });

  it("reports malformed JSON instead of treating it as regular text", () => {
    expect(() => parseCollectorQueueExport('{"version":1,"packages":[')).toThrow(/JSON/i);
  });

  it("rejects JSON that does not match the version-one queue export schema", () => {
    const unsuitable = [
      [],
      { version: 2, packages: [] },
      { version: 1, packages: [], exportedAt: "2026-08-26" },
      { version: 1, packages: [{ name: "Paket", links: ["not-a-url"] }] },
      {
        version: 1,
        packages: [{
          name: "Paket",
          links: ["https://example.com/file.bin"],
          fileNames: ["file.bin", "orphan.bin"]
        }]
      }
    ];

    for (const payload of unsuitable) {
      expect(() => parseCollectorQueueExport(JSON.stringify(payload))).toThrow(/Queue-Export.*ungültig/i);
    }
  });

  it("rejects queue exports above the collector package and link limits", () => {
    const tooManyPackages = {
      version: 1,
      packages: Array.from({ length: 2_001 }, (_, index) => ({
        name: `Paket ${index}`,
        links: ["https://example.com/file.bin"]
      }))
    };
    const tooManyLinks = {
      version: 1,
      packages: [{
        name: "Paket",
        links: Array.from({ length: 20_001 }, (_, index) => `https://example.com/${index}`)
      }]
    };

    expect(() => parseCollectorQueueExport(JSON.stringify(tooManyPackages))).toThrow(/2\.000 Pakete/i);
    expect(() => parseCollectorQueueExport(JSON.stringify(tooManyLinks))).toThrow(/20\.000 Links/i);
  });
});
