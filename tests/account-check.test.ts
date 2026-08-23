import { describe, it, expect, vi, afterEach } from "vitest";
import { ALL_DEBRID_STATUS_ID, checkAllDebridAccount, checkMegaDebridAccount, checkDebridLinkKey, checkAllDebridAccounts, checkRealDebridAccount, REAL_DEBRID_STATUS_ID, retainConfiguredRealDebridStatuses } from "../src/main/account-check";
import type { MegaDebridAccountEntry } from "../src/shared/mega-debrid-accounts";
import { getDebridLinkApiKeyId, type DebridLinkApiKeyEntry } from "../src/shared/debrid-link-keys";
import type { AppSettings } from "../src/shared/types";
import { defaultSettings } from "../src/main/constants";
import { getMegaDebridAccountId } from "../src/shared/mega-debrid-accounts";
import { getRealDebridAccounts, serializeRealDebridApiAccounts } from "../src/shared/real-debrid-accounts";

function megaAccount(login = "user@example.com"): MegaDebridAccountEntry {
  return { id: "mda_test", login, password: "pw", index: 0, label: "Account 1", maskedLogin: "us**le" };
}

function debridLinkKey(token = "tok_abcdef"): DebridLinkApiKeyEntry {
  return { id: "dlk_test", token, index: 0, label: "Key 1", masked: "tok***def" };
}

function mockFetchOnce(status: number, body: unknown): void {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => text
  })) as unknown as typeof fetch);
}

const NOW = 1_700_000_000_000;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkMegaDebridAccount", () => {
  it("reports valid + premium from vip_end (future Unix ts)", async () => {
    const futureSec = Math.floor(NOW / 1000) + 30 * 24 * 60 * 60;
    mockFetchOnce(200, { response_code: "ok", response_text: "User logged", token: "t", vip_end: String(futureSec), email: "a@b.de" });
    const st = await checkMegaDebridAccount(megaAccount(), undefined, NOW);
    expect(st.valid).toBe(true);
    expect(st.isPremium).toBe(true);
    expect(st.premiumUntilMs).toBe(futureSec * 1000);
    expect(st.email).toBe("a@b.de");
    expect(st.message).toMatch(/Premium noch/);
  });

  it("reports valid but NOT premium when vip_end is in the past", async () => {
    const pastSec = Math.floor(NOW / 1000) - 1000;
    mockFetchOnce(200, { response_code: "ok", token: "t", vip_end: String(pastSec) });
    const st = await checkMegaDebridAccount(megaAccount(), undefined, NOW);
    expect(st.valid).toBe(true);
    expect(st.isPremium).toBe(false);
  });

  it("reports valid but no premium when vip_end is 0/missing", async () => {
    mockFetchOnce(200, { response_code: "ok", token: "t", vip_end: "0" });
    const st = await checkMegaDebridAccount(megaAccount(), undefined, NOW);
    expect(st.valid).toBe(true);
    expect(st.isPremium).toBe(false);
    expect(st.premiumUntilMs).toBe(0);
    expect(st.message).toMatch(/Kein Premium/);
  });

  it("reports invalid login when response_code != ok", async () => {
    mockFetchOnce(200, { response_code: "error", response_text: "bad login" });
    const st = await checkMegaDebridAccount(megaAccount(), undefined, NOW);
    expect(st.valid).toBe(false);
    expect(st.isPremium).toBe(false);
    expect(st.message).toMatch(/Ungueltiger Login/);
  });

  it("reports invalid on HTTP error", async () => {
    mockFetchOnce(500, "server error");
    const st = await checkMegaDebridAccount(megaAccount(), undefined, NOW);
    expect(st.valid).toBe(false);
  });

  it("never throws on network error — returns a failed status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch);
    const st = await checkMegaDebridAccount(megaAccount(), undefined, NOW);
    expect(st.valid).toBe(false);
    expect(st.message).toMatch(/Pruefung fehlgeschlagen/);
  });
});

describe("checkDebridLinkKey", () => {
  it("reports valid + premium from premiumLeft seconds", async () => {
    const premiumLeft = 60 * 24 * 60 * 60;
    mockFetchOnce(200, { success: true, value: { username: "u", email: "u@example.test", accountType: 1, premiumLeft } });
    const st = await checkDebridLinkKey(debridLinkKey(), undefined, NOW);
    expect(st.valid).toBe(true);
    expect(st.isPremium).toBe(true);
    expect(st.premiumUntilMs).toBe(NOW + premiumLeft * 1000);
    expect(st.username).toBe("u");
    expect(st.email).toBe("u@example.test");
  });

  it("does not present a Debrid-Link username as an email address", async () => {
    mockFetchOnce(200, { success: true, value: { username: "xsucukde5", accountType: 0, premiumLeft: 0 } });
    const st = await checkDebridLinkKey(debridLinkKey(), undefined, NOW);
    expect(st.username).toBe("xsucukde5");
    expect(st.email).toBeUndefined();
  });

  it("reports valid but free (premiumLeft 0, accountType 0)", async () => {
    mockFetchOnce(200, { success: true, value: { username: "u", accountType: 0, premiumLeft: 0 } });
    const st = await checkDebridLinkKey(debridLinkKey(), undefined, NOW);
    expect(st.valid).toBe(true);
    expect(st.isPremium).toBe(false);
    expect(st.message).toMatch(/Free/);
  });

  it("reports invalid key on HTTP 401", async () => {
    mockFetchOnce(401, { success: false, error: "badToken" });
    const st = await checkDebridLinkKey(debridLinkKey(), undefined, NOW);
    expect(st.valid).toBe(false);
    expect(st.message).toMatch(/Ungueltiger API-Key/);
  });

  it("reports invalid key when success=false", async () => {
    mockFetchOnce(200, { success: false, error: "badToken" });
    const st = await checkDebridLinkKey(debridLinkKey(), undefined, NOW);
    expect(st.valid).toBe(false);
  });
});

describe("checkRealDebridAccount", () => {
  it("keys every API account status by its concrete pool identity", async () => {
    const token = "rd-api-pool-token";
    mockFetchOnce(200, { username: "api-user", type: "premium", expiration: new Date(NOW + 100_000).toISOString() });
    const account = getRealDebridAccounts({ realDebridApiTokens: serializeRealDebridApiAccounts([{ id: "rda_checkOpaque", token }]) })[0];
    const status = await checkRealDebridAccount(account, undefined, NOW);
    expect(status.accountId).toBe("rda_checkOpaque");
  });
  it("keeps browser-session username and email in separate status fields", async () => {
    const premiumUntilMs = NOW + 30 * 24 * 60 * 60 * 1000;
    const probe = vi.fn(async () => ({
      valid: true,
      isPremium: true,
      premiumUntilMs,
      username: "web-user",
      email: "web-user@example.test"
    }));

    const status = await checkRealDebridAccount({
      token: "",
      realDebridUseWebLogin: true
    } as AppSettings, undefined, NOW, probe);

    expect(probe).toHaveBeenCalledTimes(1);
    expect(status).toMatchObject({
      accountId: REAL_DEBRID_STATUS_ID,
      provider: "realdebrid",
      valid: true,
      isPremium: true,
      premiumUntilMs,
      username: "web-user",
      email: "web-user@example.test"
    });
  });

  it("keeps API username and email in separate status fields", async () => {
    mockFetchOnce(200, {
      username: "api-user",
      email: "api-user@example.test",
      type: "premium",
      expiration: new Date(NOW + 30 * 24 * 60 * 60 * 1000).toISOString()
    });

    const status = await checkRealDebridAccount({
      token: "rd-api-token",
      realDebridUseWebLogin: false
    } as AppSettings, undefined, NOW);

    expect(status).toMatchObject({
      accountId: REAL_DEBRID_STATUS_ID,
      provider: "realdebrid",
      valid: true,
      username: "api-user",
      email: "api-user@example.test"
    });
  });
});

describe("checkAllDebridAccount", () => {
  it("reads identity and premium expiry from the official user endpoint", async () => {
    const premiumUntilSec = Math.floor(NOW / 1000) + 30 * 24 * 60 * 60;
    mockFetchOnce(200, {
      status: "success",
      data: {
        user: {
          username: "all-user",
          email: "all-user@example.test",
          isPremium: true,
          premiumUntil: premiumUntilSec
        }
      }
    });

    const status = await checkAllDebridAccount("all-api-key", undefined, NOW);

    expect(status).toMatchObject({
      accountId: ALL_DEBRID_STATUS_ID,
      provider: "alldebrid",
      valid: true,
      isPremium: true,
      premiumUntilMs: premiumUntilSec * 1000,
      username: "all-user",
      email: "all-user@example.test"
    });
    expect(fetch).toHaveBeenCalledWith("https://api.alldebrid.com/v4/user", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer all-api-key" })
    }));
  });

  it("reports authentication errors without accepting the API key", async () => {
    mockFetchOnce(401, {
      status: "error",
      error: { code: "AUTH_BAD_APIKEY", message: "The auth apikey is invalid" }
    });

    const status = await checkAllDebridAccount("bad-key", undefined, NOW);

    expect(status).toMatchObject({
      accountId: ALL_DEBRID_STATUS_ID,
      provider: "alldebrid",
      valid: false,
      isPremium: false,
      message: "Ungültiger API-Key"
    });
  });
});

describe("checkAllDebridAccounts", () => {
  it("checks configured AllDebrid in all scope and only when enabled in active scope", async () => {
    const settings = {
      ...defaultSettings(),
      allDebridToken: "all-api-key",
      disabledProviders: ["alldebrid" as const]
    };
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        status: "success",
        data: { user: { username: "all-user", email: "all@example.test", isPremium: true, premiumUntil: 4_102_444_800 } }
      })
    })) as unknown as typeof fetch);

    const active = await checkAllDebridAccounts(settings, undefined, undefined, "active");
    const all = await checkAllDebridAccounts(settings, undefined, undefined, "all");

    expect(active).toEqual([]);
    expect(all).toEqual([expect.objectContaining({ accountId: ALL_DEBRID_STATUS_ID, provider: "alldebrid", valid: true })]);
  });
  it("discards a late Real-Debrid result after its account was removed", () => {
    const removedId = "rda_removedAfterCheck";
    const lateStatus = { accountId: removedId, provider: "realdebrid" as const, label: "API-Token 1", maskedLogin: "Geschützt", valid: true, isPremium: true, premiumUntilMs: null, message: "Premium aktiv", checkedAt: NOW };
    expect(retainConfiguredRealDebridStatuses(defaultSettings(), [lateStatus])).toEqual([]);
  });
  it("checks only enabled Real-Debrid pool entries in active scope and all entries in all scope", async () => {
    const firstToken = "rd-pool-active";
    const secondToken = "rd-pool-disabled";
    const activeId = "rda_poolActive";
    const disabledId = "rda_poolDisabled";
    const settings = {
      ...defaultSettings(),
      realDebridApiTokens: serializeRealDebridApiAccounts([{ id: activeId, token: firstToken }, { id: disabledId, token: secondToken }]),
      realDebridWebAccountIds: ["rdw_first", "rdw_second"],
      realDebridDisabledAccountIds: [disabledId, "rdw_second"]
    };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ username: "api", type: "premium" }) })) as unknown as typeof fetch);
    const probedAccountIds: string[] = [];
    const probe = vi.fn(async (accountId: string) => {
      probedAccountIds.push(accountId);
      return { valid: true, isPremium: true, username: "web" };
    });

    const active = await checkAllDebridAccounts(settings, undefined, probe, "active");
    const all = await checkAllDebridAccounts(settings, undefined, probe, "all");

    expect(active.map((status) => status.accountId)).toEqual([activeId, "rdw_first"]);
    expect(all.map((status) => status.accountId)).toEqual([activeId, disabledId, "rdw_first", "rdw_second"]);
    expect(probedAccountIds).toEqual(["rdw_first", "rdw_first", "rdw_second"]);
  });
  it("returns empty array when nothing configured", async () => {
    const settings = { megaCredentials: "", megaPassword: "", debridLinkApiKeys: "" } as unknown as AppSettings;
    const result = await checkAllDebridAccounts(settings);
    expect(result).toEqual([]);
  });

  it("includes Real-Debrid web login in the bulk account check", async () => {
    const settings = {
      token: "",
      realDebridUseWebLogin: true,
      megaCredentials: "",
      megaPassword: "",
      debridLinkApiKeys: ""
    } as AppSettings;
    const probe = vi.fn(async () => ({ valid: true, isPremium: true, username: "web-user" }));

    const result = await checkAllDebridAccounts(settings, undefined, probe);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      accountId: REAL_DEBRID_STATUS_ID,
      provider: "realdebrid",
      valid: true
    });
  });

  it("checks every configured mega account + debrid-link key", async () => {
    const futureSec = Math.floor(Date.now() / 1000) + 1000;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("mega-debrid")) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ response_code: "ok", token: "t", vip_end: String(futureSec) }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, value: { accountType: 1, premiumLeft: 1000 } }) };
    }) as unknown as typeof fetch);

    const settings = {
      megaCredentials: "a@b.de:pw1\nc@d.de:pw2",
      megaPassword: "",
      debridLinkApiKeys: "key1\nkey2\nkey3"
    } as unknown as AppSettings;

    const result = await checkAllDebridAccounts(settings);
    expect(result).toHaveLength(5);
    expect(result.filter((r) => r.provider === "megadebrid")).toHaveLength(2);
    expect(result.filter((r) => r.provider === "debridlink")).toHaveLength(3);
    expect(result.every((r) => r.valid)).toBe(true);
  });

  it("checks only enabled accounts in active scope and every account in all scope", async () => {
    const megaCredentials = [
      "one@example.test:pw1",
      "two@example.test:pw2",
      "three@example.test:pw3",
      "four@example.test:pw4"
    ].join("\n");
    const settings: AppSettings = {
      ...defaultSettings(),
      realDebridUseWebLogin: true,
      megaCredentials,
      megaDebridWebCredentials: megaCredentials,
      megaDebridWebEnabled: true,
      debridLinkApiKeys: "disabled-debrid-link-key",
      debridLinkDisabledKeyIds: [getDebridLinkApiKeyId("disabled-debrid-link-key")],
      megaDebridWebDisabledAccountIds: [
        getMegaDebridAccountId("one@example.test"),
        getMegaDebridAccountId("two@example.test"),
        getMegaDebridAccountId("three@example.test"),
        getMegaDebridAccountId("four@example.test")
      ]
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ response_code: "ok", token: "t", vip_end: "4102444800" })
    }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const probe = vi.fn(async () => ({ valid: true, isPremium: true, username: "rd-user" }));

    const active = await checkAllDebridAccounts(settings, undefined, probe, "active");
    const all = await checkAllDebridAccounts(settings, undefined, probe, "all");

    expect(active.map((status) => status.accountId)).toEqual([REAL_DEBRID_STATUS_ID]);
    expect(all).toHaveLength(6);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("caps concurrency (never more than 4 in flight) and preserves result order", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, value: { accountType: 1, premiumLeft: 1000 } }) };
    }) as unknown as typeof fetch);

    const keys = Array.from({ length: 9 }, (_, i) => `key_${i}`).join("\n");
    const settings = { megaCredentials: "", megaPassword: "", debridLinkApiKeys: keys } as unknown as AppSettings;

    const result = await checkAllDebridAccounts(settings);
    expect(result).toHaveLength(9);
    expect(maxInFlight).toBeLessThanOrEqual(4);
    result.forEach((r, i) => expect(r.label).toBe(`Key ${i + 1}`));
  });
});
