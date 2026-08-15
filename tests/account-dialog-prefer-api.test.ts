import { describe, expect, it } from "vitest";
import { buildAccountCreateCommand, buildRealDebridWebCreateLoginRequest, createAccountDialogState } from "../src/renderer/App";
import { createRendererSettings } from "../src/main/renderer-state";
import { defaultSettings } from "../src/main/constants";

describe("account creation dialog", () => {
  it("creates a mode-specific Mega-Debrid command without existing credentials", () => {
    const settings = createRendererSettings(defaultSettings());
    const dialog = {
      ...createAccountDialogState("create", "megadebrid-web", settings),
      megaNewLogin: "web-safe@example.test",
      megaNewPassword: "fixture-dialog-secret-7pL2"
    };

    expect(buildAccountCreateCommand(dialog)).toEqual({
      action: "create",
      kind: "megadebrid-web",
      identity: "web-safe@example.test",
      secret: "fixture-dialog-secret-7pL2",
      dailyLimitBytes: 0
    });
  });

  it("keeps all account fields blank before user input", () => {
    const dialog = createAccountDialogState("create", "debridlink-api", createRendererSettings(defaultSettings()));
    expect(dialog.token).toBe("");
    expect(dialog.password).toBe("");
    expect(dialog.megaAccounts).toEqual([]);
  });

  it("forwards the selected daily limit with a newly reserved Real-Debrid Web account", () => {
    const settings = createRendererSettings(defaultSettings());
    const dialog = {
      ...createAccountDialogState("create", "realdebrid-web", settings),
      dailyLimitGb: "2,5"
    };

    expect(buildRealDebridWebCreateLoginRequest(dialog, "rdw_reservedopaqueid")).toEqual({
      accountId: "rdw_reservedopaqueid",
      create: true,
      dailyLimitBytes: Math.floor(2.5 * 1024 * 1024 * 1024)
    });
  });
});
