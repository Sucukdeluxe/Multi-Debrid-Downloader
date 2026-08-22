import { describe, expect, it } from "vitest";
import { defaultSettings } from "../src/main/constants";
import {
  inferCollectorPackageName,
  inspectCollectorText,
  serializeCollectorPackages
} from "../src/main/collector-inspection";

const sbsLinks = [
  "https://1fichier.com/?82xiit09yax8npoh1qt8",
  "https://1fichier.com/?gr4ry0k18p3sg74vupfp",
  "https://1fichier.com/?bui5smo6gsxxelz49ukl",
  "https://1fichier.com/?9d3udo3rr96f8xi2xj74",
  "https://1fichier.com/?lqetjbffrw58zrxsrz00",
  "https://1fichier.com/?0cgbn7se8l4as8sopr9u",
  "https://1fichier.com/?dufuuwir5skm055penoo",
  "https://1fichier.com/?p2njgtuhtuzm20vwp4n5",
  "https://1fichier.com/?ogqhzkqpj2ugmm9evc11",
  "https://1fichier.com/?ktymbac2nt78o5zsi3z5",
  "https://1fichier.com/?q51ktq0jb7fmez42n3zs",
  "https://1fichier.com/?oo7p0wdnapdix2dvt6d0",
  "https://1fichier.com/?lv2s37fkloo7wgjwq05r",
  "https://1fichier.com/?fnczcnoljqxgny9q7fxt",
  "https://1fichier.com/?pbg9n0rrqk3rpnflqbe8",
  "https://1fichier.com/?cgmdxz11f2gd9u7by9tg"
];

describe("collector inspection", () => {
  it("groups the real SBS14HD multipart shape into one package with exact metadata", async () => {
    const metadata = new Map(sbsLinks.map((link, index) => [link, {
      online: true,
      fileName: `SBS14HD.part${String(index + 1).padStart(2, "0")}.rar`,
      fileSizeBytes: index === 15 ? 373_517_856 : 471_859_200,
      accessRestricted: false
    }]));

    const result = await inspectCollectorText({ rawText: sbsLinks.join("\n"), addedAt: 1_777_777_777_000 }, defaultSettings(), {
      checkOneFichier: async () => metadata,
      createId: (() => {
        let value = 0;
        return (prefix) => `${prefix}-${++value}`;
      })()
    });

    expect(result.invalidCount).toBe(0);
    expect(result.duplicateCount).toBe(0);
    expect(result.packages).toHaveLength(1);
    expect(result.packages[0].name).toBe("SBS14HD");
    expect(result.packages[0].links).toHaveLength(16);
    expect(result.packages[0].links.map((link) => link.fileName)).toEqual(
      Array.from({ length: 16 }, (_unused, index) => `SBS14HD.part${String(index + 1).padStart(2, "0")}.rar`)
    );
    expect(result.packages[0].links.reduce((sum, link) => sum + (link.fileSizeBytes || 0), 0)).toBe(7_451_405_856);
    expect(result.packages[0].links.every((link) => link.hoster === "1fichier" && link.availability === "online" && link.status === "ready")).toBe(true);
    expect(result.packages[0].addedAt).toBe(1_777_777_777_000);
  });

  it("keeps explicit packages authoritative while removing duplicate URLs", async () => {
    const rawText = [
      "# Package: Staffel A",
      "# File: episode.part01.rar",
      "https://example.com/a",
      "https://example.com/a",
      "# Package: Staffel B",
      "https://example.com/b"
    ].join("\n");

    const result = await inspectCollectorText({ rawText, addedAt: 2000 }, defaultSettings(), {
      resolveFilenames: async () => new Map([["https://example.com/b", "episode.part02.rar"]])
    });

    expect(result.packages.map((pkg) => pkg.name)).toEqual(["Staffel A", "Staffel B"]);
    expect(result.packages.map((pkg) => pkg.links.length)).toEqual([1, 1]);
    expect(result.packages[0].links[0].fileName).toBe("episode.part01.rar");
    expect(result.packages[1].links[0].fileName).toBe("episode.part02.rar");
    expect(result.duplicateCount).toBe(1);
  });

  it("retains offline and unknown links as visible collector entries", async () => {
    const offline = "https://1fichier.com/?offline123";
    const unknown = "https://unknown.example/resource";
    const result = await inspectCollectorText({ rawText: `${offline}\n${unknown}`, addedAt: 3000 }, defaultSettings(), {
      checkOneFichier: async () => new Map([[offline, {
        online: false,
        fileName: "",
        fileSizeBytes: null,
        accessRestricted: false
      }]]),
      resolveFilenames: async () => new Map()
    });
    const links = result.packages.flatMap((pkg) => pkg.links);

    expect(links.find((link) => link.url === offline)).toEqual(expect.objectContaining({
      availability: "offline",
      status: "offline"
    }));
    expect(links.find((link) => link.url === unknown)).toEqual(expect.objectContaining({
      availability: "unknown",
      status: "unknown"
    }));
  });

  it("infers archive package names and serializes inspected metadata for the existing queue parser", () => {
    expect(inferCollectorPackageName("SBS14HD.part01.rar", "1fichier")).toBe("SBS14HD");
    expect(inferCollectorPackageName("Archive.7z.001", "1fichier")).toBe("Archive");
    expect(inferCollectorPackageName("Show.r00", "1fichier")).toBe("Show");

    const serialized = serializeCollectorPackages([{
      id: "package-1",
      name: "SBS14HD",
      addedAt: 4000,
      links: [{
        id: "link-1",
        url: sbsLinks[0],
        fileName: "SBS14HD.part01.rar",
        fileSizeBytes: 471_859_200,
        hoster: "1fichier",
        availability: "online",
        status: "ready",
        addedAt: 4000
      }]
    }]);

    expect(serialized).toBe(`# Package: SBS14HD\n# File: SBS14HD.part01.rar\n${sbsLinks[0]}`);
  });
});
