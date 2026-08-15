import { describe, expect, it } from "vitest";
import { defaultSettings } from "../src/main/constants";
import { overlayLiveUsageCounters } from "../src/main/settings-live-overlay";
import { getDebridLinkApiKeyId } from "../src/shared/debrid-link-keys";
import { getMegaDebridAccountId } from "../src/shared/mega-debrid-accounts";
import { serializeRealDebridApiAccounts } from "../src/shared/real-debrid-accounts";

describe("live settings overlay", () => {
  it("keeps only live Real-Debrid status and usage for accounts still configured", () => {
    const keepToken = "fixture-overlay-rd-keep";
    const removedToken = "fixture-overlay-rd-removed";
    const keepId = "rda_overlayKeep";
    const removedId = "rda_overlayRemoved";
    const target = { ...defaultSettings(), realDebridApiTokens: serializeRealDebridApiAccounts([{ id: keepId, token: keepToken }]) };
    const status = (accountId: string) => ({ accountId, provider: "realdebrid" as const, label: "Real-Debrid", maskedLogin: "Geschützt", valid: true, isPremium: true, premiumUntilMs: null, message: "Premium aktiv", checkedAt: 1 });
    const live = {
      ...defaultSettings(),
      realDebridApiTokens: serializeRealDebridApiAccounts([{ id: keepId, token: keepToken }, { id: removedId, token: removedToken }]),
      realDebridAccountDailyUsageBytes: { [keepId]: 10, [removedId]: 20 },
      realDebridAccountTotalUsageBytes: { [keepId]: 100, [removedId]: 200 },
      debridAccountStatuses: { [keepId]: status(keepId), [removedId]: status(removedId) }
    };

    overlayLiveUsageCounters(target, live, 1);

    expect(target.realDebridAccountDailyUsageBytes).toEqual({ [keepId]: 10 });
    expect(target.realDebridAccountTotalUsageBytes).toEqual({ [keepId]: 100 });
    expect(target.debridAccountStatuses).toEqual({ [keepId]: status(keepId) });
  });
  it("keeps current Mega-Debrid counters and drops data for identities no longer configured", () => {
    const keepMegaId = getMegaDebridAccountId("keep@example.com");
    const removedMegaId = getMegaDebridAccountId("removed@example.com");
    const keepKeyId = getDebridLinkApiKeyId("keep-key");
    const removedKeyId = getDebridLinkApiKeyId("removed-key");
    const target = {
      ...defaultSettings(),
      megaCredentials: "keep@example.com:pass",
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
        [removedMegaId]: { accountId: removedMegaId, provider: "megadebrid" as const, label: "Account 2", maskedLogin: "re***om", valid: true, isPremium: true, premiumUntilMs: null, message: "OK", checkedAt: 1 },
        [keepKeyId]: { accountId: keepKeyId, provider: "debridlink" as const, label: "Key 1", maskedLogin: "kee***key", valid: true, isPremium: false, premiumUntilMs: null, message: "Free", checkedAt: 1 },
        [removedKeyId]: { accountId: removedKeyId, provider: "debridlink" as const, label: "Key 2", maskedLogin: "rem***key", valid: true, isPremium: false, premiumUntilMs: null, message: "Free", checkedAt: 1 }
      }
    };

    overlayLiveUsageCounters(target, live, 9_000);

    expect(target.megaDebridAccountDailyUsageBytes).toEqual({ [keepMegaId]: 300 });
    expect(target.megaDebridAccountTotalUsageBytes).toEqual({ [keepMegaId]: 3_000 });
    expect(target.debridLinkApiKeyDailyUsageBytes).toEqual({ [keepKeyId]: 500 });
    expect(target.debridLinkApiKeyTotalUsageBytes).toEqual({ [keepKeyId]: 5_000 });
    expect(Object.keys(target.debridAccountStatuses).sort()).toEqual([keepKeyId, keepMegaId].sort());
    expect(target.totalRuntimeAllTimeMs).toBe(9_000);
  });

  it("keeps the Real-Debrid service status while the browser account remains configured", () => {
    const target = {
      ...defaultSettings(),
      realDebridUseWebLogin: true
    };
    const live = {
      ...target,
      debridAccountStatuses: {
        "svc-realdebrid": {
          accountId: "svc-realdebrid",
          provider: "realdebrid" as const,
          label: "Real-Debrid",
          maskedLogin: "Browser-Login",
          valid: true,
          isPremium: true,
          premiumUntilMs: null,
          message: "Premium aktiv",
          checkedAt: 1
        }
      }
    };

    overlayLiveUsageCounters(target, live, 9_000);

    expect(target.debridAccountStatuses["svc-realdebrid"]).toEqual(live.debridAccountStatuses["svc-realdebrid"]);
  });
});
