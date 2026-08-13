import { describe, expect, it } from "vitest";
import { defaultSettings } from "../src/main/constants";
import { validateRendererSettingsUpdate } from "../src/main/renderer-settings";
import { createRendererSettings } from "../src/main/renderer-state";

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

  it("accepts a complete renderer draft with an optional nested account status field omitted", () => {
    const current = defaultSettings();
    current.debridAccountStatuses = {
      "debridlink-key": {
        accountId: "debridlink-key",
        provider: "debridlink",
        label: "Debrid-Link",
        maskedLogin: "abc***xyz",
        valid: true,
        isPremium: true,
        premiumUntilMs: null,
        message: "Premium",
        checkedAt: 1
      }
    };
    const rendererDraft = createRendererSettings(current);

    const result = validateRendererSettingsUpdate(rendererDraft, current);

    expect(result.debridAccountStatuses).toEqual(rendererDraft.debridAccountStatuses);
  });
});
