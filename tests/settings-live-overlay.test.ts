import { describe, expect, it } from "vitest";
import { defaultSettings } from "../src/main/constants";
import { overlayLiveUsageCounters } from "../src/main/settings-live-overlay";
import { getDebridLinkApiKeyId } from "../src/shared/debrid-link-keys";
import { getMegaDebridAccountId } from "../src/shared/mega-debrid-accounts";

describe("live settings overlay", () => {
  it("keeps current Mega-Debrid counters and drops data for identities no longer configured", () => {
    const keepMegaId = getMegaDebridAccountId("keep@example.com");
    const removedMegaId = getMegaDebridAccountId("removed@example.com");
    const keepMegaApiStatusId = `${keepMegaId}:api`;
    const keepMegaWebStatusId = `${keepMegaId}:web`;
    const removedMegaApiStatusId = `${removedMegaId}:api`;
    const keepKeyId = getDebridLinkApiKeyId("keep-key");
    const removedKeyId = getDebridLinkApiKeyId("removed-key");
    const target = {
      ...defaultSettings(),
      megaDebridApiCredentials: "keep@example.com:api-pass",
      megaDebridWebCredentials: "keep@example.com:web-pass",
      megaLogin: "keep@example.com",
      megaPassword: "pass",
      debridLinkApiKeys: "keep-key",
      megaDebridAccountDailyUsageBytes: { [keepMegaId]: 1 },
      megaDebridAccountTotalUsageBytes: { [keepMegaId]: 2 }
    };
    const live = {
      ...defaultSettings(),
      megaCredentials: "keep@example.com:pass\nremoved@example.com:pass",
      debridLinkApiKeys: "keep-key\nremoved-key",
      megaDebridAccountDailyUsageBytes: { [keepMegaId]: 300, [removedMegaId]: 400 },
      megaDebridAccountTotalUsageBytes: { [keepMegaId]: 3_000, [removedMegaId]: 4_000 },
      debridLinkApiKeyDailyUsageBytes: { [keepKeyId]: 500, [removedKeyId]: 600 },
      debridLinkApiKeyTotalUsageBytes: { [keepKeyId]: 5_000, [removedKeyId]: 6_000 },
      debridAccountStatuses: {
        [keepMegaId]: { accountId: keepMegaId, provider: "megadebrid" as const, label: "Account 1", maskedLogin: "ke***om", valid: true, isPremium: true, premiumUntilMs: null, message: "OK", checkedAt: 1 },
        [keepMegaApiStatusId]: { accountId: keepMegaApiStatusId, provider: "megadebrid" as const, label: "Account 1", maskedLogin: "ke***om", valid: false, isPremium: false, premiumUntilMs: null, message: "API ungültig", checkedAt: 2 },
        [keepMegaWebStatusId]: { accountId: keepMegaWebStatusId, provider: "megadebrid" as const, label: "Account 1", maskedLogin: "ke***om", valid: true, isPremium: true, premiumUntilMs: null, message: "Web gültig", checkedAt: 3 },
        [removedMegaId]: { accountId: removedMegaId, provider: "megadebrid" as const, label: "Account 2", maskedLogin: "re***om", valid: true, isPremium: true, premiumUntilMs: null, message: "OK", checkedAt: 1 },
        [removedMegaApiStatusId]: { accountId: removedMegaApiStatusId, provider: "megadebrid" as const, label: "Account 2", maskedLogin: "re***om", valid: true, isPremium: true, premiumUntilMs: null, message: "API gültig", checkedAt: 2 },
        [keepKeyId]: { accountId: keepKeyId, provider: "debridlink" as const, label: "Key 1", maskedLogin: "kee***key", valid: true, isPremium: false, premiumUntilMs: null, message: "Free", checkedAt: 1 },
        [removedKeyId]: { accountId: removedKeyId, provider: "debridlink" as const, label: "Key 2", maskedLogin: "rem***key", valid: true, isPremium: false, premiumUntilMs: null, message: "Free", checkedAt: 1 }
      }
    };

    overlayLiveUsageCounters(target, live, 9_000);

    expect(target.megaDebridAccountDailyUsageBytes).toEqual({ [keepMegaId]: 300 });
    expect(target.megaDebridAccountTotalUsageBytes).toEqual({ [keepMegaId]: 3_000 });
    expect(target.debridLinkApiKeyDailyUsageBytes).toEqual({ [keepKeyId]: 500 });
    expect(target.debridLinkApiKeyTotalUsageBytes).toEqual({ [keepKeyId]: 5_000 });
    expect(Object.keys(target.debridAccountStatuses).sort()).toEqual([
      keepKeyId,
      keepMegaId,
      keepMegaApiStatusId,
      keepMegaWebStatusId
    ].sort());
    expect(target.debridAccountStatuses[keepMegaApiStatusId]?.message).toBe("API ungültig");
    expect(target.debridAccountStatuses[keepMegaWebStatusId]?.message).toBe("Web gültig");
    expect(target.totalRuntimeAllTimeMs).toBe(9_000);
  });
});
