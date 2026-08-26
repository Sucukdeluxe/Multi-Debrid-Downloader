import { describe, expect, it } from "vitest";
import { validateCollectorPersistenceState } from "../src/shared/collector";
import {
  createCollectorPersistenceCoordinator,
  restoreCollectorPersistenceState
} from "../src/renderer/views/collector/collector-persistence";

const packageEntry = {
  id: "package-one",
  name: "Staffel Eins",
  nameSource: "explicit" as const,
  links: [{
    id: "link-one",
    url: "https://1fichier.com/?example",
    fileName: "episode.part01.rar",
    fileSizeBytes: 471_859_200,
    hoster: "1fichier",
    availability: "online" as const,
    status: "ready" as const,
    addedAt: 1_000
  }],
  addedAt: 1_000
};

describe("collector persistence payload", () => {
  it("accepts a complete state and prunes unknown collapsed package ids", () => {
    const input = { packages: [packageEntry], collapsedPackageIds: ["package-one", "missing", "package-one"] };

    expect(validateCollectorPersistenceState(input)).toEqual({
      packages: [packageEntry],
      collapsedPackageIds: ["package-one"]
    });
    expect(validateCollectorPersistenceState(input)).not.toBe(input);
  });

  it("accepts an empty collector without loosening the payload shape", () => {
    expect(validateCollectorPersistenceState({ packages: [], collapsedPackageIds: [] })).toEqual({ packages: [], collapsedPackageIds: [] });
    expect(() => validateCollectorPersistenceState({ packages: [], collapsedPackageIds: [], selectedLinkIds: [] })).toThrow("Linksammler-Speicherzustand ist ungültig");
  });

  it("rejects invalid packages and excessive queue sizes", () => {
    expect(() => validateCollectorPersistenceState({ packages: [{ ...packageEntry, name: "" }], collapsedPackageIds: [] })).toThrow("Linksammler-Speicherzustand ist ungültig");
    expect(() => validateCollectorPersistenceState({ packages: Array.from({ length: 2_001 }, () => packageEntry), collapsedPackageIds: [] })).toThrow("Linksammler-Speicherzustand ist ungültig");
  });
});

describe("collector persistence renderer flow", () => {
  it("merges a late restore with current imports and keeps collapse state from both sides", () => {
    const persisted = { packages: [packageEntry], collapsedPackageIds: ["package-one"] };
    const currentPackage = {
      ...packageEntry,
      id: "package-current",
      name: "Aktueller Import",
      links: [{ ...packageEntry.links[0], id: "link-current", url: "https://example.com/current" }]
    };

    expect(restoreCollectorPersistenceState(persisted, [currentPackage], new Set(["package-current"]))).toEqual({
      packages: [packageEntry, currentPackage],
      collapsedPackageIds: ["package-one", "package-current"]
    });
  });

  it("serializes saves and lets the newest queued state win", async () => {
    const saved: string[] = [];
    let releaseFirst: () => void = () => {};
    const coordinator = createCollectorPersistenceCoordinator(async (state) => {
      saved.push(state.packages[0]?.id || "empty");
      if (saved.length === 1) await new Promise<void>((resolve) => { releaseFirst = resolve; });
      return state;
    }, 0);

    coordinator.schedule({ packages: [{ ...packageEntry, id: "first" }], collapsedPackageIds: [] });
    const firstFlush = coordinator.flush();
    await Promise.resolve();
    coordinator.schedule({ packages: [{ ...packageEntry, id: "latest" }], collapsedPackageIds: [] });
    releaseFirst();
    await firstFlush;
    await coordinator.flush();

    expect(saved).toEqual(["first", "latest"]);
  });
});
