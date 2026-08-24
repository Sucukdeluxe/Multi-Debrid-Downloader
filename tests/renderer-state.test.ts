import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { defaultSettings } from "../src/main/constants";
import { createRendererState } from "../src/main/renderer-state";
import { getDebridLinkApiKeyId } from "../src/shared/debrid-link-keys";
import { getMegaDebridAccountId } from "../src/shared/mega-debrid-accounts";
import { serializeRealDebridApiAccounts } from "../src/shared/real-debrid-accounts";
import type { AppSettings, RendererAccountKind } from "../src/shared/types";

const SECRETS = {
  token: "fixture-rd-token-7vQ2",
  megaPassword: "fixture-mega-password-8kM3",
  bestToken: "fixture-best-token-5xL9",
  allDebridToken: "fixture-ad-token-4pR6",
  ddownloadPassword: "fixture-dd-password-2tN8",
  oneFichierApiKey: "fixture-onefichier-key-6cW1",
  debridLinkApiKey: "fixture-debridlink-key-9hS4",
  linkSnappyPassword: "fixture-linksnappy-password-3mB7",
  archivePassword: "fixture-archive-password-1jD5",
  notifyUrl: "https://notify.example.test/hooks/fixture-notify-secret-0fA2"
} as const;

const ACCOUNT_FIXTURES: Array<{
  kind: RendererAccountKind;
  secret: string;
  settings: Partial<AppSettings>;
}> = [
  { kind: "realdebrid-api", secret: "fixture-rd-api-secret-1aK4", settings: { token: "fixture-rd-api-secret-1aK4" } },
  { kind: "realdebrid-web", secret: "fixture-rd-web-session-2bL5", settings: { token: "fixture-rd-web-session-2bL5", realDebridUseWebLogin: true } },
  { kind: "megadebrid-api", secret: "fixture-mega-api-secret-3cM6", settings: { megaCredentials: "mega-api@example.test:fixture-mega-api-secret-3cM6", megaDebridApiCredentials: "mega-api@example.test:fixture-mega-api-secret-3cM6", megaDebridApiEnabled: true } },
  { kind: "megadebrid-web", secret: "fixture-mega-web-secret-4dN7", settings: { megaCredentials: "mega-web@example.test:fixture-mega-web-secret-4dN7", megaDebridWebCredentials: "mega-web@example.test:fixture-mega-web-secret-4dN7", megaDebridWebEnabled: true } },
  { kind: "bestdebrid-api", secret: "fixture-best-api-secret-5eP8", settings: { bestToken: "fixture-best-api-secret-5eP8" } },
  { kind: "bestdebrid-web", secret: "fixture-best-web-session-6fQ9", settings: { bestToken: "fixture-best-web-session-6fQ9", bestDebridUseWebLogin: true } },
  { kind: "alldebrid-api", secret: "fixture-all-api-secret-7gR1", settings: { allDebridToken: "fixture-all-api-secret-7gR1" } },
  { kind: "alldebrid-web", secret: "fixture-all-web-session-8hS2", settings: { allDebridToken: "fixture-all-web-session-8hS2", allDebridUseWebLogin: true } },
  { kind: "ddownload-login", secret: "fixture-dd-secret-9jT3", settings: { ddownloadLogin: "dd@example.test", ddownloadPassword: "fixture-dd-secret-9jT3" } },
  { kind: "onefichier-api", secret: "fixture-one-secret-0kU4", settings: { oneFichierApiKey: "fixture-one-secret-0kU4" } },
  { kind: "debridlink-api", secret: "fixture-dl-secret-1mV5", settings: { debridLinkApiKeys: "fixture-dl-secret-1mV5" } },
  { kind: "linksnappy-login", secret: "fixture-ls-secret-2nW6", settings: { linkSnappyLogin: "ls@example.test", linkSnappyPassword: "fixture-ls-secret-2nW6" } }
];

describe("renderer state serialization", () => {
  it("projects notification controls with their safe defaults", () => {
    expect(createRendererState(defaultSettings()).settings).toEqual(expect.objectContaining({
      notifyPackageSuccessMode: "digest",
      notifyOnRemainingBelow: false,
      notifyRemainingThresholdGb: 50,
      notifyOnDownloadStall: false,
      notifyStallAfterSeconds: 90,
      notifyStallCooldownMinutes: 10,
      notifyOnDownloadRecovery: true
    }));
  });

  it("projects distinct Real-Debrid API and Web rows with per-account state", () => {
    const firstToken = "fixture-renderer-rd-first-1aB2";
    const secondToken = "fixture-renderer-rd-second-3cD4";
    const firstId = "rda_rendererFirst";
    const secondId = "rda_rendererSecond";
    const settings = {
      ...defaultSettings(),
      realDebridApiTokens: serializeRealDebridApiAccounts([{ id: firstId, token: firstToken }, { id: secondId, token: secondToken }]),
      realDebridWebAccountIds: ["rdw_first"],
      realDebridDisabledAccountIds: [secondId],
      realDebridAccountDailyLimitBytes: { [firstId]: 100 },
      realDebridAccountDailyUsageBytes: { [firstId]: 25 },
      realDebridAccountTotalUsageBytes: { [firstId]: 500 },
      debridAccountStatuses: {
        [firstId]: { accountId: firstId, provider: "realdebrid" as const, label: "API-Token 1", maskedLogin: "Geschützter API-Token", valid: true, isPremium: true, premiumUntilMs: null, message: "Premium aktiv", checkedAt: 1 }
      }
    };
    const state = createRendererState(settings);
    const realDebridRows = state.accounts.filter((account) => account.provider === "realdebrid");

    expect(realDebridRows).toEqual([
      expect.objectContaining({ accountId: firstId, kind: "realdebrid-api", enabled: true, dailyLimitBytes: 100, dailyUsageBytes: 25, totalUsageBytes: 500, status: expect.objectContaining({ accountId: firstId }) }),
      expect.objectContaining({ accountId: secondId, kind: "realdebrid-api", enabled: false }),
      expect.objectContaining({ accountId: "rdw_first", kind: "realdebrid-web", enabled: true })
    ]);
    expect(JSON.stringify(state)).not.toContain(firstToken);
    expect(JSON.stringify(state)).not.toContain(secondToken);
    expect(realDebridRows[0].accountId).not.toBe(`rda_${crypto.createHash("sha256").update(firstToken).digest("hex").slice(0, 32)}`);
  });
  it.each(ACCOUNT_FIXTURES)("serializes $kind without its representative secret", ({ kind, secret, settings }) => {
    const state = createRendererState({ ...defaultSettings(), ...settings });

    expect(state.accounts).toEqual(expect.arrayContaining([expect.objectContaining({ kind, hasSecret: true })]));
    expect(JSON.stringify(state)).not.toContain(secret);
    expect(JSON.stringify(state.settings)).not.toContain(secret);
  });

  it("excludes every provider and settings secret while preserving safe account metadata", () => {
    const megaLogin = "renderer-fixture@example.test";
    const settings = {
      ...defaultSettings(),
      token: SECRETS.token,
      megaLogin,
      megaPassword: SECRETS.megaPassword,
      megaCredentials: `${megaLogin}:${SECRETS.megaPassword}`,
      megaDebridApiCredentials: `${megaLogin}:${SECRETS.megaPassword}`,
      megaDebridApiEnabled: true,
      bestToken: SECRETS.bestToken,
      allDebridToken: SECRETS.allDebridToken,
      ddownloadLogin: "renderer-dd@example.test",
      ddownloadPassword: SECRETS.ddownloadPassword,
      oneFichierApiKey: SECRETS.oneFichierApiKey,
      debridLinkApiKeys: SECRETS.debridLinkApiKey,
      linkSnappyLogin: "renderer-linksnappy@example.test",
      linkSnappyPassword: SECRETS.linkSnappyPassword,
      archivePasswordList: SECRETS.archivePassword,
      notifyUrl: SECRETS.notifyUrl
    };

    const state = createRendererState(settings);
    const serialized = JSON.stringify(state);

    for (const secret of Object.values(SECRETS)) {
      expect(serialized).not.toContain(secret);
    }
    expect(state.settings.archivePasswordListConfigured).toBe(true);
    expect(state.settings.notifyUrlConfigured).toBe(true);
    expect(state.accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "realdebrid-api", hasSecret: true }),
      expect.objectContaining({ kind: "megadebrid-api", identity: megaLogin, hasSecret: true }),
      expect.objectContaining({ kind: "debridlink-api", hasSecret: true })
    ]));
  });

  it("redacts individual secrets embedded in status metadata for multi-account pools", () => {
    const firstMegaSecret = "fixture-first-mega-pool-secret-3pX7";
    const secondMegaSecret = "fixture-second-mega-pool-secret-4qY8";
    const firstKey = "fixture-first-debridlink-pool-secret-5rZ9";
    const secondKey = "fixture-second-debridlink-pool-secret-6sA1";
    const secondMegaId = getMegaDebridAccountId("second-pool@example.test");
    const secondKeyId = getDebridLinkApiKeyId(secondKey);
    const settings = {
      ...defaultSettings(),
      megaCredentials: `first-pool@example.test:${firstMegaSecret}\nsecond-pool@example.test:${secondMegaSecret}`,
      megaDebridApiCredentials: `first-pool@example.test:${firstMegaSecret}\nsecond-pool@example.test:${secondMegaSecret}`,
      megaDebridApiEnabled: true,
      debridLinkApiKeys: `${firstKey}\n${secondKey}`,
      debridAccountStatuses: {
        [secondMegaId]: {
          accountId: secondMegaId,
          provider: "megadebrid" as const,
          label: "Account 2",
          maskedLogin: "se***st",
          valid: false,
          isPremium: false,
          premiumUntilMs: null,
          message: `Rejected ${secondMegaSecret}`,
          checkedAt: 1
        },
        [secondKeyId]: {
          accountId: secondKeyId,
          provider: "debridlink" as const,
          label: "Key 2",
          maskedLogin: "fi***A1",
          valid: false,
          isPremium: false,
          premiumUntilMs: null,
          message: `Rejected ${secondKey}`,
          checkedAt: 1
        }
      }
    };

    const serialized = JSON.stringify(createRendererState(settings));

    for (const secret of [firstMegaSecret, secondMegaSecret, firstKey, secondKey]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("exposes only non-secret Real-Debrid account controls to the renderer", () => {
    const settings = {
      ...defaultSettings(),
      realDebridApiTokens: JSON.stringify({ version: 1, accounts: [{ id: "rda_visible", token: "fixture-rd-secret" }] }),
      realDebridDisabledAccountIds: ["rda_visible"],
      realDebridAccountDailyLimitBytes: { rda_visible: 10_000 },
      realDebridAccountDailyUsageBytes: { rda_visible: 2_000 },
      realDebridAccountTotalUsageBytes: { rda_visible: 8_000 }
    };

    const renderer = createRendererState(settings).settings;

    expect(renderer.realDebridDisabledAccountIds).toEqual(["rda_visible"]);
    expect(renderer.realDebridAccountDailyLimitBytes).toEqual({ rda_visible: 10_000 });
    expect(renderer.realDebridAccountDailyUsageBytes).toEqual({ rda_visible: 2_000 });
    expect(renderer.realDebridAccountTotalUsageBytes).toEqual({ rda_visible: 8_000 });
    expect(JSON.stringify(renderer)).not.toContain("fixture-rd-secret");
    expect(renderer).not.toHaveProperty("realDebridApiTokens");
    expect(renderer).not.toHaveProperty("realDebridWebAccountIds");
  });
});
