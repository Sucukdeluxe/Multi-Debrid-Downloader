import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AvatarMenu, getAvatarMenuKeyboardAction } from "../src/renderer/shell/AvatarMenu";
import { AppShell } from "../src/renderer/shell/AppShell";
import { buildMainNavigation } from "../src/renderer/shell/shell-model";

describe("desktop shell", () => {
  it("exposes all five views with exactly one active item", () => {
    const items = buildMainNavigation("downloads");
    expect(items.map((item) => item.id)).toEqual(["downloads", "collector", "settings", "history", "statistics"]);
    expect(items.filter((item) => item.active)).toHaveLength(1);
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
