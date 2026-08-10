import { readFileSync } from "node:fs";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DownloadItem, DownloadStatus, PackageEntry } from "../src/shared/types";
import {
  buildDownloadSidebarCounts,
  buildDownloadsViewModel,
  classifyDownloadStatus,
  type DownloadSidebarFilter,
  type DownloadsModelInput
} from "../src/renderer/views/downloads/downloads-model";
import {
  DownloadsContent,
  DownloadsFooter,
  DownloadsSidebar,
  DownloadsSidebarStatus,
  DownloadsToolbar,
  DownloadsView,
  type DownloadsViewActions
} from "../src/renderer/views/downloads/DownloadsView";
import {
  DownloadsTableHeader,
  PackageCardContent,
  areItemRowPropsEqual,
  arePackageCardPropsEqual
} from "../src/renderer/views/downloads/DownloadsTable";

const now = new Date(2026, 7, 10, 12, 0, 0, 0).getTime();

function item(id: string, packageId: string, status: DownloadStatus, overrides: Partial<DownloadItem> = {}): DownloadItem {
  return {
    id,
    packageId,
    url: `https://rapidgator.net/file/${id}`,
    provider: "realdebrid",
    providerLabel: "Real-Debrid",
    status,
    retries: 0,
    speedBps: status === "downloading" ? 12_000_000 : 0,
    downloadedBytes: status === "completed" ? 2_000_000_000 : 500_000_000,
    totalBytes: 2_000_000_000,
    progressPercent: status === "completed" ? 100 : 25,
    fileName: `${id}.mkv`,
    targetPath: `C:\\Downloads\\${id}.mkv`,
    resumable: true,
    attempts: 1,
    lastError: status === "failed" ? "Hoster nicht erreichbar" : "",
    fullStatus: status,
    createdAt: now - 1_000,
    updatedAt: now,
    ...overrides
  };
}

function pkg(id: string, name: string, itemIds: string[]): PackageEntry {
  return { id, name, itemIds, createdAt: now } as PackageEntry;
}

function createInput(overrides: Partial<DownloadsModelInput> = {}): DownloadsModelInput {
  const items = [
    item("active", "package-a", "downloading"),
    item("queued", "package-a", "queued", { provider: "debridlink", providerLabel: "Debrid-Link" }),
    item("failed", "package-b", "failed", { provider: "alldebrid", providerLabel: "AllDebrid" }),
    item("done", "package-b", "completed", { provider: "realdebrid", providerLabel: "Real-Debrid" })
  ];
  const packages = [
    pkg("package-a", "Aktive Serie", ["active", "queued"]),
    pkg("package-b", "Archiv Paket", ["failed", "done"])
  ];
  return {
    packageOrder: packages.map((entry) => entry.id),
    packages: Object.fromEntries(packages.map((entry) => [entry.id, entry])),
    items: Object.fromEntries(items.map((entry) => [entry.id, entry])),
    displayMode: "packages",
    filter: "all",
    providerFilter: "all",
    query: "",
    collapsedPackageIds: [],
    selectedIds: [],
    hideExtractedItems: false,
    showAllPackages: false,
    renderLimit: 260,
    ...overrides
  };
}

function createActions(overrides: Partial<DownloadsViewActions> = {}): DownloadsViewActions {
  return {
    onDisplayModeChange: () => {},
    onFilterChange: () => {},
    onProviderFilterChange: () => {},
    onQueryChange: () => {},
    onAddLinks: () => {},
    onStartDownloads: () => {},
    onPauseDownloads: () => {},
    onStopDownloads: () => {},
    onToggleSchedule: () => {},
    onScheduleTimeChange: () => {},
    onActivateSchedule: () => {},
    onCancelSchedule: () => {},
    onMoveSelectionUp: () => {},
    onMoveSelectionDown: () => {},
    onRenameSelection: () => {},
    onRemoveSelection: () => {},
    onToggleClipboardWatcher: () => {},
    onClearAll: () => {},
    onToggleAllPackages: () => {},
    onShowAllPackages: () => {},
    onPackageDragStart: () => {},
    onPackageDrop: () => {},
    onPackageDragEnd: () => {},
    onSetVisibleSelection: () => {},
    onToggleSelection: () => {},
    onSelectionMouseDown: () => {},
    onSelectionMouseEnter: () => {},
    onTogglePackage: () => {},
    onTogglePackageCollapse: () => {},
    onStartPackageRename: () => {},
    onPackageRenameChange: () => {},
    onCommitPackageRename: () => {},
    onCancelPackageRename: () => {},
    onCancelPackage: () => {},
    onMovePackageUp: () => {},
    onMovePackageDown: () => {},
    onRemoveItem: () => {},
    onOpenContextMenu: () => {},
    onSortColumn: () => {},
    onColumnDragStart: () => {},
    onColumnDragOver: () => {},
    onColumnDragLeave: () => {},
    onColumnDrop: () => {},
    onColumnDragEnd: () => {},
    onColumnContextMenu: () => {},
    ...overrides
  };
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

function withRuntime(input: DownloadsModelInput, overrides: Record<string, unknown> = {}) {
  return {
    ...buildDownloadsViewModel(input),
    running: true,
    paused: false,
    canStart: true,
    canPause: true,
    canStop: true,
    actionBusy: false,
    reconnectSeconds: 0,
    reconnectReason: "",
    clipboardWatcher: true,
    scheduleActive: false,
    scheduleOpen: false,
    scheduleTime: "23:30",
    scheduleLabel: "",
    packageSpeedBps: { "package-a": 12_000_000 },
    editingPackageId: null,
    editingName: "",
    columnOrder: ["name", "size", "hoster", "progress"] as const,
    gridTemplate: "minmax(280px, 2fr) 140px 160px minmax(220px, 1fr)",
    status: {
      packages: 2,
      links: 4,
      session: "3,00 GB",
      total: "10,00 GB",
      hosters: 3,
      speed: "96,00 Mbit/s",
      eta: "00:05:00"
    },
    ...overrides
  };
}

describe("downloads model", () => {
  it("exports the sidebar filter contract used by the downloads shell", () => {
    const filter: DownloadSidebarFilter = "queued";

    expect(filter).toBe("queued");
  });

  it("builds sidebar counts without mutating the runtime items", () => {
    const items = [
      item("count-active", "count-package", "downloading"),
      item("count-done", "count-package", "completed"),
      item("count-cancelled", "count-package", "cancelled")
    ];
    const snapshot = items.map((entry) => ({ ...entry }));

    expect(buildDownloadSidebarCounts(items)).toEqual({ all: 3, active: 1, queued: 0, paused: 0, completed: 1, failed: 0 });
    expect(items).toEqual(snapshot);
  });

  it("maps every runtime status into the exact semantic filter class", () => {
    expect(classifyDownloadStatus("downloading")).toBe("active");
    expect(classifyDownloadStatus("validating")).toBe("active");
    expect(classifyDownloadStatus("extracting")).toBe("active");
    expect(classifyDownloadStatus("integrity_check")).toBe("active");
    expect(classifyDownloadStatus("queued")).toBe("queued");
    expect(classifyDownloadStatus("reconnect_wait")).toBe("queued");
    expect(classifyDownloadStatus("paused")).toBe("paused");
    expect(classifyDownloadStatus("completed")).toBe("completed");
    expect(classifyDownloadStatus("failed")).toBe("failed");
    expect(classifyDownloadStatus("cancelled")).toBe("all");
  });

  it("derives sidebar counts from the complete queue before presentation filters", () => {
    const model = buildDownloadsViewModel(createInput({ filter: "failed" }));

    expect(model.counts).toEqual({ all: 4, active: 1, queued: 1, paused: 0, completed: 1, failed: 1 });
    expect(model.visibleItemIds).toEqual(["failed"]);
  });

  it("filters by package name, file name, provider, status and extracted visibility", () => {
    const byPackage = buildDownloadsViewModel(createInput({ query: "aktive serie" }));
    const byFile = buildDownloadsViewModel(createInput({ query: "done.mkv" }));
    const byProvider = buildDownloadsViewModel(createInput({ providerFilter: "debridlink" }));
    const hiddenExtracted = buildDownloadsViewModel(createInput({
      items: { ...createInput().items, done: item("done", "package-b", "completed", { fullStatus: "Entpackt" }) },
      hideExtractedItems: true
    }));

    expect(byPackage.packageRows.map((row) => row.package.id)).toEqual(["package-a"]);
    expect(byPackage.packageRows[0].items.map((entry) => entry.id)).toEqual(["active", "queued"]);
    expect(byFile.packageRows.map((row) => row.package.id)).toEqual(["package-b"]);
    expect(byFile.packageRows[0].items.map((entry) => entry.id)).toEqual(["done"]);
    expect(byProvider.visibleItemIds).toEqual(["queued"]);
    expect(hiddenExtracted.visibleItemIds).not.toContain("done");
  });

  it("supports the genuine flat file mode without synthetic package rows", () => {
    const model = buildDownloadsViewModel(createInput({ displayMode: "files" }));

    expect(model.packageRows).toEqual([]);
    expect(model.fileRows.map((entry) => entry.id)).toEqual(["active", "queued", "failed", "done"]);
    expect(model.mainRowCount).toBe(4);
  });

  it("reports a filtered flat-file range from the actually rendered rows", () => {
    const model = buildDownloadsViewModel(createInput({ displayMode: "files", filter: "failed" }));

    expect(model.paginationLabel).toBe("1\u20131 von 1");
    expect(model.totalMainRowCount).toBe(1);
  });

  it("counts cancelled downloads only in the complete all queue", () => {
    const model = buildDownloadsViewModel(createInput({
      packageOrder: ["cancelled-package"],
      packages: { "cancelled-package": pkg("cancelled-package", "Abgebrochen", ["cancelled-item"]) },
      items: { "cancelled-item": item("cancelled-item", "cancelled-package", "cancelled") }
    }));

    expect(model.counts).toEqual({ all: 1, active: 0, queued: 0, paused: 0, completed: 0, failed: 0 });
    expect(buildDownloadsViewModel({ ...createInput(), filter: "completed", packageOrder: model.packageRows.map((row) => row.package.id), packages: { "cancelled-package": pkg("cancelled-package", "Abgebrochen", ["cancelled-item"]) }, items: { "cancelled-item": item("cancelled-item", "cancelled-package", "cancelled") } }).visibleItemIds).toEqual([]);
  });

  it("finds an account label without treating it as a provider id", () => {
    const base = createInput();
    const model = buildDownloadsViewModel({
      ...base,
      items: {
        ...base.items,
        active: { ...base.items.active, providerAccountLabel: "Privates Real-Debrid Konto" }
      },
      query: "privates real-debrid"
    });

    expect(model.visibleItemIds).toEqual(["active"]);
    expect(model.providerFilter).toBe("all");
  });

  it("excludes collapsed children from visible and actionable row selection", () => {
    const model = buildDownloadsViewModel(createInput({
      collapsedPackageIds: ["package-a"],
      selectedIds: ["package-a", "active", "queued"]
    }));

    expect(model.visibleRowIds).not.toContain("active");
    expect(model.actionableSelectedIds).toEqual(["package-a"]);
  });

  it("limits occupied package rows honestly while preserving active packages and an actionable visible selection", () => {
    const packageEntries = Array.from({ length: 264 }, (_, index) => pkg(`p-${index}`, `Paket ${index}`, [`i-${index}`]));
    const itemEntries = packageEntries.map((entry, index) => item(`i-${index}`, entry.id, index === 263 ? "downloading" : "queued"));
    const model = buildDownloadsViewModel(createInput({
      packageOrder: packageEntries.map((entry) => entry.id),
      packages: Object.fromEntries(packageEntries.map((entry) => [entry.id, entry])),
      items: Object.fromEntries(itemEntries.map((entry) => [entry.id, entry])),
      selectedIds: ["p-0", "i-0", "p-263", "i-263", "missing"],
      renderLimit: 260
    }));

    expect(model.packageRows).toHaveLength(260);
    expect(model.packageRows.some((row) => row.package.id === "p-263")).toBe(true);
    expect(model.paginationLabel).toBe("1–260 von 264");
    expect(model.actionableSelectedIds).toEqual(["p-0", "i-0", "p-263", "i-263"]);
  });
});

describe("downloads view", () => {
  it("renders the five dense markers exactly once and the empty marker only for a true empty queue", () => {
    const occupied = renderToStaticMarkup(<DownloadsView actions={createActions()} model={withRuntime(createInput())} />);
    const empty = renderToStaticMarkup(<DownloadsView actions={createActions()} model={withRuntime(createInput({ packageOrder: [], packages: {}, items: {} }), { running: false })} />);

    for (const marker of ["downloads-sidebar", "downloads-sidebar-status", "downloads-toolbar", "downloads-table-body", "downloads-pagination"]) {
      expect(occupied.match(new RegExp(`data-visual-region=\\"${marker}\\"`, "g"))).toHaveLength(1);
      expect(empty.match(new RegExp(`data-visual-region=\\"${marker}\\"`, "g"))).toHaveLength(1);
    }
    expect(occupied).not.toContain("data-visual-region=\"downloads-empty-state\"");
    expect(empty).toContain("data-visual-region=\"downloads-empty-state\"");
    expect(empty).toContain("F\u00fcge Links hinzu, um den ersten Download zu starten.");
  });

  it("renders the distinct filtered-empty guidance inside the table body", () => {
    const html = renderToStaticMarkup(<DownloadsView actions={createActions()} model={withRuntime(createInput({ filter: "paused" }))} />);

    expect(html).toContain("Keine passenden Downloads");
    expect(html).toContain("Passe Filter oder Suche an.");
    expect(html).not.toContain("data-visual-region=\"downloads-empty-state\"");
    expect(html).toContain("0 von 0");
  });

  it("keeps sidebar, status, toolbar, table and footer as independently renderable production modules", () => {
    const model = withRuntime(createInput());
    const actions = createActions();

    expect(renderToStaticMarkup(<DownloadsSidebar actions={actions} model={model} />)).toContain("downloads-sidebar");
    expect(renderToStaticMarkup(<DownloadsSidebarStatus model={model} />)).toContain("downloads-sidebar-status");
    expect(renderToStaticMarkup(<DownloadsToolbar actions={actions} model={model} />)).toContain("downloads-toolbar");
    expect(renderToStaticMarkup(<DownloadsContent actions={actions} model={model} />)).toContain("downloads-table-body");
    expect(renderToStaticMarkup(<DownloadsFooter actions={actions} model={model} />)).toContain("downloads-pagination");
  });

  it("keeps the compact download search in the sidebar instead of the action toolbar", () => {
    const model = withRuntime(createInput());
    const actions = createActions();
    const sidebar = renderToStaticMarkup(<DownloadsSidebar actions={actions} model={model} />);
    const toolbar = renderToStaticMarkup(<DownloadsToolbar actions={actions} model={model} />);

    expect(sidebar).toContain("downloads-sidebar-search");
    expect(sidebar).toContain("Paket, Datei oder Service");
    expect(toolbar).not.toContain("downloads-search-input");
  });

  it("forwards package drag lifecycle callbacks through the extracted downloads content", () => {
    const calls: string[] = [];
    const actions = createActions() as DownloadsViewActions & {
      onPackageDragStart: (packageId: string) => void;
      onPackageDrop: (packageId: string) => void;
      onPackageDragEnd: () => void;
    };
    actions.onPackageDragStart = (packageId) => calls.push(`start:${packageId}`);
    actions.onPackageDrop = (packageId) => calls.push(`drop:${packageId}`);
    actions.onPackageDragEnd = () => calls.push("end");
    const content = DownloadsContent({ actions, model: withRuntime(createInput()) });
    const packageElement = findElement(content, (element) => element.props.row?.package.id === "package-a");

    packageElement.props.onDragStart("package-a");
    packageElement.props.onDrop("package-b");
    packageElement.props.onDragEnd();

    expect(calls).toEqual(["start:package-a", "drop:package-b", "end"]);
  });

  it("dispatches add, start, pause, stop, scheduling and selection actions through separate existing callbacks", () => {
    const calls: string[] = [];
    const actions = createActions({
      onAddLinks: () => calls.push("add"),
      onStartDownloads: () => calls.push("start"),
      onPauseDownloads: () => calls.push("pause"),
      onStopDownloads: () => calls.push("stop"),
      onActivateSchedule: () => calls.push("schedule"),
      onMoveSelectionUp: () => calls.push("up"),
      onMoveSelectionDown: () => calls.push("down"),
      onRenameSelection: () => calls.push("rename"),
      onRemoveSelection: () => calls.push("remove")
    });
    const toolbar = DownloadsToolbar({
      actions,
      model: withRuntime(createInput({ selectedIds: ["active"] }), { scheduleOpen: true })
    });

    for (const label of ["Links hinzufügen", "Start", "Pause", "Stop", "Planen", "Nach oben", "Nach unten", "Umbenennen", "Entfernen"]) {
      findButton(toolbar, label).props.onClick();
    }

    expect(calls).toEqual(["add", "start", "pause", "stop", "schedule", "up", "down", "rename", "remove"]);
  });

  it("uses exact toolbar disabled semantics without a dead reconnect branch", () => {
    const toolbar = DownloadsToolbar({
      actions: createActions(),
      model: withRuntime(createInput(), { canStart: false, canPause: false, canStop: false, reconnectSeconds: 8 })
    });

    expect(findButton(toolbar, "Start").props.disabled).toBe(true);
    expect(findButton(toolbar, "Pause").props.disabled).toBe(true);
    expect(findButton(toolbar, "Stop").props.disabled).toBe(true);
    expect(renderToStaticMarkup(toolbar)).not.toContain("Reconnect");
  });

  it("keeps start available for resume and pause independent from unrelated action busy state", () => {
    const pausedToolbar = DownloadsToolbar({
      actions: createActions(),
      model: withRuntime(createInput(), { paused: true, canStart: false, canPause: true })
    });
    const busyToolbar = DownloadsToolbar({
      actions: createActions(),
      model: withRuntime(createInput(), { paused: false, canPause: true, actionBusy: true })
    });

    expect(findButton(pausedToolbar, "Start").props.disabled).toBe(false);
    expect(findButton(pausedToolbar, "Pause").props.disabled).toBe(true);
    expect(findButton(busyToolbar, "Pause").props.disabled).toBe(false);
  });

  it("enables package movement only for a visible selected package row", () => {
    const itemOnly = DownloadsToolbar({
      actions: createActions(),
      model: withRuntime(createInput({ selectedIds: ["active"] }))
    });
    const packageSelected = DownloadsToolbar({
      actions: createActions(),
      model: withRuntime(createInput({ selectedIds: ["package-a"] }))
    });

    expect(findButton(itemOnly, "Nach oben").props.disabled).toBe(true);
    expect(findButton(itemOnly, "Nach unten").props.disabled).toBe(true);
    expect(findButton(packageSelected, "Nach oben").props.disabled).toBe(false);
    expect(findButton(packageSelected, "Nach unten").props.disabled).toBe(false);
  });

  it("keeps an active schedule visible and cancellable while the picker is closed", () => {
    const toolbar = DownloadsToolbar({
      actions: createActions(),
      model: withRuntime(createInput(), { scheduleActive: true, scheduleOpen: false, scheduleLabel: "1m 30s" })
    });
    const html = renderToStaticMarkup(toolbar);

    expect(html).toContain("Geplant: 1m 30s");
    expect(findButton(toolbar, "Abbrechen").props.disabled).toBe(false);
  });

  it("keeps the table header and all rows in one horizontal scroll context with exact dense geometry", () => {
    const html = renderToStaticMarkup(<DownloadsView actions={createActions()} model={withRuntime(createInput())} />);
    const css = readFileSync(new URL("../src/renderer/views/downloads/downloads.css", import.meta.url), "utf8");

    expect(html.indexOf("downloads-table-header")).toBeGreaterThan(html.indexOf("downloads-table"));
    expect(html.indexOf("data-visual-region=\"downloads-table-body\"")).toBeGreaterThan(html.indexOf("downloads-table-header"));
    expect(css).toMatch(/\.downloads-table\s*\{[^}]*overflow-x:\s*auto;/s);
    expect(css).toMatch(/\.downloads-table-header\s*\{[^}]*height:\s*41px;[^}]*position:\s*sticky;/s);
    expect(css).toMatch(/\.downloads-item-row,\s*\.downloads-package-row\s*\{[^}]*height:\s*48px;/s);
    expect(css).toMatch(/\.downloads-toolbar button,\s*\.downloads-footer button,[^{]+\{[^}]*height:\s*36px;/s);
    expect(css).toMatch(/\.downloads-content\s*\{[^}]*height:\s*100%;/s);
    expect(css).toMatch(/\.downloads-action-cell button,\s*\.downloads-collapse-button\s*\{[^}]*width:\s*30px;[^}]*height:\s*30px;/s);
    expect(css).toMatch(/\.downloads-footer\s*\{[^}]*height:\s*60px;[^}]*padding:\s*0 12px 0 60px;/s);
    expect(css).toMatch(/\.downloads-package-card\s*\{[^}]*border:\s*0;[^}]*border-bottom:\s*1px solid var\(--ui-border\);[^}]*padding:\s*0;/s);
    expect(css).not.toMatch(/gradient|box-shadow|nth-child/i);
  });

  it("keeps visible interaction text non-selectable and only inputs plus copy values selectable", () => {
    const css = readFileSync(new URL("../src/renderer/views/downloads/downloads.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.downloads-sidebar,\s*\.downloads-sidebar-status,\s*\.downloads-toolbar,\s*\.downloads-content,\s*\.downloads-footer\s*\{[^}]*user-select:\s*none;/s);
    expect(css).toMatch(/\.downloads-copyable,\s*\.downloads-search-input,\s*\.downloads-rename-input\s*\{[^}]*user-select:\s*text;/s);
  });

  it("keeps the 1120px layout inside the single downloads table scroll owner", () => {
    const css = readFileSync(new URL("../src/renderer/views/downloads/downloads.css", import.meta.url), "utf8");

    expect(css).toMatch(/@media \(max-width:\s*1120px\)/);
    expect(css).toMatch(/\.downloads-content\s*\{[^}]*overflow:\s*hidden;/s);
    expect(css).toMatch(/\.downloads-table\s*\{[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*auto;/s);
  });

  it("uses only semantic color variables declared by the shared theme", () => {
    const css = readFileSync(new URL("../src/renderer/views/downloads/downloads.css", import.meta.url), "utf8");
    const theme = readFileSync(new URL("../src/renderer/theme.css", import.meta.url), "utf8");
    const usedVariables = [...css.matchAll(/var\((--ui-[a-z-]+)/g)].map((match) => match[1]);
    const declaredVariables = new Set([...theme.matchAll(/(--ui-[a-z-]+)\s*:/g)].map((match) => match[1]));

    expect([...new Set(usedVariables)].filter((name) => !declaredVariables.has(name))).toEqual([]);
  });
});

describe("downloads App integration", () => {
  it("uses the extracted table only, cleans temporary drag listeners and routes the global context start through the shared callback", () => {
    const source = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8").replaceAll("\r\n", "\n");

    expect(source).not.toMatch(/^const ItemRow\b|^const PackageCard\b|^interface ItemRowProps\b|^interface PackageCardProps\b/m);
    expect(source).toContain('window.removeEventListener("mouseup", dragMouseUpRef.current)');
    expect(source).toContain("downloadsActions.onStartDownloads(); setContextMenu(null);");
    expect(source).not.toContain(") : false ? (");
    expect(source).not.toContain("{false && (");
  });
});

describe("download table row contracts", () => {
  it("preserves the package download and extraction phase split", () => {
    const extractionPackage = {
      ...pkg("extracting-package", "Entpackendes Paket", ["extracting-item"]),
      status: "extracting"
    } as PackageEntry;
    const extractionItem = item("extracting-item", extractionPackage.id, "completed", {
      fullStatus: "Entpacken 40%",
      progressPercent: 100
    });
    const html = renderToStaticMarkup(PackageCardContent({
      actions: createActions(),
      columnOrder: ["progress"],
      editing: false,
      editingName: "",
      gridTemplate: "80px",
      packageSpeedBps: 0,
      row: { package: extractionPackage, items: [extractionItem], collapsed: true },
      selectedIds: new Set<string>(),
      selectedVersion: 0
    }));

    expect(html).toContain("<b>70%</b>");
  });

  it("sets the whole visible selection atomically from the header checkbox", () => {
    const calls: unknown[] = [];
    const header = DownloadsTableHeader({
      actions: createActions({ onSetVisibleSelection: (ids, selected) => calls.push([ids, selected]) }),
      columnOrder: ["name"],
      gridTemplate: "minmax(280px, 1fr)",
      selectedCount: 1,
      sortColumn: "name",
      sortDirection: "asc",
      visibleIds: ["package-a", "active", "queued"]
    });
    const checkbox = findElement(header, (element) => element.type === "input");

    checkbox.props.onChange({ target: { checked: true } });

    expect(calls).toEqual([[['package-a', 'active', 'queued'], true]]);
  });

  it("includes package selection state in memo equality", () => {
    const model = withRuntime(createInput());
    const row = model.packageRows[0];
    const base = {
      actions: createActions(),
      columnOrder: model.columnOrder,
      editing: false,
      editingName: "",
      gridTemplate: model.gridTemplate,
      packageSpeedBps: 0,
      row,
      selectedIds: new Set<string>(),
      selectedVersion: 1
    };

    expect(arePackageCardPropsEqual(base, { ...base, selectedIds: new Set([row.package.id]), selectedVersion: 2 })).toBe(false);
  });

  it("invalidates visible item rows when provider, error or timestamp presentation changes", () => {
    const model = withRuntime(createInput());
    const base = {
      actions: createActions(),
      columnOrder: model.columnOrder,
      gridTemplate: model.gridTemplate,
      item: model.packageRows[0].items[0],
      selected: false
    };

    expect(areItemRowPropsEqual(base, { ...base, item: { ...base.item, providerLabel: "Debrid-Link" } })).toBe(false);
    expect(areItemRowPropsEqual(base, { ...base, item: { ...base.item, lastError: "Neuer Fehler" } })).toBe(false);
    expect(areItemRowPropsEqual(base, { ...base, item: { ...base.item, updatedAt: base.item.updatedAt + 1 } })).toBe(false);
  });

  it("does not collapse a package on shift selection", () => {
    const calls: string[] = [];
    const model = withRuntime(createInput());
    const row = model.packageRows[0];
    const component = PackageCardContent({
      actions: createActions({
        onToggleSelection: () => calls.push("select"),
        onTogglePackageCollapse: () => calls.push("collapse")
      }),
      columnOrder: model.columnOrder,
      editing: false,
      editingName: "",
      gridTemplate: model.gridTemplate,
      packageSpeedBps: 0,
      row,
      selectedIds: new Set<string>(),
      selectedVersion: 1
    });
    const packageRow = findElement(component, (element) => element.props["data-download-row-id"] === row.package.id);

    packageRow.props.onClick({ button: 0, ctrlKey: false, metaKey: false, shiftKey: true, target: {}, currentTarget: { contains: () => true } });

    expect(calls).toEqual(["select"]);
  });

  it("commits Enter and the resulting Blur rename sequence exactly once", () => {
    const commits: string[] = [];
    const model = withRuntime(createInput());
    const row = model.packageRows[0];
    const component = PackageCardContent({
      actions: createActions({ onCommitPackageRename: (id, value) => commits.push(`${id}:${value}`) }),
      columnOrder: model.columnOrder,
      editing: true,
      editingName: "Neuer Name",
      gridTemplate: model.gridTemplate,
      packageSpeedBps: 0,
      row,
      selectedIds: new Set<string>(),
      selectedVersion: 1
    });
    const input = findElement(component, (element) => element.type === "input" && element.props.className === "downloads-rename-input");

    input.props.onKeyDown({ key: "Enter", preventDefault: () => {}, currentTarget: { blur: () => {} } });
    input.props.onBlur();

    expect(commits).toEqual(["package-a:Neuer Name"]);
  });

  it("keeps package selection and activation as separate controls and sends context coordinates", () => {
    const calls: Array<unknown> = [];
    const model = withRuntime(createInput());
    const row = model.packageRows[0];
    const component = PackageCardContent({
      actions: createActions({
        onToggleSelection: (id) => calls.push(["select", id]),
        onTogglePackage: (id) => calls.push(["toggle", id]),
        onOpenContextMenu: (id, x, y) => calls.push(["context", id, x, y])
      }),
      columnOrder: model.columnOrder,
      editing: false,
      editingName: "",
      gridTemplate: model.gridTemplate,
      packageSpeedBps: 0,
      row,
      selectedIds: new Set<string>(),
      selectedVersion: 1
    });
    const selection = findElement(component, (element) => element.type === "input" && element.props["aria-label"] === "Aktive Serie auswählen");
    const activation = findElement(component, (element) => element.type === "input" && element.props["aria-label"] === "Aktive Serie aktivieren");
    const packageElement = findElement(component, (element) => element.props["data-download-package-id"] === "package-a");

    selection.props.onChange();
    activation.props.onChange();
    packageElement.props.onContextMenu({ preventDefault: () => {}, stopPropagation: () => {}, clientX: 30, clientY: 50 });

    expect(calls).toEqual([["select", "package-a"], ["toggle", "package-a"], ["context", "package-a", 30, 50]]);
  });
});
