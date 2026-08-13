import { describe, expect, it } from "vitest";
import {
  buildConfiguredProviderOrder,
  getAccountDialogSelectableOptions,
  isAccountRowSelectionKey,
  matchesAccountModeFilter,
  pruneAccountRowSelection,
  resolveAccountUsername,
  resolveVisibleAccountKind
} from "../src/renderer/account-ui";

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
