import { describe, expect, it } from "vitest";
import { sortPackageOrderByService } from "../src/renderer/App";
import { sortPackageOrderByAvailability } from "../src/renderer/package-order";

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
    expect(sortPackageOrderByAvailability(order, packages, items, true)).toEqual(["offline", "unchecked", "empty", "partialLow", "partialHigh", "online"]);
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
