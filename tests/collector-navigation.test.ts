import { describe, expect, it } from "vitest";
import { shouldFocusCollectorImport } from "../src/renderer/collector-navigation";

describe("collector import navigation", () => {
  it("keeps automatic clipboard imports in the background unless explicitly enabled", () => {
    expect(shouldFocusCollectorImport("clipboard", undefined)).toBe(false);
    expect(shouldFocusCollectorImport("clipboard", false)).toBe(false);
    expect(shouldFocusCollectorImport("clipboard", true)).toBe(true);
  });

  it("keeps explicit manual imports focused regardless of the automatic setting", () => {
    for (const enabled of [undefined, false, true]) {
      expect(shouldFocusCollectorImport("manual", enabled)).toBe(true);
    }
  });
});
