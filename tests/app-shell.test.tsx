import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AvatarMenu, getAvatarMenuKeyboardAction } from "../src/renderer/shell/AvatarMenu";
import { AppHeader } from "../src/renderer/shell/AppHeader";
import { AppShell } from "../src/renderer/shell/AppShell";
import { buildMainNavigation } from "../src/renderer/shell/shell-model";

describe("desktop shell", () => {
  it("keeps application menus mounted for animated opening and closing", () => {
    const source = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
    const shellCss = readFileSync(new URL("../src/renderer/shell/shell.css", import.meta.url), "utf8");

    expect(source.match(/menu-dropdown\$\{openMenu ===/g)).toHaveLength(3);
    expect(css).toMatch(/\.menu-dropdown\s*\{[^}]*opacity:\s*0;[^}]*transform:\s*translateY\(-8px\);[^}]*visibility:\s*hidden;/s);
    expect(css).toMatch(/\.menu-dropdown\.is-open\s*\{[^}]*opacity:\s*1;[^}]*transform:\s*translateY\(0\);[^}]*visibility:\s*visible;/s);
    expect(shellCss).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.md-application-menu-tree \.menu-dropdown\s*\{[^}]*transition-duration:\s*150ms, 180ms, 0s !important;/);
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
