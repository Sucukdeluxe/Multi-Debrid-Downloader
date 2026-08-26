import { readFileSync } from "node:fs";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buildCollectorTransferPackages,
  buildCollectorWorkspaceViewModel,
  mergeCollectorEnrichment,
  mergeCollectorPackages,
  removeCollectorLinks,
  selectCollectorPackageLinks,
  type CollectorPackage
} from "../src/renderer/views/collector/collector-model";
import {
  CollectorContent,
  CollectorInputDialog,
  MemoizedCollectorContent,
  CollectorSidebar,
  CollectorSidebarStatus,
  CollectorToolbar,
  CollectorView,
  collectorFileInteractionAttributes,
  collectorHeaderScrollStyle,
  collectorPackageIntrinsicBlockSize,
  toggleAllCollectorPackageIds,
  type CollectorViewActions
} from "../src/renderer/views/collector/CollectorView";
import {
  getCollectorDisclosurePinnedIds,
  getCollectorDisclosureViewportIds,
  getCollectorFocusPackageId,
  mergeCollectorPinnedIds,
  resolveCollectorTransitionPins
} from "../src/renderer/views/collector/collector-disclosure";

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
  nameSource: "inferred",
  addedAt: 1_000,
  links: [
    { id: "link-1", url: "https://1fichier.com/?one11111", fileName: "SBS14HD.part01.rar", fileSizeBytes: 471_859_200, hoster: "1fichier", availability: "online", status: "ready", addedAt: 1_000 },
    { id: "link-2", url: "https://1fichier.com/?two22222", fileName: "SBS14HD.part02.rar", fileSizeBytes: 471_859_200, hoster: "1fichier", availability: "online", status: "ready", addedAt: 1_000 }
  ]
}, {
  id: "package-mixed",
  name: "Mixed",
  nameSource: "inferred",
  addedAt: 2_000,
  links: [
    { id: "link-3", url: "https://example.test/unknown", fileName: "download.bin", fileSizeBytes: null, hoster: "example", availability: "unknown", status: "unknown", addedAt: 2_000 },
    { id: "link-4", url: "https://example.test/offline", fileName: "offline.bin", fileSizeBytes: null, hoster: "example", availability: "offline", status: "offline", addedAt: 2_000 }
  ]
}];

describe("collector workspace model", () => {
  it("merges late enrichment by URL without duplicates and moves the link into its resolved package", () => {
    const initial: CollectorPackage[] = [{
      id: "pending",
      name: "Unsortiert",
      nameSource: "inferred",
      addedAt: 1_000,
      links: [{ id: "stable-link", url: "https://1fichier.com/?one11111", fileName: "download.bin", fileSizeBytes: null, hoster: "1fichier", availability: "unknown", status: "unknown", addedAt: 1_000 }]
    }];
    const enriched: CollectorPackage[] = [{
      id: "resolved",
      name: "SBS14HD",
      nameSource: "inferred",
      addedAt: 2_000,
      links: [{ id: "replacement-id", url: "https://1fichier.com/?one11111", fileName: "SBS14HD.part01.rar", fileSizeBytes: 471_859_200, hoster: "1fichier", availability: "online", status: "ready", addedAt: 2_000 }]
    }];

    const result = mergeCollectorPackages(initial, enriched);

    expect(result).toEqual(expect.objectContaining({ addedLinks: 0, duplicateLinks: 0, enrichedLinks: 1 }));
    expect(result.packages).toHaveLength(1);
    expect(result.packages[0].name).toBe("SBS14HD");
    expect(result.packages[0].links).toEqual([expect.objectContaining({
      id: "stable-link",
      fileName: "SBS14HD.part01.rar",
      fileSizeBytes: 471_859_200,
      availability: "online",
      status: "ready",
      addedAt: 1_000
    })]);
  });

  it("deduplicates repeated incoming URLs while preserving distinct links", () => {
    const incoming: CollectorPackage[] = [{
      id: "incoming",
      name: "SBS14HD",
      nameSource: "inferred",
      addedAt: 3_000,
      links: [
        { ...packages[0].links[0], id: "duplicate" },
        { ...packages[0].links[0], id: "duplicate-again" },
        { id: "link-5", url: "https://1fichier.com/?three333", fileName: "SBS14HD.part03.rar", fileSizeBytes: 10, hoster: "1fichier", availability: "online", status: "ready", addedAt: 3_000 }
      ]
    }];
    const result = mergeCollectorPackages(packages, incoming);

    expect(result.addedLinks).toBe(1);
    expect(result.duplicateLinks).toBe(2);
    expect(result.packages[0].links.map((link) => link.id)).toEqual(["link-1", "link-2", "link-5"]);
  });

  it("does not restore links removed while background enrichment is running", () => {
    const current = [{ ...packages[0], links: [packages[0].links[0]] }];
    const incoming = [{ ...packages[0], links: packages[0].links.map((link) => ({ ...link, status: "ready" as const })) }];

    expect(mergeCollectorEnrichment(current, incoming).packages[0].links.map((link) => link.id)).toEqual(["link-1"]);
    expect(mergeCollectorEnrichment([], incoming).packages).toEqual([]);
  });

  it("does not replace known metadata with a repeated unknown skeleton", () => {
    const current = [{ ...packages[0], links: [packages[0].links[0]] }];
    const incoming: CollectorPackage[] = [{
      id: "pending",
      name: "1Fichier",
      nameSource: "inferred",
      addedAt: 4_000,
      links: [{
        ...packages[0].links[0],
        id: "replacement",
        fileName: "download.bin",
        fileSizeBytes: null,
        availability: "unknown",
        status: "unknown",
        addedAt: 4_000
      }]
    }];

    const result = mergeCollectorPackages(current, incoming);

    expect(result.packages).toHaveLength(1);
    expect(result.packages[0].name).toBe("SBS14HD");
    expect(result.packages[0].links[0]).toEqual(expect.objectContaining({
      id: "link-1",
      fileName: "SBS14HD.part01.rar",
      fileSizeBytes: 471_859_200,
      availability: "online",
      status: "ready",
      addedAt: 1_000
    }));
  });

  it("applies a resolved package name even when link metadata was already complete", () => {
    const current: CollectorPackage[] = [{
      id: "pending",
      name: "Unsortiert",
      nameSource: "inferred",
      addedAt: 1_000,
      links: [{ ...packages[0].links[0], id: "stable-link" }]
    }];
    const incoming: CollectorPackage[] = [{
      id: "resolved",
      name: "SBS14HD",
      nameSource: "inferred",
      addedAt: 2_000,
      links: [{ ...packages[0].links[0], id: "replacement-link" }]
    }];

    const result = mergeCollectorPackages(current, incoming);

    expect(result.enrichedLinks).toBe(1);
    expect(result.duplicateLinks).toBe(0);
    expect(result.packages.map((pkg) => [pkg.name, pkg.links.map((link) => link.id)])).toEqual([
      ["SBS14HD", ["stable-link"]]
    ]);
  });

  it("keeps explicit package names authoritative over inferred enrichment", () => {
    const current: CollectorPackage[] = [{
      id: "explicit",
      name: "Meine Staffel",
      nameSource: "explicit",
      addedAt: 1_000,
      links: [{ ...packages[0].links[0], id: "stable-link", availability: "unknown", status: "unknown" }]
    }];
    const incoming: CollectorPackage[] = [{
      id: "inferred",
      name: "SBS14HD",
      nameSource: "inferred",
      addedAt: 2_000,
      links: [{ ...packages[0].links[0], id: "replacement-link" }]
    }];

    const result = mergeCollectorPackages(current, incoming);

    expect(result.packages).toHaveLength(1);
    expect(result.packages[0]).toEqual(expect.objectContaining({ name: "Meine Staffel", nameSource: "explicit" }));
    expect(result.packages[0].links[0]).toEqual(expect.objectContaining({ id: "stable-link", availability: "online", status: "ready" }));
  });

  it("upgrades an inferred package identity when explicit metadata arrives", () => {
    const current: CollectorPackage[] = [{
      id: "inferred",
      name: "SBS14HD",
      nameSource: "inferred",
      addedAt: 1_000,
      links: [{ ...packages[0].links[0], id: "stable-link", availability: "unknown", status: "unknown" }]
    }];
    const incoming: CollectorPackage[] = [{
      id: "explicit",
      name: "SBS14HD",
      nameSource: "explicit",
      addedAt: 2_000,
      links: [{ ...packages[0].links[0], id: "replacement-link" }]
    }];

    const result = mergeCollectorPackages(current, incoming);

    expect(result.packages[0].nameSource).toBe("explicit");
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
      { id: "all", label: "Alle", count: 4 },
      { id: "online", label: "Online", count: 2 },
      { id: "unknown", label: "Ungeprüft", count: 1 },
      { id: "offline", label: "Offline", count: 1 }
    ]);
  });

  it("keeps initially unknown links visible while background analysis runs", () => {
    const model = buildCollectorWorkspaceViewModel([packages[1]], "all", "", true, [], [], "", true);

    expect(model.analyzing).toBe(true);
    expect(model.empty).toBe(false);
    expect(model.packages[0].links.map((link) => link.fileName)).toContain("download.bin");
  });

  it("toggles all package identities independent of active filters", () => {
    const packageIds = packages.map((pkg) => pkg.id);
    expect([...toggleAllCollectorPackageIds(packageIds, new Set())].sort()).toEqual(["package-mixed", "package-sbs"]);
    expect([...toggleAllCollectorPackageIds(packageIds, new Set(["package-sbs"]))].sort()).toEqual(["package-mixed", "package-sbs"]);
    expect([...toggleAllCollectorPackageIds(packageIds, new Set(packageIds))]).toEqual([]);
  });
});

describe("collector disclosure virtualization", () => {
  it("pins only previously visible packages whose collapsed state changes", () => {
    const previousCollapsed = new Map([
      ["package-1", false],
      ["package-2", false],
      ["package-3", false]
    ]);
    const nextRows = [
      { id: "package-1", collapsed: true },
      { id: "package-2", collapsed: true },
      { id: "package-3", collapsed: true }
    ];

    expect(getCollectorDisclosurePinnedIds(["package-1", "package-2"], previousCollapsed, nextRows, true)).toEqual(["package-1", "package-2"]);
    expect(getCollectorDisclosurePinnedIds(["package-1", "package-2"], previousCollapsed, nextRows, false)).toEqual([]);
  });

  it("retains transitioning and keyboard-focused packages across virtual window changes", () => {
    expect(getCollectorDisclosureViewportIds([
      { id: "visible", index: 1, pinned: false },
      { id: "transitioning", index: 99, pinned: true }
    ], 0, 3)).toEqual(["visible"]);
    expect(mergeCollectorPinnedIds(["transitioning"], "focused")).toEqual(["transitioning", "focused"]);
    expect(getCollectorFocusPackageId([
      { id: "package-1", focusIndexStart: 0, focusCount: 4 },
      { id: "package-2", focusIndexStart: 4, focusCount: 2 }
    ], 4)).toBe("package-2");
    expect(resolveCollectorTransitionPins(["transitioning"], ["new-visible-1", "new-visible-2"], 3)).toEqual(["transitioning", "new-visible-1", "new-visible-2"]);
    expect(resolveCollectorTransitionPins(["transitioning"], ["new-visible-1", "new-visible-2"], 2)).toEqual(["new-visible-1", "new-visible-2"]);
    expect(resolveCollectorTransitionPins([], Array.from({ length: 12 }, (_, index) => `package-${index}`))).toEqual(Array.from({ length: 8 }, (_, index) => `package-${index + 4}`));
  });

  it("removes collapsed transition files from logical focus and ARIA indexing", () => {
    expect(collectorFileInteractionAttributes(2, 0, 0, false)).toEqual({ rowIndex: 3, focusIndex: 2, tabIndex: undefined });
    expect(collectorFileInteractionAttributes(2, 0, 0, true)).toEqual({ rowIndex: undefined, focusIndex: undefined, tabIndex: -1 });
  });
});

describe("CollectorView", () => {
  it("reserves the exact package height while content visibility skips offscreen rows", () => {
    const expanded = buildCollectorWorkspaceViewModel([packages[0]], "all", "", false, [], [], "", true).packages[0];
    const collapsed = { ...expanded, collapsed: true };

    expect(collectorPackageIntrinsicBlockSize(expanded)).toBe(126);
    expect(collectorPackageIntrinsicBlockSize(collapsed)).toBe(46);
    expect(renderToStaticMarkup(<CollectorContent actions={createActions()} model={buildCollectorWorkspaceViewModel([packages[0]], "all", "", false, [], [], "", true)} />)).toContain("contain-intrinsic-block-size:auto 126px");
  });

  it("keeps expanded child rows bounded to the virtual viewport for large collectors", () => {
    const manyPackages: CollectorPackage[] = Array.from({ length: 50 }, (_, index) => ({
      ...packages[0],
      id: `package-${index}`,
      name: `Paket ${index}`,
      links: packages[0].links.map((link, linkIndex) => ({
        ...link,
        id: `link-${index}-${linkIndex}`,
        url: `https://example.test/${index}/${linkIndex}`
      }))
    }));

    const html = renderToStaticMarkup(<CollectorContent actions={createActions()} model={buildCollectorWorkspaceViewModel(manyPackages, "all", "", false, [], [], "", true)} />);
    const renderedFileRows = html.match(/class="collector-file-row/g)?.length ?? 0;

    expect(html).toContain("collector-virtual-spacer");
    expect(renderedFileRows).toBeGreaterThan(0);
    expect(renderedFileRows).toBeLessThanOrEqual(20);
  });

  it("does not replay the disclosure animation when an expanded virtual package mounts", () => {
    const html = renderToStaticMarkup(<CollectorContent actions={createActions()} model={buildCollectorWorkspaceViewModel([packages[0]], "all", "", false, [], [], "", true)} />);

    expect(html).toContain("collector-package-items-frame");
    expect(html).not.toContain("collector-package-items-frame is-animated");
  });

  it("exposes logical row counts and positions for virtualized assistive navigation", () => {
    const html = renderToStaticMarkup(<CollectorContent actions={createActions()} model={buildCollectorWorkspaceViewModel([packages[0]], "all", "", false, [], [], "", true)} />);

    expect(html).toContain('aria-rowcount="4"');
    expect(html).toContain('aria-rowindex="1"');
    expect(html).toContain('aria-rowindex="2"');
    expect(html).toContain('aria-rowindex="3"');
    expect(html).toContain('aria-rowindex="4"');
    expect(html).toContain('data-collector-focus-index="0"');
    expect(html).toContain('data-collector-focus-index="1"');
    expect(html).toContain('data-collector-focus-index="2"');
    expect(html).toContain('data-collector-focus-index="3"');
  });

  it("renders expandable package and file rows with preview columns", () => {
    const html = renderToStaticMarkup(<CollectorView actions={createActions()} model={buildCollectorWorkspaceViewModel(packages, "all", "", false, [], [], "", true)} />);

    for (const heading of ["Name", "Größe", "Hoster", "Status", "Verfügbarkeit", "Hinzugefügt"]) expect(html).toContain(`>${heading}<`);
    expect(html).toContain("SBS14HD");
    expect(html).toContain("SBS14HD.part01.rar");
    expect(html).toContain("SBS14HD.part02.rar");
    expect(html).toContain("2/2 online");
    expect(html).toContain(">Online<");
    expect(html).toContain("aria-label=\"SBS14HD einklappen\"");
    expect(html).not.toContain("URL oder Rohzeile");
    expect(html).not.toContain(">Zeile<");
  });

  it("keeps rows and actions available during background analysis", () => {
    const model = buildCollectorWorkspaceViewModel(packages, "all", "", true, ["link-1"], [], "", true);
    const html = renderToStaticMarkup(<CollectorContent actions={createActions()} model={model} />);
    const sidebarStatus = renderToStaticMarkup(<CollectorSidebarStatus model={model} />);
    const toolbar = CollectorToolbar({ actions: createActions(), model });

    expect(html).not.toContain("Analyse läuft im Hintergrund");
    expect(sidebarStatus).toContain("Analyse läuft im Hintergrund");
    expect(sidebarStatus).toContain('role="status"');
    expect(html).toContain("SBS14HD.part01.rar");
    expect(findButton(toolbar, "Auswahl übergeben (1)").props.disabled).toBe(false);
    expect(findButton(toolbar, "Alle übergeben (4)").props.disabled).toBe(false);
    expect(findButton(toolbar, "Auswahl entfernen").props.disabled).toBe(false);
  });

  it("derives status exclusively from availability instead of filename readiness", () => {
    const unknownReady = [{
      ...packages[0],
      links: [{ ...packages[0].links[0], availability: "unknown" as const, status: "ready" as const }]
    }];
    const partial = [{
      ...packages[0],
      links: [
        { ...packages[0].links[0], availability: "online" as const },
        { ...packages[0].links[1], availability: "unknown" as const }
      ]
    }];
    const offlineUnknown = [{
      ...packages[0],
      links: [
        { ...packages[0].links[0], availability: "offline" as const },
        { ...packages[0].links[1], availability: "unknown" as const }
      ]
    }];

    const unknownHtml = renderToStaticMarkup(<CollectorContent actions={createActions()} model={buildCollectorWorkspaceViewModel(unknownReady, "all", "", false, [], [], "", true)} />);
    const partialHtml = renderToStaticMarkup(<CollectorContent actions={createActions()} model={buildCollectorWorkspaceViewModel(partial, "all", "", false, [], [], "", true)} />);
    const offlineUnknownHtml = renderToStaticMarkup(<CollectorContent actions={createActions()} model={buildCollectorWorkspaceViewModel(offlineUnknown, "all", "", false, [], [], "", true)} />);

    expect(unknownHtml).not.toContain(">Bereit<");
    expect(unknownHtml).toContain(">Ungeprüft<");
    expect(partialHtml).toContain(">Teilweise online<");
    expect(partialHtml).toContain("1/2 online");
    expect(offlineUnknownHtml).not.toContain(">Teilweise online<");
    expect(offlineUnknownHtml).toContain(">Ungeprüft<");
  });

  it("renders known hosters as icons with their full name as tooltip", () => {
    const html = renderToStaticMarkup(<CollectorContent actions={createActions()} model={buildCollectorWorkspaceViewModel(packages, "all", "", false, [], [], "", true)} />);

    expect(html).toContain('class="collector-hoster-label" title="1Fichier"');
    expect(html).toContain('class="collector-hoster-icon" data-hoster="1fichier" src="./provider-icons/onefichier.png"');
  });

  it("renders collapsed packages without child rows when animations are disabled", () => {
    const html = renderToStaticMarkup(<CollectorContent actions={createActions()} model={buildCollectorWorkspaceViewModel(packages, "all", "", false, [], ["package-sbs"], "", false)} />);
    expect(html).toContain("aria-label=\"SBS14HD ausklappen\"");
    expect(html).not.toContain("SBS14HD.part01.rar");
  });

  it("removes collapsed child rows from the DOM even when animations are enabled", () => {
    const html = renderToStaticMarkup(<CollectorContent actions={createActions()} model={buildCollectorWorkspaceViewModel([packages[0]], "all", "", false, [], ["package-sbs"], "", true)} />);
    expect(html).not.toContain("collector-package-items-frame");
    expect(html).not.toContain("SBS14HD.part01.rar");
  });

  it("reuses the collector content when app snapshots keep the same collector model", () => {
    const model = buildCollectorWorkspaceViewModel(packages, "all", "", false, [], [], "", true);
    const compare = (MemoizedCollectorContent as unknown as {
      compare: (previous: { model: typeof model; actions: CollectorViewActions }, next: { model: typeof model; actions: CollectorViewActions }) => boolean;
    }).compare;

    expect(compare({ model, actions: createActions() }, { model, actions: createActions() })).toBe(true);
    expect(compare({ model, actions: createActions() }, { model: { ...model, query: "neu" }, actions: createActions() })).toBe(false);
  });

  it("offers selected and all transfer actions", () => {
    let selected = 0;
    let all = 0;
    const toolbar = CollectorToolbar({
      actions: createActions({ onSubmitSelected: () => { selected += 1; }, onSubmitAll: () => { all += 1; } }),
      model: buildCollectorWorkspaceViewModel(packages, "all", "", false, ["link-1"], [], "", true)
    });

    findButton(toolbar, "Auswahl übergeben (1)").props.onClick();
    findButton(toolbar, "Alle übergeben (4)").props.onClick();
    expect(selected).toBe(1);
    expect(all).toBe(1);
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

  it("keeps errors visible without replacing existing packages", () => {
    const html = renderToStaticMarkup(<CollectorContent actions={createActions()} model={buildCollectorWorkspaceViewModel(packages, "all", "", false, [], [], "Ein Link konnte nicht geprüft werden", true)} />);
    expect(html).toContain("Ein Link konnte nicht geprüft werden");
    expect(html).toContain("SBS14HD.part01.rar");
  });

  it("uses an analysis dialog instead of a raw tab editor", () => {
    let value = "";
    let commits = 0;
    const dialog = CollectorInputDialog({ open: true, value, onChange: (next) => { value = next; }, onClose: () => {}, onCommit: () => { commits += 1; } });
    const html = renderToStaticMarkup(dialog);
    expect(html).toContain("Links erscheinen sofort und werden anschließend im Hintergrund geprüft.");
    expect(html).toContain("Hinzufügen");
    findElement(dialog, (element) => element.type === "textarea").props.onChange({ target: { value: "https://1fichier.com/?abc" } });
    findButton(dialog, "Hinzufügen").props.onClick();
    expect(value).toBe("https://1fichier.com/?abc");
    expect(commits).toBe(1);
  });

  it("uses aligned responsive package grids and positioned virtual rows", () => {
    const css = readFileSync(new URL("../src/renderer/views/collector/collector.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.collector-table-header-row,\s*\.collector-package-row,\s*\.collector-file-row\s*\{[^}]*grid-template-columns:/s);
    expect(css).toMatch(/\.collector-virtual-package\s*\{[^}]*position:\s*absolute;[^}]*transform:\s*translateY/s);
    expect(css).toMatch(/@media \(max-width: 1120px\)[\s\S]*\.collector-toolbar\s*\{[^}]*flex-wrap:\s*wrap;/s);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.collector-virtual-spacer\.is-motion-enabled \.collector-virtual-package\s*\{[^}]*transition-duration:\s*300ms, 300ms !important;/s);
    expect(css).toMatch(/\.collector-package-items-frame\.is-expanding\s*\{[^}]*animation:\s*collector-items-expand/s);
    expect(css).not.toMatch(/\.collector-package-items-frame\.is-animated\s*\{[^}]*animation:\s*collector-items-expand/s);
    expect(css).toMatch(/\.collector-table-header-row > span:nth-child\(2\)\s*\{[^}]*padding-left:\s*48px;/s);
    expect(css).toMatch(/\.collector-name-cell\.is-file\s*\{[^}]*padding-left:\s*32px;/s);
    expect(css).toMatch(/\.collector-table-header,\s*\.collector-table-body\s*\{[^}]*scrollbar-gutter:\s*stable;/s);
    expect(css).toMatch(/\.collector-size-cell,\s*\.collector-hoster-cell,\s*\.collector-status-cell,\s*\.collector-availability-cell,\s*\.collector-added-cell\s*\{[^}]*text-align:\s*center;/s);
    expect(css).toMatch(/\.collector-table-header-row > span:nth-child\(n\+3\)\s*\{[^}]*justify-content:\s*center;[^}]*text-align:\s*center;/s);
    expect(collectorHeaderScrollStyle(37)).toEqual({ transform: "translateX(-37px)" });
  });

  it("uses one consistent gap across collector toolbar groups", () => {
    const css = readFileSync(new URL("../src/renderer/views/collector/collector.css", import.meta.url), "utf8");
    const toolbarGap = css.match(/\.collector-toolbar\s*\{[^}]*gap:\s*([^;]+);/s)?.[1]?.trim();
    const groupGap = css.match(/\.collector-toolbar \.ui-toolbar-group\s*\{[^}]*gap:\s*([^;]+);/s)?.[1]?.trim();
    expect(toolbarGap).toBeTruthy();
    expect(groupGap).toBe(toolbarGap);
  });

  it("uses the green confirmation style for the add-links action", () => {
    const css = readFileSync(new URL("../src/renderer/views/collector/collector.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.collector-action-primary\s*\{[^}]*border-color:\s*var\(--ui-success\);[^}]*background:\s*var\(--ui-success\);[^}]*color:\s*#000000;/s);
    expect(css).toMatch(/\.collector-action-primary:hover:not\(:disabled\)\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--ui-success\) 86%, #ffffff\);[^}]*color:\s*#000000;/s);
  });
});
