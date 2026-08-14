import { describe, expect, it } from "vitest";
import { applyAccountCommand, validateAccountCommand, validateAccountCredentialCheckInput } from "../src/main/account-commands";
import * as accountCommands from "../src/main/account-commands";
import { defaultSettings } from "../src/main/constants";
import { getDebridLinkApiKeyId } from "../src/shared/debrid-link-keys";
import { getMegaDebridAccountId } from "../src/shared/mega-debrid-accounts";
import type { AppSettings, RendererAccountKind } from "../src/shared/types";

const ORIGINAL_SECRET = "fixture-original-secret-4qV8";
const REPLACEMENT_SECRET = "fixture-replacement-secret-6nC2";
const GIB = 1024 * 1024 * 1024;

const SECRET_RETAIN_CASES: Array<{
  kind: RendererAccountKind;
  identity: string;
  secret: string;
  retained: (settings: AppSettings) => boolean;
}> = [
  { kind: "realdebrid-api", identity: "", secret: "fixture-retain-rd-1aC3", retained: (settings) => settings.token === "fixture-retain-rd-1aC3" },
  { kind: "megadebrid-api", identity: "retain-mega-api@example.test", secret: "fixture-retain-mega-api-2bD4", retained: (settings) => settings.megaDebridApiCredentials === "retain-mega-api@example.test:fixture-retain-mega-api-2bD4" },
  { kind: "megadebrid-web", identity: "retain-mega-web@example.test", secret: "fixture-retain-mega-web-3cE5", retained: (settings) => settings.megaDebridWebCredentials === "retain-mega-web@example.test:fixture-retain-mega-web-3cE5" },
  { kind: "bestdebrid-api", identity: "", secret: "fixture-retain-best-4dF6", retained: (settings) => settings.bestToken === "fixture-retain-best-4dF6" },
  { kind: "alldebrid-api", identity: "", secret: "fixture-retain-all-5eG7", retained: (settings) => settings.allDebridToken === "fixture-retain-all-5eG7" },
  { kind: "ddownload-login", identity: "retain-dd@example.test", secret: "fixture-retain-dd-6fH8", retained: (settings) => settings.ddownloadPassword === "fixture-retain-dd-6fH8" },
  { kind: "onefichier-api", identity: "", secret: "fixture-retain-one-7gJ9", retained: (settings) => settings.oneFichierApiKey === "fixture-retain-one-7gJ9" },
  { kind: "debridlink-api", identity: "", secret: "fixture-retain-dl-8hK1", retained: (settings) => settings.debridLinkApiKeys === "fixture-retain-dl-8hK1" },
  { kind: "linksnappy-login", identity: "retain-ls@example.test", secret: "fixture-retain-ls-9jL2", retained: (settings) => settings.linkSnappyPassword === "fixture-retain-ls-9jL2" }
];

const ACCOUNT_KINDS: RendererAccountKind[] = [
  "realdebrid-api",
  "realdebrid-web",
  "megadebrid-api",
  "megadebrid-web",
  "bestdebrid-api",
  "bestdebrid-web",
  "alldebrid-api",
  "alldebrid-web",
  "ddownload-login",
  "onefichier-api",
  "debridlink-api",
  "linksnappy-login"
];

describe("write-only account commands", () => {
  it("reveals only the exact explicitly requested stored account secret", () => {
    const api = accountCommands as typeof accountCommands & {
      resolveStoredAccountSecret?: (settings: AppSettings, request: { kind: RendererAccountKind; accountId: string }) => string;
      validateAccountSecretRequest?: (value: unknown) => { kind: RendererAccountKind; accountId: string };
    };
    const megaIdentity = "reveal-mega@example.test";
    const megaId = getMegaDebridAccountId(megaIdentity);
    const settings = {
      ...defaultSettings(),
      token: "fixture-reveal-rd-1aB2",
      megaDebridApiCredentials: `${megaIdentity}:fixture-reveal-mega-3cD4`,
      debridLinkApiKeys: "fixture-reveal-dl-5eF6",
      bestToken: "fixture-reveal-best-7gH8",
      allDebridToken: "fixture-reveal-all-9iJ1",
      ddownloadLogin: "reveal-dd@example.test",
      ddownloadPassword: "fixture-reveal-dd-2kL3",
      oneFichierApiKey: "fixture-reveal-one-4mN5",
      linkSnappyLogin: "reveal-ls@example.test",
      linkSnappyPassword: "fixture-reveal-ls-6pQ7"
    };

    expect(api.resolveStoredAccountSecret).toBeTypeOf("function");
    expect(api.validateAccountSecretRequest).toBeTypeOf("function");
    expect(api.resolveStoredAccountSecret?.(settings, { kind: "realdebrid-api", accountId: "svc-realdebrid" })).toBe("fixture-reveal-rd-1aB2");
    expect(api.resolveStoredAccountSecret?.(settings, { kind: "megadebrid-api", accountId: megaId })).toBe("fixture-reveal-mega-3cD4");
    expect(api.resolveStoredAccountSecret?.(settings, { kind: "debridlink-api", accountId: getDebridLinkApiKeyId("fixture-reveal-dl-5eF6") })).toBe("fixture-reveal-dl-5eF6");
    expect(api.resolveStoredAccountSecret?.(settings, { kind: "bestdebrid-api", accountId: "svc-bestdebrid" })).toBe("fixture-reveal-best-7gH8");
    expect(api.resolveStoredAccountSecret?.(settings, { kind: "alldebrid-api", accountId: "svc-alldebrid" })).toBe("fixture-reveal-all-9iJ1");
    expect(api.resolveStoredAccountSecret?.(settings, { kind: "ddownload-login", accountId: "svc-ddownload" })).toBe("fixture-reveal-dd-2kL3");
    expect(api.resolveStoredAccountSecret?.(settings, { kind: "onefichier-api", accountId: "svc-onefichier" })).toBe("fixture-reveal-one-4mN5");
    expect(api.resolveStoredAccountSecret?.(settings, { kind: "linksnappy-login", accountId: "svc-linksnappy" })).toBe("fixture-reveal-ls-6pQ7");
    expect(() => api.resolveStoredAccountSecret?.(settings, { kind: "megadebrid-api", accountId: "missing" })).toThrow(/nicht gefunden/i);
    expect(() => api.validateAccountSecretRequest?.({ kind: "realdebrid-api", accountId: "svc-realdebrid", secret: "not-allowed" })).toThrow(/ungültig/i);
  });

  it.each(["realdebrid-api", "realdebrid-web"] as const)("accepts %s credential checks at the IPC boundary", (kind) => {
    expect(validateAccountCredentialCheckInput({ kind, accountId: "svc-realdebrid" })).toEqual({
      kind,
      accountId: "svc-realdebrid",
      identity: undefined,
      secret: undefined
    });
  });

  it.each([
    ["realdebrid-api", "", "fixture-rd-provider-secret-1fA4", "token"],
    ["realdebrid-web", "", "", "realDebridUseWebLogin"],
    ["bestdebrid-api", "", "fixture-best-provider-secret-2gB5", "bestToken"],
    ["bestdebrid-web", "", "", "bestDebridUseWebLogin"],
    ["alldebrid-api", "", "fixture-ad-provider-secret-3hC6", "allDebridToken"],
    ["alldebrid-web", "", "", "allDebridUseWebLogin"],
    ["ddownload-login", "dd-safe@example.test", "fixture-dd-provider-secret-4jD7", "ddownloadPassword"],
    ["onefichier-api", "", "fixture-one-provider-secret-5kE8", "oneFichierApiKey"],
    ["linksnappy-login", "ls-safe@example.test", "fixture-ls-provider-secret-6mF9", "linkSnappyPassword"]
  ] as const)("preserves create and delete behavior for %s", (kind, identity, secret, configuredKey) => {
    const created = applyAccountCommand(defaultSettings(), validateAccountCommand({
      action: "create",
      kind,
      identity,
      secret,
      dailyLimitBytes: 4_294_967_296
    }));

    expect(created.settings[configuredKey]).toBe(secret || true);
    expect(JSON.stringify(created.response)).not.toContain(secret || "fixture-never-present");

    const deleted = applyAccountCommand(created.settings, validateAccountCommand({
      action: "delete",
      kind,
      accountId: created.response.accountId
    }));

    expect(deleted.settings[configuredKey]).toBe(secret ? "" : false);
  });

  it("creates an account without returning submitted secrets", () => {
    const command = validateAccountCommand({
      action: "create",
      kind: "megadebrid-api",
      identity: "new-account@example.test",
      secret: ORIGINAL_SECRET,
      dailyLimitBytes: 12_884_901_888
    });
    const result = applyAccountCommand(defaultSettings(), command);

    expect(result.settings.megaDebridApiCredentials).toContain(ORIGINAL_SECRET);
    expect(JSON.stringify(result.response)).not.toContain(ORIGINAL_SECRET);
    expect(result.response.accountId).toBe(getMegaDebridAccountId("new-account@example.test"));
  });

  it("adds a Web Mega-Debrid account without copying it into the API pool or changing preferApi", () => {
    const result = applyAccountCommand({
      ...defaultSettings(),
      megaCredentials: "api@example.test:fixture-api-secret-1aM2",
      megaDebridApiCredentials: "api@example.test:fixture-api-secret-1aM2",
      megaDebridWebCredentials: "",
      megaDebridApiEnabled: true,
      megaDebridWebEnabled: false,
      megaDebridPreferApi: false
    }, validateAccountCommand({
      action: "create",
      kind: "megadebrid-web",
      identity: "web@example.test",
      secret: "fixture-web-secret-3bN4",
      dailyLimitBytes: 0
    }));

    expect(result.settings.megaDebridApiCredentials).toBe("api@example.test:fixture-api-secret-1aM2");
    expect(result.settings.megaDebridWebCredentials).toBe("web@example.test:fixture-web-secret-3bN4");
    expect(result.settings.megaDebridApiEnabled).toBe(true);
    expect(result.settings.megaDebridWebEnabled).toBe(true);
    expect(result.settings.megaDebridPreferApi).toBe(false);
    expect(JSON.stringify(result.response)).not.toContain("fixture-web-secret-3bN4");
  });

  it("retains a stored secret when replace receives a blank secret", () => {
    const identity = "existing-account@example.test";
    const accountId = getMegaDebridAccountId(identity);
    const settings = {
      ...defaultSettings(),
      megaCredentials: `${identity}:${ORIGINAL_SECRET}`,
      megaDebridApiCredentials: `${identity}:${ORIGINAL_SECRET}`,
      megaDebridApiEnabled: true
    };
    const command = validateAccountCommand({
      action: "replace",
      kind: "megadebrid-api",
      accountId,
      identity: "renamed-account@example.test",
      secret: "",
      dailyLimitBytes: 8_589_934_592
    });
    const result = applyAccountCommand(settings, command);

    expect(result.settings.megaDebridApiCredentials).toBe(`renamed-account@example.test:${ORIGINAL_SECRET}`);
    expect(JSON.stringify(result.response)).not.toContain(ORIGINAL_SECRET);
  });

  it.each(SECRET_RETAIN_CASES)("retains the stored $kind secret when replace receives a blank secret", ({ kind, identity, secret, retained }) => {
    const created = applyAccountCommand(defaultSettings(), validateAccountCommand({
      action: "create",
      kind,
      identity,
      secret,
      dailyLimitBytes: 1
    }));
    const replaced = applyAccountCommand(created.settings, validateAccountCommand({
      action: "replace",
      kind,
      accountId: created.response.accountId,
      identity,
      secret: "",
      dailyLimitBytes: 1
    }));

    expect(retained(replaced.settings)).toBe(true);
    expect(JSON.stringify(replaced.response)).not.toContain(secret);
  });

  it("replaces a Mega-Debrid account while preserving sibling accounts and mode-specific state", () => {
    const firstId = getMegaDebridAccountId("first@example.test");
    const oldId = getMegaDebridAccountId("second@example.test");
    const newId = getMegaDebridAccountId("renamed@example.test");
    const webId = getMegaDebridAccountId("web@example.test");
    const settings = {
      ...defaultSettings(),
      megaCredentials: "first@example.test:first-secret\nsecond@example.test:second-secret\nweb@example.test:web-secret",
      megaDebridApiCredentials: "first@example.test:first-secret\nsecond@example.test:second-secret",
      megaDebridWebCredentials: "web@example.test:web-secret",
      megaDebridApiEnabled: true,
      megaDebridWebEnabled: true,
      megaDebridPreferApi: false,
      megaDebridDisabledAccountIds: [oldId, firstId, webId],
      megaDebridApiDisabledAccountIds: [oldId, firstId],
      megaDebridWebDisabledAccountIds: [webId],
      megaDebridAccountDailyLimitBytes: { [oldId]: 15 * GIB, [firstId]: 9 * GIB },
      megaDebridAccountDailyUsageBytes: { [oldId]: 4 * GIB, [firstId]: 2 * GIB },
      megaDebridAccountTotalUsageBytes: { [oldId]: 40 * GIB, [firstId]: 20 * GIB },
      debridAccountStatuses: {
        [oldId]: { accountId: oldId, provider: "megadebrid" as const, label: "Account 2", maskedLogin: "se***st", valid: true, isPremium: true, premiumUntilMs: null, message: "OK", checkedAt: 1 },
        [firstId]: { accountId: firstId, provider: "megadebrid" as const, label: "Account 1", maskedLogin: "fi***st", valid: true, isPremium: true, premiumUntilMs: null, message: "OK", checkedAt: 1 }
      }
    };
    const result = applyAccountCommand(settings, validateAccountCommand({
      action: "replace",
      kind: "megadebrid-api",
      accountId: oldId,
      identity: "renamed@example.test",
      secret: "renamed-secret",
      dailyLimitBytes: Math.floor(25.5 * GIB)
    }));

    expect(result.settings.megaDebridApiCredentials).toBe("first@example.test:first-secret\nrenamed@example.test:renamed-secret");
    expect(result.settings.megaDebridWebCredentials).toBe("web@example.test:web-secret");
    expect(result.settings.megaDebridPreferApi).toBe(false);
    expect(result.settings.megaDebridDisabledAccountIds).toEqual([firstId, newId, webId]);
    expect(result.settings.megaDebridApiDisabledAccountIds).toEqual([firstId, newId]);
    expect(result.settings.megaDebridWebDisabledAccountIds).toEqual([webId]);
    expect(result.settings.megaDebridAccountDailyLimitBytes).toEqual({ [firstId]: 9 * GIB, [newId]: Math.floor(25.5 * GIB) });
    expect(result.settings.megaDebridAccountDailyUsageBytes).toEqual({ [firstId]: 2 * GIB });
    expect(result.settings.megaDebridAccountTotalUsageBytes).toEqual({ [firstId]: 20 * GIB });
    expect(result.settings.debridAccountStatuses).toEqual({
      [firstId]: { accountId: firstId, provider: "megadebrid", label: "Account 1", maskedLogin: "fi***st", valid: true, isPremium: true, premiumUntilMs: null, message: "OK", checkedAt: 1 }
    });
    expect(JSON.stringify(result.response)).not.toContain("renamed-secret");
  });

  it("replaces only the selected Debrid-Link key and migrates its own metadata", () => {
    const keyA = "fixture-dl-key-a-1aB2";
    const keyB = "fixture-dl-key-b-3cD4";
    const keyC = "fixture-dl-key-c-5eF6";
    const newKey = "fixture-dl-key-b-new-7gH8";
    const idA = getDebridLinkApiKeyId(keyA);
    const idB = getDebridLinkApiKeyId(keyB);
    const idNew = getDebridLinkApiKeyId(newKey);
    const result = applyAccountCommand({
      ...defaultSettings(),
      debridLinkApiKeys: `${keyA}\n${keyB}\n${keyC}`,
      debridLinkDisabledKeyIds: [idB, idA],
      debridLinkApiKeyDailyLimitBytes: { [idA]: 5 * GIB, [idB]: 10 * GIB },
      debridLinkApiKeyDailyUsageBytes: { [idA]: 2 * GIB, [idB]: 4 * GIB },
      debridLinkApiKeyTotalUsageBytes: { [idA]: 12 * GIB, [idB]: 24 * GIB }
    }, validateAccountCommand({
      action: "replace",
      kind: "debridlink-api",
      accountId: idB,
      secret: newKey,
      dailyLimitBytes: 12 * GIB
    }));

    expect(result.settings.debridLinkApiKeys).toBe(`${keyA}\n${newKey}\n${keyC}`);
    expect(result.settings.debridLinkDisabledKeyIds).toEqual([idA, idNew]);
    expect(result.settings.debridLinkApiKeyDailyLimitBytes).toEqual({ [idA]: 5 * GIB, [idNew]: 12 * GIB });
    expect(result.settings.debridLinkApiKeyDailyUsageBytes).toEqual({ [idA]: 2 * GIB });
    expect(result.settings.debridLinkApiKeyTotalUsageBytes).toEqual({ [idA]: 12 * GIB });
    expect(JSON.stringify(result.response)).not.toContain(newKey);
  });

  it("keeps a matching Web identity disabled when its API identity is deleted", () => {
    const identity = "shared-mode@example.test";
    const accountId = getMegaDebridAccountId(identity);
    const settings = {
      ...defaultSettings(),
      megaCredentials: `${identity}:fixture-api-mode-secret-1mN3`,
      megaDebridApiCredentials: `${identity}:fixture-api-mode-secret-1mN3`,
      megaDebridWebCredentials: `${identity}:fixture-web-mode-secret-2nP4`,
      megaDebridApiEnabled: true,
      megaDebridWebEnabled: true,
      megaDebridDisabledAccountIds: [accountId],
      megaDebridApiDisabledAccountIds: [accountId],
      megaDebridWebDisabledAccountIds: [accountId]
    };

    const deleted = applyAccountCommand(settings, validateAccountCommand({
      action: "delete",
      kind: "megadebrid-api",
      accountId
    }));

    expect(deleted.settings.megaDebridApiCredentials).toBe("");
    expect(deleted.settings.megaDebridWebCredentials).toBe(`${identity}:fixture-web-mode-secret-2nP4`);
    expect(deleted.settings.megaDebridApiDisabledAccountIds).toEqual([]);
    expect(deleted.settings.megaDebridWebDisabledAccountIds).toEqual([accountId]);
    expect(deleted.settings.megaDebridDisabledAccountIds).toEqual([accountId]);
  });

  it("updates only the selected secret and deletes only the selected account", () => {
    const firstIdentity = "first-account@example.test";
    const secondIdentity = "second-account@example.test";
    const firstId = getMegaDebridAccountId(firstIdentity);
    const secondId = getMegaDebridAccountId(secondIdentity);
    const settings = {
      ...defaultSettings(),
      megaCredentials: `${firstIdentity}:${ORIGINAL_SECRET}\n${secondIdentity}:fixture-sibling-secret-3wH7`,
      megaDebridApiCredentials: `${firstIdentity}:${ORIGINAL_SECRET}\n${secondIdentity}:fixture-sibling-secret-3wH7`,
      megaDebridApiEnabled: true
    };
    const updated = applyAccountCommand(settings, validateAccountCommand({
      action: "update-secret",
      kind: "megadebrid-api",
      accountId: firstId,
      secret: REPLACEMENT_SECRET
    }));
    const deleted = applyAccountCommand(updated.settings, validateAccountCommand({
      action: "delete",
      kind: "megadebrid-api",
      accountId: firstId
    }));

    expect(updated.settings.megaDebridApiCredentials).toContain(`${firstIdentity}:${REPLACEMENT_SECRET}`);
    expect(deleted.settings.megaDebridApiCredentials).toBe(`${secondIdentity}:fixture-sibling-secret-3wH7`);
    expect(deleted.response.accountId).toBe(secondId);
    expect(JSON.stringify([updated.response, deleted.response])).not.toContain(REPLACEMENT_SECRET);
  });

  it("creates and deletes a Debrid-Link API key by stable key identity", () => {
    const secret = "fixture-dl-create-delete-1pQ4";
    const created = applyAccountCommand(defaultSettings(), validateAccountCommand({
      action: "create",
      kind: "debridlink-api",
      secret,
      dailyLimitBytes: 3 * GIB
    }));

    expect(created.response.accountId).toBe(getDebridLinkApiKeyId(secret));
    expect(created.settings.debridLinkApiKeys).toBe(secret);
    expect(created.settings.debridLinkApiKeyDailyLimitBytes).toEqual({ [getDebridLinkApiKeyId(secret)]: 3 * GIB });
    expect(JSON.stringify(created.response)).not.toContain(secret);

    const deleted = applyAccountCommand(created.settings, validateAccountCommand({
      action: "delete",
      kind: "debridlink-api",
      accountId: created.response.accountId
    }));

    expect(deleted.settings.debridLinkApiKeys).toBe("");
    expect(deleted.settings.debridLinkApiKeyDailyLimitBytes).toEqual({});
    expect(deleted.response.accountId).toBeNull();
  });

  it("rejects malformed payloads without echoing submitted secrets", () => {
    let errorText = "";
    try {
      validateAccountCommand({
        action: "replace",
        kind: "megadebrid-api",
        accountId: 42,
        secret: REPLACEMENT_SECRET
      });
    } catch (error) {
      errorText = String(error);
    }

    expect(errorText).toMatch(/ungültig/i);
    expect(errorText).not.toContain(REPLACEMENT_SECRET);
  });

  it.each(ACCOUNT_KINDS)("rejects malformed %s payloads without echoing their submitted secret", (kind) => {
    const secret = `fixture-malformed-${kind}-3qR5`;
    let errorText = "";
    try {
      validateAccountCommand({ action: "replace", kind, accountId: 42, secret });
    } catch (error) {
      errorText = String(error);
    }

    expect(errorText).toMatch(/ungültig/i);
    expect(errorText).not.toContain(secret);
  });
});
