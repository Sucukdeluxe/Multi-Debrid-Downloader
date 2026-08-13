import { readFileSync } from "node:fs";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultSettings } from "../src/main/constants";
import { createRendererSettings, createRendererState } from "../src/main/renderer-state";
import { buildAccountAddFields, createAccountDialogState } from "../src/renderer/App";
import { buildAccountReplaceCommand, createAccountEditState, type AccountEditTarget } from "../src/renderer/account-edit";
import { buildConfiguredProviderOrder } from "../src/renderer/account-ui";
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
  projectAccountRows,
  pruneAccountSelection,
  reconcileAccountAddDraft,
  resolveHistoryRetentionSelection,
  sortAccountRows,
  type AccountAddOption,
  type AccountRowSource,
  type SettingsFormViewModel
} from "../src/renderer/views/settings/settings-model";
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
      status: { state: "free", message: "Free Account", premiumUntilMs: null },
      dailyLimitBytes: 0,
      dailyUsageBytes: 0,
      username: "free-user",
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
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
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
      providerOrder: ["Debrid-Link", "Real-Debrid"],
      routing: ["rapidgator.net → Debrid-Link"],
      autoFallback: true
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
    onAdd: () => {},
    onRemoveSelected: () => {},
    onCheckAll: () => {},
    ...overrides
  };
}

function viewModel(saveState: SettingsViewModel["saveState"] = "clean"): SettingsViewModel {
  return {
    section: "accounts",
    saveState,
    form: formModel(),
    accounts: workspaceModel()
  };
}

function viewActions(): SettingsViewActions {
  return {
    onSectionChange: () => {},
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
    expect(rows[1].credential).toBe("API-Key");
    expect(rows.map((row) => row.status.tone)).toEqual(["ok", "free", "invalid", "unknown", "disabled"]);
    expect(rows.map((row) => row.status.text)).toEqual([
      "Premium aktiv",
      "Free Account",
      "Login abgelehnt",
      "Noch nicht geprüft",
      "Deaktiviert"
    ]);
    expect(JSON.stringify(rows)).not.toContain("test-password");
    expect(JSON.stringify(rows)).not.toContain("test-token");
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

    expect(html).toContain("Light");
    expect(html).toContain("Dark");
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
    expect(html.match(/data-sliding-selection-item="true"/g)).toHaveLength(2);
    expect(html.match(/data-sliding-selection-active="true"/g)).toHaveLength(1);
  });

  it("uses roving focus and horizontal keyboard navigation for account tabs", () => {
    const panels: string[] = [];
    const tree = AccountWorkspace({
      model: workspaceModel(),
      actions: workspaceActions({ onPanelChange: (panel) => panels.push(panel) })
    });
    const tabs = findElements(tree, (element) => element.props.role === "tab");

    expect(tabs.map((tab) => tab.props.tabIndex)).toEqual([0, -1]);

    for (const [key, sourceIndex, targetIndex, panel] of [
      ["ArrowRight", 0, 1, "rules"],
      ["ArrowLeft", 0, 1, "rules"],
      ["Home", 1, 0, "overview"],
      ["End", 0, 1, "rules"]
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
    expect(rulesTabs.map((tab) => tab.props.tabIndex)).toEqual([-1, 0]);
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
  });

  it("keeps row selection, enable toggles, edit and context actions separate", () => {
    const calls: string[] = [];
    const tree = AccountWorkspace({
      model: workspaceModel(),
      actions: workspaceActions({
        onSelect: (id) => calls.push(`select:${id}`),
        onToggleEnabled: (id) => calls.push(`toggle:${id}`),
        onEdit: (id) => calls.push(`edit:${id}`),
        onContextMenu: (id) => calls.push(`context:${id}`)
      })
    });
    const row = findElement(tree, (element) => element.props.role === "row" && element.props["aria-selected"] === true);
    const checkbox = findElement(row, (element) => element.type === "input" && element.props.type === "checkbox");
    const actionButton = findElement(row, (element) => element.type === "button" && String(element.props["aria-label"] || "").includes("Aktionen"));
    const rowId = workspaceModel().rows[0].id;

    row.props.onClick({ target: { role: "cell" }, currentTarget: row });
    row.props.onKeyDown({ key: "Enter", target: row, currentTarget: row, preventDefault: () => {} });
    row.props.onKeyDown({ key: " ", target: checkbox, currentTarget: row, preventDefault: () => {} });
    checkbox.props.onChange();
    row.props.onDoubleClick();
    actionButton.props.onClick({ stopPropagation: () => {}, currentTarget: { getBoundingClientRect: () => ({ right: 20, bottom: 30 }) } });

    expect(calls).toEqual([
      `select:${rowId}`,
      `select:${rowId}`,
      `toggle:${rowId}`,
      `edit:${rowId}`,
      `context:${rowId}`
    ]);
  });

  it("does not open account editing when the enable checkbox is double-clicked", () => {
    const calls: string[] = [];
    const tree = AccountWorkspace({
      model: workspaceModel(),
      actions: workspaceActions({
        onToggleEnabled: (id) => calls.push(`toggle:${id}`),
        onEdit: (id) => calls.push(`edit:${id}`)
      })
    });
    const row = findElement(tree, (element) => element.props.role === "row" && element.props["aria-selected"] === true);
    const checkbox = findElement(row, (element) => element.type === "input" && element.props.type === "checkbox");
    const event = {
      propagationStopped: false,
      stopPropagation() {
        this.propagationStopped = true;
      }
    };

    checkbox.props.onChange();
    checkbox.props.onDoubleClick(event);
    if (!event.propagationStopped) {
      row.props.onDoubleClick();
    }

    expect(calls).toEqual([`toggle:${workspaceModel().rows[0].id}`]);
  });

  it("does not expose a global switch that enables or disables every account", () => {
    const legacyModel = { ...workspaceModel(), allEnabled: true } as AccountWorkspaceViewModel;
    const legacyActions = { ...workspaceActions(), onSetAllEnabled: () => {} } as AccountWorkspaceActions;
    const html = renderToStaticMarkup(<AccountWorkspace actions={legacyActions} model={legacyModel} />);

    expect(html).not.toContain("Accounts zum Herunterladen verwenden");
    expect(html).not.toContain("settings-account-all-enabled");
  });

  it("keeps overview and rules in the same workspace while only one panel is active", () => {
    const html = renderToStaticMarkup(<AccountWorkspace actions={workspaceActions()} model={workspaceModel()} />);
    expect(count(html, "class=\"settings-account-panel\"")).toBe(2);
    expect(count(html, "hidden=\"\"")).toBe(1);
    expect(html).toContain("Provider-Reihenfolge");
    expect(html).toContain("Hoster-Routing");
    expect(html).toContain("Automatischer Fallback");
  });

  it("offers a visible action that resets every Mega-Debrid cooldown", () => {
    const calls: string[] = [];
    const tree = AccountWorkspace({
      model: {
        ...workspaceModel(),
        activePanel: "rules",
        rules: {
          ...workspaceModel().rules,
          rotationEvents: [{ id: "rotation-1", title: "Mega-Debrid Web · Account 1/3", detail: "übersprungen (Cooldown aktiv)" }]
        }
      },
      actions: workspaceActions({ onResetMegaDebridCooldowns: () => calls.push("reset") } as Partial<AccountWorkspaceActions>)
    });
    const button = findElement(tree, (element) => element.type === "button" && element.props.children === "Cooldowns zurücksetzen");

    button.props.onClick();

    expect(calls).toEqual(["reset"]);
  });

  it("keeps add and edit dialogs separate and every secret field protected", () => {
    const options = accountOptions();
    const addHtml = renderToStaticMarkup(
      <AccountAddDialog
        actions={{
          onQueryChange: () => {},
          onFilterChange: () => {},
          onOptionSelect: () => {},
          onFieldChange: () => {},
          onClose: () => {},
          onSubmit: () => {}
        }}
        model={{
          open: true,
          query: "",
          filter: "all",
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
          onToggleEnabled: () => {}
        }}
        model={{
          open: true,
          hoster: "Mega-Debrid",
          mode: "API",
          identity: "member@example.test",
          enabled: true,
          fields: [
            { id: "login", label: "Login", type: "text", value: "member@example.test" },
            { id: "password", label: "Passwort", type: "password", value: "test-password" },
            { id: "token", label: "Token", type: "password", value: "test-token" }
          ],
          error: "",
          busy: false
        }}
      />
    );

    expect(addHtml).toContain("Account hinzufügen");
    expect(addHtml).toContain("Prüfen und speichern");
    expect(count(addHtml, "<select")).toBe(0);
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
  });

  it("selects the account option through the compact service table", () => {
    const selected: string[] = [];
    const tree = AccountAddDialog({
      actions: {
        onQueryChange: () => {},
        onFilterChange: () => {},
        onOptionSelect: (optionId) => selected.push(optionId),
        onFieldChange: () => {},
        onClose: () => {},
        onSubmit: () => {}
      },
      model: {
        open: true,
        query: "",
        filter: "all",
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

  it("shows an accessible empty result when account search has no matches", () => {
    const html = renderToStaticMarkup(
      <AccountAddDialog
        actions={{
          onQueryChange: () => {},
          onFilterChange: () => {},
          onOptionSelect: () => {},
          onFieldChange: () => {},
          onClose: () => {},
          onSubmit: () => {}
        }}
        model={{
          open: true,
          query: "nicht vorhanden",
          filter: "all",
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

  it("keeps specific persistence revision-safe when the draft changes in flight", () => {
    const block = sourceBlock(appSource, "const persistSpecificSettings", "const runAccountQuickAction");
    expect(block).toContain("revisionAtStart");
    expect(block).toContain("mergeConcurrentSpecificSettings");
    expect(block).toContain('setSettingsSaveState("dirty")');
  });

  it("keeps unchecked single accounts honest without a positive status", () => {
    const block = sourceBlock(appSource, "const accountSources", "const selectedAccountViewId");
    expect(block).toMatch(/:\s*!checkedStatus\s*\?\s*"unchecked"/s);
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
});

describe("settings geometry", () => {
  it("uses central focus and semantic status text tokens", () => {
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
