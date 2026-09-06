import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configureCredentialProtector } from "../src/main/credential-protection";
import { defaultSettings } from "../src/main/constants";
import { applyAccountCommand } from "../src/main/account-commands";
import { createRendererSettings } from "../src/main/renderer-state";
import { validateRendererSettingsUpdate } from "../src/main/renderer-settings";
import { createStoragePaths, loadSettings, normalizeSettings, saveSettings } from "../src/main/storage";
import { normalizeAccountUsageRules, orderAccountsByRule, reconcileAccountOrder } from "../src/shared/account-usage-rules";
import { parseDebridLinkApiKeys } from "../src/shared/debrid-link-keys";
import type { AccountRuleProvider } from "../src/shared/account-usage-rules";
import type { RendererAccountKind } from "../src/shared/types";

const directories: string[] = [];
beforeEach(() => configureCredentialProtector({ isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value).reverse(), decryptString: (value) => Buffer.from(value).reverse().toString() }));
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

describe("account usage priorities", () => {
  it("preserves automatic defaults and filters corrupt configuration", () => {
    expect(defaultSettings().accountUsageRules).toEqual({});
    expect(normalizeSettings({ ...defaultSettings(), accountUsageRules: undefined as never }).accountUsageRules).toEqual({});
    expect(normalizeAccountUsageRules({ wrong: {}, realdebrid: { mode: "bad", accountIds: ["b", "b", 4, ""] } })).toEqual({ realdebrid: { mode: "automatic", accountIds: ["b"] } });
  });

  it("restores known IDs, removes stale and duplicate IDs, and appends new accounts", () => {
    expect(reconcileAccountOrder(["b", "gone", "b", "a"], ["a", "b", "new"])).toEqual(["b", "a", "new"]);
    const accounts = [{ id: "a" }, { id: "b" }, { id: "new" }];
    expect(orderAccountsByRule(accounts, { mode: "priority", accountIds: ["b", "a"] }).map((a) => a.id)).toEqual(["b", "a", "new"]);
    expect(orderAccountsByRule(accounts, { mode: "automatic", accountIds: ["b", "a"] })).toEqual(accounts);
  });

  it("validates nested rules without allowing arbitrary providers or malformed IDs", () => {
    const current = defaultSettings();
    for (const rule of [{ mode: "random", accountIds: [] }, { mode: "priority", accountIds: [3] }, { mode: "priority", accountIds: [], secret: "no" }]) {
      expect(() => validateRendererSettingsUpdate({ accountUsageRules: { realdebrid: rule } }, current)).toThrow();
    }
    expect(() => validateRendererSettingsUpdate({ accountUsageRules: { unknown: { mode: "priority", accountIds: [] } } }, current)).toThrow();
    const accountUsageRules = { realdebrid: { mode: "priority" as const, accountIds: ["a"] } };
    expect(validateRendererSettingsUpdate({ accountUsageRules }, current)).toEqual({ accountUsageRules });
    const projected = createRendererSettings({ ...current, accountUsageRules });
    projected.accountUsageRules.realdebrid!.accountIds.push("b");
    expect(accountUsageRules.realdebrid.accountIds).toEqual(["a"]);
  });

  it.each([
    ["debridlink-api", "debridlink"], ["megadebrid-api", "megadebrid-api"], ["megadebrid-web", "megadebrid-web"], ["realdebrid-api", "realdebrid"]
  ] as [RendererAccountKind, AccountRuleProvider][])("preserves position across replace, append, delete and reload for %s", (kind, provider) => {
    let settings = defaultSettings();
    const add = (identity: string, secret: string) => {
      const result = applyAccountCommand(settings, { action: "create", kind, identity, secret });
      settings = result.settings;
      return result.response.accountId!;
    };
    const first = add("first@example.test", "fixture-first-key");
    const second = add("second@example.test", "fixture-second-key");
    settings.accountUsageRules = { [provider]: { mode: "priority", accountIds: [second, first] } };
    const replacement = applyAccountCommand(settings, { action: "replace", kind, accountId: second, identity: "renamed@example.test", secret: "fixture-renamed-key" });
    settings = replacement.settings;
    const replacementId = replacement.response.accountId!;
    expect(settings.accountUsageRules[provider]?.accountIds).toEqual([replacementId, first]);
    const third = add("third@example.test", "fixture-third-key");
    expect(settings.accountUsageRules[provider]?.accountIds).toEqual([replacementId, first, third]);
    settings = applyAccountCommand(settings, { action: "delete", kind, accountId: first }).settings;
    expect(settings.accountUsageRules[provider]?.accountIds).toEqual([replacementId, third]);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-account-priority-"));
    directories.push(directory);
    const paths = createStoragePaths(directory);
    saveSettings(paths, settings);
    expect(loadSettings(paths).accountUsageRules).toEqual(settings.accountUsageRules);
  });

  it("prunes references to accounts missing from imported configuration", () => {
    const debridLinkApiKeys = "fixture-key-one\nfixture-key-two";
    const [first, second] = parseDebridLinkApiKeys(debridLinkApiKeys);
    const settings = normalizeSettings({ ...defaultSettings(), debridLinkApiKeys, accountUsageRules: { debridlink: { mode: "priority", accountIds: ["deleted", second.id] } } });
    expect(settings.accountUsageRules.debridlink?.accountIds).toEqual([second.id, first.id]);
  });
});
