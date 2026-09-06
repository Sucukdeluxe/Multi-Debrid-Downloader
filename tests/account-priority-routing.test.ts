import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/main/constants";
import { DebridService, MEGA_DEBRID_STICKY_LINKS, primeMegaDebridRuntimeCooldownForTests, primeDebridLinkRuntimeCooldownForTests, resetDebridLinkRuntimeStateForTests, resetMegaDebridRuntimeStateForTests, resetRealDebridRuntimeStateForTests } from "../src/main/debrid";
import { serializeRealDebridApiAccounts } from "../src/shared/real-debrid-accounts";
import { getMegaDebridAccountId } from "../src/shared/mega-debrid-accounts";
import { parseDebridLinkApiKeys } from "../src/shared/debrid-link-keys";
import { getProviderUsageDayKey } from "../src/shared/provider-daily-limits";
import type { AppSettings } from "../src/shared/types";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); resetDebridLinkRuntimeStateForTests(); resetMegaDebridRuntimeStateForTests(); resetRealDebridRuntimeStateForTests(); });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const result = { fileName: "fixture.rar", directUrl: "https://download.example.test/fixture.rar", fileSize: 1234, retriesUsed: 0 };
const rdSettings = (): AppSettings => ({ ...defaultSettings(), token: "", realDebridApiTokens: serializeRealDebridApiAccounts([{ id: "rda_first", token: "first" }, { id: "rda_second", token: "second" }, { id: "rda_third", token: "third" }]), providerOrder: ["realdebrid"], providerPrimary: "realdebrid", autoProviderFallback: false, accountUsageRules: { realdebrid: { mode: "priority", accountIds: ["rda_second", "rda_first", "rda_third"] } } });

describe("fixed account priority routing", () => {
  it("reserves one Mega-Debrid conversion per account, waits when full and cancels waiting work", async () => {
    const first = getMegaDebridAccountId("first-slot");
    const second = getMegaDebridAccountId("second-slot");
    const settings: AppSettings = { ...defaultSettings(), megaDebridWebCredentials: "first-slot:pass-one\nsecond-slot:pass-two", megaDebridApiCredentials: "", megaDebridWebEnabled: true, megaDebridApiEnabled: false, providerOrder: ["megadebrid-web"], providerPrimary: "megadebrid-web", autoProviderFallback: false, accountUsageRules: { "megadebrid-web": { mode: "priority", accountIds: [second, first] } } };
    const completions: Array<() => void> = [];
    const web = vi.fn(() => new Promise<typeof result>((resolve) => completions.push(() => resolve(result))));
    const service = new DebridService(settings, { megaWebUnrestrict: web });
    const one = service.unrestrictLink("https://hoster.example/one.rar");
    const two = service.unrestrictLink("https://hoster.example/two.rar");
    const controller = new AbortController();
    const waiting = service.unrestrictLink("https://hoster.example/wait.rar", controller.signal);
    const cancelled = expect(waiting).rejects.toThrow(/aborted/i);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(web).toHaveBeenCalledTimes(2);
    controller.abort();
    await cancelled;
    const queued = service.unrestrictLink("https://hoster.example/queued.rar");
    completions[0]();
    expect((await one).sourceAccountId).toBe(second);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(web).toHaveBeenCalledTimes(3);
    completions[2]();
    expect((await queued).sourceAccountId).toBe(second);
    completions[1]();
    expect((await two).sourceAccountId).toBe(first);
    const next = service.unrestrictLink("https://hoster.example/next.rar");
    completions.at(-1)!();
    expect((await next).sourceAccountId).toBe(second);
  });
  it("applies an independent Mega-Debrid API order", async () => {
    const first = getMegaDebridAccountId("first-api");
    const second = getMegaDebridAccountId("second-api");
    const settings: AppSettings = { ...defaultSettings(), megaDebridApiCredentials: "first-api:pass-one\nsecond-api:pass-two", megaDebridWebCredentials: "", megaDebridApiEnabled: true, megaDebridWebEnabled: false, providerOrder: ["megadebrid-api"], providerPrimary: "megadebrid-api", autoProviderFallback: false, accountUsageRules: { "megadebrid-api": { mode: "priority", accountIds: [second, first] }, "megadebrid-web": { mode: "priority", accountIds: [first, second] } } };
    globalThis.fetch = vi.fn(async (input) => String(input).includes("action=connectUser")
      ? json({ response_code: "ok", token: "fixture-api-session", vip_end: Math.floor(Date.now() / 1000) + 999999 })
      : json({ response_code: "ok", debridLink: result.directUrl, filename: result.fileName }));
    expect((await new DebridService(settings).unrestrictLink("https://hoster.example/file.rar")).sourceAccountId).toBe(second);
  });

  it("can prioritize a Real-Debrid web account ahead of API accounts", async () => {
    const settings = rdSettings();
    settings.realDebridWebAccountIds = ["rdw_priority"];
    settings.realDebridUseWebLogin = true;
    settings.accountUsageRules.realdebrid!.accountIds = ["rdw_priority", "rda_second", "rda_first", "rda_third"];
    globalThis.fetch = vi.fn(async () => { throw new Error("API must not be used"); });
    const web = vi.fn(async () => result);
    expect((await new DebridService(settings, { realDebridWebUnrestrict: web }).unrestrictLink("https://hoster.example/web.rar")).sourceAccountId).toBe("rdw_priority");
    expect(web).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([false, true])("exhausts the preferred provider's accounts before provider fallback=%s", async (autoProviderFallback) => {
    const settings = rdSettings();
    settings.providerOrder = ["realdebrid", "debridlink"];
    settings.debridLinkApiKeys = "fixture-fallback-key";
    settings.autoProviderFallback = autoProviderFallback;
    const used: string[] = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      used.push(new Headers(init?.headers).get("Authorization")!);
      return String(input).includes("real-debrid") ? json({ error: "bad_token", error_code: 8 }, 401) : json({ success: true, value: { downloadUrl: result.directUrl, name: result.fileName, size: 1234 } });
    });
    const request = new DebridService(settings).unrestrictLink("https://hoster.example/file.rar");
    if (autoProviderFallback) expect((await request).provider).toBe("debridlink");
    else await expect(request).rejects.toThrow();
    expect(used).toEqual(["Bearer second", "Bearer first", "Bearer third", ...(autoProviderFallback ? ["Bearer fixture-fallback-key"] : [])]);
  });
  it("keeps Real-Debrid priority beyond sticky rotation and through parallel requests", async () => {
    const tokens: string[] = [];
    globalThis.fetch = vi.fn(async (_input, init) => {
      tokens.push(new Headers(init?.headers).get("Authorization")!);
      return json({ download: result.directUrl, filename: result.fileName, filesize: 1234 });
    });
    const service = new DebridService(rdSettings());
    for (let i = 0; i < 8; i++) expect((await service.unrestrictLink("https://hoster.example/file.rar")).sourceAccountId).toBe("rda_second");
    await Promise.all([1, 2, 3].map(() => service.unrestrictLink("https://hoster.example/file.rar")));
    expect(tokens).toEqual(Array(11).fill("Bearer second"));
  });

  it("skips Real-Debrid cooldown, returns to the preferred account after expiry, and stops on link-wide errors", async () => {
    let fail = true;
    let offline = false;
    const used: string[] = [];
    globalThis.fetch = vi.fn(async (_input, init) => {
      const token = new Headers(init?.headers).get("Authorization")!;
      used.push(token);
      if (offline) return json({ error: "hoster_unavailable", error_code: 9 }, 503);
      if (fail && token === "Bearer second") return json({ error: "too_many_active_downloads", error_code: 20 }, 403);
      return json({ download: result.directUrl, filename: result.fileName, filesize: 1234 });
    });
    const service = new DebridService(rdSettings());
    expect((await service.unrestrictLink("https://hoster.example/file.rar")).sourceAccountId).toBe("rda_first");
    fail = false;
    expect((await service.unrestrictLink("https://hoster.example/file.rar")).sourceAccountId).toBe("rda_first");
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 2 * 60 * 60 * 1000);
    expect((await service.unrestrictLink("https://hoster.example/file.rar")).sourceAccountId).toBe("rda_second");
    offline = true;
    used.length = 0;
    await expect(service.unrestrictLink("https://hoster.example/offline.rar")).rejects.toThrow();
    expect(new Set(used)).toEqual(new Set(["Bearer second"]));
  });

  it("skips disabled and daily-limited Real-Debrid accounts before calling the provider", async () => {
    const settings = rdSettings();
    settings.realDebridDisabledAccountIds = ["rda_second"];
    settings.realDebridAccountDailyLimitBytes = { rda_first: 100 };
    settings.realDebridAccountDailyUsageBytes = { rda_first: 100 };
    settings.providerDailyUsageDay = getProviderUsageDayKey();
    globalThis.fetch = vi.fn(async () => json({ download: result.directUrl, filename: result.fileName, filesize: 1234 }));
    expect((await new DebridService(settings).unrestrictLink("https://hoster.example/file.rar")).sourceAccountId).toBe("rda_third");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps Mega-Debrid Web priority beyond the automatic rotation threshold and restores it after cooldown", async () => {
    const first = getMegaDebridAccountId("first");
    const second = getMegaDebridAccountId("second");
    const settings: AppSettings = { ...defaultSettings(), megaDebridWebCredentials: "first:pass-one\nsecond:pass-two", megaDebridApiCredentials: "", megaDebridWebEnabled: true, megaDebridApiEnabled: false, providerOrder: ["megadebrid-web"], providerPrimary: "megadebrid-web", autoProviderFallback: false, accountUsageRules: { "megadebrid-web": { mode: "priority", accountIds: [second, first] } } };
    const service = new DebridService(settings, { megaWebUnrestrict: vi.fn(async () => result) });
    for (let i = 0; i <= MEGA_DEBRID_STICKY_LINKS; i++) expect((await service.unrestrictLink("https://hoster.example/file.rar")).sourceAccountId).toBe(second);
    primeMegaDebridRuntimeCooldownForTests(`${second}:web`, 60000);
    expect((await service.unrestrictLink("https://hoster.example/file.rar")).sourceAccountId).toBe(first);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 120000);
    expect((await service.unrestrictLink("https://hoster.example/file.rar")).sourceAccountId).toBe(second);
  });

  it("uses Debrid-Link key priority, skips cooldown, and returns to the first usable key", async () => {
    const debridLinkApiKeys = "fixture-key-one\nfixture-key-two\nfixture-key-three";
    const keys = parseDebridLinkApiKeys(debridLinkApiKeys);
    const settings: AppSettings = { ...defaultSettings(), debridLinkApiKeys, providerOrder: ["debridlink"], providerPrimary: "debridlink", autoProviderFallback: false, accountUsageRules: { debridlink: { mode: "priority", accountIds: [keys[2].id, keys[1].id, keys[0].id] } } };
    globalThis.fetch = vi.fn(async () => json({ success: true, value: { downloadUrl: result.directUrl, name: result.fileName, size: 1234 } }));
    const service = new DebridService(settings);
    expect((await service.unrestrictLink("https://hoster.example/file.rar")).sourceAccountId).toBe(keys[2].id);
    primeDebridLinkRuntimeCooldownForTests(keys[2].id, 60000);
    expect((await service.unrestrictLink("https://hoster.example/file.rar")).sourceAccountId).toBe(keys[1].id);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 120000);
    expect((await service.unrestrictLink("https://hoster.example/file.rar")).sourceAccountId).toBe(keys[2].id);
  });
});
