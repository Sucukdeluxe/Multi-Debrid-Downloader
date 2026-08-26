import { describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/main/constants";
import { createRendererSettings } from "../src/main/renderer-state";
import { validateRendererSettingsUpdate } from "../src/main/renderer-settings";

describe("renderer settings validation", () => {
  it("projects and validates the semantic theme preference independently from the resolved palette", () => {
    const current = { ...defaultSettings(), theme: "dark" as const, themePreference: "system" as const };
    const projected = createRendererSettings(current);

    expect(projected).toEqual(expect.objectContaining({ theme: "dark", themePreference: "system" }));
    expect(validateRendererSettingsUpdate({ theme: "light", themePreference: "system" }, current)).toEqual({
      theme: "light",
      themePreference: "system"
    });
    expect(() => validateRendererSettingsUpdate({ themePreference: "automatic" }, current)).toThrow("Settings-Payload ist ungültig");
  });

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

  it("rejects unsupported package success modes at the IPC boundary", () => {
    const current = defaultSettings();

    expect(validateRendererSettingsUpdate({ notifyPackageSuccessMode: "digest" }, current)).toEqual({ notifyPackageSuccessMode: "digest" });
    expect(validateRendererSettingsUpdate({ notifyPackageSuccessMode: "individual" }, current)).toEqual({ notifyPackageSuccessMode: "individual" });
    expect(() => validateRendererSettingsUpdate({ notifyPackageSuccessMode: "batched" }, current)).toThrow("Settings-Payload ist ungültig");
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

  it("projects daily start state and accepts only editable calendar controls", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 22, 9, 0));
    try {
      const current = {
        ...defaultSettings(),
        dailyStartEnabled: true,
        dailyStartMinuteOfDay: 18 * 60 + 45,
        dailyStartFirstLocalDate: "2026-08-23",
        dailyStartLastHandledLocalDate: "2026-08-22",
        dailyStartPendingLocalDate: "",
        dailyStartLastOutcome: "started" as const
      };
      const projected = createRendererSettings(current);

      expect(projected).toMatchObject({
        dailyStartEnabled: true,
        dailyStartMinuteOfDay: 18 * 60 + 45,
        dailyStartFirstLocalDate: "2026-08-23",
        dailyStartLastHandledLocalDate: "2026-08-22",
        dailyStartPendingLocalDate: "",
        dailyStartLastOutcome: "started"
      });
      expect(projected.nextDailyStartEpochMs).toBe(new Date(2026, 7, 23, 18, 45, 0, 0).getTime());
      expect(validateRendererSettingsUpdate({
        dailyStartEnabled: true,
        dailyStartMinuteOfDay: 7 * 60 + 30,
        dailyStartFirstLocalDate: "2026-08-24",
        dailyStartLastHandledLocalDate: "2026-08-23",
        dailyStartPendingLocalDate: "2026-08-24",
        dailyStartLastOutcome: "missed",
        nextDailyStartEpochMs: 123
      }, current)).toEqual({
        dailyStartEnabled: true,
        dailyStartMinuteOfDay: 7 * 60 + 30,
        dailyStartFirstLocalDate: "2026-08-24"
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects invalid editable daily calendar values at the renderer boundary", () => {
    const current = defaultSettings();

    expect(() => validateRendererSettingsUpdate({ dailyStartMinuteOfDay: 1_440 }, current)).toThrow("Settings-Payload ist ungültig");
    expect(() => validateRendererSettingsUpdate({ dailyStartMinuteOfDay: 12.5 }, current)).toThrow("Settings-Payload ist ungültig");
    expect(() => validateRendererSettingsUpdate({ dailyStartFirstLocalDate: "2026-02-29" }, current)).toThrow("Settings-Payload ist ungültig");
  });
});
