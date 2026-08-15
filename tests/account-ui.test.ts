import { describe, expect, it } from "vitest";
import {
  buildConfiguredProviderOrder,
  filterAccountDialogOptions,
  getAvailableAccountOptions,
  getAccountDialogSelectableOptions,
  isAccountRowSelectionKey,
  matchesAccountModeFilter,
  pruneAccountRowSelection,
  resolveAccountUsername,
  resolveVisibleAccountKind,
  runAccountEnableRefresh,
  sortAccountServices
} from "../src/renderer/account-ui";
import * as accountUi from "../src/renderer/account-ui";

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

describe("account dialog filter", () => {
  const options = [
    { id: "rd-api", serviceLabel: "Real-Debrid", title: "Real-Debrid API", modeLabel: "API", pickerDescription: "API-Token" },
    { id: "rd-web", serviceLabel: "Real-Debrid", title: "Real-Debrid Web-Login", modeLabel: "Web-Login", pickerDescription: "Browserfenster" },
    { id: "md-api", serviceLabel: "Mega-Debrid", title: "Mega-Debrid API", modeLabel: "API", pickerDescription: "Login:Passwort" }
  ];

  it("combines an exact service choice with an access-type search", () => {
    expect(filterAccountDialogOptions(options, "web", "Real-Debrid").map((option) => option.id)).toEqual(["rd-web"]);
    expect(filterAccountDialogOptions(options, "api", "all").map((option) => option.id)).toEqual(["md-api", "rd-api"]);
  });

  it("sorts services alphabetically in German without duplicates", () => {
    expect(sortAccountServices([
      "Real-Debrid",
      "Mega-Debrid",
      "BestDebrid",
      "Debrid-Link",
      "1Fichier",
      "AllDebrid",
      "DDownload",
      "LinkSnappy",
      "Mega-Debrid"
    ])).toEqual([
      "1Fichier",
      "AllDebrid",
      "BestDebrid",
      "DDownload",
      "Debrid-Link",
      "LinkSnappy",
      "Mega-Debrid",
      "Real-Debrid"
    ]);
  });

  it("keeps both Real-Debrid access types addable after existing Real-Debrid accounts", () => {
    const choices = [
      { kind: "realdebrid-api", service: "realdebrid" },
      { kind: "realdebrid-web", service: "realdebrid" },
      { kind: "bestdebrid-api", service: "bestdebrid" }
    ];
    expect(getAvailableAccountOptions(choices, ["realdebrid", "bestdebrid"]).map((option) => option.kind))
      .toEqual(["realdebrid-api", "realdebrid-web"]);
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
  it("replaces a single selection and toggles rows only for additive selection", () => {
    const api = accountUi as typeof accountUi & {
      updateAccountRowSelection?: (selected: readonly string[], rowKey: string, additive: boolean) => string[];
      pruneAccountRowSelections?: (selected: readonly string[], existing: readonly string[]) => string[];
    };

    expect(api.updateAccountRowSelection).toBeTypeOf("function");
    expect(api.pruneAccountRowSelections).toBeTypeOf("function");
    expect(api.updateAccountRowSelection?.(["account-a"], "account-b", false)).toEqual(["account-b"]);
    expect(api.updateAccountRowSelection?.(["account-a"], "account-b", true)).toEqual(["account-a", "account-b"]);
    expect(api.updateAccountRowSelection?.(["account-a", "account-b"], "account-a", true)).toEqual(["account-b"]);
    expect(api.pruneAccountRowSelections?.(["account-a", "missing", "account-a"], ["account-a", "account-b"]))
      .toEqual(["account-a"]);
  });

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

describe("account activation refresh", () => {
  it("checks an account before enabling it", async () => {
    const events: string[] = [];

    await runAccountEnableRefresh(
      async () => { events.push("check"); },
      async () => { events.push("persist"); }
    );

    expect(events).toEqual(["check", "persist"]);
  });

  it("does not check an account while disabling it", async () => {
    const events: string[] = [];

    await runAccountEnableRefresh(
      undefined,
      async () => { events.push("persist"); }
    );

    expect(events).toEqual(["persist"]);
  });
});
