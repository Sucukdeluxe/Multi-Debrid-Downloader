import { describe, expect, it } from "vitest";
import {
  buildBulkAccountEnabledState,
  buildConfiguredProviderOrder,
  getAccountDialogSelectableOptions,
  isAccountRowSelectionKey,
  matchesAccountModeFilter,
  pruneAccountRowSelection,
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

describe("bulk account activation", () => {
  it("disables each configured provider and account exactly once", () => {
    expect(buildBulkAccountEnabledState(
      ["alldebrid"],
      ["megadebrid-api", "alldebrid"],
      ["mega-1", "mega-1", "mega-2"],
      ["debrid-link-1", "debrid-link-1"],
      false
    )).toEqual({
      disabledProviders: ["alldebrid", "megadebrid-api"],
      megaDebridDisabledAccountIds: ["mega-1", "mega-2"],
      debridLinkDisabledKeyIds: ["debrid-link-1"]
    });
  });

  it("enables configured providers without changing unrelated provider state", () => {
    expect(buildBulkAccountEnabledState(
      ["realdebrid", "alldebrid", "megadebrid-api"],
      ["alldebrid", "megadebrid-api"],
      ["mega-1"],
      ["debrid-link-1"],
      true
    )).toEqual({
      disabledProviders: ["realdebrid"],
      megaDebridDisabledAccountIds: [],
      debridLinkDisabledKeyIds: []
    });
  });

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
