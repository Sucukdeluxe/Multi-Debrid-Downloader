import { describe, expect, it } from "vitest";
import { sortPackageOrderByService } from "../src/renderer/App";

describe("download package sorting", () => {
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
