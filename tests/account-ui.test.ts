import { describe, expect, it } from "vitest";
import { resolveAccountStatus } from "../src/renderer/App";
import {
  buildConfiguredProviderOrder,
  getAccountDialogSelectableOptions,
  isAccountRowSelectionKey,
  matchesAccountModeFilter,
  pruneAccountRowSelection,
  resolveAccountUsername,
  resolveVisibleAccountKind
} from "../src/renderer/account-ui";
import type { DebridAccountStatus } from "../src/shared/types";

describe("account mode filter", () => {
  it("shows only API options for the API filter", () => {
    expect(matchesAccountModeFilter({ modeLabel: "API" }, "api")).toBe(true);
    expect(matchesAccountModeFilter({ modeLabel: "Web-Login" }, "api")).toBe(false);
  });

  it("shows Web-Login options for the Web filter", () => {
    expect(matchesAccountModeFilter({ modeLabel: "Web-Login" }, "web")).toBe(true);
    expect(matchesAccountModeFilter({ modeLabel: "API" }, "web")).toBe(false);
  });
});

describe("account provider order", () => {
  it("preserves the custom provider order while accounts are disabled", () => {
    expect(buildConfiguredProviderOrder(
      ["debridlink", "realdebrid", "alldebrid"],
      ["realdebrid", "alldebrid", "debridlink", "bestdebrid"]
    )).toEqual(["debridlink", "realdebrid", "alldebrid", "bestdebrid"]);
  });
});

describe("account selection", () => {
  it("clears a selected row after that account disappears", () => {
    expect(pruneAccountRowSelection("account-a", ["account-b"])).toBeNull();
    expect(pruneAccountRowSelection("account-a", ["account-a", "account-b"])).toBe("account-a");
  });

  it("moves a hidden provider selection to the first visible option", () => {
    expect(resolveVisibleAccountKind("realdebrid-api", ["realdebrid-web", "bestdebrid-web"]))
      .toBe("realdebrid-web");
    expect(resolveVisibleAccountKind("realdebrid-api", [])).toBeNull();
    expect(resolveVisibleAccountKind("realdebrid-api", ["realdebrid-api", "bestdebrid-api"]))
      .toBe("realdebrid-api");
  });

  it("keeps edit options available after a filter temporarily has no matches", () => {
    const options = [
      { kind: "realdebrid-api", service: "realdebrid" },
      { kind: "realdebrid-web", service: "realdebrid" },
      { kind: "bestdebrid-api", service: "bestdebrid" }
    ];
    expect(getAccountDialogSelectableOptions(options, [], "edit", "realdebrid").map((option) => option.kind))
      .toEqual(["realdebrid-api", "realdebrid-web"]);
  });

  it("does not consume keyboard activation from controls inside a row", () => {
    expect(isAccountRowSelectionKey("Enter", true)).toBe(true);
    expect(isAccountRowSelectionKey(" ", true)).toBe(true);
    expect(isAccountRowSelectionKey("Enter", false)).toBe(false);
    expect(isAccountRowSelectionKey(" ", false)).toBe(false);
  });
});

describe("account usernames", () => {
  it("shows the full stored login and prefers a checked provider email", () => {
    expect(resolveAccountUsername("member@example.com", undefined)).toBe("member@example.com");
    expect(resolveAccountUsername("stored@example.com", "verified@example.com")).toBe("verified@example.com");
    expect(resolveAccountUsername("", undefined)).toBe("—");
  });
});

describe("account row statuses", () => {
  it("shows the status matching each Mega-Debrid mode", () => {
    const apiStatus: DebridAccountStatus = {
      accountId: "mda_shared:api",
      provider: "megadebrid",
      label: "Mega-Debrid API",
      maskedLogin: "sh***ed",
      valid: false,
      isPremium: false,
      premiumUntilMs: null,
      message: "API ungültig",
      checkedAt: 10
    };
    const webStatus: DebridAccountStatus = {
      accountId: "mda_shared:web",
      provider: "megadebrid",
      label: "Mega-Debrid Web",
      maskedLogin: "sh***ed",
      valid: true,
      isPremium: true,
      premiumUntilMs: 2_000,
      message: "Web gültig",
      checkedAt: 20
    };
    const statuses = {
      "mda_shared:api": apiStatus,
      "mda_shared:web": webStatus
    };
    expect(resolveAccountStatus(statuses, "mda_shared", "megadebrid-api")?.message).toBe("API ungültig");
    expect(resolveAccountStatus(statuses, "mda_shared", "megadebrid-web")?.message).toBe("Web gültig");
  });
});
