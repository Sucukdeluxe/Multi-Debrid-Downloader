import { readFileSync } from "node:fs";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "../src/shared/types";
import {
  buildHistoryViewModel,
  deriveHistoryHoster,
  deriveHistoryStartAt,
  filterHistoryRows,
  pruneHistoryIds,
  selectVisibleHistoryIds,
  type HistoryFilter,
  type HistoryViewEntry
} from "../src/renderer/views/history/history-model";
import {
  HistoryContent,
  HistoryToolbar,
  HistoryView,
  type HistoryViewActions
} from "../src/renderer/views/history/HistoryView";
import { createVisualFixture } from "./visual/fixtures";
import { createVisualElectronApi } from "./visual/mock-electron-api";

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

function findButton(node: ReactNode, label: string): ReactElement {
  return findElement(node, (element) => element.type === "button" && element.props.children === label);
}

function createActions(overrides: Partial<HistoryViewActions> = {}): HistoryViewActions {
  return {
    onFilterChange: () => {},
    onQueryChange: () => {},
    onToggleSelection: () => {},
    onToggleSelectAll: () => {},
    onToggleExpansion: () => {},
    onRestore: () => {},
    onReveal: () => {},
    onRemove: () => {},
    onClearSelection: () => {},
    onClearHistory: () => {},
    onContextMenu: () => {},
    ...overrides
  };
}

const now = new Date(2026, 7, 10, 12, 0, 0, 0).getTime();
const todayStart = new Date(2026, 7, 10, 0, 0, 0, 0).getTime();
const weekStart = new Date(2026, 7, 4, 0, 0, 0, 0).getTime();

function entry(overrides: Partial<HistoryViewEntry> & Pick<HistoryViewEntry, "id" | "name">): HistoryViewEntry {
  return {
    totalBytes: 2_000_000_000,
    downloadedBytes: 1_500_000_000,
    fileCount: 2,
    provider: "realdebrid",
    completedAt: todayStart + 60_000,
    durationSeconds: 60,
    status: "completed",
    outputDir: `C:\\Downloads\\${overrides.name}`,
    urls: ["https://rapidgator.net/file/test"],
    ...overrides,
    id: overrides.id,
    name: overrides.name
  };
}

const entries: HistoryViewEntry[] = [
  entry({ id: "today", name: "Heute Paket", completedAt: todayStart + 1 }),
  entry({ id: "week-edge", name: "Wochenanfang", completedAt: weekStart }),
  entry({ id: "week", name: "Wochen Paket", completedAt: todayStart - 1, status: "deleted", provider: "debridlink", urls: ["https://ddownload.com/a"] }),
  entry({ id: "older", name: "Altes Paket", completedAt: weekStart - 1, status: "failed", provider: null, outputDir: "D:\\Archiv\\Alt", urls: ["https://sub.example.test/a"] })
];

describe("history model", () => {
  it("separates today, previous six calendar days, older and status filters at exact boundaries", () => {
    const expected: Record<HistoryFilter, string[]> = {
      all: ["today", "week-edge", "week", "older"],
      today: ["today"],
      week: ["week-edge", "week"],
      older: ["older"],
      completed: ["today", "week-edge"],
      deleted: ["week"],
      failed: ["older"]
    };

    for (const [filter, ids] of Object.entries(expected) as Array<[HistoryFilter, string[]]>) {
      expect(filterHistoryRows(entries, filter, "", now).map((row) => row.id)).toEqual(ids);
    }
  });

  it("uses local calendar midnights for the six previous days across both daylight-saving transitions", () => {
    const springNow = new Date(2026, 2, 30, 12, 0, 0, 0).getTime();
    const springBoundary = new Date(2026, 2, 24, 0, 0, 0, 0).getTime();
    const autumnNow = new Date(2026, 9, 26, 12, 0, 0, 0).getTime();
    const autumnBoundary = new Date(2026, 9, 20, 0, 0, 0, 0).getTime();

    expect(filterHistoryRows([
      entry({ id: "spring-before", name: "Spring before", completedAt: springBoundary - 30 * 60 * 1000 }),
      entry({ id: "spring-boundary", name: "Spring boundary", completedAt: springBoundary })
    ], "week", "", springNow).map((row) => row.id)).toEqual(["spring-boundary"]);
    expect(filterHistoryRows([
      entry({ id: "autumn-boundary", name: "Autumn boundary", completedAt: autumnBoundary + 30 * 60 * 1000 })
    ], "week", "", autumnNow).map((row) => row.id)).toEqual(["autumn-boundary"]);
  });

  it("bounds today to the exact local calendar day and excludes future timestamps", () => {
    const tomorrowStart = new Date(2026, 7, 11, 0, 0, 0, 0).getTime();
    const temporalEntries = [
      entry({ id: "today-last", name: "Today last", completedAt: tomorrowStart - 1 }),
      entry({ id: "tomorrow", name: "Tomorrow", completedAt: tomorrowStart }),
      entry({ id: "future", name: "Future", completedAt: tomorrowStart + 86_400_000 })
    ];

    expect(filterHistoryRows(temporalEntries, "today", "", now).map((row) => row.id)).toEqual(["today-last"]);
  });

  it("searches name, path, hoster, provider and URLs without changing newest-first input order", () => {
    const searchable = [
      entry({ id: "new", name: "Neu", completedAt: now, provider: "debridlink", outputDir: "C:\\Filme\\Staffel", urls: ["https://rapidgator.net/file/needle"] }),
      entry({ id: "old", name: "Älter", completedAt: now - 1, provider: "realdebrid", outputDir: "D:\\Archiv", urls: ["https://ddownload.com/archive"] })
    ];

    expect(filterHistoryRows(searchable, "all", "neu", now).map((row) => row.id)).toEqual(["new"]);
    expect(filterHistoryRows(searchable, "all", "staffel", now).map((row) => row.id)).toEqual(["new"]);
    expect(filterHistoryRows(searchable, "all", "rapidgator.net", now).map((row) => row.id)).toEqual(["new"]);
    expect(filterHistoryRows(searchable, "all", "Debrid-Link", now).map((row) => row.id)).toEqual(["new"]);
    expect(filterHistoryRows(searchable, "all", "needle", now).map((row) => row.id)).toEqual(["new"]);
    expect(filterHistoryRows(searchable, "all", "d", now).map((row) => row.id)).toEqual(["new", "old"]);
  });

  it("derives hosters only from valid URL hostnames and clamps the calculated start time", () => {
    expect(deriveHistoryHoster(["https://rapidgator.net/a", "https://rapidgator.net/b", "https://ddownload.com/c", "not a url"])).toBe("rapidgator.net, ddownload.com");
    expect(deriveHistoryHoster([])).toBe("—");
    expect(deriveHistoryHoster(undefined)).toBe("—");
    expect(deriveHistoryStartAt(entry({ id: "start", name: "Start", completedAt: 20_000, durationSeconds: 3 }))).toBe(17_000);
    expect(deriveHistoryStartAt(entry({ id: "clamped", name: "Clamp", completedAt: 2_000, durationSeconds: 3 }))).toBe(0);

    const row = filterHistoryRows([entry({ id: "provider", name: "Provider", provider: "realdebrid", urls: [] })], "all", "", now)[0];
    expect(row.hoster).toBe("—");
    expect(row.providerLabel).toBe("Real-Debrid");
  });

  it("prunes removed ids and preserves the original set instance when every id survives", () => {
    const stable = new Set(["today", "week"]);
    expect(pruneHistoryIds(stable, ["today", "week", "older"])).toBe(stable);

    const pruned = pruneHistoryIds(new Set(["today", "removed"]), ["today", "week"]);
    expect([...pruned]).toEqual(["today"]);
  });

  it("builds Ctrl+A selection from only the currently visible filtered row ids", () => {
    const visibleIds = filterHistoryRows(entries, "week", "Wochen", now).map((row) => row.id);
    expect([...selectVisibleHistoryIds(visibleIds)]).toEqual(["week-edge", "week"]);
  });

  it("removes hidden selected ids from the filtered view model and every toolbar action", () => {
    const model = buildHistoryViewModel(entries, "deleted", "", ["today", "week"], [], false, "", now);
    const calls: Array<unknown> = [];
    const toolbar = HistoryToolbar({
      model,
      actions: createActions({
        onRestore: (ids) => calls.push(["restore", ids]),
        onReveal: (id) => calls.push(["reveal", id]),
        onRemove: (ids) => calls.push(["remove", ids])
      })
    });

    expect(model.rows.map((row) => row.id)).toEqual(["week"]);
    expect(model.selectedIds).toEqual(["week"]);
    findButton(toolbar, "Erneut hinzufügen").props.onClick();
    findButton(toolbar, "Im Ordner zeigen").props.onClick();
    findButton(toolbar, "Entfernen").props.onClick();
    expect(calls).toEqual([
      ["restore", ["week"]],
      ["reveal", "week"],
      ["remove", ["week"]]
    ]);
  });
});

describe("HistoryView", () => {
  it("keeps the header and rows inside the same internal horizontal scroll context", () => {
    const html = renderToStaticMarkup(
      <HistoryView
        actions={createActions()}
        model={buildHistoryViewModel(entries.slice(0, 2), "all", "", [], [], false, "", now)}
      />
    );
    const css = readFileSync(new URL("../src/renderer/views/history/history.css", import.meta.url), "utf8");
    const tableStart = html.indexOf("history-table");
    const headerStart = html.indexOf("history-table-header");
    const bodyStart = html.indexOf("data-visual-region=\"history-table-body\"");

    expect(tableStart).toBeGreaterThan(-1);
    expect(headerStart).toBeGreaterThan(tableStart);
    expect(bodyStart).toBeGreaterThan(headerStart);
    expect(css).toMatch(/\.history-content \.history-table\s*\{[^}]*overflow:\s*auto;/s);
    expect(css).toMatch(/\.history-table > \.history-table-header\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/s);
    expect(css).toMatch(/\.history-table > \.history-table-body\s*\{[^}]*overflow:\s*visible;/s);
    expect(css).not.toMatch(/\.history-table > \.history-table-body\s*\{[^}]*overflow:\s*auto;/s);
  });

  it("keeps every real AppShell history surface non-selectable while allowing text selection only for detail values", () => {
    const css = readFileSync(new URL("../src/renderer/views/history/history.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.history-sidebar,\s*\.history-workspace-toolbar,\s*\.history-content,\s*\.history-pagination\s*\{[^}]*user-select:\s*none;/s);
    expect(css).toMatch(/\.history-copyable\s*\{[^}]*user-select:\s*text;/s);
    expect(css).toMatch(/\.history-workspace-toolbar \.ui-toolbar-search-input\s*\{[^}]*user-select:\s*text;/s);
    expect(css).not.toMatch(/(^|\n)\.history-toolbar(?:\s|,|\{)/);
    expect(css).not.toMatch(/(^|\n)\.history-detail-grid(?:\s|>|\.|\{)/);
  });

  it("keeps loading, empty, filtered-empty and error states inside the same table body", () => {
    const states = [
      [buildHistoryViewModel([], "all", "", [], [], true, "", now), "Verlauf wird geladen"],
      [buildHistoryViewModel([], "all", "", [], [], false, "", now), "Noch kein Verlauf"],
      [buildHistoryViewModel([entry({ id: "done", name: "Fertig" })], "failed", "", [], [], false, "", now), "Keine passenden Einträge"],
      [buildHistoryViewModel([], "all", "", [], [], false, "Verlauf konnte nicht geladen werden", now), "Verlauf konnte nicht geladen werden"]
    ] as const;

    for (const [model, label] of states) {
      const html = renderToStaticMarkup(<HistoryView actions={createActions()} model={model} />);
      expect(html.indexOf(label)).toBeGreaterThan(html.indexOf("data-visual-region=\"history-table-body\""));
      expect(html).toContain("data-visual-region=\"history-pagination\"");
      expect(html).toContain("0 von 0");
    }
  });

  it("renders the exact compact headers, semantic statuses and no operative download controls", () => {
    const html = renderToStaticMarkup(
      <HistoryView
        actions={createActions()}
        model={buildHistoryViewModel(entries, "all", "", [], [], false, "", now)}
      />
    );
    const headerStart = html.indexOf("history-table-header-row");
    const headerEnd = html.indexOf("data-visual-region=\"history-table-body\"");
    const headerMarkup = html.slice(headerStart, headerEnd);
    const headers = ["Paket / Datei", "Status", "Größe", "Hoster", "Gestartet", "Beendet", "Aktion"];
    let previous = -1;
    for (const header of headers) {
      const index = headerMarkup.indexOf(`>${header}<`);
      expect(index).toBeGreaterThan(previous);
      previous = index;
    }
    expect(html).toContain("history-status-completed");
    expect(html).toContain("history-status-deleted");
    expect(html).toContain("history-status-failed");
    expect(html).toContain("Abgeschlossen");
    expect(html).toContain("Gelöscht");
    expect(html).toContain("Fehlgeschlagen");
    expect(html).not.toMatch(/>Start<|>Pause<|>Stop<|Priorität/);
  });

  it("renders each visual marker once, occupied main rows separately from closed detail rows and an honest footer", () => {
    const html = renderToStaticMarkup(
      <HistoryView
        actions={createActions()}
        model={buildHistoryViewModel(entries.slice(0, 2), "all", "", [], [], false, "", now)}
      />
    );

    for (const marker of ["history-sidebar", "history-toolbar", "history-table-body", "history-pagination"]) {
      expect(html.match(new RegExp(`data-visual-region=\\"${marker}\\"`, "g"))).toHaveLength(1);
    }
    expect(html.match(/data-history-row-id=/g)).toHaveLength(2);
    expect(html).not.toContain("history-detail-row");
    expect(html).toContain("1–2 von 2");
  });

  it("dispatches selection, expansion, select-all and context coordinates with exact visible ids", () => {
    const calls: Array<unknown> = [];
    const actions = createActions({
      onToggleSelection: (id) => calls.push(["select", id]),
      onToggleSelectAll: (ids) => calls.push(["all", ids]),
      onToggleExpansion: (id) => calls.push(["expand", id]),
      onContextMenu: (id, x, y) => calls.push(["context", id, x, y])
    });
    const model = buildHistoryViewModel(entries.slice(0, 2), "all", "", [], [], false, "", now);
    const content = HistoryContent({ actions, model });

    const selectAll = findElement(content, (element) => element.type === "input" && element.props["aria-label"] === "Alle sichtbaren Einträge auswählen");
    selectAll.props.onChange();
    const rowCheckbox = findElement(content, (element) => element.type === "input" && element.props["aria-label"] === "Heute Paket auswählen");
    rowCheckbox.props.onChange();
    findElement(content, (element) => element.type === "button" && element.props["aria-label"] === "Details anzeigen").props.onClick({ stopPropagation: () => {} });
    const row = findElement(content, (element) => element.props["data-history-row-id"] === "today");
    row.props.onContextMenu({
      preventDefault: () => {},
      stopPropagation: () => {},
      clientX: 144,
      clientY: 288,
      currentTarget: { querySelector: () => null }
    });

    expect(calls).toEqual([
      ["all", ["today", "week-edge"]],
      ["select", "today"],
      ["expand", "today"],
      ["context", "today", 144, 288]
    ]);
  });

  it("focuses the matching row action before opening a genuine row context menu", () => {
    const calls: Array<unknown> = [];
    const focusCalls: Array<unknown> = [];
    const content = HistoryContent({
      actions: createActions({ onContextMenu: (id, x, y) => calls.push([id, x, y]) }),
      model: buildHistoryViewModel(entries.slice(0, 1), "all", "", [], [], false, "", now)
    });
    const row = findElement(content, (element) => element.props["data-history-row-id"] === "today");

    row.props.onContextMenu({
      preventDefault: () => {},
      stopPropagation: () => {},
      clientX: 21,
      clientY: 34,
      currentTarget: {
        querySelector: () => ({ focus: (options: unknown) => focusCalls.push(options) })
      }
    });

    expect(focusCalls).toEqual([{ preventScroll: true }]);
    expect(calls).toEqual([["today", 21, 34]]);
  });

  it("enables reveal only for exactly one selected row and sends selection actions as ids", () => {
    const selected = buildHistoryViewModel(entries, "all", "", ["today"], [], false, "", now);
    const multiple = buildHistoryViewModel(entries, "all", "", ["today", "week"], [], false, "", now);
    const calls: Array<unknown> = [];
    const actions = createActions({
      onRestore: (ids) => calls.push(["restore", ids]),
      onReveal: (id) => calls.push(["reveal", id]),
      onRemove: (ids) => calls.push(["remove", ids]),
      onClearSelection: () => calls.push(["clear"])
    });
    const singleToolbar = HistoryToolbar({ actions, model: selected });
    const multiToolbar = HistoryToolbar({ actions, model: multiple });

    expect(findButton(singleToolbar, "Im Ordner zeigen").props.disabled).toBe(false);
    expect(findButton(multiToolbar, "Im Ordner zeigen").props.disabled).toBe(true);
    findButton(singleToolbar, "Erneut hinzufügen").props.onClick();
    findButton(singleToolbar, "Im Ordner zeigen").props.onClick();
    findButton(singleToolbar, "Entfernen").props.onClick();
    findButton(singleToolbar, "Auswahl löschen").props.onClick();

    expect(calls).toEqual([
      ["restore", ["today"]],
      ["reveal", "today"],
      ["remove", ["today"]],
      ["clear"]
    ]);
  });

  it("renders expanded paths and URLs as copyable details without changing the 48px main-row contract", () => {
    const html = renderToStaticMarkup(
      <HistoryView
        actions={createActions()}
        model={buildHistoryViewModel(entries.slice(0, 1), "all", "", [], ["today"], false, "", now)}
      />
    );

    expect(html).toContain("history-detail-row");
    expect(html).toContain("history-copyable");
    expect(html).toContain("C:\\Downloads\\Heute Paket");
    expect(html).toContain("https://rapidgator.net/file/test");
  });
});

describe("visual history states", () => {
  it("re-arms the real App mounted gate before every StrictMode lifecycle setup can start async work", () => {
    const source = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8").replaceAll("\r\n", "\n");
    const firstRequest = source.indexOf("window.rd.getVersion()");
    const effectStart = source.lastIndexOf("useEffect(() => {", firstRequest);
    const cleanup = source.indexOf("mountedRef.current = false", firstRequest);
    const setup = source.indexOf("mountedRef.current = true", effectStart);

    expect(effectStart).toBeGreaterThan(-1);
    expect(setup).toBeGreaterThan(effectStart);
    expect(setup).toBeLessThan(firstRequest);
    expect(cleanup).toBeGreaterThan(firstRequest);
  });

  it("keeps bootstrap deterministic before exposing loading and error responses to the opened history view", async () => {
    const loadingApi = createVisualElectronApi(createVisualFixture("dense"), "?history-state=loading");
    await expect(loadingApi.getHistory()).resolves.toHaveLength(2);
    const pending = loadingApi.getHistory();
    let settled = false;
    void pending.finally(() => { settled = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    const errorApi = createVisualElectronApi(createVisualFixture("dense"), "?history-state=error");
    await expect(errorApi.getHistory()).resolves.toHaveLength(2);
    await expect(errorApi.getHistory()).rejects.toThrow("Visual history load failed");
  });
});

const productionEntry: HistoryEntry = {
  ...entry({ id: "production", name: "Produktiv" }),
  status: "completed"
};
void productionEntry;
