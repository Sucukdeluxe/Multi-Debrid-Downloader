import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AvatarMenu, getAvatarMenuKeyboardAction } from "../src/renderer/shell/AvatarMenu";
import { AppHeader } from "../src/renderer/shell/AppHeader";
import { AppShell } from "../src/renderer/shell/AppShell";
import { buildMainNavigation } from "../src/renderer/shell/shell-model";
import { getSnapshotRenderDelay } from "../src/renderer/App";
import * as appModule from "../src/renderer/App";
import { createVisualFixture } from "./visual/fixtures";

describe("desktop shell", () => {
  it("keeps delta-only startup state behind the loading gate", () => {
    const source = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
    const coordinator = appModule.createSnapshotBootstrapCoordinator() as ReturnType<typeof appModule.createSnapshotBootstrapCoordinator> & {
      getStatus?: () => { phase: string; message: string };
    };
    const delta = structuredClone(createVisualFixture("dense").snapshot);
    delta.payloadKind = "delta";

    expect(coordinator.push(delta)).toBeNull();
    expect(coordinator.getStatus).toBeTypeOf("function");
    if (!coordinator.getStatus) return;
    expect(coordinator.getStatus()).toEqual({ phase: "loading", message: "" });
    expect(source).toContain('if (snapshotBootstrapStatus.phase !== "ready")');
    expect(source).toContain("Anwendungsdaten werden geladen");
    expect(source.indexOf('if (snapshotBootstrapStatus.phase !== "ready")')).toBeLessThan(source.indexOf("<AppShell"));
  });

  it("accepts an early full stream snapshot as authoritative startup state", () => {
    const coordinator = appModule.createSnapshotBootstrapCoordinator() as ReturnType<typeof appModule.createSnapshotBootstrapCoordinator> & {
      getStatus?: () => { phase: string; message: string };
    };
    const full = structuredClone(createVisualFixture("dense").snapshot);
    full.payloadKind = "full";

    expect(coordinator.push(full)).toEqual(full);
    expect(coordinator.getStatus).toBeTypeOf("function");
    if (!coordinator.getStatus) return;
    expect(coordinator.getStatus()).toEqual({ phase: "ready", message: "" });
  });

  it("marks the initial snapshot as authoritative after replaying queued deltas", () => {
    const coordinator = appModule.createSnapshotBootstrapCoordinator() as ReturnType<typeof appModule.createSnapshotBootstrapCoordinator> & {
      getStatus?: () => { phase: string; message: string };
    };
    const initial = structuredClone(createVisualFixture("dense").snapshot);
    const delta = structuredClone(initial);
    delta.payloadKind = "delta";
    delta.session.running = true;

    expect(coordinator.push(delta)).toBeNull();
    expect(coordinator.initialize(initial).session.running).toBe(true);
    expect(coordinator.getStatus).toBeTypeOf("function");
    if (!coordinator.getStatus) return;
    expect(coordinator.getStatus()).toEqual({ phase: "ready", message: "" });
  });

  it("shows a retryable startup error without promoting placeholder data", () => {
    const source = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
    const coordinator = appModule.createSnapshotBootstrapCoordinator() as ReturnType<typeof appModule.createSnapshotBootstrapCoordinator> & {
      fail?: (message: string) => { phase: string; message: string };
      getStatus?: () => { phase: string; message: string };
    };

    expect(coordinator.fail).toBeTypeOf("function");
    if (!coordinator.fail || !coordinator.getStatus) return;
    expect(coordinator.fail("Snapshot nicht erreichbar")).toEqual({ phase: "error", message: "Snapshot nicht erreichbar" });
    expect(coordinator.getStatus()).toEqual({ phase: "error", message: "Snapshot nicht erreichbar" });
    expect(source).toContain('snapshotBootstrapStatus.phase === "error"');
    expect(source).toContain('onClick={() => retrySnapshotBootstrapRef.current()}');
    expect(source).toContain("Erneut versuchen");
  });

  it("retries a failed snapshot load until authoritative state arrives", () => {
    const coordinator = appModule.createSnapshotBootstrapCoordinator() as ReturnType<typeof appModule.createSnapshotBootstrapCoordinator> & {
      fail?: (message: string) => { phase: string; message: string };
      retry?: () => { phase: string; message: string };
      getStatus?: () => { phase: string; message: string };
    };
    const full = structuredClone(createVisualFixture("dense").snapshot);
    full.payloadKind = "full";

    expect(coordinator.fail).toBeTypeOf("function");
    expect(coordinator.retry).toBeTypeOf("function");
    if (!coordinator.fail || !coordinator.retry || !coordinator.getStatus) return;
    coordinator.fail("Snapshot nicht erreichbar");
    expect(coordinator.retry()).toEqual({ phase: "loading", message: "" });
    coordinator.push(full);
    coordinator.fail("Verspäteter Fehler");
    expect(coordinator.getStatus()).toEqual({ phase: "ready", message: "" });
  });

  it("applies queued live removals before accepting a delayed initial snapshot", () => {
    const createSnapshotBootstrapCoordinator = (appModule as unknown as {
      createSnapshotBootstrapCoordinator?: () => {
        initialize: (snapshot: ReturnType<typeof createVisualFixture>["snapshot"]) => ReturnType<typeof createVisualFixture>["snapshot"];
        push: (snapshot: ReturnType<typeof createVisualFixture>["snapshot"]) => ReturnType<typeof createVisualFixture>["snapshot"] | null;
      };
    }).createSnapshotBootstrapCoordinator;
    expect(createSnapshotBootstrapCoordinator).toBeTypeOf("function");
    if (!createSnapshotBootstrapCoordinator) return;

    const initial = structuredClone(createVisualFixture("dense").snapshot);
    const removedItemId = Object.keys(initial.session.items)[0];
    const removedPackageId = initial.session.items[removedItemId].packageId;
    const coordinator = createSnapshotBootstrapCoordinator();
    const delta = structuredClone(initial);
    delta.payloadKind = "delta";
    delta.session.items = {};
    delta.session.packages = {};
    delta.removedItemIds = [removedItemId];
    delta.removedPackageIds = [removedPackageId];

    expect(coordinator.push(delta)).toBeNull();
    const merged = coordinator.initialize(initial);

    expect(merged.session.items[removedItemId]).toBeUndefined();
    expect(merged.session.packages[removedPackageId]).toBeUndefined();
    expect(coordinator.push({ ...merged, payloadKind: "full" })).toEqual(expect.objectContaining({ payloadKind: "full" }));

    const fullCoordinator = createSnapshotBootstrapCoordinator();
    const newerFull = structuredClone(initial);
    newerFull.payloadKind = "full";
    delete newerFull.session.items[removedItemId];
    expect(fullCoordinator.push(newerFull)?.session.items[removedItemId]).toBeUndefined();
    expect(fullCoordinator.initialize(initial).session.items[removedItemId]).toBeUndefined();
  });

  it("drops buffered snapshots that are not newer than a retry snapshot", () => {
    const coordinator = appModule.createSnapshotBootstrapCoordinator();
    const retrySnapshot = structuredClone(createVisualFixture("dense").snapshot) as ReturnType<typeof createVisualFixture>["snapshot"] & {
      snapshotRevision?: number;
    };
    retrySnapshot.snapshotRevision = 20;
    retrySnapshot.canStart = true;
    const staleDelta = structuredClone(retrySnapshot);
    staleDelta.snapshotRevision = 19;
    staleDelta.payloadKind = "delta";
    staleDelta.canStart = false;
    staleDelta.session.packageOrder = [];
    staleDelta.session.items = {};
    staleDelta.session.packages = {};

    expect(coordinator.push(staleDelta)).toBeNull();
    coordinator.fail("Snapshot nicht erreichbar");
    coordinator.retry();

    const restored = coordinator.initialize(retrySnapshot);
    expect(restored.canStart).toBe(true);
    expect(restored.session.packageOrder).toEqual(retrySnapshot.session.packageOrder);
    expect(restored.snapshotRevision).toBe(20);
  });

  it("ignores stale live snapshots and accepts a newer full snapshot", () => {
    const coordinator = appModule.createSnapshotBootstrapCoordinator();
    const current = structuredClone(createVisualFixture("dense").snapshot) as ReturnType<typeof createVisualFixture>["snapshot"] & {
      snapshotRevision?: number;
    };
    current.snapshotRevision = 30;
    current.payloadKind = "full";
    current.canStart = true;
    const stale = structuredClone(current);
    stale.snapshotRevision = 29;
    stale.canStart = false;
    const newer = structuredClone(current);
    newer.snapshotRevision = 31;
    newer.canStart = false;

    expect(coordinator.push(current)).toEqual(current);
    expect(coordinator.push(stale)).toBeNull();
    expect(coordinator.push(newer)).toEqual(newer);
  });

  it("lets a newer initial GET replace an earlier full stream snapshot", () => {
    const coordinator = appModule.createSnapshotBootstrapCoordinator();
    const early = structuredClone(createVisualFixture("dense").snapshot) as ReturnType<typeof createVisualFixture>["snapshot"] & {
      snapshotRevision?: number;
    };
    early.snapshotRevision = 40;
    early.payloadKind = "full";
    early.canStart = false;
    const initial = structuredClone(early);
    initial.snapshotRevision = 41;
    initial.canStart = true;

    expect(coordinator.push(early)).toEqual(early);
    expect(coordinator.initialize(initial)).toEqual(initial);
  });

  it("applies a resolved initial GET after an early full stream bootstrap", () => {
    const source = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
    const start = source.indexOf("const state = snapshotCoordinator.initialize(initialState)");
    const end = source.indexOf("}).catch((error) =>", start);
    const resolution = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(resolution).toContain("authoritativeSnapshotApplied");
    expect(resolution).toContain("applyStreamSnapshot(state)");
    expect(resolution).toContain("applyAuthoritativeSnapshot(state");
  });

  it("uses keyboard-focusable controls for every copy target", () => {
    const appSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
    const dialogSource = readFileSync(new URL("../src/renderer/ui/LinkAddressesDialog.tsx", import.meta.url), "utf8");
    const source = `${appSource}\n${dialogSource}`;

    expect(source).not.toMatch(/<span[^>]*className="[^"]*link-popup-click/);
    expect(dialogSource.match(/className="link-popup-(?:name|url) link-popup-click"/g)).toHaveLength(2);
    expect(source).not.toContain("navigator.clipboard.writeText(key.token)");
    expect(source).toContain("window.rd.writeClipboardText(key.masked)");
    expect(source).toContain("Maskierte Kennung kopiert");
  });

  it("confirms before removing selected collector links", () => {
    const source = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
    const removal = source.slice(source.indexOf("const removeSelectedCollectorLinks"), source.indexOf("const onPackageStartEdit"));

    expect(removal).toContain("askConfirmPrompt");
    expect(removal.indexOf("askConfirmPrompt")).toBeLessThan(removal.indexOf("setCollectorPackages"));
    expect(removal).toContain('title: "Ausgewählte Links löschen"');
  });

  it("places the delete confirmation opt-out below the right-aligned actions", () => {
    const source = readFileSync(new URL("../src/renderer/views/downloads/DeleteConfirmationDialog.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

    expect(source).toContain('className="delete-confirm-footer"');
    expect(source.indexOf('className="modal-actions"')).toBeLessThan(source.indexOf("Nicht mehr anzeigen"));
    expect(source).toContain('className="toggle-line delete-confirm-dont-ask"');
    expect(css).toMatch(/\.delete-confirm-footer\s*{[^}]*display:\s*grid;[^}]*justify-items:\s*end;/s);
  });

  it("does not stack renderer latency on the manager cadence for large active queues", () => {
    expect(getSnapshotRenderDelay(2_470, true, "downloads")).toBe(0);
    expect(getSnapshotRenderDelay(2_470, true, "statistics")).toBe(800);
  });

  it("renders medium download queues immediately after their calm 750 ms snapshot", () => {
    expect(getSnapshotRenderDelay(661, true, "downloads")).toBe(0);
  });

  it("does not add renderer delay after the 750 ms manager cadence for a small active queue", () => {
    expect(getSnapshotRenderDelay(69, true, "downloads")).toBe(0);
  });

  it("redraws the header speed sparkline on the same 750 ms cadence", () => {
    const source = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
    const sparklineBlock = source.slice(source.indexOf("const DownloadSpeedSparkline"), source.indexOf("function createScheduleId"));

    expect(sparklineBlock).toContain("window.setInterval(tick, 750)");
  });

  it("quits promptly after handing the update to the deferred installer launcher", () => {
    const source = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
    const install = source.slice(source.indexOf("handleTrusted(IPC_CHANNELS.INSTALL_UPDATE"), source.indexOf("handleTrusted(IPC_CHANNELS.OPEN_EXTERNAL"));

    expect(install).toContain("}, 250)");
    expect(install).not.toContain("}, 5000)");
  });

  it("does not let live download snapshots overwrite the local column order", () => {
    const source = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
    const stateUpdates = source.slice(source.indexOf("unsubscribe = window.rd.onStateUpdate"), source.indexOf("unsubClipboard = window.rd.onClipboardDetected"));

    expect(stateUpdates).not.toContain("setColumnOrder");
    expect(stateUpdates).not.toContain("syncColumnOrderFromSnapshot");
  });

  it("commits the target column grid before waiting for animation cleanup", () => {
    const source = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
    const pointerUp = source.slice(source.indexOf("onColumnPointerUp:"), source.indexOf("onColumnPointerCancel:"));

    expect(pointerUp.indexOf("commitDownloadColumnDrag")).toBeGreaterThanOrEqual(0);
    expect(pointerUp.indexOf("commitDownloadColumnDrag")).toBeLessThan(pointerUp.indexOf("columnDragSettleTimerRef.current = window.setTimeout"));
    expect(pointerUp.indexOf("commitDownloadColumnDrag")).toBeLessThan(pointerUp.indexOf("persistColumnOrder"));
    expect(pointerUp).toContain("snapshot.settings.animatePackageDisclosure");
  });

  it("resets the download columns immediately and persists the default order", () => {
    const source = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
    const reset = source.slice(source.indexOf("const resetColumnLayout"), source.indexOf("const downloadsActions"));
    const actions = source.slice(source.indexOf("const downloadsActions"), source.indexOf("const statisticsActions"));
    const menu = source.slice(source.indexOf("columnContextMenu={"), source.indexOf("historyContextMenu={"));

    expect(reset).toContain("setColumnOrder(DEFAULT_COLUMN_ORDER)");
    expect(reset).toContain("persistColumnOrder(DEFAULT_COLUMN_ORDER)");
    expect(reset).toContain('showToast("Spaltenlayout zurückgesetzt"');
    expect(actions).toContain("onResetColumnLayout: resetColumnLayout");
    expect(menu).toContain("Spaltenlayout zurücksetzen");
    expect(menu).toContain("resetColumnLayout()");
    expect(menu).toContain("setColHeaderCtx(null)");
    expect(menu).toContain('className="column-menu-check"');
    expect(menu).toContain('className="ctx-menu-item column-menu-reset"');
    expect(menu).not.toContain("ctx-menu-active");
  });

  it("styles checked columns with a green mark and normal text", () => {
    const shellCss = readFileSync(new URL("../src/renderer/shell/shell.css", import.meta.url), "utf8");

    expect(shellCss).toMatch(/\.md-column-context-menu \.column-menu-check\s*\{[^}]*color:\s*var\(--ui-success-text\);/s);
    expect(shellCss).toMatch(/\.md-column-context-menu \.ctx-menu-item:not\(\.ctx-menu-disabled\)\s*\{[^}]*color:\s*var\(--ui-text\);/s);
    expect(shellCss).toMatch(/\.md-column-context-menu \.ctx-menu-disabled\s*\{[^}]*color:\s*var\(--ui-text\);[^}]*opacity:\s*1;/s);
    expect(shellCss).toMatch(/\.md-column-context-menu \.column-menu-reset\s*\{[^}]*text-align:\s*center;/s);
  });

  it("keeps application menus mounted for animated opening and closing", () => {
    const source = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
    const shellCss = readFileSync(new URL("../src/renderer/shell/shell.css", import.meta.url), "utf8");

    expect(source.match(/menu-dropdown\$\{openMenu ===/g)).toHaveLength(3);
    expect(css).toMatch(/\.menu-dropdown\s*\{[^}]*opacity:\s*0;[^}]*transform:\s*translateY\(-8px\);[^}]*visibility:\s*hidden;/s);
    expect(css).toMatch(/\.menu-dropdown\.is-open\s*\{[^}]*opacity:\s*1;[^}]*transform:\s*translateY\(0\);[^}]*visibility:\s*visible;/s);
    expect(shellCss).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.md-application-menu-tree \.menu-dropdown\s*\{[^}]*transition-duration:\s*150ms, 180ms, 0s !important;/);
  });

  it("anchors every top-level application dropdown to the right header edge", () => {
    const shellCss = readFileSync(new URL("../src/renderer/shell/shell.css", import.meta.url), "utf8");

    expect(shellCss).toMatch(/\.md-application-menu-tree > \.menu-bar-item > \.menu-dropdown\s*\{[^}]*right:\s*0;[^}]*left:\s*auto;/s);
  });

  it("keeps application submenus visible inside narrow right-aligned windows", () => {
    const source = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
    const shellCss = readFileSync(new URL("../src/renderer/shell/shell.css", import.meta.url), "utf8");

    expect(source.match(/aria-hidden=\{openSubmenu !==/g)).toHaveLength(4);
    expect(source.match(/inert: ""/g)).toHaveLength(4);
    expect(source.match(/menu-submenu-dropdown\$\{openSubmenu ===/g)).toHaveLength(4);
    expect(source).not.toMatch(/\{openSubmenu === "(?:sicherung|hilfe-log|hilfe-remote|hilfe-diagnose)" && \(/);
    expect(shellCss).toMatch(/\.md-application-menu-tree :where\(\.menu-dropdown, \.menu-submenu-dropdown\)\s*\{[^}]*overflow:\s*visible;/s);
    expect(shellCss).toMatch(/\.md-application-menu-tree \.menu-submenu-dropdown\s*\{[^}]*right:\s*100%;[^}]*left:\s*auto;[^}]*opacity:\s*0;[^}]*transform:\s*translateX\(8px\);[^}]*visibility:\s*hidden;[^}]*pointer-events:\s*none;[^}]*transition:[^}]*transform 220ms cubic-bezier\(0\.22, 0\.76, 0\.22, 1\)/s);
    expect(shellCss).toMatch(/\.md-application-menu-tree \.menu-submenu-dropdown\.is-open\s*\{[^}]*opacity:\s*1;[^}]*transform:\s*translateX\(0\);[^}]*visibility:\s*visible;[^}]*pointer-events:\s*auto;/s);
    expect(shellCss).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.md-application-menu-tree \.menu-submenu-dropdown\s*\{[^}]*transition-duration:\s*0\.01ms !important;[^}]*transition-delay:\s*0s !important;/);
  });

  it("uses the product asset in the header brand", () => {
    const html = renderToStaticMarkup(<AppHeader activeView="downloads" actions={null} onViewChange={() => {}} />);
    expect(html).toContain("Multi-Debrid Downloader");
    expect(html).toContain("app_icon.png");
  });

  it("exposes all five views with exactly one active item", () => {
    const items = buildMainNavigation("downloads");
    expect(items.map((item) => item.id)).toEqual(["downloads", "collector", "settings", "history", "statistics"]);
    expect(items.filter((item) => item.active)).toHaveLength(1);
  });

  it("renders one measured sliding indicator behind the active navigation item", () => {
    const html = renderToStaticMarkup(<AppHeader activeView="downloads" actions={null} onViewChange={() => {}} />);
    const source = readFileSync(new URL("../src/renderer/shell/AppHeader.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../src/renderer/shell/shell.css", import.meta.url), "utf8");

    expect(html).toContain("data-main-view=\"downloads\"");
    expect(source).toContain("ResizeObserver");
    expect(css).toMatch(/\.md-shell-navigation::before\s*\{[^}]*transform:\s*translate3d\(var\(--md-navigation-active-x[^}]*transition:\s*transform 420ms cubic-bezier\(0\.22, 0\.76, 0\.22, 1\), width 420ms cubic-bezier\(0\.22, 0\.76, 0\.22, 1\)/s);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.md-shell-navigation::before\s*\{[^}]*transition-duration:\s*420ms, 420ms, 420ms, 120ms !important;/);
    expect(css).toMatch(/\.md-shell-navigation-item\.is-active\s*\{[^}]*background:\s*transparent;/s);
  });

  it("renders context regions without global placeholders", () => {
    const html = renderToStaticMarkup(
      <AppShell
        activeView="downloads"
        onViewChange={() => {}}
        sidebar={<div>Filter</div>}
        sidebarStatus={<div>2 Downloads</div>}
        headerActions={null}
        toolbar={<div>Aktionen</div>}
        footer={<div>1–1 von 1</div>}
        contextInfo={null}
        sidebarCollapsed={false}
        onSidebarCollapsedChange={() => {}}
      >
        <div>Inhalt</div>
      </AppShell>
    );
    expect(html).toContain("data-ui-region=\"header\"");
    expect(html).toContain("data-ui-region=\"sidebar\"");
    expect(html).toContain("data-ui-region=\"sidebar-status\"");
    expect(html).toContain("data-ui-region=\"main\"");
    expect(html).toContain("1–1 von 1");
  });

  it("does not reserve a collapsed sidebar column when sidebar slots are empty", () => {
    const html = renderToStaticMarkup(
      <AppShell
        activeView="settings"
        onViewChange={() => {}}
        sidebar={null}
        sidebarStatus={null}
        headerActions={null}
        toolbar={null}
        footer={null}
        contextInfo={null}
        sidebarCollapsed
        onSidebarCollapsedChange={() => {}}
      >
        <div>Einstellungen</div>
      </AppShell>
    );
    expect(html).not.toContain("has-collapsed-sidebar");
    expect(html).not.toContain("data-ui-region=\"sidebar\"");
    expect(html).not.toContain("data-ui-region=\"toolbar\"");
    expect(html).not.toContain("data-ui-region=\"footer\"");
  });

  it("collapses a populated sidebar to zero width while preserving the edge toggle", () => {
    const html = renderToStaticMarkup(
      <AppShell
        activeView="downloads"
        onViewChange={() => {}}
        sidebar={<div>Filter</div>}
        sidebarStatus={<div>2 Downloads</div>}
        headerActions={null}
        toolbar={null}
        footer={null}
        contextInfo={null}
        sidebarCollapsed
        onSidebarCollapsedChange={() => {}}
      >
        <div>Downloads</div>
      </AppShell>
    );
    const shellCss = readFileSync(new URL("../src/renderer/shell/shell.css", import.meta.url), "utf8");

    expect(html).toContain("has-collapsed-sidebar");
    expect(html).toContain("md-shell-sidebar-panel");
    expect(html).toContain("Seitenleiste ausklappen");
    expect(shellCss).toMatch(/\.md-shell\.has-collapsed-sidebar \.md-shell-workspace\s*\{[^}]*grid-template-columns:\s*0 minmax\(0,\s*1fr\);/s);
  });

  it("slides the complete sidebar panel in both directions with the workspace width", () => {
    const shellCss = readFileSync(new URL("../src/renderer/shell/shell.css", import.meta.url), "utf8");

    expect(shellCss).toMatch(/\.md-shell-workspace\s*\{[^}]*transition:\s*grid-template-columns 520ms cubic-bezier\(0\.22, 0\.76, 0\.22, 1\);/s);
    expect(shellCss).toMatch(/\.md-shell-sidebar-panel\s*\{[^}]*transform:\s*translate3d\(0, 0, 0\);[^}]*transition:[^}]*transform 520ms cubic-bezier\(0\.22, 0\.76, 0\.22, 1\)/s);
    expect(shellCss).toMatch(/\.md-shell-sidebar\.is-collapsed \.md-shell-sidebar-panel\s*\{[^}]*transform:\s*translate3d\(calc\(-100% - 8px\), 0, 0\);[^}]*pointer-events:\s*none;/s);
    expect(shellCss).toMatch(/\.md-shell-sidebar:hover \.md-shell-sidebar-toggle,\s*\.md-shell-sidebar\.is-collapsed \.md-shell-sidebar-toggle,\s*\.md-shell-sidebar-toggle:focus-visible\s*\{[^}]*opacity:\s*1;/s);
  });

  it("keeps the explicitly requested sidebar motion active when Windows animations are disabled", () => {
    const shellCss = readFileSync(new URL("../src/renderer/shell/shell.css", import.meta.url), "utf8");

    expect(shellCss).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.md-shell-workspace\s*\{[^}]*transition-duration:\s*520ms !important;/s);
    expect(shellCss).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.md-shell-sidebar-panel\s*\{[^}]*transition-duration:\s*260ms, 520ms, 0s !important;/s);
  });

  it("keeps every view sidebar on the same content axis", () => {
    const shellCss = readFileSync(new URL("../src/renderer/shell/shell.css", import.meta.url), "utf8").replaceAll("\r\n", "\n");

    expect(shellCss).toMatch(/\.md-shell-sidebar-scroll > :is\(\.collector-sidebar, \.settings-sidebar, \.history-sidebar, \.statistics-sidebar\)\s*\{[^}]*gap:\s*8px;[^}]*padding:\s*0;[^}]*width:\s*100%;/s);
    expect(shellCss).toMatch(/\.md-shell-sidebar-scroll > :is\(\.collector-sidebar, \.settings-sidebar, \.history-sidebar, \.statistics-sidebar\) > :is\(\.collector-sidebar-heading, \.settings-sidebar-heading, \.history-sidebar-heading, \.statistics-sidebar-heading\)\s*\{[^}]*align-items:\s*center;[^}]*min-height:\s*28px;[^}]*padding:\s*0;/s);
    expect(shellCss).toMatch(/\.md-shell-sidebar-scroll \.collector-sidebar-select\s*\{[^}]*padding:\s*0 10px;/s);
  });

  it("renders the account popover only while open", () => {
    expect(renderToStaticMarkup(<AvatarMenu open={false} accountLabel="konto@example.test" actions={[]} onClose={() => {}} />)).toBe("");
    const html = renderToStaticMarkup(
      <AvatarMenu
        open
        accountLabel="konto@example.test"
        actions={[{ id: "logout", label: "Abmelden", danger: true, onSelect: () => {} }]}
        onClose={() => {}}
      />
    );
    expect(html).toContain("role=\"menu\"");
    expect(html).toContain("aria-label=\"Kontomenü\"");
    expect(html).toContain("konto@example.test");
    expect(html).toContain("Abmelden");
    expect(html).toContain("autofocus=\"\"");
  });

  it("maps menu keys to wrapped focus movement and closing", () => {
    expect(getAvatarMenuKeyboardAction("ArrowDown", 0, 3)).toEqual({ type: "focus", index: 1 });
    expect(getAvatarMenuKeyboardAction("ArrowDown", 2, 3)).toEqual({ type: "focus", index: 0 });
    expect(getAvatarMenuKeyboardAction("ArrowUp", 0, 3)).toEqual({ type: "focus", index: 2 });
    expect(getAvatarMenuKeyboardAction("Home", 2, 3)).toEqual({ type: "focus", index: 0 });
    expect(getAvatarMenuKeyboardAction("End", 0, 3)).toEqual({ type: "focus", index: 2 });
    expect(getAvatarMenuKeyboardAction("Escape", 1, 3)).toEqual({ type: "close" });
    expect(getAvatarMenuKeyboardAction("Tab", 1, 3)).toBeNull();
  });
});
