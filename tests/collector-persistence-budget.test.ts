import { describe, expect, it } from "vitest";
import {
  inspectCollectorPersistenceSize,
  type CollectorLink,
  type CollectorPackage,
  type CollectorPersistenceState
} from "../src/shared/collector";
import {
  advanceCollectorPersistenceBudget,
  createCollectorPersistenceBudget
} from "../src/renderer/views/collector/collector-persistence-budget";
import { mergeCollectorPackages } from "../src/renderer/views/collector/collector-model";

function link(id: string, url = `https://example.test/${id}`): CollectorLink {
  return {
    id,
    url,
    fileName: `${id}.bin`,
    fileSizeBytes: null,
    hoster: "example",
    availability: "unknown",
    status: "unknown",
    addedAt: 1
  };
}

function packageEntry(id: string, name: string, links: CollectorLink[]): CollectorPackage {
  return { id, name, nameSource: "explicit", links, addedAt: 1 };
}

function requiredByteCount(state: CollectorPersistenceState): number {
  const result = inspectCollectorPersistenceSize(state, Number.MAX_SAFE_INTEGER);
  if (!result.ok) throw new Error(result.message);
  return result.byteCount;
}

describe("collector persistence budget", () => {
  it("creates exact UTF-8 package and envelope accounting with one serialization per link", () => {
    const firstLink = link("link-ä");
    const secondLink = link("link-two");
    const plainFirst = packageEntry("package-ä", "Paket ä", [firstLink]);
    const plainSecond = packageEntry("package-two", "Paket 二", [secondLink]);
    const calls = new Map<string, number>();
    const tracked = (entry: CollectorLink): CollectorLink => Object.assign({}, entry, {
      toJSON: () => {
        calls.set(entry.id, (calls.get(entry.id) ?? 0) + 1);
        return entry;
      }
    });
    const state = {
      packages: [
        { ...plainFirst, links: [tracked(firstLink)] },
        { ...plainSecond, links: [tracked(secondLink)] }
      ],
      collapsedPackageIds: ["package-ä"]
    };
    const expectedState = { packages: [plainFirst, plainSecond], collapsedPackageIds: ["package-ä"] };
    const expectedBytes = requiredByteCount(expectedState);
    const result = createCollectorPersistenceBudget(state, expectedBytes);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.byteCount).toBe(expectedBytes);
    expect(result.nextBudget.byteCount).toBe(expectedBytes);
    expect(result.nextBudget.packageByteCounts).toEqual(new Map([
      [plainFirst.id, new TextEncoder().encode(JSON.stringify(plainFirst)).byteLength],
      [plainSecond.id, new TextEncoder().encode(JSON.stringify(plainSecond)).byteLength]
    ]));
    expect(result.nextBudget.packageBaseByteCounts).toBeInstanceOf(Map);
    expect(result.nextBudget.linkByteCounts).toBeInstanceOf(Map);
    expect(result.nextBudget.packageLinkCounts).toBeInstanceOf(Map);
    expect(result.nextBudget.packageBaseByteCounts.size).toBe(2);
    expect(result.nextBudget.linkByteCounts.size).toBe(2);
    expect(result.nextBudget.packageLinkCounts).toEqual(new Map([[plainFirst.id, 1], [plainSecond.id, 1]]));
    expect(calls).toEqual(new Map([[firstLink.id, 1], [secondLink.id, 1]]));
  });

  it("serializes only the changed link when advancing a 20,000-link package", () => {
    const plainLinks = Array.from({ length: 20_000 }, (_, index) => link(`large-${index}`));
    const calls = new Map<string, number>();
    const tracked = (entry: CollectorLink): CollectorLink => Object.assign({}, entry, {
      toJSON: () => {
        calls.set(entry.id, (calls.get(entry.id) ?? 0) + 1);
        return entry;
      }
    });
    const currentLinks = plainLinks.map(tracked);
    const currentPackage = packageEntry("large-package", "Großes Paket", currentLinks);
    const baseline = createCollectorPersistenceBudget({ packages: [currentPackage], collapsedPackageIds: [] });

    expect(baseline.ok).toBe(true);
    if (!baseline.ok) return;
    calls.clear();

    const changedIndex = 12_345;
    const changedPlainLink = { ...plainLinks[changedIndex], fileName: "angereichert.bin", availability: "online" as const, status: "ready" as const };
    const nextLinks = [...currentLinks];
    nextLinks[changedIndex] = tracked(changedPlainLink);
    const nextPackage = packageEntry("large-package", "Großes Paket", nextLinks);
    const expectedLinks = [...plainLinks];
    expectedLinks[changedIndex] = changedPlainLink;
    const expectedState = {
      packages: [packageEntry("large-package", "Großes Paket", expectedLinks)],
      collapsedPackageIds: []
    };
    const expectedBytes = requiredByteCount(expectedState);
    let result: ReturnType<typeof advanceCollectorPersistenceBudget> | undefined;
    let elapsedMs = Number.POSITIVE_INFINITY;

    expect(() => {
      const startedAt = performance.now();
      result = advanceCollectorPersistenceBudget(
        baseline.nextBudget,
        {
          links: [{
            url: changedPlainLink.url,
            previousPackageId: currentPackage.id,
            previousLink: currentLinks[changedIndex],
            nextPackageId: nextPackage.id,
            nextLink: nextLinks[changedIndex]
          }],
          packages: [{
            package: { id: nextPackage.id, name: nextPackage.name, nameSource: nextPackage.nameSource, addedAt: nextPackage.addedAt },
            linkCount: nextPackage.links.length
          }],
          removedPackageIds: [],
          packageCount: 1
        },
        []
      );
      elapsedMs = performance.now() - startedAt;
    }).not.toThrow();
    if (!result) return;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.byteCount).toBe(expectedBytes);
    expect([...calls.values()].reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(calls).toEqual(new Map([[changedPlainLink.id, 1]]));
    expect(elapsedMs).toBeLessThan(5);
  });

  it("updates moved links, package ids and comma bytes from the merge delta", () => {
    const first = link("first", "https://example.test/first");
    const second = link("second", "https://example.test/second");
    const pending = packageEntry("pending", "Pending", [first, second]);
    const untouched = packageEntry(
      "untouched",
      "Unberührt",
      Array.from({ length: 512 }, (_, index) => link(`bulk-${index}`))
    );
    const resolvedFirst = packageEntry("resolved-first", "Erstes Paket", [{ ...first, fileName: "Erstes Paket.bin" }]);
    const resolvedSecond = packageEntry("resolved-second", "Zweites Paket", [second]);
    const baselineState = { packages: [pending, untouched], collapsedPackageIds: [] };
    const baseline = createCollectorPersistenceBudget(baselineState);
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) return;
    const untouchedBytes = baseline.nextBudget.packageByteCounts.get(untouched.id);
    const merged = mergeCollectorPackages(baselineState.packages, [resolvedFirst, resolvedSecond]);
    const expectedState = {
      packages: merged.packages,
      collapsedPackageIds: ["resolved-second"]
    };
    const result = advanceCollectorPersistenceBudget(
      baseline.nextBudget,
      merged.persistenceDelta,
      expectedState.collapsedPackageIds
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.byteCount).toBe(requiredByteCount(expectedState));
    expect([...result.nextBudget.packageByteCounts.keys()].sort()).toEqual(["resolved-first", "resolved-second", "untouched"]);
    expect(result.nextBudget.packageByteCounts.get(untouched.id)).toBe(untouchedBytes);
  });

  it("atomically rejects enrichment that moves a skeleton over a configurable byte limit", () => {
    const skeletonPackage = packageEntry("stable-package", "x", [link("stable-link")]);
    const enrichedPackage = { ...skeletonPackage, name: "ä".repeat(1_024) };
    const skeletonState = { packages: [skeletonPackage], collapsedPackageIds: [] };
    const enrichedState = { packages: [enrichedPackage], collapsedPackageIds: [] };
    const skeletonBytes = requiredByteCount(skeletonState);
    const enrichedBytes = requiredByteCount(enrichedState);
    const maximumBytes = skeletonBytes + 1;
    const baseline = createCollectorPersistenceBudget(skeletonState, maximumBytes);

    expect(skeletonBytes).toBeLessThan(maximumBytes);
    expect(enrichedBytes).toBeGreaterThan(maximumBytes);
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) return;
    const originalPackageByteCounts = baseline.nextBudget.packageByteCounts;
    const originalEntries = [...originalPackageByteCounts];
    const result = advanceCollectorPersistenceBudget(
      baseline.nextBudget,
      {
        links: [],
        packages: [{
          package: {
            id: enrichedPackage.id,
            name: enrichedPackage.name,
            nameSource: enrichedPackage.nameSource,
            addedAt: enrichedPackage.addedAt
          },
          linkCount: enrichedPackage.links.length
        }],
        removedPackageIds: [],
        packageCount: 1
      },
      [],
      maximumBytes
    );

    expect(result).toEqual({
      ok: false,
      byteCount: enrichedBytes,
      message: "Der Linksammler ist zu groß, um gespeichert zu werden."
    });
    expect(baseline.nextBudget.byteCount).toBe(skeletonBytes);
    expect(baseline.nextBudget.packageByteCounts).toBe(originalPackageByteCounts);
    expect([...baseline.nextBudget.packageByteCounts]).toEqual(originalEntries);
  });
});
