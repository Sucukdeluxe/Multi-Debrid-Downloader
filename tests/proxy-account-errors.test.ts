import { describe, expect, it } from "vitest";
import { createProxyOnlyAccountError, resolveProxyOnlyAccountErrorCode } from "../src/main/proxy-account-errors";

const enabledSettings = { proxyDownloadEnabled: true, proxyListPath: "C:\\proxy.txt" };

describe("Proxy-only account errors", () => {
  it("distinguishes missing, unreadable, empty and unavailable fixed proxy settings", () => {
    expect(resolveProxyOnlyAccountErrorCode(
      { proxyDownloadEnabled: true, proxyListPath: "" },
      { status: "blocked", reason: "proxy_file_unavailable" }
    )).toBe("proxy_list_missing");
    expect(resolveProxyOnlyAccountErrorCode(
      enabledSettings,
      { status: "blocked", reason: "proxy_file_unavailable" }
    )).toBe("proxy_list_unreadable");
    expect(resolveProxyOnlyAccountErrorCode(
      enabledSettings,
      { status: "blocked", reason: "no_valid_proxies" }
    )).toBe("proxy_list_empty");
    expect(resolveProxyOnlyAccountErrorCode(
      enabledSettings,
      { status: "blocked", reason: "proxy_index_unavailable" }
    )).toBe("proxy_index_unavailable");
  });

  it("maps only transport failures from an active fixed proxy", () => {
    const active = { status: "active", selectedIndex: 1, proxyCount: 20 } as const;
    expect(resolveProxyOnlyAccountErrorCode(enabledSettings, active, "Prüfung fehlgeschlagen: fetch failed"))
      .toBe("proxy_unreachable");
    expect(resolveProxyOnlyAccountErrorCode(enabledSettings, active, "Prüfung fehlgeschlagen: The operation was aborted due to timeout"))
      .toBe("proxy_unreachable");
    expect(resolveProxyOnlyAccountErrorCode(enabledSettings, active, "Prüfung fehlgeschlagen (HTTP 407)"))
      .toBe("proxy_unreachable");
    expect(resolveProxyOnlyAccountErrorCode(enabledSettings, active, "Prüfung fehlgeschlagen (HTTP 503)"))
      .toBeNull();
    expect(resolveProxyOnlyAccountErrorCode(enabledSettings, active, "Ungültiger API-Token"))
      .toBeNull();
  });

  it("does not classify errors while Proxy-only is disabled", () => {
    expect(resolveProxyOnlyAccountErrorCode(
      { proxyDownloadEnabled: false, proxyListPath: "" },
      { status: "disabled" },
      "fetch failed"
    )).toBeNull();
    expect(createProxyOnlyAccountError("proxy_list_missing").message).toBe("proxy_only_account:proxy_list_missing");
  });
});
