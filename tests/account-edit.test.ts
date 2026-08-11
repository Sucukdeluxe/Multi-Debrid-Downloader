import { describe, expect, it } from "vitest";
import { defaultSettings } from "../src/main/constants";
import { createRendererState } from "../src/main/renderer-state";
import { getMegaDebridAccountId } from "../src/shared/mega-debrid-accounts";
import {
  buildAccountDeleteCommand,
  buildAccountReplaceCommand,
  createAccountEditState,
  validateAccountEdit,
  type AccountEditTarget
} from "../src/renderer/account-edit";

function megaTarget(identity: string): AccountEditTarget {
  const accountId = getMegaDebridAccountId(identity);
  return {
    type: "mega",
    rowKey: `mega-megadebrid-api-${accountId}`,
    kind: "megadebrid-api",
    service: "megadebrid-api",
    accountId
  };
}

describe("renderer-safe account editing", () => {
  it("opens an existing account without reading its stored secret", () => {
    const identity = "safe-edit@example.test";
    const state = createRendererState({
      ...defaultSettings(),
      megaCredentials: `${identity}:fixture-stored-secret-4dH8`,
      megaDebridApiCredentials: `${identity}:fixture-stored-secret-4dH8`,
      megaDebridApiEnabled: true
    });

    const edit = createAccountEditState(megaTarget(identity), state.accounts);

    expect(edit.login).toBe(identity);
    expect(edit.password).toBe("");
    expect(JSON.stringify(edit)).not.toContain("fixture-stored-secret-4dH8");
  });

  it("builds a replace command whose blank secret retains the main-process value", () => {
    const identity = "safe-edit@example.test";
    const renderer = createRendererState({
      ...defaultSettings(),
      megaCredentials: `${identity}:fixture-stored-secret-4dH8`,
      megaDebridApiCredentials: `${identity}:fixture-stored-secret-4dH8`,
      megaDebridApiEnabled: true
    });
    const edit = createAccountEditState(megaTarget(identity), renderer.accounts);

    expect(validateAccountEdit(edit, renderer.accounts)).toBeNull();
    expect(buildAccountReplaceCommand(edit)).toEqual(expect.objectContaining({
      action: "replace",
      accountId: getMegaDebridAccountId(identity),
      identity,
      secret: ""
    }));
  });

  it("rejects duplicate identities using safe account metadata", () => {
    const first = "first-safe@example.test";
    const second = "second-safe@example.test";
    const renderer = createRendererState({
      ...defaultSettings(),
      megaCredentials: `${first}:fixture-first-secret-1aB2\n${second}:fixture-second-secret-3cD4`,
      megaDebridApiCredentials: `${first}:fixture-first-secret-1aB2\n${second}:fixture-second-secret-3cD4`,
      megaDebridApiEnabled: true
    });
    const edit = { ...createAccountEditState(megaTarget(second), renderer.accounts), login: first };

    expect(validateAccountEdit(edit, renderer.accounts)).toMatch(/bereits vorhanden/i);
  });

  it("builds an identity-only delete command", () => {
    const target = megaTarget("delete-safe@example.test");
    expect(buildAccountDeleteCommand(target)).toEqual({
      action: "delete",
      kind: "megadebrid-api",
      accountId: target.type === "mega" ? target.accountId : ""
    });
  });
});
