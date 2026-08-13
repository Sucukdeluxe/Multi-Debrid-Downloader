import { describe, expect, it } from "vitest";
import { defaultSettings } from "../src/main/constants";
import { validateRendererSettingsUpdate } from "../src/main/renderer-settings";

describe("renderer settings validation", () => {
  it("ignores undefined optional fields from a stale renderer draft", () => {
    const result = validateRendererSettingsUpdate({
      columnOrderVersion: undefined,
      megaDebridApiEnabled: false,
      megaDebridWebEnabled: false,
      debridLinkDisabledKeyIds: []
    }, defaultSettings());

    expect(result).toEqual({
      megaDebridApiEnabled: false,
      megaDebridWebEnabled: false,
      debridLinkDisabledKeyIds: []
    });
  });
});
