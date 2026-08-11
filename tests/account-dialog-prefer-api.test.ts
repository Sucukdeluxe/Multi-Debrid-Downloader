import { describe, expect, it } from "vitest";
import { applyAccountDialogToSettings, createAccountDialogState, AccountDialogState } from "../src/renderer/App";
import { defaultSettings } from "../src/main/constants";
import { getMegaDebridAccountId } from "../src/shared/mega-debrid-accounts";
import { isMegaDebridAccountDisabled } from "../src/shared/provider-daily-limits";

function megaDialog(kind: "megadebrid-api" | "megadebrid-web"): AccountDialogState {
  return {
    mode: "edit",
    kind,
    service: kind,
    token: "",
    login: "",
    password: "",
    dailyLimitGb: "",
    keyDailyLimitGbById: {},
    megaAccounts: [{ login: "user@x", password: "pw" }],
    megaNewLogin: "",
    megaNewPassword: "",
    megaDisabledIds: []
  };
}

describe("applyAccountDialogToSettings — keeps the user's Mega preferApi choice", () => {
  it("does not flip megaDebridPreferApi to true when editing the API account", () => {
    const settings = { ...defaultSettings(), megaDebridApiEnabled: true, megaDebridWebEnabled: true, megaDebridPreferApi: false };
    const next = applyAccountDialogToSettings(settings, megaDialog("megadebrid-api"));
    expect(next.megaDebridApiEnabled).toBe(true);
    expect(next.megaDebridPreferApi).toBe(false);
  });

  it("does not flip megaDebridPreferApi to false when editing the Web account", () => {
    const settings = { ...defaultSettings(), megaDebridApiEnabled: true, megaDebridWebEnabled: true, megaDebridPreferApi: true };
    const next = applyAccountDialogToSettings(settings, megaDialog("megadebrid-web"));
    expect(next.megaDebridWebEnabled).toBe(true);
    expect(next.megaDebridPreferApi).toBe(true);
  });

  it("adds a Web account without copying it into the API account pool", () => {
    const settings = {
      ...defaultSettings(),
      megaCredentials: "api@example.test:api-pass",
      megaDebridApiCredentials: "api@example.test:api-pass",
      megaDebridWebCredentials: "",
      megaDebridApiEnabled: true,
      megaDebridWebEnabled: false
    };
    const dialog = createAccountDialogState("create", "megadebrid-web", settings);

    expect(dialog.megaAccounts).toEqual([]);

    const next = applyAccountDialogToSettings(settings, {
      ...dialog,
      megaAccounts: [{ login: "web@example.test", password: "web-pass" }]
    });

    expect(next.megaDebridApiCredentials).toBe("api@example.test:api-pass");
    expect(next.megaDebridWebCredentials).toBe("web@example.test:web-pass");
    expect(next.megaDebridApiEnabled).toBe(true);
    expect(next.megaDebridWebEnabled).toBe(true);
  });

  it("disables an API account without disabling the matching Web account", () => {
    const accountId = getMegaDebridAccountId("shared@example.test");
    const settings = {
      ...defaultSettings(),
      megaCredentials: "shared@example.test:api-pass",
      megaDebridApiCredentials: "shared@example.test:api-pass",
      megaDebridWebCredentials: "shared@example.test:web-pass",
      megaDebridApiEnabled: true,
      megaDebridWebEnabled: true
    };
    const next = applyAccountDialogToSettings(settings, {
      ...createAccountDialogState("edit", "megadebrid-api", settings),
      megaDisabledIds: [accountId]
    });

    expect(isMegaDebridAccountDisabled(next, accountId, "api")).toBe(true);
    expect(isMegaDebridAccountDisabled(next, accountId, "web")).toBe(false);
  });
});
