import { describe, expect, it } from "vitest";
import { defaultSettings } from "../src/main/constants";
import {
  applyAccountEdit,
  buildAccountEditCheckSettings,
  createAccountEditState,
  removeAccountTarget,
  validateAccountEdit,
  validateAccountEditStatuses,
  type AccountEditTarget
} from "../src/renderer/account-edit";
import { getDebridLinkApiKeyId } from "../src/shared/debrid-link-keys";
import { getMegaDebridAccountId } from "../src/shared/mega-debrid-accounts";

const GIB = 1024 * 1024 * 1024;

function megaTarget(login: string): AccountEditTarget {
  return {
    type: "mega",
    rowKey: `mega-${getMegaDebridAccountId(login)}`,
    kind: "megadebrid-api",
    service: "megadebrid-api",
    accountId: getMegaDebridAccountId(login)
  };
}

function debridLinkTarget(token: string): AccountEditTarget {
  return {
    type: "debridlink",
    rowKey: `dl-${getDebridLinkApiKeyId(token)}`,
    kind: "debridlink-api",
    service: "debridlink",
    keyId: getDebridLinkApiKeyId(token)
  };
}

describe("account-specific editing", () => {
  it("changes only the selected Mega-Debrid account and preserves sibling order and mode settings", () => {
    const oldId = getMegaDebridAccountId("second@example.com");
    const newId = getMegaDebridAccountId("renamed@example.com");
    const firstId = getMegaDebridAccountId("first@example.com");
    const settings = {
      ...defaultSettings(),
      megaCredentials: "first@example.com:first-pass\nsecond@example.com:second-pass\nthird@example.com:third-pass",
      megaLogin: "first@example.com",
      megaPassword: "first-pass",
      megaDebridApiEnabled: true,
      megaDebridWebEnabled: true,
      megaDebridPreferApi: false,
      megaDebridDisabledAccountIds: [oldId, firstId],
      megaDebridAccountDailyLimitBytes: { [oldId]: 15 * GIB, [firstId]: 9 * GIB },
      megaDebridAccountDailyUsageBytes: { [oldId]: 4 * GIB, [firstId]: 2 * GIB },
      megaDebridAccountTotalUsageBytes: { [oldId]: 40 * GIB, [firstId]: 20 * GIB },
      debridAccountStatuses: {
        [oldId]: { accountId: oldId, provider: "megadebrid" as const, label: "Account 2", maskedLogin: "se***om", valid: true, isPremium: true, premiumUntilMs: null, message: "OK", checkedAt: 1 },
        [firstId]: { accountId: firstId, provider: "megadebrid" as const, label: "Account 1", maskedLogin: "fi***om", valid: true, isPremium: true, premiumUntilMs: null, message: "OK", checkedAt: 1 }
      }
    };
    const state = {
      ...createAccountEditState(megaTarget("second@example.com"), settings),
      login: "renamed@example.com",
      password: "new-pass",
      dailyLimitGb: "25,5"
    };

    expect(validateAccountEdit(state, settings)).toBeNull();
    const next = applyAccountEdit(settings, state);

    expect(next.megaCredentials).toBe("first@example.com:first-pass\nrenamed@example.com:new-pass\nthird@example.com:third-pass");
    expect(next.megaLogin).toBe("first@example.com");
    expect(next.megaPassword).toBe("first-pass");
    expect(next.megaDebridApiEnabled).toBe(true);
    expect(next.megaDebridWebEnabled).toBe(true);
    expect(next.megaDebridPreferApi).toBe(false);
    expect(next.megaDebridDisabledAccountIds).toEqual([firstId, newId]);
    expect(next.megaDebridAccountDailyLimitBytes).toEqual({ [firstId]: 9 * GIB, [newId]: Math.floor(25.5 * GIB) });
    expect(next.megaDebridAccountDailyUsageBytes).toEqual({ [firstId]: 2 * GIB });
    expect(next.megaDebridAccountTotalUsageBytes).toEqual({ [firstId]: 20 * GIB });
    expect(next.debridAccountStatuses).toEqual({
      [firstId]: { accountId: firstId, provider: "megadebrid", label: "Account 1", maskedLogin: "fi***om", valid: true, isPremium: true, premiumUntilMs: null, message: "OK", checkedAt: 1 }
    });
  });

  it("keeps Mega-Debrid usage when only the password changes", () => {
    const id = getMegaDebridAccountId("user@example.com");
    const settings = {
      ...defaultSettings(),
      megaCredentials: "user@example.com:old-pass",
      megaLogin: "user@example.com",
      megaPassword: "old-pass",
      megaDebridAccountDailyLimitBytes: { [id]: 8 * GIB },
      megaDebridAccountDailyUsageBytes: { [id]: 3 * GIB },
      megaDebridAccountTotalUsageBytes: { [id]: 33 * GIB }
    };
    const state = { ...createAccountEditState(megaTarget("user@example.com"), settings), password: "new-pass" };
    const next = applyAccountEdit(settings, state);

    expect(next.megaCredentials).toBe("user@example.com:new-pass");
    expect(next.megaDebridAccountDailyUsageBytes).toEqual({ [id]: 3 * GIB });
    expect(next.megaDebridAccountTotalUsageBytes).toEqual({ [id]: 33 * GIB });
  });

  it("preserves exact account limits when the rounded display value is left unchanged", () => {
    const megaLogin = "user@example.com";
    const megaId = getMegaDebridAccountId(megaLogin);
    const key = "debrid-link-token";
    const keyId = getDebridLinkApiKeyId(key);
    const exactLimit = Math.floor(10.05 * GIB);
    const settings = {
      ...defaultSettings(),
      megaCredentials: `${megaLogin}:pass`,
      megaLogin,
      megaPassword: "pass",
      megaDebridAccountDailyLimitBytes: { [megaId]: exactLimit },
      debridLinkApiKeys: key,
      debridLinkApiKeyDailyLimitBytes: { [keyId]: exactLimit }
    };

    const megaNext = applyAccountEdit(settings, createAccountEditState(megaTarget(megaLogin), settings));
    const debridLinkNext = applyAccountEdit(settings, createAccountEditState(debridLinkTarget(key), settings));

    expect(megaNext.megaDebridAccountDailyLimitBytes[megaId]).toBe(exactLimit);
    expect(debridLinkNext.debridLinkApiKeyDailyLimitBytes[keyId]).toBe(exactLimit);
  });

  it("rejects whitespace-only Mega-Debrid passwords and empty or mismatched check results", () => {
    const login = "user@example.com";
    const settings = {
      ...defaultSettings(),
      megaCredentials: `${login}:pass`,
      megaLogin: login,
      megaPassword: "pass"
    };
    const state = { ...createAccountEditState(megaTarget(login), settings), password: "   " };

    expect(validateAccountEdit(state, settings)).toMatch(/Passwort/i);
    expect(validateAccountEditStatuses(state, [])).toMatch(/keinen Account/i);
    expect(validateAccountEditStatuses(state, [{
      accountId: "mda_other",
      provider: "megadebrid",
      label: "Account 1",
      maskedLogin: "ot***er",
      valid: true,
      isPremium: true,
      premiumUntilMs: null,
      message: "OK",
      checkedAt: 1
    }])).toMatch(/falschen Account/i);
  });

  it("rejects duplicate Mega-Debrid logins and missing row targets", () => {
    const settings = {
      ...defaultSettings(),
      megaCredentials: "first@example.com:first-pass\nsecond@example.com:second-pass"
    };
    const duplicate = {
      ...createAccountEditState(megaTarget("second@example.com"), settings),
      login: "first@example.com"
    };

    expect(validateAccountEdit(duplicate, settings)).toMatch(/bereits vorhanden/i);
    expect(() => createAccountEditState(megaTarget("missing@example.com"), settings)).toThrow(/nicht gefunden/i);
  });

  it("replaces only the selected Debrid-Link key and migrates its own metadata", () => {
    const keyA = "token-a";
    const keyB = "token-b";
    const keyC = "token-c";
    const newKey = "token-b-new";
    const idA = getDebridLinkApiKeyId(keyA);
    const idB = getDebridLinkApiKeyId(keyB);
    const idNew = getDebridLinkApiKeyId(newKey);
    const settings = {
      ...defaultSettings(),
      debridLinkApiKeys: `${keyA}\n${keyB}\n${keyC}`,
      debridLinkDisabledKeyIds: [idB, idA],
      debridLinkApiKeyDailyLimitBytes: { [idA]: 5 * GIB, [idB]: 10 * GIB },
      debridLinkApiKeyDailyUsageBytes: { [idA]: 2 * GIB, [idB]: 4 * GIB },
      debridLinkApiKeyTotalUsageBytes: { [idA]: 12 * GIB, [idB]: 24 * GIB }
    };
    const state = {
      ...createAccountEditState(debridLinkTarget(keyB), settings),
      token: newKey,
      dailyLimitGb: "12"
    };
    const next = applyAccountEdit(settings, state);

    expect(next.debridLinkApiKeys).toBe(`${keyA}\n${newKey}\n${keyC}`);
    expect(next.debridLinkDisabledKeyIds).toEqual([idA, idNew]);
    expect(next.debridLinkApiKeyDailyLimitBytes).toEqual({ [idA]: 5 * GIB, [idNew]: 12 * GIB });
    expect(next.debridLinkApiKeyDailyUsageBytes).toEqual({ [idA]: 2 * GIB });
    expect(next.debridLinkApiKeyTotalUsageBytes).toEqual({ [idA]: 12 * GIB });
  });

  it("edits a single login without changing unrelated credentials", () => {
    const settings = {
      ...defaultSettings(),
      ddownloadLogin: "old@example.com",
      ddownloadPassword: "old-pass",
      linkSnappyLogin: "keep@example.com",
      linkSnappyPassword: "keep-pass"
    };
    const target: AccountEditTarget = {
      type: "single",
      rowKey: "svc-ddownload",
      kind: "ddownload-login",
      service: "ddownload",
      provider: "ddownload"
    };
    const state = {
      ...createAccountEditState(target, settings),
      login: "new@example.com",
      password: "new-pass",
      dailyLimitGb: "7"
    };
    const next = applyAccountEdit(settings, state);

    expect(next.ddownloadLogin).toBe("new@example.com");
    expect(next.ddownloadPassword).toBe("new-pass");
    expect(next.linkSnappyLogin).toBe("keep@example.com");
    expect(next.linkSnappyPassword).toBe("keep-pass");
    expect(next.providerDailyLimitBytes.ddownload).toBe(7 * GIB);
  });

  it("rejects whitespace-only passwords for direct login accounts", () => {
    const settings = {
      ...defaultSettings(),
      ddownloadLogin: "user@example.com",
      ddownloadPassword: "password",
      linkSnappyLogin: "member@example.com",
      linkSnappyPassword: "secret"
    };
    const ddownloadTarget: AccountEditTarget = {
      type: "single",
      rowKey: "svc-ddownload",
      kind: "ddownload-login",
      service: "ddownload",
      provider: "ddownload"
    };
    const linkSnappyTarget: AccountEditTarget = {
      type: "single",
      rowKey: "svc-linksnappy",
      kind: "linksnappy-login",
      service: "linksnappy",
      provider: "linksnappy"
    };

    expect(validateAccountEdit({ ...createAccountEditState(ddownloadTarget, settings), password: "   " }, settings)).toMatch(/Passwort/i);
    expect(validateAccountEdit({ ...createAccountEditState(linkSnappyTarget, settings), password: "\t" }, settings)).toMatch(/Passwort/i);
  });

  it("builds a targeted check snapshot without invalid sibling accounts", () => {
    const settings = {
      ...defaultSettings(),
      megaCredentials: "first@example.com:first-pass\nsecond@example.com:second-pass",
      megaLogin: "first@example.com",
      megaPassword: "first-pass",
      debridLinkApiKeys: "one\ntwo"
    };
    const target = megaTarget("second@example.com");
    const state = createAccountEditState(target, settings);
    const checkSettings = buildAccountEditCheckSettings(settings, state);

    expect(checkSettings.megaCredentials).toBe("second@example.com:second-pass");
    expect(checkSettings.megaLogin).toBe("second@example.com");
    expect(checkSettings.megaPassword).toBe("second-pass");
    expect(checkSettings.debridLinkApiKeys).toBe("");
  });

  it("removes only the selected Mega-Debrid account and all metadata belonging to it", () => {
    const removeId = getMegaDebridAccountId("second@example.com");
    const keepId = getMegaDebridAccountId("first@example.com");
    const settings = {
      ...defaultSettings(),
      megaCredentials: "first@example.com:first-pass\nsecond@example.com:second-pass",
      megaLogin: "first@example.com",
      megaPassword: "first-pass",
      megaDebridDisabledAccountIds: [removeId, keepId],
      megaDebridAccountDailyLimitBytes: { [removeId]: 2, [keepId]: 1 },
      megaDebridAccountDailyUsageBytes: { [removeId]: 4, [keepId]: 3 },
      megaDebridAccountTotalUsageBytes: { [removeId]: 6, [keepId]: 5 },
      debridAccountStatuses: {
        [removeId]: { accountId: removeId, provider: "megadebrid" as const, label: "Account 2", maskedLogin: "se***om", valid: true, isPremium: false, premiumUntilMs: null, message: "Free", checkedAt: 1 },
        [keepId]: { accountId: keepId, provider: "megadebrid" as const, label: "Account 1", maskedLogin: "fi***om", valid: true, isPremium: true, premiumUntilMs: null, message: "OK", checkedAt: 1 }
      }
    };
    const next = removeAccountTarget(settings, megaTarget("second@example.com"));

    expect(next.megaCredentials).toBe("first@example.com:first-pass");
    expect(next.megaDebridDisabledAccountIds).toEqual([keepId]);
    expect(next.megaDebridAccountDailyLimitBytes).toEqual({ [keepId]: 1 });
    expect(next.megaDebridAccountDailyUsageBytes).toEqual({ [keepId]: 3 });
    expect(next.megaDebridAccountTotalUsageBytes).toEqual({ [keepId]: 5 });
    expect(next.debridAccountStatuses).toEqual({
      [keepId]: { accountId: keepId, provider: "megadebrid", label: "Account 1", maskedLogin: "fi***om", valid: true, isPremium: true, premiumUntilMs: null, message: "OK", checkedAt: 1 }
    });
  });
});
