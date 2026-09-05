import { describe, expect, it } from "vitest";
import { sortPackageOrderByService } from "../src/renderer/App";
import { createAvailabilitySortCycle, sortPackageOrderByAvailability } from "../src/renderer/package-order";

describe("download package sorting", () => {
  it("sorts the Verfügbarkeit column from fully online through partial and unchecked down to fully offline", () => {
    const packages = {
      offline: { id: "offline", itemIds: ["offline-1", "offline-2"] },
      partialLow: { id: "partialLow", itemIds: ["low-1", "low-2", "low-3", "low-4"] },
      unchecked: { id: "unchecked", itemIds: ["unchecked-1"] },
      online: { id: "online", itemIds: ["online-1", "online-2"] },
      partialHigh: { id: "partialHigh", itemIds: ["high-1", "high-2", "high-3", "high-4"] },
      empty: { id: "empty", itemIds: [] }
    } as any;
    const items = {
      "offline-1": { status: "queued", onlineStatus: "offline" },
      "offline-2": { status: "queued", onlineStatus: "offline" },
      "low-1": { status: "queued", onlineStatus: "online" },
      "low-2": { status: "queued", onlineStatus: "offline" },
      "low-3": { status: "queued", onlineStatus: "offline" },
      "low-4": { status: "queued", onlineStatus: "offline" },
      "unchecked-1": { status: "queued", onlineStatus: undefined },
      "online-1": { status: "queued", onlineStatus: "online" },
      "online-2": { status: "completed", onlineStatus: undefined },
      "high-1": { status: "queued", onlineStatus: "online" },
      "high-2": { status: "queued", onlineStatus: "online" },
      "high-3": { status: "queued", onlineStatus: "online" },
      "high-4": { status: "queued", onlineStatus: "offline" }
    } as any;
    const order = ["offline", "partialLow", "unchecked", "online", "partialHigh", "empty"];

    expect(sortPackageOrderByAvailability(order, packages, items, false)).toEqual(["online", "partialHigh", "partialLow", "unchecked", "empty", "offline"]);
    expect(sortPackageOrderByAvailability(order, packages, items, true)).toEqual(["offline", "empty", "unchecked", "partialLow", "partialHigh", "online"]);
  });

  it("uses part counts only for equal availability, including offline and partial packages", () => {
    const definitions = [
      ["offlineSmall", 0, 2], ["onlineSmall", 2, 2], ["partialSmall", 1, 2],
      ["offlineLarge", 0, 8], ["onlineLarge", 8, 8], ["partialLarge", 4, 8],
      ["partialHigh", 3, 4], ["onlineEqual", 2, 2]
    ] as const;
    const packages: any = {};
    const items: any = {};
    for (const [id, online, total] of definitions) {
      const itemIds = Array.from({ length: total }, (_, index) => `${id}-${index}`);
      packages[id] = { id, itemIds };
      itemIds.forEach((itemId, index) => { items[itemId] = { status: "queued", onlineStatus: index < online ? "online" : "offline" }; });
    }
    const order = definitions.map(([id]) => id);
    expect(sortPackageOrderByAvailability(order, packages, items, false)).toEqual([
      "onlineLarge", "onlineSmall", "onlineEqual", "partialHigh", "partialLarge", "partialSmall", "offlineLarge", "offlineSmall"
    ]);
    expect(sortPackageOrderByAvailability(order, packages, items, true)).toEqual([
      "offlineSmall", "offlineLarge", "partialSmall", "partialLarge", "partialHigh", "onlineSmall", "onlineEqual", "onlineLarge"
    ]);
  });

  it("cycles online first, offline first, original order, then starts a new cycle", () => {
    const cycle = createAvailabilitySortCycle();
    const original = ["b", "a", "c"];
    expect(cycle.next(original).descending).toBe(false);
    expect(cycle.next(["a", "b", "c"]).descending).toBe(true);
    expect(cycle.next(["c", "b", "a"])).toEqual({ descending: null, order: original });
    expect(cycle.next(["new", "a"]).descending).toBe(false);
    expect(cycle.next(["a", "new"]).descending).toBe(true);
    expect(cycle.next(["a", "new"])).toEqual({ descending: null, order: ["new", "a"] });
  });

  it("restores surviving packages and appends new packages without resurrecting deletions", () => {
    const cycle = createAvailabilitySortCycle();
    const original = ["b", "a", "deleted"];
    cycle.next(original);
    original.reverse();
    cycle.next(["a", "b", "new"]);
    expect(cycle.next(["new", "a", "b", "newer"])).toEqual({ descending: null, order: ["b", "a", "new", "newer"] });
  });

  it("starts afresh after another column and handles an empty queue", () => {
    const cycle = createAvailabilitySortCycle();
    cycle.next(["old"]);
    cycle.reset();
    expect(cycle.next([])).toEqual({ descending: false, order: [] });
    cycle.next([]);
    expect(cycle.next([])).toEqual({ descending: null, order: [] });
  });

  it("sorts the Service column by its visible provider labels", () => {
    const packages = {
      a: { id: "a", itemIds: ["item-a"] },
      b: { id: "b", itemIds: ["item-b"] }
    } as any;
    const items = {
      "item-a": { provider: "realdebrid", providerLabel: "Real-Debrid" },
      "item-b": { provider: "debridlink", providerLabel: "Debrid-Link" }
    } as any;

    expect(sortPackageOrderByService(["a", "b"], packages, items, false)).toEqual(["b", "a"]);
    expect(sortPackageOrderByService(["a", "b"], packages, items, true)).toEqual(["a", "b"]);
  });

  it("uses filtered visible services instead of hidden package items", () => {
    const packages = {
      a: { id: "a", itemIds: ["a-hidden", "a-visible"] },
      b: { id: "b", itemIds: ["b-visible"] }
    } as any;
    const items = {
      "a-visible": { provider: "debridlink", providerLabel: "ZZZ Visible" },
      "a-hidden": { provider: "realdebrid", providerLabel: "AAA Hidden" },
      "b-visible": { provider: "realdebrid", providerLabel: "Real-Debrid" }
    } as any;

    expect(sortPackageOrderByService(["b", "a"], packages, items, false, {
      a: [items["a-visible"]],
      b: [items["b-visible"]]
    })).toEqual(["b", "a"]);
  });
});
