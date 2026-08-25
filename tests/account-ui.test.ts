import { describe, expect, it } from "vitest";
import { defaultSettings } from "../src/main/constants";
import { createRendererSettings } from "../src/main/renderer-state";
import {
  buildAccountTogglePatch,
  buildConfiguredProviderOrder,
  createAccountToggleQueue,
  enqueueAccountToggleIntent,
  filterAccountDialogOptions,
  getAvailableAccountOptions,
  getAccountDialogSelectableOptions,
  isAccountRowSelectionKey,
  matchesAccountModeFilter,
  mergeAccountToggleSettings,
  pruneAccountRowSelection,
  resolveAccountUsername,
  resolveVisibleAccountKind,
  sortAccountServices
} from "../src/renderer/account-ui";
import { parseDebridLinkApiKeys } from "../src/shared/debrid-link-keys";
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

describe("account toggle bursts", () => {
  it("serializes different account intents without dropping the second task", async () => {
    const queue = createAccountToggleQueue();
    const events: string[] = [];
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = queue.enqueue("account-a", async () => {
      events.push("a:start");
      await firstGate;
      events.push("a:end");
      return "a";
    });
    const second = queue.enqueue("account-b", async () => {
      events.push("b:start");
      events.push("b:end");
      return "b";
    });

    await Promise.resolve();
    expect(events).toEqual(["a:start"]);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: "applied", value: "a" },
      { status: "applied", value: "b" }
    ]);
    expect(events).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("lets only the latest queued intent for the same account persist", async () => {
    const queue = createAccountToggleQueue();
    const persisted: string[] = [];
    let releaseBlocker: () => void = () => {};
    const blocker = queue.enqueue("blocker", async () => new Promise<string>((resolve) => {
      releaseBlocker = () => resolve("released");
    }));
    const stale = queue.enqueue("account-a", async () => {
      persisted.push("stale");
      return "stale";
    });
    const latest = queue.enqueue("account-a", async () => {
      persisted.push("latest");
      return "latest";
    });

    await Promise.resolve();
    releaseBlocker();
    await blocker;
    await expect(stale).resolves.toEqual({ status: "superseded" });
    await expect(latest).resolves.toEqual({ status: "applied", value: "latest" });
    expect(persisted).toEqual(["latest"]);
  });

  it("rebases consecutive account patches on the latest persisted settings", () => {
    const source = defaultSettings();
    source.debridLinkApiKeys = "first-key\nsecond-key";
    const settings = createRendererSettings(source);
    const [first, second] = parseDebridLinkApiKeys(source.debridLinkApiKeys);
    const afterFirst = { ...settings, ...buildAccountTogglePatch(settings, { type: "debridlink", accountId: first.id }, false) };
    const afterSecond = { ...afterFirst, ...buildAccountTogglePatch(afterFirst, { type: "debridlink", accountId: second.id }, false) };

    expect(afterSecond.debridLinkDisabledKeyIds).toEqual([first.id, second.id]);
  });

  it("does not let a stale enable check overwrite a newer disable intent", async () => {
    const queue = createAccountToggleQueue();
    let settings = createRendererSettings({ ...defaultSettings(), deepbridApiKey: "test-key" });
    let releaseCheck: () => void = () => {};
    const checkGate = new Promise<void>((resolve) => { releaseCheck = resolve; });
    const persistedPatches: unknown[] = [];
    const dependencies = {
      getSettings: () => settings,
      persist: async (patch: ReturnType<typeof buildAccountTogglePatch>) => {
        persistedPatches.push(patch);
        settings = { ...settings, ...patch };
        return settings;
      }
    };
    const target = { type: "provider", provider: "deepbrid" } as const;
    const enable = enqueueAccountToggleIntent(queue, {
      key: "svc-deepbrid",
      target,
      enabled: true,
      check: async () => {
        await checkGate;
        return { valid: true };
      }
    }, dependencies);

    await Promise.resolve();
    const disable = enqueueAccountToggleIntent(queue, { key: "svc-deepbrid", target, enabled: false }, dependencies);
    releaseCheck();

    await expect(enable).resolves.toEqual({ status: "superseded" });
    await expect(disable).resolves.toEqual(expect.objectContaining({ status: "applied" }));
    expect(persistedPatches).toHaveLength(1);
    expect(settings.disabledProviders).toContain("deepbrid");
  });

  it("continues with the next account after an earlier toggle fails", async () => {
    const queue = createAccountToggleQueue();
    const first = queue.enqueue("account-a", async () => { throw new Error("invalid account"); });
    const second = queue.enqueue("account-b", async () => "saved-b");

    await expect(first).resolves.toEqual(expect.objectContaining({ status: "failed" }));
    await expect(second).resolves.toEqual({ status: "applied", value: "saved-b" });
  });

  it("rebases a full settings save onto the latest persisted account state", () => {
    const base = createRendererSettings({ ...defaultSettings(), deepbridApiKey: "test-key" });
    const draft = { ...base, theme: "light" as const, disabledProviders: [] };
    const persisted = { ...base, theme: "dark" as const, disabledProviders: ["deepbrid" as const] };

    expect(mergeAccountToggleSettings(draft, persisted)).toEqual(expect.objectContaining({
      theme: "light",
      disabledProviders: ["deepbrid"]
    }));
  });

  it("preserves a queued account toggle when a full settings save follows immediately", async () => {
    const queue = createAccountToggleQueue();
    let settings = createRendererSettings({ ...defaultSettings(), deepbridApiKey: "test-key" });
    const draft = { ...settings, theme: "light" as const };
    const dependencies = {
      getSettings: () => settings,
      persist: async (patch: ReturnType<typeof buildAccountTogglePatch>) => {
        settings = { ...settings, ...patch };
        return settings;
      }
    };
    const toggle = enqueueAccountToggleIntent(queue, {
      key: "svc-deepbrid",
      target: { type: "provider", provider: "deepbrid" },
      enabled: false
    }, dependencies);
    const fullSave = queue.enqueue("settings-save-1", async () => {
      settings = mergeAccountToggleSettings(draft, settings);
      return settings;
    });

    await expect(toggle).resolves.toEqual(expect.objectContaining({ status: "applied" }));
    await expect(fullSave).resolves.toEqual(expect.objectContaining({ status: "applied" }));
    expect(settings).toEqual(expect.objectContaining({
      theme: "light",
      disabledProviders: ["deepbrid"]
    }));
  });
});
