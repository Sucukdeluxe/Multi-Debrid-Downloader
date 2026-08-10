import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { mergeKnownTotalBytes } from "../src/main/download-size";

describe("download size transitions", () => {
  it("preserves a known metadata size when unrestrict has no replacement", () => {
    expect(mergeKnownTotalBytes(2_000, null)).toBe(2_000);
    expect(mergeKnownTotalBytes(2_000, 0)).toBe(2_000);
  });

  it("accepts a positive replacement size", () => {
    expect(mergeKnownTotalBytes(2_000, 2_500)).toBe(2_500);
    expect(mergeKnownTotalBytes(null, 2_500)).toBe(2_500);
  });

  it("applies the guarded merge to every unrestrict size transition", () => {
    const source = readFileSync(new URL("../src/main/download-manager.ts", import.meta.url), "utf8");

    expect(source).not.toContain("item.totalBytes = unrestricted.fileSize");
    expect(source.match(/item\.totalBytes = mergeKnownTotalBytes\(item\.totalBytes, unrestricted\.fileSize\)/g)).toHaveLength(2);
  });
});
