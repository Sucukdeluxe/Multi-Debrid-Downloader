import { readFileSync } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DownloadItem, DownloadStatus, PackageEntry } from "../src/shared/types";
import {
  buildDownloadSidebarCounts,
  buildDownloadsViewModel,
  classifyDownloadStatus,
  formatRemainingDownloadBytes,
  formatRemainingDownloadTooltip,
  getDownloadQueueTotalBytes,
  getRemainingDownloadBytes,
  getPendingDownloadItemCount,
  getDownloadSpeedBps,
  buildDownloadLogicalRows,
  type DownloadSidebarFilter,
  type DownloadsModelInput
} from "../src/renderer/views/downloads/downloads-model";
import {
  DOWNLOAD_DISCLOSURE_DURATION_MS,
  DOWNLOAD_DISCLOSURE_MAX_ANIMATED_ITEMS,
  activateDownloadDisclosureTransition,
  getDownloadDisclosurePinnedIds,
  mergeDownloadDisclosureRows,
  prepareDownloadDisclosureTransition,
  scheduleDownloadDisclosureActivation,
  stableDownloadDisclosureRows
} from "../src/renderer/views/downloads/download-disclosure-transition";
import {
  DOWNLOAD_ORDER_TRANSITION_DURATION_MS,
  getDownloadOrderTransitionPinnedIds,
  getDownloadOrderTransformKeyframes,
  isDownloadPackageOrderChange
} from "../src/renderer/views/downloads/download-order-transition";
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
  ItemRowContent,
  PackageCardContent,
  areItemRowPropsEqual,
  arePackageCardPropsEqual,
  compactDownloadStatus,
  downloadColumnDefinitions,
  getAvailabilitySummary,
  getPackageProgress,
  getPackageSizeProgress
} from "../src/renderer/views/downloads/DownloadsTable";
import * as downloadsTableModule from "../src/renderer/views/downloads/DownloadsTable";
import {
  DOWNLOAD_FILE_ROW_HEIGHT,
  DOWNLOAD_PACKAGE_ROW_HEIGHT,
  calculateDownloadVirtualWindow
} from "../src/renderer/views/downloads/download-virtualizer";
import {
  compactDownloadServiceLabel,
  extractHoster,
  formatHosterLabel,
  normalizeDownloadServiceLabel
} from "../src/renderer/download-format";
import { getRollingMetricDirection } from "../src/renderer/ui/RollingMetricValue";

const now = new Date(2026, 7, 10, 12, 0, 0, 0).getTime();

describe("Downloadtabellen-Spalten", () => {
  it("derives grid tracks from the same column order that renders the cells", () => {
    const downloadGridTemplateForOrder = (downloadsTableModule as unknown as {
      downloadGridTemplateForOrder?: (order: readonly string[]) => string;
    }).downloadGridTemplateForOrder;
    expect(downloadGridTemplateForOrder).toBeTypeOf("function");
    if (!downloadGridTemplateForOrder) return;

    const order = ["size", "name"];
    const expected = `36px ${downloadColumnDefinitions.size.width} ${downloadColumnDefinitions.name.width} 60px`;
    const header = DownloadsTableHeader({
      actions: createActions(),
      columnOrder: order,
      gridTemplate: `${downloadColumnDefinitions.name.width} ${downloadColumnDefinitions.size.width}`,
      selectedCount: 0,
      sortColumn: "name",
      sortDirection: "asc",
      visibleIds: []
    });

    expect(downloadGridTemplateForOrder(order)).toBe(expected);
    expect(header.props.style.gridTemplateColumns).toBe(expected);
  });

  it("keeps the column layout reset out of the table action header", () => {
    const actions = createActions();
    const model = withRuntime(createInput());
    const content = renderToStaticMarkup(<DownloadsContent actions={actions} model={model} />);

    expect(content).not.toContain('aria-label="Spaltenlayout zurücksetzen"');
    expect(content).toMatch(/class="downloads-action-cell" role="columnheader">Aktion<\/span>/);
  });

  it("never interpolates download grid tracks while column contents move", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src/renderer/views/downloads/downloads.css"), "utf8");

    expect(css).toMatch(/\.downloads-table-header,\s*\.downloads-package-row,\s*\.downloads-item-row\s*\{[^}]*transition-property:\s*none;/s);
    expect(css).toMatch(/\.downloads-table\.is-column-drag-motion-disabled\.is-column-drag-active\s+\[data-download-column\]\s*\{[^}]*transition:\s*none\s*!important;/s);
  });

  it("verteilt die Breite mit ausreichend Platz für vollständige Überschriften", () => {
    expect(downloadColumnDefinitions.name.width).toBe("minmax(var(--downloads-name-min, 290px), 2.3fr)");
    expect(downloadColumnDefinitions.progress.width).toBe("minmax(var(--downloads-progress-min, 105px), 0.85fr)");
    expect(downloadColumnDefinitions.prio.width).toBe("minmax(var(--downloads-priority-min, 85px), 0.8fr)");
    expect(downloadColumnDefinitions.speed).toEqual(expect.objectContaining({ label: "Geschwindigkeit", width: "minmax(var(--downloads-speed-min, 120px), 1fr)" }));
    expect(downloadColumnDefinitions.availability).toEqual(expect.objectContaining({ label: "Verfügbarkeit", width: "minmax(var(--downloads-availability-min, 110px), 1fr)" }));
  });

  it("uses the normal text color for sortable and static column headers", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src/renderer/views/downloads/downloads.css"), "utf8");

    expect(css).toMatch(/\.downloads-table-header\s*\{[^}]*color:\s*var\(--ui-text\);/s);
  });

  it("moves complete columns through pointer capture and animated transforms", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/renderer/views/downloads/DownloadsTable.tsx"), "utf8");
    const dragSource = fs.readFileSync(path.join(process.cwd(), "src/renderer/views/downloads/column-drag.ts"), "utf8");
    const css = fs.readFileSync(path.join(process.cwd(), "src/renderer/views/downloads/downloads.css"), "utf8");

    expect(source).toContain("onColumnPointerDown");
    expect(source).toContain("setPointerCapture");
    expect(source).toContain("onPointerMove");
    expect(source).not.toMatch(/className="downloads-column-header"[\s\S]{0,180}\sdraggable/);
    expect(dragSource).toContain('root.style.setProperty(`--downloads-column-drag-${id}`');
    expect(css).toMatch(/\.downloads-table\.is-column-drag-active \[data-download-column\]\s*\{[^}]*transform:\s*translate3d\(var\(--downloads-column-drag-x, 0px\), 0, 0\);[^}]*transition:\s*transform 220ms/s);
    expect(css).toMatch(/\.downloads-table\.is-column-drag-active \[data-column-dragging="true"\]\s*\{[^}]*transition:\s*none;/s);
    expect(css).not.toMatch(/\.downloads-table\.is-column-drag-active \[data-column-dragging="true"\]\s*\{[^}]*background:/s);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.downloads-table\.is-column-drag-active \[data-download-column\][^{]*\{[^}]*transition-duration:\s*220ms !important;/s);
  });

  it("changes package collapse state only through user actions", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/renderer/App.tsx"), "utf8");

    expect(source).not.toContain("autoExpandedPkgsRef");
    expect(source).not.toMatch(/isExtracting[\s\S]{0,800}setCollapsedPackages/);
  });
});

describe("rollende Downloadkennzahlen", () => {
  it("moves increasing values up and decreasing values down", () => {
    expect(getRollingMetricDirection(300, 600)).toBe("up");
    expect(getRollingMetricDirection(600, 300)).toBe("down");
    expect(getRollingMetricDirection(300, 300)).toBe("none");
  });

  it("animates exactly the six stable sidebar metrics including the remaining volume", () => {
    const html = renderToStaticMarkup(<DownloadsSidebarStatus model={withRuntime(createInput())} />);
    expect(html.match(/class="downloads-rolling-value"/g)).toHaveLength(6);
    expect(html).toContain("Verbleibend");
    expect(html.indexOf("Verbleibend")).toBeLessThan(html.indexOf("Gesamt"));
    expect(html).toContain('data-status-metric="speed"');
    expect(html).toContain('data-status-metric="eta"');
  });
});

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

describe("Download-Gesamtgröße", () => {
  it("summiert bekannte Dateigrößen und verwendet geladene Bytes nur als Fallback", () => {
    const items = [
      item("known", "package-a", "queued", { totalBytes: 4_000, downloadedBytes: 500 }),
      item("fallback", "package-a", "queued", { totalBytes: null, downloadedBytes: 750 })
    ];

    expect(getDownloadQueueTotalBytes(items)).toBe(4_750);
  });

  it("preserves completed package bytes and progress after immediate cleanup", () => {
    const active = item("active", "package-a", "downloading", {
      downloadedBytes: 500,
      totalBytes: 1_000,
      progressPercent: 50
    });
    const packageEntry = pkg("package-a", "Serie", ["active"]);
    packageEntry.cleanedCompletedItemCount = 2;
    packageEntry.cleanedExtractedItemCount = 2;
    packageEntry.cleanedDownloadedBytes = 2_000;
    packageEntry.cleanedTotalBytes = 2_000;
    const row = { package: packageEntry, items: [active], allItems: [active], collapsed: true };

    expect(getPackageSizeProgress(row)).toEqual({ downloaded: 2_500, total: 3_000, value: 83 });
    expect(getPackageProgress(row)).toEqual(expect.objectContaining({ done: 2, total: 3, value: 83 }));
  });
});

describe("verbleibendes Downloadvolumen", () => {
  it("summiert nur offene bekannte Restbytes und klemmt überladene Fortschritte bei null", () => {
    const items = [
      item("partial", "remaining", "downloading", { downloadedBytes: 750_000_000, totalBytes: 2_000_000_000 }),
      item("queued", "remaining", "queued", { downloadedBytes: 0, totalBytes: 3_000_000_000 }),
      item("overshot", "remaining", "downloading", { downloadedBytes: 2_100_000_000, totalBytes: 2_000_000_000 }),
      item("done", "remaining", "completed", { downloadedBytes: 9_000_000_000, totalBytes: 10_000_000_000 }),
      item("failed", "remaining", "failed", { downloadedBytes: 0, totalBytes: 8_000_000_000 }),
      item("cancelled", "remaining", "cancelled", { downloadedBytes: 0, totalBytes: 7_000_000_000 })
    ];

    expect(getRemainingDownloadBytes(items)).toEqual({ bytes: 4_250_000_000, unknownItems: 0 });
  });

  it("meldet unbekannte Größen nur für noch offene Downloads", () => {
    const items = [
      item("known", "remaining", "queued", { downloadedBytes: 250_000_000, totalBytes: 1_000_000_000 }),
      item("unknown-open", "remaining", "queued", { downloadedBytes: 120_000_000, totalBytes: null }),
      item("unknown-done", "remaining", "completed", { totalBytes: null })
    ];

    expect(getRemainingDownloadBytes(items)).toEqual({ bytes: 750_000_000, unknownItems: 1 });
    expect(formatRemainingDownloadBytes({ bytes: 750_000_000, unknownItems: 1 })).toBe("≥ 715.26 MB");
    expect(formatRemainingDownloadBytes({ bytes: 0, unknownItems: 1 })).toBe("Unbekannt");
    expect(formatRemainingDownloadBytes({ bytes: 0, unknownItems: 0 })).toBe("0 B");
    expect(formatRemainingDownloadTooltip({ bytes: 750_000_000, unknownItems: 1 }))
      .toBe("Noch unbekannte Dateigrößen: 1. Die tatsächliche Restmenge kann höher sein.");
    expect(formatRemainingDownloadTooltip({ bytes: 0, unknownItems: 0 })).toBe("");
  });

  it("erklärt unbekannte Restgrößen direkt am verbleibenden Wert", () => {
    const model = withRuntime(createInput());
    model.status.remaining = "≥ 715.26 MB";
    model.status.remainingTooltip = "Noch unbekannte Dateigrößen: 2. Die tatsächliche Restmenge kann höher sein.";

    const html = renderToStaticMarkup(<DownloadsSidebarStatus model={model} />);

    expect(html).toContain('class="has-tooltip"');
    expect(html).toContain('title="Noch unbekannte Dateigrößen: 2. Die tatsächliche Restmenge kann höher sein."');
    expect(html).toContain('aria-describedby="downloads-status-remaining-tooltip"');
    expect(html).toContain('class="downloads-visually-hidden"');
  });
});

describe("virtualisierte Paketanimation", () => {
  const packageA = pkg("package-a", "A", ["a-1", "a-2"]);
  const packageB = pkg("package-b", "B", ["b-1"]);
  const items = {
    "a-1": item("a-1", "package-a", "queued"),
    "a-2": item("a-2", "package-a", "queued"),
    "b-1": item("b-1", "package-b", "queued")
  };
  const logicalRows = (collapsedPackageIds: string[]) => buildDownloadLogicalRows(buildDownloadsViewModel({
    packageOrder: [packageA.id, packageB.id],
    packages: { [packageA.id]: packageA, [packageB.id]: packageB },
    items,
    displayMode: "packages",
    filter: "all",
    providerFilter: "all",
    query: "",
    collapsedPackageIds,
    selectedIds: [],
    hideExtractedItems: false,
    showAllPackages: true,
    renderLimit: 100
  }));

  it("überspringt die Paketbewegung, wenn sie in den Einstellungen deaktiviert ist", () => {
    const expanded = logicalRows([]);
    const prepared = prepareDownloadDisclosureTransition(
      stableDownloadDisclosureRows(logicalRows([packageA.id])),
      expanded,
      false
    );

    expect(prepared.animated).toBe(false);
    expect(prepared.rows).toEqual(stableDownloadDisclosureRows(expanded));
    expect(prepared.rows.some((row) => row.type === "item-group")).toBe(false);
  });

  it("deaktiviert alle Downloadbewegungen über den allgemeinen Animationsschalter", () => {
    const html = renderToStaticMarkup(<DownloadsContent actions={createActions()} model={withRuntime(createInput(), { animationsEnabled: false })} />);
    const css = readFileSync(path.join(process.cwd(), "src/renderer/views/downloads/downloads.css"), "utf8");

    expect(html).toContain('class="downloads-table-body is-download-motion-disabled"');
    expect(css).toMatch(/\.downloads-table-body\.is-download-motion-disabled \.downloads-virtual-spacer,\s*\.downloads-table-body\.is-download-motion-disabled \.downloads-virtual-row\s*\{[^}]*transition:\s*none !important;/s);
  });

  it("pins only previously visible rows for a real priority reorder", () => {
    expect(DOWNLOAD_ORDER_TRANSITION_DURATION_MS).toBe(3000);
    expect(isDownloadPackageOrderChange(["a", "b", "c"], ["b", "c", "a"])).toBe(true);
    expect(isDownloadPackageOrderChange(["a", "b"], ["a", "c"])).toBe(false);
    expect(getDownloadOrderTransitionPinnedIds({
      enabled: true,
      previousOrder: ["a", "b", "c"],
      nextOrder: ["b", "c", "a"],
      previousVisibleIds: ["a", "a:items", "b"],
      activePinnedIds: []
    })).toEqual(["a", "a:items", "b"]);
    expect(getDownloadOrderTransitionPinnedIds({
      enabled: false,
      previousOrder: ["a", "b", "c"],
      nextOrder: ["b", "c", "a"],
      previousVisibleIds: ["a", "b"],
      activePinnedIds: ["c"]
    })).toEqual([]);
    expect(getDownloadOrderTransformKeyframes(240, 159, 315)).toEqual([
      { transform: "translateY(84px)" },
      { transform: "translateY(240px)" }
    ]);
  });

  it("zeichnet den Startzustand in einem eigenen Frame vor der Aktivierung", () => {
    const frames: FrameRequestCallback[] = [];
    const cancelled: number[] = [];
    const activated = vi.fn();
    let frameId = 0;
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      frameId += 1;
      return frameId;
    });
    const cancelFrame = vi.fn((frame: number) => cancelled.push(frame));

    const cancel = scheduleDownloadDisclosureActivation(requestFrame, cancelFrame, activated);

    expect(activated).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);
    frames.shift()?.(16);
    expect(activated).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);
    frames.shift()?.(32);
    expect(activated).toHaveBeenCalledTimes(1);

    cancel();
    expect(cancelled).toContain(2);
  });

  it("fährt einen gemeinsamen Paketbereich aus und lässt seine Unterzeilen auf fester Höhe", () => {
    const collapsed = logicalRows([packageA.id]);
    const expanded = logicalRows([]);
    const prepared = prepareDownloadDisclosureTransition(stableDownloadDisclosureRows(collapsed), expanded);

    expect(prepared.animated).toBe(true);
    expect(prepared.rows.map((row) => [row.id, row.height, row.disclosurePhase, row.disclosureOpacity])).toEqual([
      ["package-a", 40, "stable", 1],
      ["package-a:items", 0, "entering", 1],
      ["package-b", 40, "stable", 1],
      ["b-1", 38, "stable", 1]
    ]);
    const preparedGroup = prepared.rows.find((row) => row.type === "item-group");
    expect(preparedGroup?.type === "item-group" ? preparedGroup.items.map((row) => [row.id, row.height]) : []).toEqual([
      ["a-1", 38],
      ["a-2", 38]
    ]);
    expect(activateDownloadDisclosureTransition(prepared.rows).map((row) => [row.id, row.height, row.disclosureOpacity])).toEqual([
      ["package-a", 40, 1],
      ["package-a:items", 76, 1],
      ["package-b", 40, 1],
      ["b-1", 38, 1]
    ]);
  });

  it("behält die ausdrücklich gewünschte Paketbewegung auch bei reduzierten Systemanimationen bei", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src/renderer/views/downloads/downloads.css"), "utf8");

    expect(DOWNLOAD_DISCLOSURE_DURATION_MS).toBe(1500);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.downloads-virtual-spacer\s*\{[^}]*transition-duration:\s*1500ms !important;/s);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.downloads-virtual-row\s*\{[^}]*transition-duration:\s*1500ms, 1500ms, 1500ms !important;/s);
  });

  it("schneidet beim Einfahren den gemeinsamen Paketbereich ab statt Unterzeilen zusammenzuziehen", () => {
    const expanded = logicalRows([]);
    const collapsed = logicalRows([packageA.id]);
    const prepared = prepareDownloadDisclosureTransition(stableDownloadDisclosureRows(expanded), collapsed);

    expect(prepared.rows.map((row) => [row.id, row.height, row.disclosurePhase, row.disclosureOpacity])).toEqual([
      ["package-a", 40, "stable", 1],
      ["package-a:items", 76, "leaving", 1],
      ["package-b", 40, "stable", 1],
      ["b-1", 38, "stable", 1]
    ]);
    const preparedGroup = prepared.rows.find((row) => row.type === "item-group");
    expect(preparedGroup?.type === "item-group" ? preparedGroup.items.map((row) => row.height) : []).toEqual([38, 38]);
    expect(activateDownloadDisclosureTransition(prepared.rows).map((row) => [row.id, row.height, row.disclosureOpacity])).toEqual([
      ["package-a", 40, 1],
      ["package-a:items", 0, 1],
      ["package-b", 40, 1],
      ["b-1", 38, 1]
    ]);
    expect(stableDownloadDisclosureRows(collapsed).map((row) => row.id)).toEqual(["package-a", "package-b", "b-1"]);
  });

  it("mountet beim Zuklappen auch erst im Ziel-Viewport sichtbare Folgepakete vor der Bewegung", () => {
    const childIds = Array.from({ length: 26 }, (_, index) => `first-${index}`);
    const followingPackages = Array.from({ length: 36 }, (_, index) => pkg(`following-${index}`, `Folge ${index}`, [`following-item-${index}`]));
    const firstPackage = pkg("first", "Erstes Paket", childIds);
    const packageOrder = [firstPackage.id, ...followingPackages.map((entry) => entry.id)];
    const packages = Object.fromEntries([firstPackage, ...followingPackages].map((entry) => [entry.id, entry]));
    const queueItems = Object.fromEntries([
      ...childIds.map((id) => [id, item(id, firstPackage.id, "queued")] as const),
      ...followingPackages.map((entry, index) => [`following-item-${index}`, item(`following-item-${index}`, entry.id, "queued")] as const)
    ]);
    const buildRows = (collapsed: boolean) => buildDownloadLogicalRows(buildDownloadsViewModel({
      packageOrder,
      packages,
      items: queueItems,
      displayMode: "packages",
      filter: "all",
      providerFilter: "all",
      query: "",
      collapsedPackageIds: collapsed ? packageOrder : followingPackages.map((entry) => entry.id),
      selectedIds: [],
      hideExtractedItems: false,
      showAllPackages: true,
      renderLimit: 100
    }));
    const prepared = prepareDownloadDisclosureTransition(stableDownloadDisclosureRows(buildRows(false)), buildRows(true));
    const options = { scrollTop: 0, viewportHeight: 720, overscan: 8 };
    const startWindow = calculateDownloadVirtualWindow(prepared.rows, options);
    const targetWindow = calculateDownloadVirtualWindow(activateDownloadDisclosureTransition(prepared.rows), options);
    const startIds = new Set(startWindow.rows.map((entry) => entry.id));
    const targetOnlyIds = targetWindow.rows.map((entry) => entry.id).filter((id) => !startIds.has(id));
    const pinnedIds = getDownloadDisclosurePinnedIds(prepared.rows, options);
    const mountedStartWindow = calculateDownloadVirtualWindow(prepared.rows, { ...options, pinnedIds });
    const mountedStartIds = new Set(mountedStartWindow.rows.map((entry) => entry.id));

    expect(targetOnlyIds.length).toBeGreaterThan(10);
    expect(targetOnlyIds.every((id) => mountedStartIds.has(id))).toBe(true);
    expect(pinnedIds.length).toBeLessThan(80);
  });

  it("überspringt die Bewegung bei riesigen Einzelpaketen und hält das DOM-Fenster begrenzt", () => {
    const count = DOWNLOAD_DISCLOSURE_MAX_ANIMATED_ITEMS + 10_000;
    const hugePackage = pkg("huge-package", "Groß", Array.from({ length: count }, (_, index) => `huge-${index}`));
    const hugeItems = Object.fromEntries(hugePackage.itemIds.map((id) => [id, item(id, hugePackage.id, "queued")]));
    const buildRows = (collapsed: boolean) => buildDownloadLogicalRows(buildDownloadsViewModel({
      packageOrder: [hugePackage.id],
      packages: { [hugePackage.id]: hugePackage },
      items: hugeItems,
      displayMode: "packages",
      filter: "all",
      providerFilter: "all",
      query: "",
      collapsedPackageIds: collapsed ? [hugePackage.id] : [],
      selectedIds: [],
      hideExtractedItems: false,
      showAllPackages: true,
      renderLimit: count + 1
    }));
    const prepared = prepareDownloadDisclosureTransition(stableDownloadDisclosureRows(buildRows(true)), buildRows(false));
    const window = calculateDownloadVirtualWindow(prepared.rows, { scrollTop: 0, viewportHeight: 720, overscan: 8 });

    expect(prepared.animated).toBe(false);
    expect(window.rows.length).toBeLessThan(40);
  });

  it("begrenzt gleichzeitig animierte Unterzeilen über alle Pakete hinweg", () => {
    const manyItems = Object.fromEntries(Array.from({ length: 80 }, (_, index) => {
      const packageId = index < 40 ? "many-a" : "many-b";
      const id = `${packageId}-${index}`;
      return [id, item(id, packageId, "queued")];
    }));
    const manyPackages = {
      "many-a": pkg("many-a", "Viele A", Object.keys(manyItems).filter((id) => id.startsWith("many-a"))),
      "many-b": pkg("many-b", "Viele B", Object.keys(manyItems).filter((id) => id.startsWith("many-b")))
    };
    const buildRows = (collapsedPackageIds: string[]) => buildDownloadLogicalRows(buildDownloadsViewModel({
      packageOrder: ["many-a", "many-b"],
      packages: manyPackages,
      items: manyItems,
      displayMode: "packages",
      filter: "all",
      providerFilter: "all",
      query: "",
      collapsedPackageIds,
      selectedIds: [],
      hideExtractedItems: false,
      showAllPackages: true,
      renderLimit: 100
    }));

    const prepared = prepareDownloadDisclosureTransition(stableDownloadDisclosureRows(buildRows(["many-a", "many-b"])), buildRows([]));
    expect(prepared.animated).toBe(false);
  });

  it("übernimmt Laufzeitupdates während der Bewegung und kehrt schnelle Gegenklicks um", () => {
    const entering = activateDownloadDisclosureTransition(prepareDownloadDisclosureTransition(stableDownloadDisclosureRows(logicalRows([packageA.id])), logicalRows([])).rows);
    const updated = logicalRows([]).map((row) => row.type === "item" && row.id === "a-1" ? { ...row, item: { ...row.item, downloadedBytes: 987_654_321 } } : row);
    const merged = mergeDownloadDisclosureRows(entering, updated);
    const enteringGroup = merged.find((row) => row.type === "item-group");
    const updatedItem = enteringGroup?.type === "item-group" ? enteringGroup.items.find((row) => row.id === "a-1") : null;
    expect(updatedItem?.item.downloadedBytes).toBe(987_654_321);
    expect(enteringGroup).toEqual(expect.objectContaining({ disclosurePhase: "entering", height: 76, disclosureOpacity: 1 }));

    const collapsed = logicalRows([packageA.id]);
    const leaving = activateDownloadDisclosureTransition(prepareDownloadDisclosureTransition(stableDownloadDisclosureRows(logicalRows([])), collapsed).rows);
    const reversed = prepareDownloadDisclosureTransition(leaving, logicalRows([]));
    expect(reversed.animated).toBe(true);
    expect(reversed.rows.find((row) => row.packageId === packageA.id && row.type === "item-group")).toEqual(expect.objectContaining({ disclosurePhase: "entering", height: 0 }));
  });

  it("gleicht die Unterzeilenmenge einer laufenden Paketbewegung sofort mit dem aktuellen Modell ab", () => {
    const entering = activateDownloadDisclosureTransition(prepareDownloadDisclosureTransition(stableDownloadDisclosureRows(logicalRows([packageA.id])), logicalRows([])).rows);
    const current = logicalRows([]);
    const replacement = item("a-3", packageA.id, "queued");
    const updated = current.flatMap((row) => {
      if (row.type === "item" && row.id === "a-2") {
        return [{ ...row, id: replacement.id, item: replacement }];
      }
      return [row];
    });
    const merged = mergeDownloadDisclosureRows(entering, updated);
    const group = merged.find((row) => row.type === "item-group");

    expect(group?.type === "item-group" ? group.items.map((row) => row.id) : []).toEqual(["a-1", "a-3"]);
    expect(group).toEqual(expect.objectContaining({ height: 76 }));
  });

  it("bricht eine laufende Gruppenbewegung ab wenn ein Filterwechsel die Virtualisierungsgrenze überschreitet", () => {
    const entering = activateDownloadDisclosureTransition(prepareDownloadDisclosureTransition(stableDownloadDisclosureRows(logicalRows([packageA.id])), logicalRows([])).rows);
    const itemIds = Array.from({ length: DOWNLOAD_DISCLOSURE_MAX_ANIMATED_ITEMS + 100 }, (_, index) => `expanded-${index}`);
    const expandedPackage = pkg(packageA.id, packageA.name, itemIds);
    const expandedItems = Object.fromEntries(itemIds.map((id) => [id, item(id, packageA.id, "queued")]));
    const expandedRows = buildDownloadLogicalRows(buildDownloadsViewModel({
      packageOrder: [expandedPackage.id],
      packages: { [expandedPackage.id]: expandedPackage },
      items: expandedItems,
      displayMode: "packages",
      filter: "all",
      providerFilter: "all",
      query: "",
      collapsedPackageIds: [],
      selectedIds: [],
      hideExtractedItems: false,
      showAllPackages: true,
      renderLimit: itemIds.length + 1
    }));
    const merged = mergeDownloadDisclosureRows(entering, expandedRows);
    const window = calculateDownloadVirtualWindow(merged, { scrollTop: 0, viewportHeight: 720, overscan: 8 });

    expect(merged.some((row) => row.type === "item-group")).toBe(false);
    expect(window.rows.length).toBeLessThan(40);
  });
});

describe("laufender Queue-Linkzähler", () => {
  it("sinkt sofort, sobald eine Unterdatei abgeschlossen ist", () => {
    const items = [
      item("queued", "package-a", "queued"),
      item("active", "package-a", "downloading"),
      item("done", "package-a", "completed"),
      item("failed", "package-a", "failed")
    ];

    expect(getPendingDownloadItemCount(items)).toBe(2);
  });

  it("formatiert große Sidebar-Zähler mit deutschen Tausenderpunkten", () => {
    const model = withRuntime(createInput(), {
      status: { ...withRuntime(createInput()).status, packages: 130, links: 2484 }
    });
    const html = renderToStaticMarkup(<DownloadsSidebarStatus model={model} />);

    expect(html).toContain(">2.484<");
  });
});

describe("responsive Downloadstatus und Servicebezeichnungen", () => {
  it("keeps full status details while providing compact table text", () => {
    expect(compactDownloadStatus("Link wird umgewandelt")).toBe("Umwandeln");
    expect(compactDownloadStatus("Download läuft (Mega-Debrid API)")).toBe("Download läuft");
    expect(compactDownloadStatus("Download running (Mega-Debrid API)")).toBe("Download running");
    expect(compactDownloadStatus("Entpacken 1% (1/1) · Tonspur: Deutsch")).toBe("Entpacken - 1%");
    expect(compactDownloadStatus("0/11 · Entpacken 53% (1/1) · scn2-httpv7-S01E102.rar")).toBe("Entpacken - 53%");
    expect(compactDownloadStatus("Extracting 53% (1/1) · archive.rar")).toBe("Extracting - 53%");
    expect(compactDownloadStatus("Passwort knacken: 75% (3/4) · sau-geheim.part1.rar")).toBe("Passwort knacken: 75% (3/4)");
    expect(compactDownloadStatus("Passwort gefunden · archive.part1.rar")).toBe("Passwort gefunden");
    expect(compactDownloadStatus("Entpacken - Ausstehend · archive.part1.rar")).toBe("Entpacken - Ausstehend");
    expect(compactDownloadStatus("Entpack-Fehler [archive.part1.rar]: Unerwartetes Dateiende")).toBe("Entpack-Fehler");
    expect(compactDownloadStatus("Extraction error [archive.part1.rar]: Unexpected end of file")).toBe("Extraction error");
  });

  it("normalizes every supported RapidGator domain to one hoster identity", () => {
    const hosters = [
      extractHoster("https://rapidgator.net/file/one"),
      extractHoster("https://rg.to/file/two"),
      extractHoster("https://cdn.rg.to/file/three"),
      extractHoster("https://rapidgator.asia/file/four")
    ];

    expect(hosters).toEqual(["rapidgator", "rapidgator", "rapidgator", "rapidgator"]);
    expect(new Set(hosters).size).toBe(1);
    expect(formatHosterLabel(hosters[1])).toEqual(expect.objectContaining({ compact: "RG", title: "RapidGator", iconSrc: expect.any(String) }));
  });

  it("normalizes every supported 1Fichier domain to one hoster identity", () => {
    const hosters = [
      extractHoster("https://1fichier.com/?abc12345"),
      extractHoster("https://desfichiers.net/?def67890"),
      extractHoster("https://piecejointe.net/?ghi12345"),
      extractHoster("https://dl4free.com/?jkl67890")
    ];

    expect(hosters).toEqual(["1fichier", "1fichier", "1fichier", "1fichier"]);
    expect(new Set(hosters).size).toBe(1);
    expect(formatHosterLabel(hosters[1])).toEqual({ compact: "1Fichier", title: "1Fichier", iconSrc: "./provider-icons/onefichier.png" });
  });

  it("removes duplicated access-mode wording from service labels", () => {
    expect(normalizeDownloadServiceLabel("Mega-Debrid Web (Web Account)")).toBe("Mega-Debrid (Web)");
    expect(normalizeDownloadServiceLabel("Mega-Debrid API (API Account)")).toBe("Mega-Debrid (API)");
    expect(normalizeDownloadServiceLabel("Mega-Debrid API (API Access)")).toBe("Mega-Debrid (API)");
    expect(normalizeDownloadServiceLabel("Real-Debrid (Web Account)")).toBe("Real-Debrid (Web Account)");
    expect(normalizeDownloadServiceLabel("Mega-Debrid Web (Web Account), Mega-Debrid API (API Account)")).toBe("Mega-Debrid (Web), Mega-Debrid (API)");
    expect(compactDownloadServiceLabel("Mega-Debrid Web (Web Account), Mega-Debrid API (API Account)")).toBe("Mega-Debrid (Web), Mega-Debrid (API)");
  });
});

function createInput(overrides: Partial<DownloadsModelInput> = {}): DownloadsModelInput {
  const items = [
    item("active", "package-a", "downloading"),
    item("queued", "package-a", "queued", { provider: "debridlink", providerLabel: "Debrid-Link", url: "https://ddownload.com/file/queued" }),
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

function createLargeInput(packageCount: number, itemCount: number, overrides: Partial<DownloadsModelInput> = {}): DownloadsModelInput {
  const packageEntries = Array.from({ length: packageCount }, (_, packageIndex) => {
    const ids = Array.from({ length: itemCount }, (_, itemIndex) => `i-${packageIndex}-${itemIndex}`);
    return pkg(`p-${packageIndex}`, `Paket ${packageIndex}`, ids);
  });
  const itemEntries = packageEntries.flatMap((entry, packageIndex) => (
    entry.itemIds.map((id, itemIndex) => item(id, entry.id, packageIndex === packageCount - 1 && itemIndex === 0 ? "downloading" : "queued"))
  ));
  return {
    ...createInput(overrides),
    packageOrder: packageEntries.map((entry) => entry.id),
    packages: Object.fromEntries(packageEntries.map((entry) => [entry.id, entry])),
    items: Object.fromEntries(itemEntries.map((entry) => [entry.id, entry])),
    ...overrides
  };
}

function createActions(overrides: Partial<DownloadsViewActions> = {}): DownloadsViewActions {
  return {
    onResetColumnLayout: () => {},
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
    onSetVisibleSelection: () => {},
    onToggleSelection: () => {},
    onSelectionMouseDown: () => {},
    onSelectionMouseEnter: () => {},
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
    onColumnPointerDown: () => {},
    onColumnPointerMove: () => {},
    onColumnPointerUp: () => {},
    onColumnPointerCancel: () => {},
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
    disclosureRevision: 0,
    animationsEnabled: true,
    editingPackageId: null,
    editingName: "",
    columnOrder: ["name", "size", "hoster", "progress"] as const,
    gridTemplate: "minmax(280px, 2fr) 140px 160px minmax(220px, 1fr)",
    status: {
      packages: 2,
      links: 4,
      session: "3,00 GB",
      sessionBytes: 3_000_000_000,
      total: "10,00 GB",
      totalBytes: 10_000_000_000,
      remaining: "6,50 GB",
      remainingBytes: 6_500_000_000,
      remainingTooltip: "",
      hosters: 3,
      speed: "96,00 Mbit/s",
      eta: "00:05:00"
    },
    ...overrides
  };
}

describe("downloads model", () => {
  it("uses the package telemetry as the single live speed source", () => {
    expect(getDownloadSpeedBps({ a: 45_000_000, b: 30_400_000, idle: 0 })).toBe(75_400_000);
    expect(getDownloadSpeedBps({ stale: -1, invalid: Number.NaN })).toBe(0);
  });

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

  it("keeps occupied package rows logical while preserving active packages and an actionable visible selection", () => {
    const packageEntries = Array.from({ length: 264 }, (_, index) => pkg(`p-${index}`, `Paket ${index}`, [`i-${index}`]));
    const itemEntries = packageEntries.map((entry, index) => item(`i-${index}`, entry.id, index === 263 ? "downloading" : "queued"));
    const model = buildDownloadsViewModel(createInput({
      packageOrder: packageEntries.map((entry) => entry.id),
      packages: Object.fromEntries(packageEntries.map((entry) => [entry.id, entry])),
      items: Object.fromEntries(itemEntries.map((entry) => [entry.id, entry])),
      selectedIds: ["p-0", "i-0", "p-263", "i-263", "missing"],
      renderLimit: 260
    }));

    expect(model.packageRows).toHaveLength(264);
    expect(model.packageRows.some((row) => row.package.id === "p-263")).toBe(true);
    expect(model.paginationLabel).toBe("1–264 von 264");
    expect(model.actionableSelectedIds).toEqual(["p-0", "i-0", "p-263", "i-263"]);
  });

  it("keeps every filtered expanded row logical while the DOM window stays bounded", () => {
    const model = buildDownloadsViewModel(createLargeInput(320, 2, {
      selectedIds: ["p-0", "i-0-0", "p-319", "i-319-0"],
      renderLimit: 20
    }));
    const logicalRows = buildDownloadLogicalRows(model);
    const html = renderToStaticMarkup(<DownloadsView actions={createActions()} model={withRuntime(createLargeInput(320, 2, { renderLimit: 20 }))} />);
    const renderedRows = html.match(/data-download-row-id=/g) ?? [];

    expect(model.packageRows).toHaveLength(320);
    expect(model.visibleRowIds).toHaveLength(960);
    expect(model.visibleRowIds.slice(0, 3)).toEqual(["p-0", "i-0-0", "i-0-1"]);
    expect(model.visibleRowIds.slice(-3)).toEqual(["p-319", "i-319-0", "i-319-1"]);
    expect(model.actionableSelectedIds).toEqual(["p-0", "i-0-0", "p-319", "i-319-0"]);
    expect(logicalRows).toHaveLength(960);
    expect(renderedRows.length).toBeGreaterThan(0);
    expect(renderedRows.length).toBeLessThan(80);
  });

  it("uses fixed download row geometry, overscan and pinned rows for the virtual window", () => {
    const rows = [
      { id: "p-0", height: DOWNLOAD_PACKAGE_ROW_HEIGHT },
      { id: "i-0", height: DOWNLOAD_FILE_ROW_HEIGHT },
      { id: "p-1", height: DOWNLOAD_PACKAGE_ROW_HEIGHT },
      { id: "i-1", height: DOWNLOAD_FILE_ROW_HEIGHT },
      { id: "p-2", height: DOWNLOAD_PACKAGE_ROW_HEIGHT },
      { id: "i-2", height: DOWNLOAD_FILE_ROW_HEIGHT }
    ];

    const window = calculateDownloadVirtualWindow(rows, {
      scrollTop: 79,
      viewportHeight: 40,
      overscan: 1,
      pinnedIds: ["p-0", "i-2"]
    });

    expect(DOWNLOAD_PACKAGE_ROW_HEIGHT).toBe(40);
    expect(DOWNLOAD_FILE_ROW_HEIGHT).toBe(38);
    expect(window.totalHeight).toBe(234);
    expect(window.rows.map((row) => [row.id, row.index, row.top, row.height, row.pinned])).toEqual([
      ["p-0", 0, 0, 40, true],
      ["i-0", 1, 40, 38, false],
      ["p-1", 2, 78, 40, false],
      ["i-1", 3, 118, 38, false],
      ["p-2", 4, 156, 40, false],
      ["i-2", 5, 196, 38, true]
    ]);
  });
});

describe("downloads view", () => {
  it("pins the clipboard toggle separately at the bottom above the status metrics", () => {
    const html = renderToStaticMarkup(<DownloadsSidebar actions={createActions()} model={withRuntime(createInput())} />);
    const actionsMarkup = html.match(/<div class="downloads-sidebar-actions">([\s\S]*?)<\/div>/)?.[1] ?? "";
    const css = fs.readFileSync(path.join(process.cwd(), "src/renderer/views/downloads/downloads.css"), "utf8");

    expect(html).toContain('class="downloads-clipboard-toggle"');
    expect(actionsMarkup).not.toContain("Zwischenablage überwachen");
    expect(css).toMatch(/\.downloads-sidebar\s*\{[^}]*height:\s*100%;[^}]*padding:\s*14px 12px 6px;/s);
    expect(css).toMatch(/\.downloads-clipboard-toggle\s*\{[^}]*margin-top:\s*auto;[^}]*border:\s*1px solid var\(--ui-border\);[^}]*background:\s*var\(--ui-input\);/s);
  });

  it("shows the sidebar actions as permanently recognizable buttons", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src/renderer/views/downloads/downloads.css"), "utf8");

    expect(css).toMatch(/\.downloads-sidebar-actions button\s*\{[^}]*border:\s*1px solid var\(--ui-border\);[^}]*background:\s*var\(--ui-input\);[^}]*padding:\s*0 10px;/s);
  });

  it("marks the download filters for one measured vertical selection indicator", () => {
    const html = renderToStaticMarkup(<DownloadsSidebar actions={createActions()} model={withRuntime(createInput())} />);

    expect(html).toContain("ui-sliding-selection ui-sliding-selection-vertical");
    expect(html.match(/data-sliding-selection-item="true"/g)).toHaveLength(6);
    expect(html.match(/data-sliding-selection-active="true"/g)).toHaveLength(1);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it("disables the service filter until more than one concrete service is available", () => {
    const none = renderToStaticMarkup(<DownloadsSidebar actions={createActions()} model={withRuntime(createInput(), { providerOptions: [] })} />);
    const one = renderToStaticMarkup(<DownloadsSidebar actions={createActions()} model={withRuntime(createInput(), { providerOptions: [{ id: "rapidgator", label: "RapidGator" }] })} />);
    const multiple = renderToStaticMarkup(<DownloadsSidebar actions={createActions()} model={withRuntime(createInput(), { providerOptions: [{ id: "rapidgator", label: "RapidGator" }, { id: "ddownload", label: "DDownload" }] })} />);

    expect(none).toMatch(/<select[^>]*aria-label="Service filtern"[^>]*disabled=""/);
    expect(one).toMatch(/<select[^>]*aria-label="Service filtern"[^>]*disabled=""/);
    expect(multiple).not.toMatch(/<select[^>]*aria-label="Service filtern"[^>]*disabled=""/);
  });

  it("shows only the package mode while the file mode remains hidden", () => {
    const html = renderToStaticMarkup(<DownloadsSidebar actions={createActions()} model={withRuntime(createInput())} />);
    const css = fs.readFileSync(path.join(process.cwd(), "src/renderer/views/downloads/downloads.css"), "utf8");

    expect(html).toContain("Pakete");
    expect(html).not.toContain(">Dateien<");
    expect(html).not.toContain("downloads-mode-switch");
    expect(css).toMatch(/\.downloads-mode-title\s*\{[^}]*justify-content:\s*center;[^}]*color:\s*#0a0f1a;[^}]*background:\s*#90cdf4;[^}]*text-align:\s*center;/s);
  });

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

  it("blocks native package dragging while preserving explicit reorder actions", () => {
    const model = withRuntime(createInput());
    const component = PackageCardContent({
      actions: createActions(),
      columnOrder: model.columnOrder,
      editing: false,
      editingName: "",
      gridTemplate: model.gridTemplate,
      packageSpeedBps: 0,
      row: model.packageRows[0],
      selectedIds: new Set<string>(),
      selectedVersion: 0
    });
    const preventDefault = vi.fn();

    expect(component.props.draggable).toBeUndefined();
    component.props.onDragStart({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("starts with the local Start action and dispatches toolbar actions separately", () => {
    const calls: string[] = [];
    const actions = createActions({
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

    for (const label of ["Start", "Pause", "Stop", "Planen", "Nach oben", "Nach unten", "Umbenennen", "Entfernen"]) {
      findButton(toolbar, label).props.onClick();
    }

    const html = renderToStaticMarkup(toolbar);
    expect(html).not.toContain("Links hinzufügen");
    expect(html.indexOf(">Start<")).toBeLessThan(html.indexOf(">Pause<"));
    expect(calls).toEqual(["start", "pause", "stop", "schedule", "up", "down", "rename", "remove"]);
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

  it("blocks resume without a usable account and keeps pause independent from unrelated action busy state", () => {
    const pausedToolbar = DownloadsToolbar({
      actions: createActions(),
      model: withRuntime(createInput(), { paused: true, canStart: false, canPause: true })
    });
    const busyToolbar = DownloadsToolbar({
      actions: createActions(),
      model: withRuntime(createInput(), { paused: false, canPause: true, actionBusy: true })
    });

    expect(findButton(pausedToolbar, "Start").props.disabled).toBe(true);
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
    expect(html).toContain('class="downloads-package-card ');
    expect(html).not.toContain('class="package-card');
    expect(html).toContain('class="downloads-hoster-icon" data-hoster="rapidgator" src="data:image/x-icon;base64,');
    expect(html).toContain('class="downloads-hoster-icon" data-hoster="ddownload" src="./provider-icons/ddownload.ico"');
    expect(html).not.toContain('title="RapidGator">RG<');
    expect(html).toContain('data-download-column="name"');
    expect(html).toContain('data-download-column="hoster"');
    expect(html).toMatch(/grid-template-columns:[^"]+ 60px/);
    expect(html).toContain('class="downloads-virtual-spacer"');
    expect(css).toMatch(/\.downloads-table\s*\{[^}]*overflow-x:\s*auto;[^}]*scrollbar-gutter:\s*stable;/s);
    expect(css).not.toMatch(/\.downloads-table-body\s*\{[^}]*overflow(?:-y)?:\s*auto;/s);
    expect(css).toMatch(/\.downloads-table-header,\s*\.downloads-table-body\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*var\(--downloads-table-min-width, 1191px\);/s);
    expect(css).not.toMatch(/min-width:\s*max-content;/);
    expect(css).toMatch(/\.downloads-table-header\s*\{[^}]*height:\s*41px;[^}]*position:\s*sticky;/s);
    expect(css).toMatch(/--downloads-package-row-height:\s*40px;/s);
    expect(css).toMatch(/--downloads-file-row-height:\s*38px;/s);
    expect(css).toMatch(/\.downloads-item-row,\s*\.downloads-package-row\s*\{[^}]*height:\s*var\(--downloads-package-row-height\);/s);
    expect(css).toMatch(/\.downloads-item-row\s*\{[^}]*height:\s*var\(--downloads-file-row-height\);/s);
    expect(css).toMatch(/\.downloads-virtual-spacer\s*\{[^}]*position:\s*relative;[^}]*height:\s*var\(--downloads-virtual-total-height\);/s);
    expect(css).toMatch(/\.downloads-virtual-row\s*\{[^}]*position:\s*absolute;[^}]*transform:\s*translateY\(var\(--downloads-virtual-row-top\)\);/s);
    expect(css).toMatch(/\.downloads-toolbar button,\s*\.downloads-footer button,[^{]+\{[^}]*height:\s*36px;/s);
    expect(css).toMatch(/\.downloads-content\s*\{[^}]*height:\s*100%;/s);
    expect(css).toMatch(/\.downloads-collapse-button\s*\{[^}]*box-sizing:\s*border-box;[^}]*flex:\s*0 0 30px;[^}]*width:\s*30px;[^}]*min-width:\s*30px;[^}]*max-width:\s*30px;/s);
    expect(css).toMatch(/\.downloads-cell-slot\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*center;/s);
    expect(css).toMatch(/\.downloads-cell-slot\s*>\s*\.downloads-cell\s*\{[^}]*justify-content:\s*center;[^}]*text-align:\s*center;/s);
    expect(css).toMatch(/\.downloads-column-header\s*\{[^}]*justify-content:\s*center;[^}]*text-align:\s*center;/s);
    expect(css).toMatch(/\[data-download-column="name"\][^{]*\{[^}]*justify-content:\s*flex-start;[^}]*text-align:\s*left;/s);
    expect(css).toMatch(/\.downloads-meter-label\.is-track\s*\{[^}]*color:\s*var\(--ui-progress-track-text/s);
    expect(css).toMatch(/\.downloads-meter-label\s*\{[^}]*font-weight:\s*700;/s);
    expect(css).toMatch(/\.downloads-meter-label\.is-track\s*\{[^}]*clip-path:\s*inset\(0 0 0 var\(--downloads-progress\)\);/s);
    expect(css).toMatch(/\.downloads-meter-label\.is-filled\s*\{[^}]*color:\s*var\(--ui-progress-fill-text/s);
    expect(css).toMatch(/\.downloads-link-state\.online\s*\{[^}]*background:\s*var\(--ui-success\);/s);
    expect(css).toMatch(/\.downloads-status-cell\s*\{[^}]*container-type:\s*inline-size;/s);
    expect(css).toMatch(/\.downloads-service-cell\s*\{[^}]*container-type:\s*inline-size;/s);
    expect(css).toMatch(/\.downloads-cell-slot\s*>\s*:is\(\.downloads-status-cell, \.downloads-service-cell\)\s*\{[^}]*justify-content:\s*center;[^}]*text-align:\s*center;/s);
    expect(css).toMatch(/:is\(\.downloads-status-full, \.downloads-status-compact, \.downloads-service-full, \.downloads-service-compact\)\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
    expect(css).toMatch(/@container\s*\(max-width:\s*150px\)[\s\S]*\.downloads-status-full[^{]*\{[^}]*display:\s*none;[\s\S]*\.downloads-status-compact[^{]*\{[^}]*display:\s*block;/s);
    expect(css).toMatch(/@container\s*\(max-width:\s*150px\)[\s\S]*\.downloads-service-full[^{]*\{[^}]*display:\s*none;[\s\S]*\.downloads-service-compact[^{]*\{[^}]*display:\s*block;/s);
    expect(css).toMatch(/\.downloads-virtual-spacer\s*\{[^}]*transition:\s*height 1500ms cubic-bezier\(0\.22, 1, 0\.36, 1\);/s);
    expect(css).toMatch(/\.downloads-virtual-row\s*\{[^}]*transition:\s*height 1500ms[^;]*transform 1500ms[^;]*opacity 1500ms/s);
    expect(css).toMatch(/\.downloads-footer\s*\{[^}]*height:\s*60px;[^}]*padding:\s*0 12px 0 60px;/s);
    expect(css).toMatch(/\.downloads-package-card\s*\{[^}]*border:\s*0;[^}]*border-bottom:\s*1px solid color-mix\(in srgb, var\(--ui-border\) 72%, transparent\);[^}]*padding:\s*0;/s);
    expect(css).toMatch(/\.downloads-package-card\s*\{[^}]*box-shadow:\s*none;/s);
    expect(css).not.toMatch(/gradient|nth-child/i);
  });

  it("keeps visible interaction text non-selectable and only inputs plus copy values selectable", () => {
    const css = readFileSync(new URL("../src/renderer/views/downloads/downloads.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.downloads-sidebar,\s*\.downloads-sidebar-status,\s*\.downloads-toolbar,\s*\.downloads-content,\s*\.downloads-footer\s*\{[^}]*user-select:\s*none;/s);
    expect(css).toMatch(/\.downloads-copyable,\s*\.downloads-search-input,\s*\.downloads-rename-input\s*\{[^}]*user-select:\s*text;/s);
    expect(css).toMatch(/\.downloads-name-cell\s+\.downloads-rename-input\s*\{[^}]*flex:\s*1 1 auto;[^}]*width:\s*100%;[^}]*min-width:\s*0;/s);
  });

  it("marks selected rows clearly, enlarges selection checkboxes and slows package disclosure", () => {
    const css = readFileSync(new URL("../src/renderer/views/downloads/downloads.css", import.meta.url), "utf8");
    const source = readFileSync(new URL("../src/renderer/views/downloads/DownloadsTable.tsx", import.meta.url), "utf8");

    expect(css).toMatch(/\.downloads-item-row,\s*\.downloads-package-row\s*\{[^}]*border-left:\s*3px solid transparent;/s);
    expect(css).toMatch(/\.downloads-item-row\.is-selected,\s*\.downloads-package-card\.is-selected\s*>\s*\.downloads-package-row\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--ui-success\) 14%, var\(--ui-canvas\)\);[^}]*border-left-color:\s*var\(--ui-success\);/s);
    expect(css).toMatch(/\.downloads-item-row\.is-selected::before\s*\{[^}]*content:\s*"";[^}]*position:\s*absolute;[^}]*inset:\s*-1px auto -1px -3px;[^}]*width:\s*3px;[^}]*background:\s*var\(--ui-success\);/s);
    expect(css).toMatch(/\.downloads-package-card\.is-selected::before\s*\{[^}]*content:\s*"";[^}]*position:\s*absolute;[^}]*inset:\s*0 auto auto 0;[^}]*width:\s*3px;[^}]*height:\s*41px;[^}]*background:\s*var\(--ui-success\);/s);
    expect(css).toMatch(/\.downloads-package-card:has\(\.downloads-package-items-inner\s*>\s*\.downloads-item-row:last-child\.is-selected\)::after\s*\{[^}]*content:\s*"";[^}]*position:\s*absolute;[^}]*inset:\s*auto auto -1px 0;[^}]*width:\s*3px;[^}]*height:\s*1px;[^}]*background:\s*var\(--ui-success\);/s);
    expect(css).toMatch(/\.downloads-selection-cell\s+input\[type="checkbox"\]\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;/s);
    expect(css).toMatch(/\.downloads-hoster-icon\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;[^}]*object-fit:\s*contain;/s);
    expect(css).toMatch(/\.downloads-hoster-icon\[data-hoster="rapidgator"\]\s*\{[^}]*transform:\s*translateY\(-4px\) scale\(2\);/s);
    expect(source).not.toContain("PackageItemsTransition");
  });

  it("keeps the action column visible at 1366px and 1120px through the production wrapper contract", () => {
    const html = renderToStaticMarkup(<DownloadsContent actions={createActions()} model={withRuntime(createInput())} />);
    const css = readFileSync(new URL("../src/renderer/views/downloads/downloads.css", import.meta.url), "utf8");

    expect(html).toMatch(/^<main class="downloads-content">/);
    expect(css).toMatch(/\.md-shell\.is-compact \.downloads-content,\s*\.md-shell\.is-minimum \.downloads-content\s*\{[^}]*--downloads-table-min-width:\s*1016px;[^}]*--downloads-name-min:\s*180px;[^}]*--downloads-status-min:\s*90px;/s);
    expect(css).not.toMatch(/\.md-shell\.is-(?:compact|minimum) \.downloads-view/);
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
  it("keeps the priority menu open when the selected priority is already active", () => {
    const source = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8").replaceAll("\r\n", "\n");

    expect(source).toMatch(/disabled=\{allMatch\}[\s\S]{0,260}window\.rd\.setPackagePriority/);
  });

  it("keeps previously visible package rows mounted while priority order glides", () => {
    const source = readFileSync(new URL("../src/renderer/views/downloads/VirtualizedDownloadsBody.tsx", import.meta.url), "utf8").replaceAll("\r\n", "\n");

    expect(source).toContain("getDownloadOrderTransitionPinnedIds");
    expect(source).toContain("animateDownloadOrderRows");
    expect(source).toContain("orderTransitionPinnedIdsRef.current");
    expect(source).toContain("data-download-row-id={entry.id}");
    expect(source).toContain("DOWNLOAD_ORDER_TRANSITION_DURATION_MS");
  });

  it("updates the clipboard checkbox optimistically before IPC reconciliation", () => {
    const source = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8").replaceAll("\r\n", "\n");

    expect(source).toMatch(/const toggleClipboardWatcher = useCallback\(\(\): void => \{[\s\S]*setClipboardWatcherActive\(next\);[\s\S]*window\.rd\.toggleClipboard\(\)/);
    expect(source).toContain("onToggleClipboardWatcher: toggleClipboardWatcher");
    expect(source).not.toContain("onToggleClipboardWatcher: () => { void performQuickAction(() => window.rd.toggleClipboard()); }");
  });

  it("uses the extracted table only, cleans temporary drag listeners and routes the global context start through the shared callback", () => {
    const source = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8").replaceAll("\r\n", "\n");

    expect(source).not.toMatch(/^const ItemRow\b|^const PackageCard\b|^interface ItemRowProps\b|^interface PackageCardProps\b/m);
    expect(source).toContain('window.removeEventListener("mouseup", dragMouseUpRef.current)');
    expect(source).toContain("downloadsActions.onStartDownloads(); setContextMenu(null);");
    expect(source).not.toContain(") : false ? (");
    expect(source).not.toContain("{false && (");
  });

  it("pins the inline rename row outside the initial viewport without rendering the whole queue", () => {
    const model = withRuntime(createLargeInput(340, 1), {
      editingPackageId: "p-339",
      editingName: "Pinned Rename"
    });
    const html = renderToStaticMarkup(<DownloadsContent actions={createActions()} model={model} />);
    const renderedRows = html.match(/data-download-row-id=/g) ?? [];

    expect(html).toContain('data-download-row-id="p-339"');
    expect(html).toContain('class="downloads-rename-input"');
    expect(renderedRows.length).toBeGreaterThan(0);
    expect(renderedRows.length).toBeLessThan(80);
  });
});

describe("download table row contracts", () => {
  it("summarizes full, partial, offline and unchecked package availability", () => {
    expect(getAvailabilitySummary([
      item("online-a", "package-a", "queued", { onlineStatus: "online" }),
      item("online-b", "package-a", "queued", { onlineStatus: "online" })
    ])).toEqual({ online: 2, total: 2, state: "online" });
    expect(getAvailabilitySummary([
      item("partial-a", "package-a", "queued", { onlineStatus: "online" }),
      item("partial-b", "package-a", "queued", { onlineStatus: "offline" })
    ])).toEqual({ online: 1, total: 2, state: "partial" });
    expect(getAvailabilitySummary([
      item("offline-a", "package-a", "queued", { onlineStatus: "offline" }),
      item("offline-b", "package-a", "queued", { onlineStatus: "offline" })
    ])).toEqual({ online: 0, total: 2, state: "offline" });
    expect(getAvailabilitySummary([
      item("unknown-a", "package-a", "queued", { onlineStatus: undefined })
    ])).toEqual({ online: 0, total: 1, state: "checking" });
  });

  it("shows reset package availability as one compact unchecked label", () => {
    const resetItems = [
      item("reset-a", "package-a", "queued", { onlineStatus: undefined }),
      item("reset-b", "package-a", "queued", { onlineStatus: undefined }),
      item("reset-c", "package-a", "queued", { onlineStatus: undefined })
    ];
    const html = renderToStaticMarkup(PackageCardContent({
      actions: createActions(),
      columnOrder: ["availability"],
      editing: false,
      editingName: "",
      gridTemplate: "150px",
      packageSpeedBps: 0,
      row: { package: pkg("package-a", "Reset", resetItems.map((entry) => entry.id)), items: resetItems, allItems: resetItems, collapsed: true },
      selectedIds: new Set<string>(),
      selectedVersion: 0
    }));

    expect(html).toContain(">Ungeprüft</span>");
    expect(html).not.toContain(">0</span>");
    expect(html).not.toContain(">3</span>");
    expect(html).not.toContain(">online</span>");
  });

  it("renders availability for package and file rows", () => {
    const onlineItem = item("online-file", "package-a", "queued", { onlineStatus: "online" });
    const packageHtml = renderToStaticMarkup(PackageCardContent({
      actions: createActions(),
      columnOrder: ["availability"],
      editing: false,
      editingName: "",
      gridTemplate: "110px",
      packageSpeedBps: 0,
      row: { package: pkg("package-a", "Paket", [onlineItem.id]), items: [onlineItem], allItems: [onlineItem], collapsed: true },
      selectedIds: new Set<string>(),
      selectedVersion: 0
    }));
    const itemHtml = renderToStaticMarkup(ItemRowContent({
      actions: createActions(),
      columnOrder: ["availability"],
      gridTemplate: "110px",
      item: onlineItem,
      selected: false
    }));

    expect(packageHtml).toContain("1/1 online");
    expect(packageHtml).toContain("downloads-availability has-counts is-online");
    expect(packageHtml).toContain("downloads-availability-count is-online-count");
    expect(packageHtml).toContain("downloads-availability-separator");
    expect(packageHtml).toContain("downloads-availability-count is-total-count");
    expect(packageHtml).toContain("downloads-availability-label");
    expect(itemHtml).toContain("Online");
    expect(itemHtml).toContain("downloads-availability is-online");
  });

  it("aligns availability symbols, split counts and labels on fixed axes", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src/renderer/views/downloads/downloads.css"), "utf8");

    expect(css).toMatch(/\.downloads-availability\.has-counts\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*16px 4ch 1ch 3ch auto;[^}]*font-variant-numeric:\s*tabular-nums;/s);
    expect(css).toMatch(/\.downloads-availability-count\.is-online-count\s*\{[^}]*text-align:\s*right;/s);
    expect(css).toMatch(/\.downloads-availability-count\.is-total-count\s*\{[^}]*text-align:\s*left;/s);
    expect(css).toMatch(/\.downloads-availability-label\s*\{[^}]*padding-left:\s*3px;/s);
    expect(css).toMatch(/\.downloads-availability\.is-online\s*\{[^}]*color:\s*var\(--ui-success-text\);/s);
    expect(css).toMatch(/\.downloads-availability\.is-partial\s*\{[^}]*color:\s*var\(--ui-warning-text\);/s);
    expect(css).toMatch(/\.downloads-availability\.is-offline\s*\{[^}]*color:\s*var\(--ui-danger-text\);/s);
  });

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
      row: { package: extractionPackage, items: [extractionItem], allItems: [extractionItem], collapsed: true },
      selectedIds: new Set<string>(),
      selectedVersion: 0
    }));

    expect(html).toContain(">70%</b>");
  });

  it("never exposes archive filenames as the visible package status", () => {
    const extractionItem = item("archive-item", "archive-package", "completed", { fullStatus: "Entpacken - Ausstehend" });
    const extractionPackage = {
      ...pkg("archive-package", "Archiv", [extractionItem.id]),
      status: "extracting",
      postProcessLabel: "release.part1.rar"
    } as PackageEntry;
    const html = renderToStaticMarkup(PackageCardContent({
      actions: createActions(),
      columnOrder: ["status"],
      editing: false,
      editingName: "",
      gridTemplate: "220px",
      packageSpeedBps: 0,
      row: { package: extractionPackage, items: [extractionItem], allItems: [extractionItem], collapsed: true },
      selectedIds: new Set<string>(),
      selectedVersion: 0
    }));

    expect(html).toContain(">Entpacken - Ausstehend</span>");
    expect(html).not.toContain(">release.part1.rar</span>");
  });

  it.each([
    ["package", "Finalisieren (1/2) · release.part1.rar", "Finalisieren - 50%"],
    ["package", "Finalizing - 50% * release.part1.rar", "Finalizing - 50%"],
    ["item", "Finalizing (3/4) · release.part1.rar", "Finalizing - 75%"],
    ["item", "Finalisieren - 50% * release.part1.rar", "Finalisieren - 50%"]
  ])("shows %s finalization status without archive details", (target, rawStatus, expectedStatus) => {
    const html = target === "package"
      ? renderToStaticMarkup(PackageCardContent({
        actions: createActions(),
        columnOrder: ["status"],
        editing: false,
        editingName: "",
        gridTemplate: "220px",
        packageSpeedBps: 0,
        row: {
          package: { ...pkg("finalization-package", "Finalization", ["finalization-item"]), postProcessLabel: rawStatus, status: "extracting" } as PackageEntry,
          items: [item("finalization-item", "finalization-package", "completed")],
          allItems: [item("finalization-item", "finalization-package", "completed")],
          collapsed: true
        },
        selectedIds: new Set<string>(),
        selectedVersion: 0
      }))
      : renderToStaticMarkup(ItemRowContent({
        actions: createActions(),
        columnOrder: ["status"],
        gridTemplate: "220px",
        item: item("finalization-item", "finalization-package", "completed", { fullStatus: rawStatus }),
        selected: false
      }));

    expect(html).toContain(`aria-label="${expectedStatus}"`);
    expect(html.match(new RegExp(`>${expectedStatus}</span>`, "g"))).toHaveLength(2);
    expect(html).not.toContain(">release.part1.rar</span>");
    if (target === "item") expect(html).not.toMatch(/title="[^"]*release\.part1\.rar/);
  });

  it.each([
    ["Finalisieren (3/2) · release.part1.rar", "Finalisieren - 100%"],
    ["Finalizing (-1/2) · release.part1.rar", "Finalizing - 0%"],
    ["Finalisieren (/2) · release.part1.rar", "Finalisieren"],
    ["Finalizing (1/) · release.part1.rar", "Finalizing"],
    ["Finalisieren (1/2/3) · release.part1.rar", "Finalisieren"],
    ["Finalizing (not-a-number/2) · release.part1.rar", "Finalizing"],
    ["Finalisieren (Infinity/2) · release.part1.rar", "Finalisieren"],
    ["Finalizing (NaN/2) · release.part1.rar", "Finalizing"],
    ["Finalisieren (1/0) · release.part1.rar", "Finalisieren"],
    ["Finalizing (invalid/2) · release.part1.rar", "Finalizing"]
  ])("derives only finite finalization percentages", (rawStatus, expectedStatus) => {
    expect(compactDownloadStatus(rawStatus)).toBe(expectedStatus);
  });

  it("renders meter text in clipped track and fill layers", () => {
    const html = renderToStaticMarkup(ItemRowContent({
      actions: createActions(),
      columnOrder: ["size", "progress"],
      gridTemplate: "180px 120px",
      item: item("meter", "package-a", "downloading", { downloadedBytes: 750, totalBytes: 1_000, progressPercent: 75 }),
      selected: false
    }));

    expect(html.match(/class="downloads-meter-label is-track"/g)).toHaveLength(2);
    expect(html.match(/class="downloads-meter-label is-filled"/g)).toHaveLength(2);
    expect(html.match(/role="progressbar"/g)).toHaveLength(2);
    expect(html).toContain("--downloads-progress:75%");
  });

  it("shows compact status visually while preserving the full accessible text", () => {
    const html = renderToStaticMarkup(ItemRowContent({
      actions: createActions(),
      columnOrder: ["status", "account"],
      gridTemplate: "120px 120px",
      item: item("status", "package-a", "downloading", {
        fullStatus: "Download läuft (Mega-Debrid)",
        providerLabel: "Mega-Debrid Web (Web Account)"
      }),
      selected: false
    }));

    expect(html).toContain('aria-label="Download läuft"');
    expect(html).toContain('class="downloads-status-full"');
    expect(html).toContain('class="downloads-status-compact"');
    expect(html.match(/>Download läuft<\/span>/g)).toHaveLength(2);
    expect(html).toContain('title="Download läuft (Mega-Debrid)"');
    expect(html).toContain('title="Mega-Debrid Web (Web Account)"');
    expect(html).toContain('class="downloads-service-full">Mega-Debrid (Web)</span>');
    expect(html).toContain('class="downloads-service-compact">Mega-Debrid (Web)</span>');
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
    const input = { indeterminate: false };

    (checkbox as unknown as { ref: (element: typeof input) => void }).ref(input);
    checkbox.props.onChange({ target: { checked: true } });

    expect(checkbox.props["aria-checked"]).toBe("mixed");
    expect(input.indeterminate).toBe(true);
    expect(calls).toEqual([[['package-a', 'active', 'queued'], true]]);
  });

  it("announces sort state and exposes keyboard-operable column move controls", () => {
    const calls: Array<[string, string, number]> = [];
    const header = DownloadsTableHeader({
      actions: createActions({
        onColumnPointerDown: (column, event) => calls.push(["down", column, event.clientX]),
        onColumnPointerMove: (column, event) => calls.push(["move", column, event.clientX]),
        onColumnPointerUp: (column, event) => calls.push(["up", column, event.clientX])
      }),
      columnOrder: ["name", "size", "account"],
      gridTemplate: "200px 100px 100px",
      selectedCount: 0,
      sortColumn: "name",
      sortDirection: "desc",
      visibleIds: ["package-a"]
    });
    const html = renderToStaticMarkup(header);
    const moveLeft = findElement(header, (element) => element.type === "button" && element.props["aria-label"] === "Geladen / Größe nach links verschieben");
    const previous = { getBoundingClientRect: () => ({ left: 100, width: 100 }), matches: () => true };
    const current = {
      closest: () => null,
      getBoundingClientRect: () => ({ left: 200, width: 100 }),
      previousElementSibling: previous,
      nextElementSibling: null
    };

    moveLeft.props.onClick({ currentTarget: { closest: () => current }, stopPropagation: () => {} });

    expect(html).toMatch(/aria-sort="descending"[^>]*data-download-column="name"/);
    expect(html).toMatch(/aria-sort="none"[^>]*data-download-column="size"/);
    expect(html).not.toMatch(/aria-sort="[^"]+"[^>]*data-download-column="account"/);
    expect(moveLeft.props.type).toBe("button");
    expect(calls).toEqual([
      ["down", "size", 250],
      ["move", "size", 149],
      ["up", "size", 149]
    ]);
  });

  it("opens the column menu without letting the same context event close it again", () => {
    const calls: Array<[string, number, number]> = [];
    const header = DownloadsTableHeader({
      actions: createActions({ onColumnContextMenu: (column, x, y) => calls.push([column, x, y]) }),
      columnOrder: ["name", "size"],
      gridTemplate: "200px 100px",
      selectedCount: 0,
      sortColumn: "name",
      sortDirection: "asc",
      visibleIds: []
    });
    const nameHeader = findElement(header, (element) => element.props["data-download-column"] === "name");
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    nameHeader.props.onContextMenu({ clientX: 320, clientY: 140, preventDefault, stopPropagation });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([["name", 320, 140]]);
  });

  it("ignores another column move while the previous move is settling", () => {
    const calls: string[] = [];
    const header = DownloadsTableHeader({
      actions: createActions({
        onColumnPointerDown: () => calls.push("down"),
        onColumnPointerMove: () => calls.push("move"),
        onColumnPointerUp: () => calls.push("up")
      }),
      columnOrder: ["name", "size", "account"],
      gridTemplate: "200px 100px 100px",
      selectedCount: 0,
      sortColumn: "name",
      sortDirection: "asc",
      visibleIds: ["package-a"]
    });
    const moveRight = findElement(header, (element) => element.type === "button" && element.props["aria-label"] === "Name nach rechts verschieben");
    const table = { classList: { contains: (className: string) => className === "is-column-drag-settling" } };
    const sibling = { getBoundingClientRect: () => ({ left: 300, width: 100 }), matches: () => true };
    const current = {
      closest: (selector: string) => selector === ".downloads-table" ? table : null,
      getBoundingClientRect: () => ({ left: 100, width: 200 }),
      previousElementSibling: null,
      nextElementSibling: sibling
    };

    moveRight.props.onClick({ currentTarget: { closest: () => current }, stopPropagation: () => {} });

    expect(calls).toEqual([]);
  });

  it("does not start a pointer drag while a column move is settling", () => {
    const calls: string[] = [];
    const header = DownloadsTableHeader({
      actions: createActions({ onColumnPointerDown: () => calls.push("down") }),
      columnOrder: ["name", "size", "account"],
      gridTemplate: "200px 100px 100px",
      selectedCount: 0,
      sortColumn: "name",
      sortDirection: "asc",
      visibleIds: ["package-a"]
    });
    const nameHeader = findElement(header, (element) => element.props["data-download-column"] === "name");
    const pointerCapture = vi.fn();

    nameHeader.props.onPointerDown({
      button: 0,
      clientX: 200,
      currentTarget: {
        closest: () => ({ classList: { contains: (className: string) => className === "is-column-drag-settling" } }),
        setPointerCapture: pointerCapture
      },
      isPrimary: true,
      pointerId: 4
    });

    expect(pointerCapture).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
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

  it("selects a package on a plain row click", () => {
    const calls: Array<[string, boolean, boolean]> = [];
    const model = withRuntime(createInput());
    const row = model.packageRows[0];
    const component = PackageCardContent({
      actions: createActions({
        onToggleSelection: (id, ctrl, shift) => calls.push([id, ctrl, shift])
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

    packageRow.props.onClick({ ctrlKey: false, metaKey: false, shiftKey: false });

    expect(calls).toEqual([[row.package.id, false, false]]);
  });

  it("collapses a package through its disclosure button or a free-row double click", () => {
    const calls: string[] = [];
    const model = withRuntime(createInput());
    const row = model.packageRows[0];
    const component = PackageCardContent({
      actions: createActions({
        onTogglePackageCollapse: () => calls.push("collapse"),
        onToggleSelection: () => calls.push("select")
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
    const collapseButton = findElement(component, (element) => element.type === "button" && String(element.props.className || "").includes("downloads-collapse-button"));

    packageRow.props.onClick({ ctrlKey: false, detail: 1, metaKey: false, shiftKey: false, target: {}, currentTarget: {} });
    packageRow.props.onClick({ ctrlKey: false, detail: 2, metaKey: false, shiftKey: false, target: {}, currentTarget: {} });
    expect(packageRow.props.onDoubleClick).toBeTypeOf("function");
    packageRow.props.onDoubleClick({
      ctrlKey: false,
      currentTarget: {},
      metaKey: false,
      preventDefault: () => calls.push("prevent"),
      shiftKey: false,
      target: { closest: () => null }
    });
    collapseButton.props.onClick({ stopPropagation: () => {} });

    expect(calls).toEqual(["select", "prevent", "collapse", "collapse"]);
    expect(collapseButton.props["aria-expanded"]).toBe(true);
    expect(collapseButton.props["aria-controls"]).toBeUndefined();
  });

  it("does not collapse a package when a row double click starts on interactive content", () => {
    const calls: string[] = [];
    const model = withRuntime(createInput());
    const row = model.packageRows[0];
    const component = PackageCardContent({
      actions: createActions({
        onStartPackageRename: () => calls.push("rename"),
        onTogglePackageCollapse: () => calls.push("collapse"),
        onToggleSelection: () => calls.push("select")
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
    const title = findElement(component, (element) => element.type === "strong" && String(element.props.className || "").includes("downloads-copyable"));

    packageRow.props.onClick({ ctrlKey: false, detail: 1, metaKey: false, shiftKey: false });
    packageRow.props.onClick({ ctrlKey: false, detail: 2, metaKey: false, shiftKey: false });
    expect(packageRow.props.onDoubleClick).toBeTypeOf("function");
    packageRow.props.onDoubleClick({
      ctrlKey: false,
      currentTarget: {},
      metaKey: false,
      preventDefault: () => calls.push("prevent"),
      shiftKey: false,
      target: { closest: () => ({}) }
    });
    title.props.onDoubleClick({ stopPropagation: () => calls.push("stop") });

    expect(calls).toEqual(["select", "stop", "rename"]);
  });

  it("keeps an already selected package selected during a row double click", () => {
    const calls: string[] = [];
    const model = withRuntime(createInput());
    const row = model.packageRows[0];
    const component = PackageCardContent({
      actions: createActions({
        onTogglePackageCollapse: () => calls.push("collapse"),
        onToggleSelection: () => calls.push("select")
      }),
      columnOrder: model.columnOrder,
      editing: false,
      editingName: "",
      gridTemplate: model.gridTemplate,
      packageSpeedBps: 0,
      row,
      selectedIds: new Set([row.package.id]),
      selectedVersion: 1
    });
    const packageRow = findElement(component, (element) => element.props["data-download-row-id"] === row.package.id);

    packageRow.props.onClick({ ctrlKey: false, detail: 1, metaKey: false, shiftKey: false });
    packageRow.props.onClick({ ctrlKey: false, detail: 2, metaKey: false, shiftKey: false });
    packageRow.props.onDoubleClick({
      ctrlKey: false,
      metaKey: false,
      preventDefault: () => calls.push("prevent"),
      shiftKey: false,
      target: { closest: () => null }
    });

    expect(calls).toEqual(["prevent", "collapse"]);
  });

  it("keeps the complete package status and audio details in the tooltip", () => {
    const audioPackage = {
      ...pkg("audio-package", "Audio package", ["audio-item"]),
      postProcessLabel: "Entpacken 1%",
      audioStripSummary: {
        at: now,
        candidates: 1,
        remuxed: 1,
        keptSingle: 0,
        skippedNoGerman: 0,
        skippedNoTool: 0,
        failed: 0,
        files: [{ name: "episode.mkv", action: "remuxed", reason: "German kept" }]
      }
    } as PackageEntry;
    const html = renderToStaticMarkup(PackageCardContent({
      actions: createActions(),
      columnOrder: ["status"],
      editing: false,
      editingName: "",
      gridTemplate: "220px",
      packageSpeedBps: 0,
      row: { package: audioPackage, items: [item("audio-item", audioPackage.id, "queued")], allItems: [item("audio-item", audioPackage.id, "queued")], collapsed: true },
      selectedIds: new Set<string>(),
      selectedVersion: 0
    }));

    expect(html).toMatch(/title="0\/1 · Entpacken - 1% · Tonspur: 1 OK[^\"]*episode\.mkv: remuxed \(German kept\)"/s);
  });

  it("shows only a compact extraction error while retaining diagnostics in the tooltip", () => {
    const html = renderToStaticMarkup(ItemRowContent({
      actions: createActions(),
      columnOrder: ["status"],
      gridTemplate: "220px",
      item: item("extract-error", "package-a", "failed", {
        fullStatus: "Entpack-Fehler [release.part1.rar]: Unerwartetes Dateiende",
        lastError: "Mega-Debrid API: Kein Server verfügbar"
      }),
      selected: false
    }));

    expect(html.match(/>Entpack-Fehler<\/span>/g)).toHaveLength(2);
    expect(html).toContain('title="Entpack-Fehler [release.part1.rar]: Unerwartetes Dateiende');
    expect(html).toContain('Mega-Debrid API: Kein Server verfügbar');
  });

  it("removes redundant service suffixes from runtime statuses", () => {
    expect(compactDownloadStatus("Starte... (Mega-Debrid Web)")).toBe("Starte...");
    expect(compactDownloadStatus("Warte auf Daten (Mega-Debrid Web)")).toBe("Warte auf Daten");
    expect(compactDownloadStatus("Warte auf Festplatte (Mega-Debrid Web)")).toBe("Warte auf Festplatte");
  });

  it("prioritizes disk waits and extraction errors in package status", () => {
    const diskPackage = pkg("disk-package", "Disk package", ["disk-item", "active-item"]);
    const diskHtml = renderToStaticMarkup(PackageCardContent({
      actions: createActions(),
      columnOrder: ["status"],
      editing: false,
      editingName: "",
      gridTemplate: "220px",
      packageSpeedBps: 1_000,
      row: {
        package: diskPackage,
        items: [
          item("disk-item", diskPackage.id, "downloading", { fullStatus: "Warte auf Festplatte (Mega-Debrid Web)" }),
          item("active-item", diskPackage.id, "downloading", { fullStatus: "Download läuft (Mega-Debrid Web)" })
        ],
        allItems: [
          item("disk-item", diskPackage.id, "downloading", { fullStatus: "Warte auf Festplatte (Mega-Debrid Web)" }),
          item("active-item", diskPackage.id, "downloading", { fullStatus: "Download läuft (Mega-Debrid Web)" })
        ],
        collapsed: true
      },
      selectedIds: new Set<string>(),
      selectedVersion: 0
    }));
    expect(diskHtml).toMatch(/>Warte auf Festplatte<\/span>/);

    const errorPackage = { ...pkg("error-package", "Error package", ["error-a", "error-b"]), status: "completed" as const };
    const errorHtml = renderToStaticMarkup(PackageCardContent({
      actions: createActions(),
      columnOrder: ["status"],
      editing: false,
      editingName: "",
      gridTemplate: "220px",
      packageSpeedBps: 0,
      row: {
        package: errorPackage,
        items: [
          item("error-a", errorPackage.id, "completed", { fullStatus: "Entpack-Fehler [release.part1.rar]: Kein Speicherplatz" }),
          item("error-b", errorPackage.id, "completed", { fullStatus: "Entpackt - Done" })
        ],
        allItems: [
          item("error-a", errorPackage.id, "completed", { fullStatus: "Entpack-Fehler [release.part1.rar]: Kein Speicherplatz" }),
          item("error-b", errorPackage.id, "completed", { fullStatus: "Entpackt - Done" })
        ],
        collapsed: true
      },
      selectedIds: new Set<string>(),
      selectedVersion: 0
    }));
    expect(errorHtml).toMatch(/>Entpack-Fehler<\/span>/);
    expect(errorHtml).not.toMatch(/>2\/2<\/span>/);
  });

  it("shows only the operation in an actively downloading package status", () => {
    const activePackage = pkg("active-package", "Active package", ["active-item"]);
    const html = renderToStaticMarkup(PackageCardContent({
      actions: createActions(),
      columnOrder: ["status"],
      editing: false,
      editingName: "",
      gridTemplate: "220px",
      packageSpeedBps: 1_000,
      row: { package: activePackage, items: [item("active-item", activePackage.id, "downloading", { fullStatus: "Download läuft (Mega-Debrid API)" })], allItems: [item("active-item", activePackage.id, "downloading", { fullStatus: "Download läuft (Mega-Debrid API)" })], collapsed: true },
      selectedIds: new Set<string>(),
      selectedVersion: 0
    }));

    expect(html.match(/>Download läuft<\/span>/g)).toHaveLength(2);
    expect(html).toContain('title="0/1"');
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

  it("removes the redundant package activation checkbox and preserves context actions", () => {
    const calls: Array<unknown> = [];
    const model = withRuntime(createInput());
    const row = model.packageRows[0];
    const component = PackageCardContent({
      actions: createActions({
        onToggleSelection: (id, ctrl, shift) => calls.push(["select", id, ctrl, shift]),
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
    const packageElement = findElement(component, (element) => element.props["data-download-package-id"] === "package-a");

    selection.props.onClick({ stopPropagation: () => {}, ctrlKey: false, metaKey: false, shiftKey: true });
    packageElement.props.onContextMenu({ preventDefault: () => {}, stopPropagation: () => {}, clientX: 30, clientY: 50 });

    expect(calls).toEqual([["select", "package-a", true, true], ["context", "package-a", 30, 50]]);
    expect(() => findElement(component, (element) => element.type === "input" && element.props["aria-label"] === "Aktive Serie aktivieren")).toThrow("Element not found");
  });
});
