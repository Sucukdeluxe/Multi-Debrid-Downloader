import { describe, expect, it } from "vitest";
import { normalizeExtractNowRequest } from "../src/shared/extract-now";

describe("extract now request", () => {
  it("deduplicates package and item targets while preserving their order", () => {
    expect(normalizeExtractNowRequest({
      packageIds: ["pkg-2", "pkg-1", "pkg-2"],
      itemIds: ["item-2", "item-1", "item-2"]
    })).toEqual({
      packageIds: ["pkg-2", "pkg-1"],
      itemIds: ["item-2", "item-1"]
    });
  });

  it("rejects empty, malformed and oversized selections", () => {
    expect(() => normalizeExtractNowRequest({ packageIds: [], itemIds: [] })).toThrow(/mindestens/i);
    expect(() => normalizeExtractNowRequest({ packageIds: ["pkg"], itemIds: [4] })).toThrow(/itemIds/i);
    expect(() => normalizeExtractNowRequest({ packageIds: Array.from({ length: 2001 }, (_, index) => `pkg-${index}`), itemIds: [] })).toThrow(/höchstens/i);
    expect(() => normalizeExtractNowRequest({ packageIds: Array.from({ length: 2001 }, () => "pkg"), itemIds: [] })).toThrow(/höchstens/i);
    expect(() => normalizeExtractNowRequest({ packageIds: ["p".repeat(257)], itemIds: [] })).toThrow(/Länge/i);
    expect(() => normalizeExtractNowRequest({ packageIds: ["pkg"], itemIds: [], extra: true })).toThrow(/unbekannt/i);
    expect(() => normalizeExtractNowRequest(null)).toThrow(/Objekt/i);
  });
});
