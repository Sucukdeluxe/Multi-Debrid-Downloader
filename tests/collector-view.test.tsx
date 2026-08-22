import { readFileSync } from "node:fs";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CollectorPackage } from "../src/shared/collector";
import {
  buildCollectorTransferPackages,
  buildCollectorWorkspaceViewModel,
  mergeCollectorPackages,
  removeCollectorLinks,
  selectCollectorPackageLinks
} from "../src/renderer/views/collector/collector-model";
import { CollectorContent, CollectorInputDialog, CollectorSidebar, CollectorToolbar, CollectorView, type CollectorViewActions } from "../src/renderer/views/collector/CollectorView";
import * as collectorViewModule from "../src/renderer/views/collector/CollectorView";

function visitElements(node: ReactNode, visit: (element: ReactElement) => void): void {
  if (Array.isArray(node)) {
    node.forEach((child) => visitElements(child, visit));
    return;
  }
  if (!isValidElement(node)) return;
  visit(node);
  visitElements(node.props.children, visit);
  visitElements(node.props.actions, visit);
}

function findElement(node: ReactNode, predicate: (element: ReactElement) => boolean): ReactElement {
  let result: ReactElement | null = null;
  visitElements(node, (element) => {
    if (!result && predicate(element)) result = element;
  });
  if (!result) throw new Error("Element not found");
  return result;
}

function findButton(node: ReactNode, label: string): ReactElement {
  return findElement(node, (element) => element.type === "button" && element.props.children === label);
}

function createActions(overrides: Partial<CollectorViewActions> = {}): CollectorViewActions {
  return {
    onFilterChange: () => {},
    onOpenInput: () => {},
    onImportDlc: () => {},
    onImportFile: () => {},
    onSubmitSelected: () => {},
    onSubmitAll: () => {},
    onQueryChange: () => {},
    onLinkSelectionChange: () => {},
    onPackageSelectionChange: () => {},
    onPackageCollapseChange: () => {},
    onToggleAllPackages: () => {},
    onRemoveSelected: () => {},
    ...overrides
  };
}

const packages: CollectorPackage[] = [{
  id: "package-sbs",
  name: "SBS14HD",
  addedAt: 1000,
  links: [
    { id: "link-1", url: "https://1fichier.com/?one11111", fileName: "SBS14HD.part01.rar", fileSizeBytes: 471_859_200, hoster: "1fichier", availability: "online", status: "ready", addedAt: 1000 },
    { id: "link-2", url: "https://1fichier.com/?two22222", fileName: "SBS14HD.part02.rar", fileSizeBytes: 471_859_200, hoster: "1fichier", availability: "online", status: "ready", addedAt: 1000 }
  ]
}, {
  id: "package-mixed",
  name: "Mixed",
  addedAt: 2000,
  links: [
    { id: "link-3", url: "https://example.test/unknown", fileName: "unknown.bin", fileSizeBytes: null, hoster: "example", availability: "unknown", status: "unknown", addedAt: 2000 },
    { id: "link-4", url: "https://example.test/offline", fileName: "offline.bin", fileSizeBytes: null, hoster: "example", availability: "offline", status: "offline", addedAt: 2000 }
  ]
}];

describe("collector workspace model", () => {
  it("merges packages by name while deduplicating URLs", () => {
    const incoming: CollectorPackage[] = [{
      id: "incoming",
      name: "SBS14HD",
      addedAt: 3000,
      links: [
        { ...packages[0].links[0], id: "duplicate" },
        { id: "link-5", url: "https://1fichier.com/?three333", fileName: "SBS14HD.part03.rar", fileSizeBytes: 10, hoster: "1fichier", availability: "online", status: "ready", addedAt: 3000 }
      ]
    }];
    const result = mergeCollectorPackages(packages, incoming);

    expect(result.addedLinks).toBe(1);
    expect(result.duplicateLinks).toBe(1);
    expect(result.packages[0].id).toBe("package-sbs");
    expect(result.packages[0].links.map((link) => link.id)).toEqual(["link-1", "link-2", "link-5"]);
  });

  it("supports whole-package selection, partial transfers and partial removal", () => {
    const selected = selectCollectorPackageLinks(new Set(["link-3"]), packages[0], true);
    expect([...selected].sort()).toEqual(["link-1", "link-2", "link-3"]);
    expect(buildCollectorTransferPackages(packages, new Set(["link-2", "link-3"])).map((pkg) => [pkg.name, pkg.links.map((link) => link.id)])).toEqual([
      ["SBS14HD", ["link-2"]], ["Mixed", ["link-3"]]
    ]);
    expect(removeCollectorLinks(packages, new Set(["link-2", "link-3"])).map((pkg) => [pkg.name, pkg.links.map((link) => link.id)])).toEqual([
      ["SBS14HD", ["link-1"]], ["Mixed", ["link-4"]]
    ]);
  });

  it("derives aggregates, filters and search once for the view", () => {
    const model = buildCollectorWorkspaceViewModel(packages, "online", "part02", false, ["link-2"], ["package-mixed"], "", true);

    expect(model.packages).toHaveLength(1);
    expect(model.packages[0]).toEqual(expect.objectContaining({ totalBytes: 943_718_400, unknownSizeCount: 0, onlineCount: 2, totalCount: 2, selectedCount: 1, collapsed: false }));
    expect(model.packages[0].links.map((link) => link.id)).toEqual(["link-2"]);
    expect(model.filters).toEqual([
      { id: "all", label: "Alle Links", count: 4 }, { id: "online", label: "Online", count: 2 }, { id: "unknown", label: "Ungeprüft", count: 1 }, { id: "offline", label: "Offline", count: 1 }
    ]);
  });

  it("toggles every raw package even when the workspace shows only a filtered subset", () => {
    const toggleAllCollectorPackageIds = (collectorViewModule as unknown as {
      toggleAllCollectorPackageIds?: (packageIds: readonly string[], collapsedPackageIds: ReadonlySet<string>) => Set<string>;
    }).toggleAllCollectorPackageIds;
    expect(toggleAllCollectorPackageIds).toBeTypeOf("function");
    if (!toggleAllCollectorPackageIds) return;

    const rawPackageIds = packages.map((pkg) => pkg.id);
    expect([...toggleAllCollectorPackageIds(rawPackageIds, new Set())].sort()).toEqual(["package-mixed", "package-sbs"]);
    expect([...toggleAllCollectorPackageIds(rawPackageIds, new Set(["package-sbs"]))].sort()).toEqual(["package-mixed", "package-sbs"]);
    expect([...toggleAllCollectorPackageIds(rawPackageIds, new Set(rawPackageIds))]).toEqual([]);
  });
});

describe("CollectorView", () => {
  it("renders expandable package and file rows with preview columns", () => {
    const html = renderToStaticMarkup(<CollectorView actions={createActions()} model={buildCollectorWorkspaceViewModel(packages, "all", "", false, [], [], "", true)} />);
    for (const heading of ["Name", "Größe", "Hoster", "Status", "Verfügbarkeit", "Hinzugefügt"]) expect(html).toContain(`>${heading}<`);
    expect(html).toContain("SBS14HD");
    expect(html).toContain("SBS14HD.part01.rar");
    expect(html).toContain("SBS14HD.part02.rar");
    expect(html).toContain("2/2 online");
    expect(html).toContain("aria-label=\"SBS14HD einklappen\"");
    expect(html).not.toContain("URL oder Rohzeile");
    expect(html).not.toContain(">Zeile<");
    expect(html).not.toContain(">Lokal<");
  });

  it("renders known hosters as icons with their full name as tooltip", () => {
    const ddownloadPackages: CollectorPackage[] = [{
      id: "package-ddownload",
      name: "Archive",
      addedAt: 3000,
      links: [{
        id: "link-ddownload",
        url: "https://ddownload.com/ntwscdw62gyb",
        fileName: "Archive.part01.rar",
        fileSizeBytes: 526_385_152,
        hoster: "ddownload",
        availability: "online",
        status: "ready",
        addedAt: 3000
      }]
    }];
    const html = renderToStaticMarkup(<CollectorContent actions={createActions()} model={buildCollectorWorkspaceViewModel(ddownloadPackages, "all", "", false, [], [], "", true)} />);

    expect(html).toContain('class="collector-hoster-label" title="DDownload"');
    expect(html).toContain('class="collector-hoster-icon" data-hoster="ddownload" src="./provider-icons/ddownload.ico"');
    expect(html).not.toContain('title="DDownload">DD<');
  });

  it("renders collapsed packages without child rows", () => {
    const html = renderToStaticMarkup(<CollectorContent actions={createActions()} model={buildCollectorWorkspaceViewModel(packages, "all", "", false, [], ["package-sbs"], "", false)} />);
    expect(html).toContain("aria-label=\"SBS14HD ausklappen\"");
    expect(html).not.toContain("SBS14HD.part01.rar");
  });

  it("offers selected and all transfer actions", () => {
    let selected = 0;
    let all = 0;
    const toolbar = CollectorToolbar({ actions: createActions({ onSubmitSelected: () => { selected += 1; }, onSubmitAll: () => { all += 1; } }), model: buildCollectorWorkspaceViewModel(packages, "all", "", false, ["link-1"], [], "", true) });
    findButton(toolbar, "Auswahl übergeben (1)").props.onClick();
    findButton(toolbar, "Alle übergeben (4)").props.onClick();
    expect(selected).toBe(1);
    expect(all).toBe(1);
  });

  it("keeps the global package toggle enabled at the right toolbar edge despite active filters", () => {
    let toggles = 0;
    const model = buildCollectorWorkspaceViewModel(packages, "online", "no-visible-result", false, [], [], "", true);
    const toolbar = CollectorToolbar({ actions: createActions({ onToggleAllPackages: () => { toggles += 1; } }), model });
    const toolbarButtons: ReactElement[] = [];
    visitElements(toolbar, (element) => {
      if (element.type === "button") toolbarButtons.push(element);
    });
    const toggle = findButton(toolbar, "Alle ein-/ausklappen");

    expect(model.empty).toBe(true);
    expect(model.totalCount).toBe(4);
    expect(toggle.props.disabled).toBe(false);
    expect(toolbarButtons.at(-1)?.props.children).toBe("Alle ein-/ausklappen");
    toggle.props.onClick();
    expect(toggles).toBe(1);
  });

  it("renders accessible mixed package selection", () => {
    const html = renderToStaticMarkup(<CollectorContent actions={createActions()} model={buildCollectorWorkspaceViewModel(packages, "all", "", false, ["link-1"], [], "", true)} />);
    expect(html).toContain("aria-label=\"Paket SBS14HD auswählen\"");
    expect(html).toContain("aria-checked=\"mixed\"");
  });

  it("routes status filters and search independently", () => {
    let filter = "";
    let query = "";
    const model = buildCollectorWorkspaceViewModel(packages, "online", "", false, [], [], "", true);
    const actions = createActions({ onFilterChange: (value) => { filter = value; }, onQueryChange: (value) => { query = value; } });
    const sidebar = CollectorSidebar({ actions, model });
    findElement(sidebar, (element) => element.type === "button" && element.props["aria-current"] === "page").props.onClick();
    const toolbar = CollectorToolbar({ actions, model });
    findElement(toolbar, (element) => element.props.label === "Links durchsuchen").props.onChange({ target: { value: "part02" } });
    expect(filter).toBe("online");
    expect(query).toBe("part02");
  });

  it("keeps busy, error and empty states inside the table body", () => {
    const actions = createActions();
    const empty = renderToStaticMarkup(<CollectorContent actions={actions} model={buildCollectorWorkspaceViewModel([], "all", "", false, [], [], "", true)} />);
    const busy = renderToStaticMarkup(<CollectorContent actions={actions} model={buildCollectorWorkspaceViewModel([], "all", "", true, [], [], "", true)} />);
    const failed = renderToStaticMarkup(<CollectorContent actions={actions} model={buildCollectorWorkspaceViewModel([], "all", "", false, [], [], "Import fehlgeschlagen", true)} />);
    expect(empty).toContain("Noch keine Links");
    expect(busy).toContain("Links werden analysiert");
    expect(failed).toContain("Import fehlgeschlagen");
  });

  it("uses an analysis dialog instead of a raw tab editor", () => {
    let value = "";
    let commits = 0;
    const dialog = CollectorInputDialog({ open: true, value, onChange: (next) => { value = next; }, onClose: () => {}, onCommit: () => { commits += 1; } });
    const html = renderToStaticMarkup(dialog);
    expect(html).toContain("Links werden geprüft und automatisch zu Downloadpaketen gruppiert.");
    expect(html).toContain("Analysieren");
    findElement(dialog, (element) => element.type === "textarea").props.onChange({ target: { value: "https://1fichier.com/?abc" } });
    findButton(dialog, "Analysieren").props.onClick();
    expect(value).toBe("https://1fichier.com/?abc");
    expect(commits).toBe(1);
  });

  it("uses aligned responsive package grids and content visibility", () => {
    const css = readFileSync(new URL("../src/renderer/views/collector/collector.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.collector-table-header-row, \.collector-package-row, \.collector-file-row\s*\{[^}]*grid-template-columns:/s);
    expect(css).toMatch(/\.collector-package-group\s*\{[^}]*content-visibility:\s*auto;/s);
    expect(css).toMatch(/@media \(max-width: 1120px\)[\s\S]*\.collector-toolbar\s*\{[^}]*flex-wrap:\s*wrap;/s);
  });

  it("uses one consistent gap across collector toolbar groups", () => {
    const css = readFileSync(new URL("../src/renderer/views/collector/collector.css", import.meta.url), "utf8");
    const toolbarGap = css.match(/\.collector-toolbar\s*\{[^}]*gap:\s*([^;]+);/s)?.[1]?.trim();
    const groupGap = css.match(/\.collector-toolbar \.ui-toolbar-group\s*\{[^}]*gap:\s*([^;]+);/s)?.[1]?.trim();

    expect(toolbarGap).toBeTruthy();
    expect(groupGap).toBe(toolbarGap);
  });
});
