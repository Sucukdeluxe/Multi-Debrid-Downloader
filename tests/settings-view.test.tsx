import { readFileSync } from "node:fs";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultSettings } from "../src/main/constants";
import { createRendererSettings, createRendererState } from "../src/main/renderer-state";
import { buildAccountAddFields, buildAccountCreateProviderOrderUpdate, buildProviderOrderEntry, captureSettingsSaveIntent, createAccountDialogState, createDiscardedSettingsState, createSettingsDraft, resolveSettingsSaveCompletion } from "../src/renderer/App";
import { buildAccountReplaceCommand, createAccountEditState, type AccountEditTarget } from "../src/renderer/account-edit";
import {
  buildAccountTogglePatch,
  buildScopedAccountEnabledState,
  buildConfiguredProviderOrder,
  resolveAccountStatusState
} from "../src/renderer/account-ui";
import { getDebridLinkApiKeyId } from "../src/shared/debrid-link-keys";
import { getMegaDebridAccountId } from "../src/shared/mega-debrid-accounts";
import {
  ACCOUNT_COLUMNS,
  SETTINGS_SECTIONS,
  buildSettingsFormViewModel,
  buildAccountRowId,
  buildTargetedAccountCheck,
  filterAccountAddOptions,
  getSettingsSaveLabel,
  getSettingsSelectNavigationIndex,
  normalizeNotificationNumberField,
  projectAccountRows,
  pruneAccountSelection,
  reconcileAccountAddDraft,
  resolveHistoryRetentionSelection,
  sortAccountRows,
  type AccountAddOption,
  type AccountRowSource,
  type SettingsFormViewModel
} from "../src/renderer/views/settings/settings-model";
import * as settingsModel from "../src/renderer/views/settings/settings-model";
import {
  AccountAddDialog,
  AccountEditDialog,
  AccountWorkspace,
  type AccountWorkspaceActions,
  type AccountWorkspaceViewModel
} from "../src/renderer/views/settings/AccountWorkspace";
import {
  SettingsForm,
  closeSettingsSelectAndRestoreFocus,
  getSettingsSelectKeyboardAction
} from "../src/renderer/views/settings/SettingsForm";
import {
  SettingsContent,
  SettingsSidebar,
  SettingsView,
  type SettingsViewActions,
  type SettingsViewModel
} from "../src/renderer/views/settings/SettingsView";

const GIB = 1024 * 1024 * 1024;
const NOW = 1_700_000_000_000;
const appSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
const accountWorkspaceSource = readFileSync(
  new URL("../src/renderer/views/settings/AccountWorkspace.tsx", import.meta.url),
  "utf8"
);
const settingsCss = readFileSync(
  new URL("../src/renderer/views/settings/settings.css", import.meta.url),
  "utf8"
);

describe("settings save intent", () => {
  it("captures the clicked draft before waiting for queued account mutations", () => {
    const clicked = { outputDir: "C:\\Clicked", maxParallel: 4 };
    const intent = captureSettingsSaveIntent(7, clicked);
    clicked.outputDir = "C:\\Edited later";

    expect(intent).toEqual({ revision: 7, draft: { outputDir: "C:\\Clicked", maxParallel: 4 } });
  });

  it("keeps edits made after the save click dirty when the older request completes", () => {
    const intent = captureSettingsSaveIntent(7, { outputDir: "C:\\Clicked" });

    expect(resolveSettingsSaveCompletion(intent.revision, 8)).toEqual({
      saveState: "dirty",
      applyPersistedTheme: false,
      toast: "Zwischenstand gespeichert – weitere Änderungen sind ungespeichert"
    });
  });
});

function sourceBlock(source: string, start: string, end: string): string {
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
}

function visitElements(node: ReactNode, visit: (element: ReactElement) => void): void {
  if (Array.isArray(node)) {
    node.forEach((child) => visitElements(child, visit));
    return;
  }
  if (!isValidElement(node)) {
    return;
  }
  visit(node);
  visitElements(node.props.children, visit);
  visitElements(node.props.actions, visit);
}

function findElement(node: ReactNode, predicate: (element: ReactElement) => boolean): ReactElement {
  let result: ReactElement | null = null;
  visitElements(node, (element) => {
    if (!result && predicate(element)) {
      result = element;
    }
  });
  if (!result) {
    throw new Error("Element not found");
  }
  return result;
}

function findElements(node: ReactNode, predicate: (element: ReactElement) => boolean): ReactElement[] {
  const results: ReactElement[] = [];
  visitElements(node, (element) => {
    if (predicate(element)) {
      results.push(element);
    }
  });
  return results;
}

function compositeKeyboardTarget(count: number): {
  elements: Array<{ closest: () => { querySelectorAll: () => unknown[] }; focus: () => void }>;
  focused: () => number;
} {
  let focusedIndex = -1;
  const elements: Array<{ closest: () => { querySelectorAll: () => unknown[] }; focus: () => void }> = [];
  const container = { querySelectorAll: () => elements };
  for (let index = 0; index < count; index += 1) {
    elements.push({
      closest: () => container,
      focus: () => { focusedIndex = index; }
    });
  }
  return { elements, focused: () => focusedIndex };
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function accountSources(): AccountRowSource[] {
  return [
    {
      identityId: "mega-premium",
      service: "megadebrid-api",
      hoster: "Mega-Debrid",
      mode: "API",
      icon: "./provider-icons/mega-debrid.png",
      enabled: true,
      status: {
        state: "premium",
        message: "Premium aktiv",
        premiumUntilMs: NOW + 7 * 24 * 60 * 60 * 1000,
        checkedAt: NOW - 5 * 60 * 1000,
        email: "verified@example.test"
      },
      dailyLimitBytes: 10 * GIB,
      dailyUsageBytes: 4 * GIB,
      username: "stored-user",
      credentialKind: "password",
      canCheck: true
    },
    {
      identityId: "debrid-free",
      service: "debridlink",
      hoster: "Debrid-Link",
      mode: "API-Key",
      icon: "./provider-icons/debrid-link.ico",
      enabled: true,
      status: { state: "free", message: "Free Account", premiumUntilMs: null, username: "xsucukde5" },
      dailyLimitBytes: 0,
      dailyUsageBytes: 0,
      username: "",
      credentialKind: "api-key",
      canCheck: true
    },
    {
      identityId: "invalid",
      service: "ddownload",
      hoster: "DDownload",
      mode: "Login",
      icon: "./provider-icons/ddownload.ico",
      enabled: true,
      status: { state: "invalid", message: "Login abgelehnt", premiumUntilMs: null },
      username: "invalid@example.test",
      credentialKind: "password",
      canCheck: false
    },
    {
      identityId: "unknown",
      service: "onefichier",
      hoster: "1Fichier",
      mode: "API",
      icon: "./provider-icons/onefichier.png",
      enabled: true,
      status: { state: "unchecked", message: "", premiumUntilMs: null },
      username: "—",
      credentialKind: "api-key",
      canCheck: false
    },
    {
      identityId: "disabled",
      service: "linksnappy",
      hoster: "LinkSnappy",
      mode: "Web-Login",
      icon: "./provider-icons/linksnappy.png",
      enabled: false,
      status: { state: "disabled", message: "", premiumUntilMs: null },
      username: "disabled@example.test",
      credentialKind: "password",
      canCheck: false
    }
  ];
}

function accountOptions(): AccountAddOption[] {
  return [
    {
      id: "realdebrid-api",
      service: "realdebrid",
      title: "Real-Debrid",
      mode: "API",
      description: "API-Token verwenden",
      functionLabel: "API-Token",
      filter: "api",
      multi: false
    },
    {
      id: "ddownload-login",
      service: "ddownload",
      title: "DDownload",
      mode: "Login",
      description: "Login und Passwort",
      functionLabel: "Login:Passwort",
      filter: "web",
      multi: false
    },
    {
      id: "megadebrid-api",
      service: "megadebrid-api",
      title: "Mega-Debrid",
      mode: "API",
      description: "Weiteren Account hinzufügen",
      functionLabel: "Login:Passwort",
      filter: "api",
      multi: true
    },
    {
      id: "debridlink-api",
      service: "debridlink",
      title: "Debrid-Link",
      mode: "API",
      description: "Weiteren API-Key hinzufügen",
      functionLabel: "API-Key",
      filter: "api",
      multi: true
    }
  ];
}

function formModel(): SettingsFormViewModel {
  return {
    title: "Allgemein",
    description: "Grundeinstellungen der Anwendung.",
    groups: [
      {
        id: "appearance",
        title: "Darstellung",
        fields: [
          {
            id: "downloadDir",
            kind: "path",
            label: "Download-Ordner",
            value: "C:\\Downloads",
            help: "Zielordner für Downloads."
          },
          {
            id: "theme",
            kind: "theme",
            label: "Theme",
            value: "dark",
            options: [
              { value: "light", label: "Hell" },
              { value: "dark", label: "Dunkel" },
              { value: "system", label: "System" }
            ]
          },
          {
            id: "autoUpdate",
            kind: "switch",
            label: "Automatisch nach Updates suchen",
            value: true
          }
        ]
      }
    ]
  };
}

function workspaceModel(): AccountWorkspaceViewModel {
  return {
    activePanel: "overview",
    rows: projectAccountRows(accountSources(), [buildAccountRowId("megadebrid-api", "API", "mega-premium")], NOW),
    selectedIds: [buildAccountRowId("megadebrid-api", "API", "mega-premium")],
    busy: false,
    rules: {
      providerOrder: [
        { id: "debridlink", label: "Debrid-Link (API)", icon: "./provider-icons/debrid-link.ico" },
        { id: "realdebrid", label: "Real-Debrid (Web-Login)", icon: "./provider-icons/real-debrid.png" }
      ],
      routing: ["rapidgator.net → Debrid-Link"],
      autoFallback: true
    },
    runtime: {
      providers: [
        {
          id: "realdebrid",
          label: "Real-Debrid",
          accountCount: 2,
          availableAccountCount: 1,
          activeDownloads: 3,
          dailyUsageText: "12,5 GB"
        }
      ],
      accounts: [
        {
          id: "rd-runtime",
          providerLabel: "Real-Debrid",
          modeLabel: "API",
          identity: "stored-user",
          stateLabel: "Cooldown",
          stateTone: "warning",
          activeDownloads: 0,
          dailyUsageText: "4,2 GB",
          successRateText: "75 % (3/4)",
          lastUsedText: "vor 2 Min.",
          cooldownText: "Rate-Limit aktiv · 48 Sek."
        }
      ]
    }
  };
}

function workspaceActions(overrides: Partial<AccountWorkspaceActions> = {}): AccountWorkspaceActions {
  return {
    onPanelChange: () => {},
    onSelect: () => {},
    onToggleEnabled: () => {},
    onEdit: () => {},
    onContextMenu: () => {},
    onCopyIdentity: () => {},
    onAdd: () => {},
    onRemoveSelected: () => {},
    onCheckActive: () => {},
    onCheckAll: () => {},
    ...overrides
  };
}

function viewModel(saveState: SettingsViewModel["saveState"] = "clean", saveInFlight = false): SettingsViewModel {
  return {
    section: "accounts",
    saveState,
    saveInFlight,
    form: formModel(),
    accounts: workspaceModel()
  };
}

function viewActions(): SettingsViewActions {
  return {
    onSectionChange: () => {},
    onDiscard: () => {},
    onSave: () => {},
    form: { onChange: () => {}, onAction: () => {} },
    accounts: workspaceActions()
  };
}

describe("settings model", () => {
  it("keeps six stable sections and accessible save-state labels", () => {
    expect(SETTINGS_SECTIONS).toEqual([
      { id: "allgemein", label: "Allgemein" },
      { id: "accounts", label: "Accounts" },
      { id: "extract", label: "Entpacken" },
      { id: "speed", label: "Geschwindigkeit" },
      { id: "cleanup", label: "Bereinigung" },
      { id: "updates", label: "Updates" }
    ]);
    expect(["clean", "dirty", "saving", "saved", "error"].map((state) => getSettingsSaveLabel(state as never)))
      .toEqual(["Gespeichert", "Ungespeicherte Änderungen", "Wird gespeichert…", "Gespeichert", "Speichern fehlgeschlagen"]);
  });

  it("projects stable sanitized rows with full verified usernames and distinct states", () => {
    const rows = projectAccountRows(accountSources(), [], NOW);

    expect(rows.map((row) => row.id)).toEqual(accountSources().map((source) => buildAccountRowId(source.service, source.mode, source.identityId)));
    expect(rows[0].username).toBe("stored-user");
    expect(rows[0].email).toBe("verified@example.test");
    expect(rows[0].credential).toBe("••••••");
    expect(rows[1].username).toBe("xsucukde5");
    expect(rows[1].email).toBe("—");
    expect(rows[1].credential).toBe("API-Key");
    expect(rows.map((row) => row.status.tone)).toEqual(["ok", "free", "invalid", "unknown", "disabled"]);
    expect(rows.map((row) => row.status.text)).toEqual([
      "Premium aktiv",
      "Free Account",
      "Login abgelehnt",
      "Noch nicht geprüft",
      "Deaktiviert"
    ]);
    expect(rows[0].status.checkedAgo).toBe("vor 5 Min");
    expect(JSON.stringify(rows)).not.toContain("test-password");
    expect(JSON.stringify(rows)).not.toContain("test-token");
  });

  it("marks elapsed premium access as expired instead of active", () => {
    expect(resolveAccountStatusState(false, {
      valid: true,
      isPremium: true,
      premiumUntilMs: NOW - 1
    }, NOW)).toBe("free");
    expect(resolveAccountStatusState(false, {
      valid: true,
      isPremium: true,
      premiumUntilMs: NOW + 1
    }, NOW)).toBe("premium");
    expect(resolveAccountStatusState(false, {
      valid: true,
      isPremium: true,
      premiumUntilMs: null
    }, NOW)).toBe("premium");

    const [row] = projectAccountRows([{
      ...accountSources()[0],
      status: {
        ...accountSources()[0].status,
        state: "free",
        premiumUntilMs: NOW - 1,
        checkedAt: NOW - 60 * 60 * 1000
      }
    }], [], NOW);

    expect(row.status).toEqual({ tone: "free", text: "Free Account", checkedAgo: "vor 1 Std" });
    expect(row.premiumUntilMs).toBeNull();
  });

  it("sorts positive premium expirations first and prunes vanished selections", () => {
    const rows = projectAccountRows(accountSources(), [], NOW);
    const sorted = sortAccountRows(rows);

    expect(sorted[0].status.tone).toBe("ok");
    expect(pruneAccountSelection([rows[0].id, "missing"], rows)).toEqual([rows[0].id]);
  });

  it("filters add options honestly and clears hidden credentials", () => {
    const options = accountOptions();
    expect(filterAccountAddOptions(options, "", "web", []) .map((option) => option.id)).toEqual(["ddownload-login"]);
    expect(filterAccountAddOptions(options, "api-key", "all", ["realdebrid"]).map((option) => option.id)).toEqual(["debridlink-api"]);
    expect(filterAccountAddOptions(options, "", "all", ["realdebrid"]).map((option) => option.id)).not.toContain("realdebrid-api");
    expect(filterAccountAddOptions(options, "", "all", ["realdebrid"]).map((option) => option.id)).toContain("megadebrid-api");

    expect(reconcileAccountAddDraft({
      selectedId: "realdebrid-api",
      login: "member@example.test",
      password: "test-password",
      token: "test-token",
      dailyLimitGb: "10"
    }, [options[1]])).toEqual({ selectedId: null, login: "", password: "", token: "", dailyLimitGb: "" });
  });

  it("targets new Mega and Debrid-Link identities without inventing checks for other services", () => {
    const options = accountOptions();
    expect(buildTargetedAccountCheck(options[2], "mda-new")).toEqual({ service: "megadebrid-api", expectedStatusId: "mda-new" });
    expect(buildTargetedAccountCheck(options[3], "dlk-new")).toEqual({ service: "debridlink", expectedStatusId: "dlk-new" });
    expect(buildTargetedAccountCheck(options[1], "ddownload-new")).toBeNull();
  });

  it("preserves provider order", () => {
    expect(buildConfiguredProviderOrder(
      ["debridlink", "realdebrid", "alldebrid"],
      ["realdebrid", "alldebrid", "debridlink", "bestdebrid"]
    )).toEqual(["debridlink", "realdebrid", "alldebrid", "bestdebrid"]);
  });

  it("appends a newly configured Deepbrid provider once for immediate persistence", () => {
    const settings = createRendererSettings({
      ...defaultSettings(),
      token: "synthetic-real-debrid-token",
      debridLinkApiKeys: "synthetic-debrid-link-key",
      deepbridApiKey: "synthetic-deepbrid-key",
      providerOrder: ["debridlink", "realdebrid"]
    });

    expect(buildAccountCreateProviderOrderUpdate(settings)).toEqual({
      providerOrder: ["debridlink", "realdebrid", "deepbrid"],
      providerPrimary: "debridlink",
      providerSecondary: "realdebrid",
      providerTertiary: "deepbrid"
    });
  });

  it("builds the Deepbrid API picker and status row", () => {
    const dialog = createAccountDialogState("create", "deepbrid-api", createRendererSettings(defaultSettings()));
    expect(buildAccountAddFields(dialog).find((field) => field.id === "token")?.label).toBe("Token / API-Key");
    const [row] = projectAccountRows([{
      identityId: "svc-deepbrid",
      service: "deepbrid",
      hoster: "Deepbrid",
      mode: "API",
      enabled: true,
      status: { state: "premium", message: "Premium aktiv", premiumUntilMs: NOW + GIB, username: "deep-user", email: "deep@example.test" },
      dailyLimitBytes: 10 * GIB,
      dailyUsageBytes: 3 * GIB,
      totalUsageBytes: 20 * GIB,
      username: "",
      credentialKind: "api-key",
      canCheck: true
    }], [], NOW);
    expect(row).toMatchObject({ hoster: "Deepbrid", mode: "API", icon: "./provider-icons/deepbrid.png", username: "deep-user", email: "deep@example.test", traffic: "7 GiB von 10 GiB übrig · Gesamt 20 GiB", credential: "API-Key", canCheck: true });
  });

  it("keeps exact rounded limits and migrates edited identity metadata", () => {
    const login = "member@example.test";
    const oldId = getMegaDebridAccountId(login);
    const newLogin = "renamed@example.test";
    const exactLimit = Math.floor(10.05 * GIB);
    const settings = {
      ...defaultSettings(),
      megaCredentials: `${login}:test-password`,
      megaLogin: login,
      megaPassword: "test-password",
      megaDebridDisabledAccountIds: [oldId],
      megaDebridAccountDailyLimitBytes: { [oldId]: exactLimit },
      megaDebridAccountDailyUsageBytes: { [oldId]: 2 * GIB },
      megaDebridAccountTotalUsageBytes: { [oldId]: 20 * GIB }
    };
    const target: AccountEditTarget = {
      type: "mega",
      rowKey: "row",
      kind: "megadebrid-api",
      service: "megadebrid-api",
      accountId: oldId
    };
    const renderer = createRendererState(settings);
    const unchanged = buildAccountReplaceCommand(createAccountEditState(target, renderer.accounts));
    const renamed = buildAccountReplaceCommand({
      ...createAccountEditState(target, renderer.accounts),
      login: newLogin
    });

    expect(unchanged.dailyLimitBytes).toBe(exactLimit);
    expect(unchanged.secret).toBe("");
    expect(renamed.identity).toBe(newLogin);
    expect(renamed.secret).toBe("");
  });
});

describe("settings views", () => {
  it("uses a dedicated high-contrast border for form controls", () => {
    const theme = readFileSync(new URL("../src/renderer/theme.css", import.meta.url), "utf8");
    const css = readFileSync(new URL("../src/renderer/views/settings/settings.css", import.meta.url), "utf8");

    expect(theme).toContain("--ui-control-border: #707070;");
    expect(theme).toContain("--ui-control-border: #7B8491;");
    expect(css.match(/border:\s*1px solid var\(--ui-control-border\);/g)?.length).toBeGreaterThanOrEqual(2);
  });
  it("marks settings sections for one measured vertical selection indicator", () => {
    const html = renderToStaticMarkup(<SettingsSidebar actions={viewActions()} model={viewModel()} />);

    expect(html).toContain("ui-sliding-selection ui-sliding-selection-vertical");
    expect(html.match(/data-sliding-selection-item="true"/g)).toHaveLength(SETTINGS_SECTIONS.length);
    expect(html.match(/data-sliding-selection-active="true"/g)).toHaveLength(1);
  });

  it("offers animated language and bounded history retention choices", () => {
    const form = buildSettingsFormViewModel({
      settings: { ...createRendererSettings(defaultSettings()), archivePasswordList: "", notifyUrl: "" },
      section: "allgemein",
      speedLimitInput: "0",
      scheduleSpeedInputs: {}
    });
    const language = form.groups.flatMap((group) => group.fields).find((field) => field.id === "language");

    expect(language).toEqual({
      id: "language",
      kind: "select",
      label: "Sprache",
      value: "en",
      options: [
        { value: "en", label: "English" },
        { value: "de", label: "Deutsch" }
      ]
    });
    const historyRetention = form.groups.flatMap((group) => group.fields).find((field) => field.id === "historyRetentionMode");

    expect(historyRetention).toEqual({
      id: "historyRetentionMode",
      kind: "select",
      label: "Verlauf speichern",
      value: "permanent",
      options: [
        { value: "never", label: "Nie" },
        { value: "session", label: "Nur aktuelle Session" },
        { value: "permanent-100", label: "Nur letzte 100 Einträge" },
        { value: "permanent-250", label: "Nur letzte 250 Einträge" },
        { value: "permanent", label: "Dauerhaft" }
      ]
    });

    const html = renderToStaticMarkup(<SettingsForm actions={{ onAction: () => {}, onChange: () => {} }} model={form} />);
    expect(html).toContain("class=\"settings-select\"");
    expect(html).toContain("role=\"combobox\"");
    expect(html).toContain("role=\"listbox\"");
    expect(settingsCss).toMatch(/\.settings-select-options\s*\{[^}]*opacity:\s*0[^}]*transform:\s*translateY\(-6px\)[^}]*transition:/s);
    expect(settingsCss).toMatch(/\.settings-select\.is-open\s+\.settings-select-options\s*\{[^}]*opacity:\s*1[^}]*transform:\s*translateY\(0\)/s);
  });

  it("offers one general switch for interface animations", () => {
    const form = buildSettingsFormViewModel({
      settings: { ...createRendererSettings(defaultSettings()), archivePasswordList: "", notifyUrl: "" },
      section: "allgemein",
      speedLimitInput: "0",
      scheduleSpeedInputs: {}
    });
    const animation = form.groups.flatMap((group) => group.fields)
      .find((field) => field.id === "animatePackageDisclosure");

    expect(animation).toEqual({
      id: "animatePackageDisclosure",
      kind: "switch",
      label: "Animationen",
      value: true
    });
  });

  it("projects proxy segmentation controls with safe defaults and connection totals", () => {
    const form = buildSettingsFormViewModel({
      settings: {
        ...createRendererSettings({
          ...defaultSettings(),
          maxParallel: 5,
          proxyDownloadEnabled: true,
          proxyListPath: "C:\\proxy-list.txt",
          proxyApiProxyIndex: 7,
          proxyConnectionsPerDownload: 16
        }),
        archivePasswordList: "",
        notifyUrl: ""
      },
      section: "speed",
      speedLimitInput: "0",
      scheduleSpeedInputs: {}
    });
    const proxyGroup = form.groups.find((group) => group.id === "speed-proxy");

    expect(proxyGroup?.fields.map((field) => field.id)).toEqual([
      "proxyDownloadEnabled",
      "proxyListPath",
      "proxyApiProxyIndex",
      "proxyConnectionsPerDownload"
    ]);
    expect(proxyGroup?.fields.find((field) => field.id === "proxyListPath")).toEqual(expect.objectContaining({
      value: "C:\\proxy-list.txt",
      actionLabel: "Datei wählen",
      disabled: false
    }));
    expect(proxyGroup?.fields.find((field) => field.id === "proxyApiProxyIndex")).toEqual(expect.objectContaining({
      value: "7",
      min: 1,
      max: 100000,
      disabled: false
    }));
    expect(proxyGroup?.fields.find((field) => field.id === "proxyConnectionsPerDownload")).toEqual(expect.objectContaining({
      label: "Proxy-Verbindungen insgesamt",
      value: "16",
      min: 2,
      max: 40,
      help: expect.stringContaining("zusammen höchstens 16 Segmentverbindungen")
    }));
  });

  it("projects every notification control in the required order with exact bounds", () => {
    const form = buildSettingsFormViewModel({
      settings: {
        ...createRendererSettings(defaultSettings()),
        archivePasswordList: "",
        notifyUrl: "https://discord.com/api/webhooks/example",
        notifyOnPackageCompleted: true,
        notifyOnRemainingBelow: true,
        notifyOnDownloadStall: true
      },
      section: "allgemein",
      speedLimitInput: "0",
      scheduleSpeedInputs: {}
    });
    const fields = form.groups.find((group) => group.id === "general-notifications")?.fields ?? [];

    expect(fields.map((field) => field.id)).toEqual([
      "notifyUrl",
      "notifyMention",
      "notifyOnPackageCompleted",
      "notifyOnPackageFailed",
      "notifyPackageSuccessMode",
      "notifyOnRunFinished",
      "notifyOnRemainingBelow",
      "notifyRemainingThresholdGb",
      "notifyOnDownloadStall",
      "notifyStallAfterSeconds",
      "notifyStallCooldownMinutes",
      "notifyOnDownloadRecovery"
    ]);
    expect(fields.find((field) => field.id === "notifyPackageSuccessMode")).toEqual({
      id: "notifyPackageSuccessMode",
      kind: "select",
      label: "Erfolgsmeldungen senden",
      value: "digest",
      disabled: false,
      options: [
        { value: "digest", label: "Gesammelt (alle 2 Minuten)" },
        { value: "individual", label: "Jedes Paket einzeln" }
      ]
    });
    expect(fields.find((field) => field.id === "notifyRemainingThresholdGb")).toEqual({
      id: "notifyRemainingThresholdGb",
      kind: "number",
      label: "Restmengenschwelle (GB)",
      value: "50",
      min: 1,
      max: 100000,
      disabled: false
    });
    expect(fields.find((field) => field.id === "notifyStallAfterSeconds")).toEqual({
      id: "notifyStallAfterSeconds",
      kind: "number",
      label: "Stillstand bestätigen nach (Sek.)",
      value: "90",
      min: 60,
      max: 3600,
      disabled: false
    });
    expect(fields.find((field) => field.id === "notifyStallCooldownMinutes")).toEqual({
      id: "notifyStallCooldownMinutes",
      kind: "number",
      label: "Frühestens erneut melden nach (Min.)",
      value: "10",
      min: 5,
      max: 1440,
      disabled: false
    });
  });

  it("disables notification controls that depend on an inactive switch", () => {
    const form = buildSettingsFormViewModel({
      settings: { ...createRendererSettings(defaultSettings()), archivePasswordList: "", notifyUrl: "" },
      section: "allgemein",
      speedLimitInput: "0",
      scheduleSpeedInputs: {}
    });
    const fields = form.groups.find((group) => group.id === "general-notifications")?.fields ?? [];
    const disabled = Object.fromEntries(fields.map((field) => [field.id, Boolean(field.disabled)]));

    expect(disabled).toMatchObject({
      notifyPackageSuccessMode: true,
      notifyRemainingThresholdGb: true,
      notifyStallAfterSeconds: true,
      notifyStallCooldownMinutes: true,
      notifyOnDownloadRecovery: true
    });
  });

  it("clamps notification number fields and restores their exact defaults", () => {
    expect(normalizeNotificationNumberField("notifyRemainingThresholdGb", "0")).toBe(1);
    expect(normalizeNotificationNumberField("notifyRemainingThresholdGb", "100001")).toBe(100000);
    expect(normalizeNotificationNumberField("notifyRemainingThresholdGb", "invalid")).toBe(50);
    expect(normalizeNotificationNumberField("notifyStallAfterSeconds", "59")).toBe(60);
    expect(normalizeNotificationNumberField("notifyStallAfterSeconds", "3601")).toBe(3600);
    expect(normalizeNotificationNumberField("notifyStallAfterSeconds", "invalid")).toBe(90);
    expect(normalizeNotificationNumberField("notifyStallCooldownMinutes", "4")).toBe(5);
    expect(normalizeNotificationNumberField("notifyStallCooldownMinutes", "1441")).toBe(1440);
    expect(normalizeNotificationNumberField("notifyStallCooldownMinutes", "invalid")).toBe(10);
    expect(normalizeNotificationNumberField("maxParallel", "8")).toBeUndefined();
  });

  it("supports keyboard navigation in animated settings selects", () => {
    expect(getSettingsSelectNavigationIndex(1, 3, "ArrowDown")).toBe(2);
    expect(getSettingsSelectNavigationIndex(2, 3, "ArrowDown")).toBe(0);
    expect(getSettingsSelectNavigationIndex(0, 3, "ArrowUp")).toBe(2);
    expect(getSettingsSelectNavigationIndex(1, 3, "Home")).toBe(0);
    expect(getSettingsSelectNavigationIndex(1, 3, "End")).toBe(2);

    const source = readFileSync(new URL("../src/renderer/views/settings/SettingsForm.tsx", import.meta.url), "utf8");
    expect(source).toContain("optionRefs.current[nextIndex]?.focus()");
    expect(getSettingsSelectKeyboardAction("Home", 1, 3)).toEqual({ type: "focus", index: 0 });
    expect(getSettingsSelectKeyboardAction("End", 1, 3)).toEqual({ type: "focus", index: 2 });
    expect(source).toContain("onBlur={onBlur}");
  });

  it("closes settings selects with Escape and restores the trigger focus", () => {
    const calls: string[] = [];

    expect(getSettingsSelectKeyboardAction("Escape", 1, 3)).toEqual({ type: "close" });
    expect(getSettingsSelectKeyboardAction("ArrowDown", 1, 3)).toEqual({ type: "focus", index: 2 });
    expect(getSettingsSelectKeyboardAction("ArrowUp", 0, 3)).toEqual({ type: "focus", index: 2 });
    closeSettingsSelectAndRestoreFocus(
      () => calls.push("close"),
      { focus: () => calls.push("focus") }
    );

    expect(calls).toEqual(["close", "focus"]);
  });

  it("clears a bounded history preset when permanent retention is selected", () => {
    expect(resolveHistoryRetentionSelection("permanent", 100, "permanent")).toEqual({
      historyRetentionMode: "permanent",
      historyMaxEntries: 500
    });
    expect(resolveHistoryRetentionSelection("permanent", 250, "permanent-100")).toEqual({
      historyRetentionMode: "permanent",
      historyMaxEntries: 100
    });
  });

  it("renders one real sidebar marker and all sections", () => {
    const html = renderToStaticMarkup(<SettingsSidebar actions={viewActions()} model={viewModel()} />);
    expect(count(html, "data-visual-region=\"settings-sidebar\"")).toBe(1);
    for (const section of SETTINGS_SECTIONS) {
      expect(html).toContain(section.label);
    }
    expect(html).toContain("aria-current=\"page\"");
  });

  it("shows every save state without a generic toolbar, pagination or info control", () => {
    for (const saveState of ["clean", "dirty", "saving", "saved", "error"] as const) {
      const html = renderToStaticMarkup(<SettingsContent actions={viewActions()} model={viewModel(saveState)} />);
      expect(html).toContain(getSettingsSaveLabel(saveState));
      expect(html).toContain("Einstellungen speichern");
      expect(html).not.toContain("role=\"toolbar\"");
      expect(html).not.toContain("table-pagination");
      expect(html).not.toContain("ui-context-info");
    }
  });

  it("enables discarding only for unsaved or failed settings drafts", () => {
    let discarded = 0;
    const actions = { ...viewActions(), onDiscard: () => { discarded += 1; } };
    const findDiscard = (content: ReactElement): ReactElement<{ disabled?: boolean; onClick: () => void }> => {
      let result: ReactElement<{ disabled?: boolean; onClick: () => void }> | null = null;
      visitElements(content, (element) => {
        if (element.type === "button" && element.props.children === "Änderungen verwerfen") {
          result = element as ReactElement<{ disabled?: boolean; onClick: () => void }>;
        }
      });
      if (!result) throw new Error("Discard button missing");
      return result;
    };

    const dirty = findDiscard(SettingsContent({ actions, model: viewModel("dirty") }));
    const clean = findDiscard(SettingsContent({ actions, model: viewModel("clean") }));
    const saving = findDiscard(SettingsContent({ actions, model: viewModel("saving") }));
    const saved = findDiscard(SettingsContent({ actions, model: viewModel("saved") }));
    const error = findDiscard(SettingsContent({ actions, model: viewModel("error") }));
    const dirtyWhileSaving = findDiscard(SettingsContent({ actions, model: viewModel("dirty", true) }));

    expect(dirty.props.disabled).toBe(false);
    expect(clean.props.disabled).toBe(true);
    expect(saving.props.disabled).toBe(true);
    expect(saved.props.disabled).toBe(true);
    expect(error.props.disabled).toBe(false);
    expect(dirtyWhileSaving.props.disabled).toBe(true);
    dirty.props.onClick();
    expect(discarded).toBe(1);
  });

  it("renders the settings save action with a green background and black text", () => {
    const html = renderToStaticMarkup(<SettingsContent actions={viewActions()} model={viewModel("dirty")} />);
    const css = readFileSync(new URL("../src/renderer/views/settings/settings.css", import.meta.url), "utf8");

    expect(html).toContain('class="settings-button settings-button-primary settings-save-button"');
    expect(css).toMatch(/\.settings-save-button\s*{[^}]*border-color:\s*var\(--ui-success\);[^}]*background:\s*var\(--ui-success\);[^}]*color:\s*#000000;/s);
    expect(css).toMatch(/\.settings-save-button:hover:not\(:disabled\)\s*{[^}]*background:\s*color-mix\(in srgb, var\(--ui-success\) 86%, #ffffff\);[^}]*color:\s*#000000;/s);
  });

  it("renders the sidebar and content once in the complete view", () => {
    const html = renderToStaticMarkup(<SettingsView actions={viewActions()} model={viewModel()} />);
    expect(count(html, "data-visual-region=\"settings-sidebar\"")).toBe(1);
    expect(count(html, "data-visual-region=\"accounts-table-body\"")).toBe(1);
  });

  it("renders form controls, theme choices and switches through bounded callbacks", () => {
    let changed = "";
    const form = SettingsForm({
      model: formModel(),
      actions: {
        onChange: (id) => { changed = id; },
        onAction: () => {}
      }
    });
    const html = renderToStaticMarkup(form);

    expect(html).toContain("Hell");
    expect(html).toContain("Dunkel");
    expect(html).toContain("System");
    expect(html).toContain("role=\"switch\"");
    const switchButton = findElement(form, (element) => element.props.role === "switch");
    switchButton.props.onClick();
    expect(changed).toBe("autoUpdate");
  });

  it("uses roving focus and complete arrow navigation for theme radios", () => {
    const changes: string[] = [];
    const tree = SettingsForm({
      model: formModel(),
      actions: {
        onChange: (id, value) => changes.push(`${id}:${String(value)}`),
        onAction: () => {}
      }
    });
    const radios = findElements(tree, (element) => element.props.role === "radio");

    expect(radios.map((radio) => radio.props.tabIndex)).toEqual([-1, 0, -1]);

    for (const [key, sourceIndex, targetIndex, value] of [
      ["ArrowRight", 1, 2, "system"],
      ["ArrowDown", 1, 2, "system"],
      ["ArrowLeft", 1, 0, "light"],
      ["ArrowUp", 1, 0, "light"],
      ["Home", 1, 0, "light"],
      ["End", 1, 2, "system"]
    ] as const) {
      const target = compositeKeyboardTarget(radios.length);
      let prevented = false;
      radios[sourceIndex].props.onKeyDown({
        key,
        currentTarget: target.elements[sourceIndex],
        preventDefault: () => { prevented = true; }
      });
      expect(prevented).toBe(true);
      expect(target.focused()).toBe(targetIndex);
      expect(changes.at(-1)).toBe(`theme:${value}`);
    }
  });
});

describe("account workspace", () => {
  it("marks account panels for one measured horizontal selection indicator", () => {
    const html = renderToStaticMarkup(<AccountWorkspace actions={workspaceActions()} model={workspaceModel()} />);

    expect(html).toContain("ui-sliding-selection ui-sliding-selection-horizontal");
    expect(html.match(/data-sliding-selection-item="true"/g)).toHaveLength(3);
    expect(html.match(/data-sliding-selection-active="true"/g)).toHaveLength(1);
  });

  it("shows the last account check directly below the status", () => {
    const html = renderToStaticMarkup(<AccountWorkspace actions={workspaceActions()} model={workspaceModel()} />);

    expect(html).toContain("settings-account-status-checked");
    expect(html).toContain("Geprüft");
    expect(html).toContain("vor 5 Min");
  });

  it("shows a live provider and account overview without exposing raw failure details", () => {
    const html = renderToStaticMarkup(
      <AccountWorkspace
        actions={workspaceActions()}
        model={{ ...workspaceModel(), activePanel: "runtime" as never }}
      />
    );

    expect(html).toContain("Laufzeit");
    expect(html).toContain("Real-Debrid");
    expect(html).toContain("1 von 2 verfügbar");
    expect(html).toContain("<strong>3</strong> aktive Downloads");
    expect(html).toContain("75 % (3/4)");
    expect(html).toContain("Rate-Limit aktiv · 48 Sek.");
    expect(html).not.toContain("HTTP 429");
    expect(html).not.toContain("token-");
  });

  it("uses roving focus and horizontal keyboard navigation for account tabs", () => {
    const panels: string[] = [];
    const tree = AccountWorkspace({
      model: workspaceModel(),
      actions: workspaceActions({ onPanelChange: (panel) => panels.push(panel) })
    });
    const tabs = findElements(tree, (element) => element.props.role === "tab");

    expect(tabs.map((tab) => tab.props.tabIndex)).toEqual([0, -1, -1]);

    for (const [key, sourceIndex, targetIndex, panel] of [
      ["ArrowRight", 0, 1, "rules"],
      ["ArrowLeft", 0, 2, "runtime"],
      ["Home", 1, 0, "overview"],
      ["End", 0, 2, "runtime"]
    ] as const) {
      const target = compositeKeyboardTarget(tabs.length);
      let prevented = false;
      tabs[sourceIndex].props.onKeyDown({
        key,
        currentTarget: target.elements[sourceIndex],
        preventDefault: () => { prevented = true; }
      });
      expect(prevented).toBe(true);
      expect(target.focused()).toBe(targetIndex);
      expect(panels.at(-1)).toBe(panel);
    }

    const rulesTree = AccountWorkspace({
      model: { ...workspaceModel(), activePanel: "rules" },
      actions: workspaceActions()
    });
    const rulesTabs = findElements(rulesTree, (element) => element.props.role === "tab");
    expect(rulesTabs.map((tab) => tab.props.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("announces account loading and errors without hiding the existing table state", () => {
    const loadingHtml = renderToStaticMarkup(
      <AccountWorkspace
        actions={workspaceActions()}
        model={{ ...workspaceModel(), busy: true, rows: [], selectedIds: [] }}
      />
    );
    const errorHtml = renderToStaticMarkup(
      <AccountWorkspace
        actions={workspaceActions()}
        model={{ ...workspaceModel(), busy: false, error: "Accounts konnten nicht geladen werden", rows: [], selectedIds: [] }}
      />
    );

    expect(loadingHtml).toContain('aria-busy="true"');
    expect(loadingHtml).toContain('aria-live="polite"');
    expect(loadingHtml).toContain('role="status"');
    expect(loadingHtml).toContain("Accountdaten werden aktualisiert");
    expect(errorHtml).toContain('role="alert"');
    expect(errorHtml).toContain("Accounts konnten nicht geladen werden");
  });

  it("renders the exact columns, one table marker, full usernames and no raw credentials", () => {
    const html = renderToStaticMarkup(<AccountWorkspace actions={workspaceActions()} model={workspaceModel()} />);
    const positions = ACCOUNT_COLUMNS.map((column) => html.indexOf(column));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(count(html, "data-visual-region=\"accounts-table-body\"")).toBe(1);
    expect(html).toContain("verified@example.test");
    expect(html).not.toContain("ve***st");
    expect(html).toContain("••••••");
    expect(html).not.toContain("test-password");
    expect(html).not.toContain("test-token");
    expect(html).not.toContain("table-pagination");
    expect(html).not.toContain("role=\"toolbar\"");
    expect(count(html, 'role="separator"')).toBe(ACCOUNT_COLUMNS.length);
    expect(html).toContain('aria-label="Status Spaltenbreite ändern"');
    expect(html).toMatch(/class="settings-account-column-actions" role="columnheader">Aktion<\/span>/);
    expect(settingsCss).toMatch(/\.settings-account-column-actions\s*{[^}]*place-items:\s*center end/s);
    expect(settingsCss).not.toMatch(/\.settings-account-column-actions\s*{[^}]*padding-left:/s);
    expect(settingsCss).toMatch(/\.settings-account-row > \.settings-account-column-actions\s*{[^}]*padding-right:\s*19px/s);
    expect(settingsCss).not.toMatch(/\.settings-account-column-actions\s*{[^}]*transform:/s);
  });

  it("offers separate checks for active accounts and every configured account", () => {
    const html = renderToStaticMarkup(<AccountWorkspace actions={workspaceActions()} model={workspaceModel()} />);

    expect(html).toContain("Aktive aktualisieren");
    expect(html).toContain("Alle aktualisieren");
    expect(html).toContain('title="Prüft nur aktivierte Accounts."');
    expect(html).toContain('title="Prüft alle angelegten Accounts, auch deaktivierte."');
  });

  it("disables the active account check when no enabled account can be checked", () => {
    const model = workspaceModel();
    const html = renderToStaticMarkup(
      <AccountWorkspace
        actions={workspaceActions()}
        model={{ ...model, rows: model.rows.map((row) => ({ ...row, enabled: false })) }}
      />
    );

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>↻ Aktive aktualisieren<\/button>/);
    expect(html).toMatch(/<button[^>]*>↻ Alle aktualisieren<\/button>/);
  });

  it("clamps and serializes persistent account table column widths", () => {
    const api = settingsModel as typeof settingsModel & {
      createAccountTableColumnWidths?: () => Record<string, number>;
      resizeAccountTableColumn?: (widths: Record<string, number>, column: string, delta: number) => Record<string, number>;
      getAccountTableGridTemplate?: (widths: Record<string, number>) => string;
    };

    expect(api.createAccountTableColumnWidths).toBeTypeOf("function");
    expect(api.resizeAccountTableColumn).toBeTypeOf("function");
    expect(api.getAccountTableGridTemplate).toBeTypeOf("function");
    const initial = api.createAccountTableColumnWidths?.() || {};
    const widened = api.resizeAccountTableColumn?.(initial, "status", 120) || {};
    const narrowed = api.resizeAccountTableColumn?.(widened, "status", -10_000) || {};

    expect(widened.status).toBeGreaterThan(initial.status);
    expect(narrowed.status).toBeGreaterThanOrEqual(120);
    expect(api.getAccountTableGridTemplate?.(widened)).toContain(`${widened.status}px`);
    expect(api.getAccountTableGridTemplate?.(widened)).toMatch(/minmax\(64px, 1fr\)$/);
  });

  it("keeps row selection, enable toggles, edit and context actions separate", () => {
    const calls: string[] = [];
    const tree = AccountWorkspace({
      model: workspaceModel(),
      actions: workspaceActions({
        onSelect: (id, additive) => calls.push(`select:${id}:${additive}`),
        onToggleEnabled: (id, enabled) => calls.push(`toggle:${id}:${enabled}`),
        onEdit: (id) => calls.push(`edit:${id}`),
        onContextMenu: (id) => calls.push(`context:${id}`)
      })
    });
    const row = findElement(tree, (element) => element.props.role === "row" && element.props["aria-selected"] === true);
    const checkbox = findElement(row, (element) => element.type === "input" && element.props.type === "checkbox");
    const actionButton = findElement(row, (element) => element.type === "button" && String(element.props["aria-label"] || "").includes("Aktionen"));
    const rowId = workspaceModel().rows[0].id;

    row.props.onClick({ target: { role: "cell" }, currentTarget: row, ctrlKey: false, metaKey: false });
    row.props.onClick({ target: { role: "cell" }, currentTarget: row, ctrlKey: true, metaKey: false });
    row.props.onKeyDown({ key: "Enter", target: row, currentTarget: row, preventDefault: () => {} });
    row.props.onKeyDown({ key: " ", target: checkbox, currentTarget: row, preventDefault: () => {} });
    checkbox.props.onChange({ target: { checked: false } });
    checkbox.props.onDoubleClick({ stopPropagation: () => calls.push("checkbox-double-click-stopped") });
    row.props.onDoubleClick();
    actionButton.props.onClick({ stopPropagation: () => {}, currentTarget: { getBoundingClientRect: () => ({ right: 20, bottom: 30 }) } });
    actionButton.props.onDoubleClick({ stopPropagation: () => calls.push("action-double-click-stopped") });

    expect(calls).toEqual([
      `select:${rowId}:false`,
      `select:${rowId}:true`,
      `select:${rowId}:false`,
      `toggle:${rowId}:false`,
      "checkbox-double-click-stopped",
      `edit:${rowId}`,
      `context:${rowId}`,
      "action-double-click-stopped"
    ]);
  });

  it("formats the account action heading as hoster and access type without a dangling marker", () => {
    const api = settingsModel as typeof settingsModel & {
      formatAccountContextHeading?: (hoster: string, mode: string) => string;
    };

    expect(api.formatAccountContextHeading).toBeTypeOf("function");
    expect(api.formatAccountContextHeading?.("Debrid-Link", "API")).toBe("Debrid-Link | API");
    expect(api.formatAccountContextHeading?.("Mega-Debrid", "Web-Login")).toBe("Mega-Debrid | Web-Login");
  });

  it("shows the selected account count", () => {
    const model = workspaceModel();
    const tree = AccountWorkspace({
      actions: workspaceActions(),
      model: { ...model, selectedIds: model.rows.slice(0, 3).map((row) => row.id) }
    });
    const html = renderToStaticMarkup(tree);

    expect(html).toContain("− Entfernen (3)");
  });

  it("removes the redundant global account activation switch", () => {
    const legacyActions = { ...workspaceActions(), onSetAllEnabled: () => {} } as AccountWorkspaceActions;
    const legacyModel = { ...workspaceModel(), allEnabled: true } as AccountWorkspaceViewModel;
    const html = renderToStaticMarkup(
      <AccountWorkspace
        actions={legacyActions}
        model={legacyModel}
      />
    );

    expect(html).not.toContain("Accounts zum Herunterladen verwenden");
    expect(settingsCss).toMatch(/\.settings-account-row\.is-selected\s*{[^}]*#5b8cff[^}]*box-shadow:/s);
  });

  it("copies only populated username and email cells without triggering the row", () => {
    const copies: string[] = [];
    const tree = AccountWorkspace({
      model: workspaceModel(),
      actions: workspaceActions({
        onCopyIdentity: (label, value) => copies.push(`${label}:${value}`)
      })
    });
    const buttons = findElements(tree, (element) => String(element.props.className || "").includes("settings-account-copy-button"));
    const copyableCells = findElements(tree, (element) => ["settings-account-username", "settings-account-email"].includes(String(element.props.className || "")))
      .filter((element) => element.props.title === "Klicken zum Kopieren");
    const username = buttons.find((button) => button.props["aria-label"] === "Benutzername kopieren");
    const email = buttons.find((button) => button.props["aria-label"] === "E-Mail kopieren");
    let stopped = 0;

    username?.props.onClick({ stopPropagation: () => { stopped += 1; } });
    email?.props.onClick({ stopPropagation: () => { stopped += 1; } });
    username?.props.onDoubleClick({ stopPropagation: () => { stopped += 1; } });

    expect(buttons.some((button) => button.props.children === "—")).toBe(false);
    expect(copyableCells).toHaveLength(buttons.length);
    expect(copies).toEqual([
      "Benutzername:stored-user",
      "E-Mail:verified@example.test"
    ]);
    expect(stopped).toBe(3);
  });

  it("keeps all account panels in the same workspace while only one panel is active", () => {
    const html = renderToStaticMarkup(<AccountWorkspace actions={workspaceActions()} model={workspaceModel()} />);
    expect(count(html, "class=\"settings-account-panel\"")).toBe(3);
    expect(count(html, "hidden=\"\"")).toBe(2);
    expect(html).toContain("Provider-Reihenfolge");
    expect(html).toContain("Hoster-Routing");
    expect(html).toContain("Automatischer Fallback");
    expect(html).toContain("Provider-Laufzeit");
    expect(html).toContain("Debrid-Link (API)");
    expect(html).toContain("Real-Debrid (Web-Login)");
    expect(html).toContain("./provider-icons/debrid-link.ico");
    expect(html).toContain("./provider-icons/real-debrid.png");
  });

  it("keeps add and edit dialogs separate and every secret field protected", () => {
    const options = accountOptions();
    const addHtml = renderToStaticMarkup(
      <AccountAddDialog
        actions={{
          onQueryChange: () => {},
          onServiceFilterChange: () => {},
          onOptionSelect: () => {},
          onFieldChange: () => {},
          onClose: () => {},
          onSubmit: () => {}
        }}
        model={{
          open: true,
          query: "",
          serviceFilter: "all",
          serviceFilters: ["Real-Debrid", "DDownload", "Mega-Debrid", "Debrid-Link"],
          options,
          selectedOptionId: "megadebrid-api",
          fields: [
            { id: "login", label: "Login", type: "text", value: "member@example.test" },
            { id: "password", label: "Passwort", type: "password", value: "test-password" }
          ],
          error: "",
          busy: false
        }}
      />
    );
    const editHtml = renderToStaticMarkup(
      <AccountEditDialog
        actions={{
          onFieldChange: () => {},
          onClose: () => {},
          onCheck: () => {},
          onSave: () => {},
          onRemove: () => {},
          onToggleEnabled: () => {},
          onToggleSecret: () => {},
          onCopySecret: () => {}
        }}
        model={{
          open: true,
          hoster: "Mega-Debrid",
          mode: "API",
          identity: "member@example.test",
          enabled: true,
          fields: [
            { id: "login", label: "Login", type: "text", value: "member@example.test" },
            { id: "password", label: "Passwort", type: "password", value: "", storedSecret: true, secretVisible: false },
            { id: "token", label: "Token", type: "password", value: "", storedSecret: true, secretVisible: false },
            { id: "dailyLimitGb", label: "Tageslimit (GB, optional)", type: "number", value: "" }
          ],
          error: "",
          busy: false
        }}
      />
    );

    expect(addHtml).toContain("Account hinzufügen");
    expect(addHtml).toContain("Prüfen und speichern");
    expect(count(addHtml, "<select")).toBe(1);
    expect(addHtml).toContain('aria-label="Dienst filtern"');
    expect(addHtml).toContain("Alle Dienste");
    expect(addHtml).toContain('aria-label="Dienst oder Zugangstyp suchen"');
    expect(addHtml).toContain('role="listbox"');
    expect(addHtml).toContain('class="settings-account-picker-header"');
    expect(addHtml).toContain("Dienst");
    expect(addHtml).toContain("Typ/Funktion");
    options.forEach((option) => expect(addHtml).toContain(`data-account-option-id="${option.id}"`));
    expect(addHtml).toContain('data-account-option-id="megadebrid-api"');
    expect(addHtml).toContain('aria-selected="true"');
    expect(addHtml).toContain("Weiteren Account hinzufügen");
    expect(addHtml).toContain("Login:Passwort");
    expect(addHtml).toContain('type="search"');
    expect(addHtml).toContain("settings-account-picker-row");
    expect(count(addHtml, 'class="settings-account-dialog-fields"')).toBe(1);
    expect(addHtml.indexOf('aria-label="Dienst oder Zugangstyp suchen"')).toBeLessThan(addHtml.indexOf("settings-account-picker-table"));
    expect(addHtml.indexOf("settings-account-picker-table")).toBeLessThan(addHtml.indexOf("settings-account-dialog-fields"));
    expect(editHtml).toContain("Account bearbeiten");
    expect(editHtml).toContain("member@example.test");
    expect(editHtml).toContain("Entfernen");
    expect(editHtml).toContain("Prüfen");
    expect(count(addHtml, "type=\"password\"")).toBe(1);
    expect(count(editHtml, "type=\"password\"")).toBe(2);
    expect(editHtml).toContain('aria-label="Passwort anzeigen"');
    expect(editHtml).toContain('aria-label="Token anzeigen"');
    expect(editHtml.indexOf("Tageslimit (GB, optional)")).toBeLessThan(editHtml.indexOf("Account aktiviert"));
  });

  it("selects the account option through the compact service table", () => {
    const selected: string[] = [];
    const tree = AccountAddDialog({
      actions: {
        onQueryChange: () => {},
        onServiceFilterChange: () => {},
        onOptionSelect: (optionId) => selected.push(optionId),
        onFieldChange: () => {},
        onClose: () => {},
        onSubmit: () => {}
      },
      model: {
        open: true,
        query: "",
        serviceFilter: "all",
        serviceFilters: ["Real-Debrid", "DDownload", "Mega-Debrid", "Debrid-Link"],
        options: accountOptions(),
        selectedOptionId: "megadebrid-api",
        fields: [],
        error: "",
        busy: false
      }
    });
    const selector = findElement(tree, (element) => element.props["data-account-option-id"] === "debridlink-api");

    selector.props.onClick();

    expect(selected).toEqual(["debridlink-api"]);
  });

  it("filters by service and selects the first visible option with Enter", () => {
    const selected: string[] = [];
    const serviceFilters: string[] = [];
    const options = accountOptions().filter((option) => option.title === "Mega-Debrid");
    const tree = AccountAddDialog({
      actions: {
        onQueryChange: () => {},
        onServiceFilterChange: (service) => serviceFilters.push(service),
        onOptionSelect: (optionId) => selected.push(optionId),
        onFieldChange: () => {},
        onClose: () => {},
        onSubmit: () => {}
      },
      model: {
        open: true,
        query: "api",
        serviceFilter: "Mega-Debrid",
        serviceFilters: ["Real-Debrid", "Mega-Debrid"],
        options,
        selectedOptionId: options[0].id,
        fields: [],
        error: "",
        busy: false
      }
    });
    const serviceSelect = findElement(tree, (element) => element.props["aria-label"] === "Dienst filtern");
    const search = findElement(tree, (element) => element.props["aria-label"] === "Dienst oder Zugangstyp suchen");

    serviceSelect.props.onChange({ target: { value: "Real-Debrid" } });
    search.props.onKeyDown({ key: "Enter", preventDefault: () => selected.push("prevented") });

    expect(serviceFilters).toEqual(["Real-Debrid"]);
    expect(selected).toEqual(["prevented", "megadebrid-api"]);
  });

  it("shows an accessible empty result when account search has no matches", () => {
    const html = renderToStaticMarkup(
      <AccountAddDialog
        actions={{
          onQueryChange: () => {},
          onServiceFilterChange: () => {},
          onOptionSelect: () => {},
          onFieldChange: () => {},
          onClose: () => {},
          onSubmit: () => {}
        }}
        model={{
          open: true,
          query: "nicht vorhanden",
          serviceFilter: "all",
          serviceFilters: ["Real-Debrid"],
          options: [],
          selectedOptionId: null,
          fields: [],
          error: "",
          busy: false
        }}
      />
    );

    expect(html).toContain('aria-describedby="settings-account-picker-empty"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="status"');
    expect(html).toContain("Keine passenden Dienste oder Zugangstypen gefunden");
  });

  it("keeps stored usernames separate from provider email addresses", () => {
    const rows = projectAccountRows(accountSources(), [], NOW);

    expect(rows[0].username).toBe("stored-user");
    expect(rows[0].email).toBe("verified@example.test");
    expect(ACCOUNT_COLUMNS).toContain("E-Mail");

    const html = renderToStaticMarkup(<AccountWorkspace actions={workspaceActions()} model={workspaceModel()} />);
    expect(html).toContain("stored-user");
    expect(html).toContain("verified@example.test");
  });
});

describe("settings App integration", () => {
  it("serializes local and online backup imports with pending account mutations", () => {
    const localImport = sourceBlock(appSource, "const onImportBackup", "const onCreateOnlineBackup");
    const onlineImport = sourceBlock(appSource, "const onImportOnlineBackup", "const onCopyOnlineBackupKey");

    expect(localImport).toContain("runQueuedSettingsMutation");
    expect(onlineImport).toContain("runQueuedSettingsMutation");
    expect(localImport.indexOf("runQueuedSettingsMutation")).toBeLessThan(localImport.indexOf("runLocalBackupImport"));
    expect(onlineImport.indexOf("runQueuedSettingsMutation")).toBeLessThan(onlineImport.indexOf("window.rd.importOnlineBackup"));
  });

  it("projects provider order entries with logos and explicit login modes", () => {
    const settings = createRendererSettings({
      ...defaultSettings(),
      megaDebridWebEnabled: true,
      megaDebridWebCredentials: "member:password",
      deepbridApiKey: "test-key",
      providerOrder: ["megadebrid-web", "deepbrid"]
    });

    expect(buildProviderOrderEntry("megadebrid-web", settings)).toEqual({
      id: "megadebrid-web",
      label: "Mega-Debrid (Web-Login)",
      icon: "./provider-icons/mega-debrid.png"
    });
    expect(buildProviderOrderEntry("deepbrid", settings)).toEqual({
      id: "deepbrid",
      label: "Deepbrid (API)",
      icon: "./provider-icons/deepbrid.png"
    });
  });

  it("preserves the write-only webhook during live snapshots and clears it for backup reseeding", () => {
    const safe = createRendererSettings({ ...defaultSettings(), notifyUrl: "https://private.example.test/hook" });
    const current = { ...safe, archivePasswordList: "loaded-password", notifyUrl: "https://private.example.test/hook" };

    expect(createSettingsDraft(safe, current).notifyUrl).toBe("https://private.example.test/hook");
    expect(createSettingsDraft(safe).notifyUrl).toBe("");
    expect(appSource).toContain("applyPersistedSettings(fresh.settings, false)");
  });

  it("rebuilds every local settings input from the last persisted state", () => {
    const persisted = createRendererSettings({
      ...defaultSettings(),
      theme: "light",
      speedLimitKbps: 12 * 1024,
      bandwidthSchedules: [{ id: "night", startHour: 22, endHour: 6, speedLimitKbps: 8 * 1024, enabled: true }]
    });

    expect(createDiscardedSettingsState(persisted, "system")).toEqual({
      draft: { ...persisted, archivePasswordList: "", notifyUrl: "" },
      themeChoice: "system",
      speedLimitInput: "12",
      scheduleSpeedInputs: { night: "8" }
    });
  });

  it("uses the persisted semantic theme preference as the settings field value", () => {
    const form = buildSettingsFormViewModel({
      settings: {
        ...createRendererSettings({ ...defaultSettings(), theme: "dark", themePreference: "system" }),
        archivePasswordList: "",
        notifyUrl: ""
      },
      section: "allgemein",
      speedLimitInput: "0",
      scheduleSpeedInputs: {}
    });

    expect(form.groups.flatMap((group) => group.fields).find((field) => field.id === "theme")).toEqual(expect.objectContaining({
      value: "system",
      options: [
        { value: "light", label: "Hell" },
        { value: "dark", label: "Dunkel" },
        { value: "system", label: "System" }
      ]
    }));
  });

  it("does not apply a stale save result over newer draft changes", () => {
    expect(resolveSettingsSaveCompletion(4, 4)).toEqual({
      saveState: "saved",
      applyPersistedTheme: true,
      toast: "Einstellungen gespeichert"
    });
    expect(resolveSettingsSaveCompletion(4, 5)).toEqual({
      saveState: "dirty",
      applyPersistedTheme: false,
      toast: "Zwischenstand gespeichert – weitere Änderungen sind ungespeichert"
    });
  });

  it("loads and preserves the stored archive password list in the extraction section", () => {
    const revealBlock = sourceBlock(appSource, "const showToast", "const clearImportQueueFocusListener");
    const applyBlock = sourceBlock(appSource, "const applyPersistedSettings", "const syncLiveProviderUsageSettings");
    const mainSource = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");

    expect(revealBlock).toContain("window.rd.getArchivePasswordList()");
    expect(revealBlock).toContain('settingsSubTab !== "extract"');
    expect(appSource).toContain("setSettingsDraft((current) => createSettingsDraft({ ...state.settings, theme: resolvedTheme }, current))");
    expect(appSource).toContain("setSettingsDraft((current) => createSettingsDraft(next.settings, current))");
    expect(applyBlock).toContain("setSettingsDraft((current) => createSettingsDraft(result, preserveWriteOnlyValues ? current : undefined))");
    expect(mainSource).toContain("handleTrusted(IPC_CHANNELS.GET_ARCHIVE_PASSWORD_LIST");
  });

  it("persists an edited archive password list before unrelated account mutations", () => {
    const editBlock = sourceBlock(appSource, "const onSaveAccountEditDialog", "const onSaveAccountDialog");
    const createBlock = sourceBlock(appSource, "const onSaveAccountDialog", "const onResetAccountDailyUsage");
    const deleteKeyBlock = sourceBlock(appSource, "const onRemoveDebridLinkKey", "const onToggleAccountEnabled");
    const deleteRowsBlock = sourceBlock(appSource, "const removeAccountTableRows", "const checkAccountsActive");

    expect(editBlock.indexOf("await persistDraftSettingsDirect()")).toBeLessThan(editBlock.indexOf("window.rd.replaceAccount"));
    expect(createBlock.indexOf("await persistDraftSettingsDirect()")).toBeLessThan(createBlock.indexOf("window.rd.createAccount"));
    expect(deleteKeyBlock.indexOf("await persistDraftSettingsDirect()")).toBeLessThan(deleteKeyBlock.indexOf("window.rd.deleteAccount"));
    expect(deleteRowsBlock.indexOf("await persistDraftSettingsDirect()")).toBeLessThan(deleteRowsBlock.indexOf("window.rd.deleteAccount"));
  });

  it("invalidates an archive password reveal before applying imported settings", () => {
    const applyBlock = sourceBlock(appSource, "const applyPersistedSettings", "const syncLiveProviderUsageSettings");

    expect(applyBlock).toContain("archivePasswordLoadGenerationRef.current += 1");
    expect(applyBlock.indexOf("archivePasswordLoadGenerationRef.current += 1")).toBeLessThan(applyBlock.indexOf("setSettingsDraft"));
  });

  it("enables an account by clearing both its row-level and provider-level locks", () => {
    expect(buildScopedAccountEnabledState(
      ["debridlink", "linksnappy"],
      ["debridlink"],
      ["key-disabled", "key-other"],
      "key-disabled",
      true
    )).toEqual({
      disabledProviders: ["linksnappy"],
      disabledAccountIds: ["key-other"]
    });

    expect(buildScopedAccountEnabledState([], ["debridlink"], [], "key-active", false)).toEqual({
      disabledProviders: [],
      disabledAccountIds: ["key-active"]
    });

    const rendererSettings = createRendererSettings(defaultSettings());
    const megaPatch = buildAccountTogglePatch({
      ...rendererSettings,
      disabledProviders: ["megadebrid-web"],
      megaDebridWebEnabled: false,
      megaDebridWebDisabledAccountIds: ["mega-web-account"]
    }, { type: "megadebrid", provider: "megadebrid-web", accountId: "mega-web-account" }, true);
    expect(megaPatch).toEqual(expect.objectContaining({
      disabledProviders: [],
      megaDebridWebEnabled: true,
      megaDebridWebDisabledAccountIds: []
    }));
  });

  it("shows a failed all-account check even when the account is disabled", () => {
    expect(resolveAccountStatusState(true, { valid: false, isPremium: false })).toBe("invalid");
    expect(resolveAccountStatusState(true, { valid: true, isPremium: true })).toBe("disabled");
    expect(resolveAccountStatusState(false, undefined)).toBe("unchecked");
  });

  it("keeps new Mega-Debrid credentials empty and never exposes stored accounts as an API key", () => {
    const settings = {
      ...defaultSettings(),
      megaCredentials: "first@example.test:first-secret\nsecond@example.test:second-secret",
      debridLinkApiKeys: "existing-debrid-link-key"
    };
    const rendererSettings = createRendererSettings(settings);
    const megaDialog = createAccountDialogState("create", "megadebrid-api", rendererSettings);
    const megaFields = buildAccountAddFields(megaDialog);
    const debridLinkFields = buildAccountAddFields(createAccountDialogState("create", "debridlink-api", rendererSettings));

    expect(megaDialog.megaNewLogin).toBe("");
    expect(megaDialog.megaNewPassword).toBe("");
    expect(megaDialog.token).toBe("");
    expect(megaFields.map((field) => field.id)).toEqual(["megaNewLogin", "megaNewPassword", "dailyLimitGb"]);
    expect(megaFields.map((field) => field.label)).not.toContain("Token / API-Key");
    expect(debridLinkFields.find((field) => field.id === "token")).toEqual(expect.objectContaining({ value: "" }));
  });

  it("keeps unchecked single accounts honest without a positive status", () => {
    const block = sourceBlock(appSource, "const accountSources", "const selectedAccountViewId");
    expect(block).toContain("resolveAccountStatusState(row.disabled, checkedStatus, runtimeNow)");
  });

  it("stores only the stable account row id in context-menu state", () => {
    const stateBlock = sourceBlock(appSource, "interface AccountContextMenuState", "function getAccountQuickActionMeta");
    expect(stateBlock).toContain("rowId: string");
    expect(stateBlock).not.toContain("row: AccountTableRow");
    expect(appSource).toContain("activeAccountContextRow");
  });

  it("preserves the System theme choice while applying its resolved palette", () => {
    expect(appSource).toContain("settingsThemeChoice");
    expect(appSource).toContain("resolveSettingsThemeChoice");
  });

  it("restores and persists the semantic theme choice through backend settings", () => {
    const startupBlock = sourceBlock(appSource, "void window.rd.getSnapshot()", "unsubscribe = window.rd.onStateUpdate");
    const saveBlock = sourceBlock(appSource, "const persistDraftSettingsDirect", "const persistDraftSettings =");

    expect(appSource).not.toContain("SETTINGS_THEME_CHOICE_STORAGE_KEY");
    expect(appSource).not.toContain("window.localStorage");
    expect(startupBlock).toContain("state.settings.themePreference");
    expect(saveBlock).toContain("themePreference: themeChoiceAtStart");
  });

  it("tracks operating-system palette changes only while System is selected", () => {
    expect(appSource).toContain('addEventListener("change", onSystemThemeChange)');
    expect(appSource).toContain('removeEventListener("change", onSystemThemeChange)');
    expect(appSource).toContain('settingsThemeChoiceRef.current !== "system"');
  });

  it("clears the live bandwidth chart only after a confirmed session reset succeeds", () => {
    const resetBlock = sourceBlock(appSource, "onResetSession: () => {", "onResetAll: () => {");
    const resetSuccessBlock = sourceBlock(resetBlock, "return window.rd.resetSessionStats().then(() => {", "}).catch((error) => {");

    expect(resetSuccessBlock).toContain("speedHistoryRef.current = []");
    expect(resetBlock.indexOf("window.rd.resetSessionStats()")).toBeLessThan(resetBlock.indexOf("speedHistoryRef.current = []"));
  });

  it("clears stale history state when loading the persisted history fails", () => {
    const loadBlock = sourceBlock(appSource, "const loadHistoryEntries", "useEffect(() => {");
    const catchBlock = sourceBlock(loadBlock, "} catch {", "} finally {");

    expect(catchBlock).toContain("pendingLiveHistoryEntriesRef.current = []");
    expect(catchBlock).toContain("applyHistoryEntries([])");
    expect(catchBlock.indexOf("pendingLiveHistoryEntriesRef.current = []")).toBeLessThan(catchBlock.indexOf("setHistoryError"));
    expect(catchBlock.indexOf("applyHistoryEntries([])")).toBeLessThan(catchBlock.indexOf("setHistoryError"));
  });
});

describe("settings geometry", () => {
  it("uses central focus and semantic status text tokens", () => {
    expect(settingsCss).toContain(".settings-account-status-checked");
    expect(settingsCss).toMatch(/\.settings-theme-option:focus-visible,[^{]*\.settings-account-picker-row:focus-visible\s*{[^}]*outline:\s*2px solid var\(--ui-focus\);/s);
    expect(settingsCss).toMatch(/\.settings-save-state\.is-clean,[^{]*\.settings-save-state\.is-saved\s*{[^}]*color:\s*var\(--ui-success-text\);/s);
    expect(settingsCss).toMatch(/\.settings-save-state\.is-dirty,[^{]*\.settings-save-state\.is-saving\s*{[^}]*color:\s*var\(--ui-warning-text\);/s);
    expect(settingsCss).toMatch(/\.settings-save-state\.is-error\s*{[^}]*color:\s*var\(--ui-danger-text\);/s);
    expect(settingsCss).toMatch(/\.settings-account-status-badge\.is-ok\s*{[^}]*color:\s*var\(--ui-success-text\);/s);
    expect(settingsCss).toMatch(/\.settings-account-status-badge\.is-free,[^{]*\.settings-account-status-badge\.is-unknown\s*{[^}]*color:\s*var\(--ui-warning-text\);/s);
    expect(settingsCss).toMatch(/\.settings-account-status-badge\.is-invalid\s*{[^}]*color:\s*var\(--ui-danger-text\);/s);
    expect(settingsCss).toMatch(/\.settings-account-table-error \.ui-data-table-empty-title,[^{]*\.settings-account-dialog-error\s*{[^}]*color:\s*var\(--ui-danger-text\);/s);
  });

  it("keeps the specified form, table, switch, overflow and selection geometry", () => {
    const css = readFileSync(new URL("../src/renderer/views/settings/settings.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.settings-account-picker-list\s*{[^}]*height:\s*190px;[^}]*scrollbar-gutter:\s*stable;/s);
    expect(css).toMatch(/\.settings-account-picker-empty\s*{[^}]*height:\s*190px;/s);
    expect(css).toMatch(/\.settings-content\s*{[^}]*padding:\s*24px;/s);
    expect(css).toMatch(
      /\.md-runtime-view-content\s*>\s*\.settings-content\s*{[^}]*height:\s*100%;[^}]*padding:\s*24px;/s
    );
    expect(css).toMatch(/\.settings-form-column\s*{[^}]*width:\s*500px;[^}]*max-width:\s*100%;/s);
    expect(css).toMatch(/\.settings-control\s*{[^}]*height:\s*44px;[^}]*border-radius:\s*6px;/s);
    expect(css).toMatch(/\.settings-switch\s*{[^}]*width:\s*40px;[^}]*height:\s*20px;/s);
    expect(css).toMatch(/\.settings-switch\.is-on\s*{[^}]*border-color:\s*var\(--ui-success\);[^}]*background:\s*var\(--ui-success\);/s);
    expect(css).toMatch(/\.settings-account-table-header\s*{[^}]*height:\s*41px;/s);
    expect(css).toMatch(/\.settings-account-table-header\s*{[^}]*overflow:\s*hidden;/s);
    expect(css).toMatch(/\.settings-account-table-grid\s*{[^}]*color:\s*var\(--ui-text\);/s);
    expect(css).toMatch(/\.settings-account-row\s*{[^}]*height:\s*48px;/s);
    expect(css).toMatch(/\.settings-account-table-body\s*{[^}]*overflow:\s*auto;/s);
    expect(css).toMatch(/\.settings-account-status-badge\.is-ok::before\s*{[^}]*background:\s*var\(--ui-success\);/s);
    expect(accountWorkspaceSource).toContain("onScroll={syncAccountTableScroll}");
    expect(css).toMatch(/\.settings-view\s*{[^}]*min-width:\s*0;/s);
    expect(css).toMatch(/\.settings-account-workspace\s*{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*min-height:\s*0;/s);
    expect(css).toMatch(/\.settings-static\s*{[^}]*user-select:\s*none;/s);
    expect(css).toMatch(/\.settings-content\s+:where\(input,\s*textarea,\s*\[contenteditable="true"\],\s*\.settings-copyable\)\s*{[^}]*user-select:\s*text;/s);
  });
});
