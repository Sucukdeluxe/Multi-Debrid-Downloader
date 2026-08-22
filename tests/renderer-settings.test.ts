import { describe, expect, it } from "vitest";
import { defaultSettings } from "../src/main/constants";
import { createRendererSettings } from "../src/main/renderer-state";
import { validateRendererSettingsUpdate } from "../src/main/renderer-settings";

describe("renderer settings validation", () => {
  it("accepts every editable notification control while keeping the webhook write-only", () => {
    const current = { ...defaultSettings(), notifyUrl: "https://notify.example.test/private-hook" };
    const update = {
      notifyPackageSuccessMode: "individual",
      notifyOnRemainingBelow: true,
      notifyRemainingThresholdGb: 25,
      notifyOnDownloadStall: true,
      notifyStallAfterSeconds: 120,
      notifyStallCooldownMinutes: 15,
      notifyOnDownloadRecovery: false
    };
    const projected = createRendererSettings(current);

    expect(projected).not.toHaveProperty("notifyUrl");
    expect(projected.notifyUrlConfigured).toBe(true);
    expect(validateRendererSettingsUpdate(update, current)).toEqual(update);
  });

  it("accepts a complete settings save when an account status has no optional email", () => {
    const current = defaultSettings();
    current.debridAccountStatuses = {
      "svc-realdebrid": {
        accountId: "svc-realdebrid",
        provider: "realdebrid",
        label: "Real-Debrid",
        maskedLogin: "user",
        valid: true,
        isPremium: true,
        premiumUntilMs: null,
        username: "web-user",
        message: "Premium aktiv",
        checkedAt: 1_700_000_000_000
      }
    };
    const rendererSettings = createRendererSettings(current);

    expect(rendererSettings.debridAccountStatuses["svc-realdebrid"]).toHaveProperty("email", undefined);
    expect(rendererSettings.debridAccountStatuses["svc-realdebrid"]).toHaveProperty("username", "web-user");
    const validated = validateRendererSettingsUpdate(rendererSettings, current);

    expect(validated.debridAccountStatuses).toEqual(rendererSettings.debridAccountStatuses);
    expect(validated.animatePackageDisclosure).toBe(true);
    expect(validated).not.toHaveProperty("configuredProviders");
    expect(validated).not.toHaveProperty("archivePasswordListConfigured");
    expect(validated).not.toHaveProperty("notifyUrlConfigured");
  });

  it("ignores omitted optional top-level values but still rejects unknown concrete settings", () => {
    const current = defaultSettings();

    expect(validateRendererSettingsUpdate({ columnOrderVersion: undefined }, current)).toEqual({});
    expect(() => validateRendererSettingsUpdate({ obsoleteSetting: true }, current)).toThrow("Settings-Payload ist ungültig");
  });

  it("keeps archive passwords out of general renderer settings", () => {
    const password = "fixture-renderer-hidden-archive-password";
    const projected = createRendererSettings({ ...defaultSettings(), archivePasswordList: password });

    expect(projected.archivePasswordListConfigured).toBe(true);
    expect(JSON.stringify(projected)).not.toContain(password);
  });
});
