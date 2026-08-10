import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  clampContextMenuPosition,
  ContextMenu,
  getContextMenuKeyboardAction,
  getContextMenuSubmenuKeyboardAction,
  getContextSubmenuPosition
} from "../src/renderer/ui/ContextMenu";

const contextMenuSource = readFileSync(new URL("../src/renderer/ui/ContextMenu.tsx", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

describe("ContextMenu", () => {
  it("renders menu semantics and marks buttons as menu items", () => {
    const html = renderToStaticMarkup(
      <ContextMenu ariaLabel="Aktionen" onClose={() => {}} open x={40} y={60}>
        <button>Öffnen</button>
        <button disabled>Gesperrt</button>
      </ContextMenu>
    );

    expect(html).toContain("role=\"menu\"");
    expect(html).toContain("aria-label=\"Aktionen\"");
    expect(html.match(/role=\"menuitem\"/g)).toHaveLength(2);
    expect(html).toContain("tabindex=\"-1\"");
  });

  it("server-renders without layout-effect warnings", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    renderToStaticMarkup(
      <ContextMenu onClose={() => {}} open x={0} y={0}>
        <button>Öffnen</button>
      </ContextMenu>
    );

    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("clamps every edge to the visible viewport", () => {
    expect(clampContextMenuPosition(790, 590, 220, 180, 800, 600)).toEqual({ x: 580, y: 420 });
    expect(clampContextMenuPosition(-12, -8, 220, 180, 800, 600)).toEqual({ x: 0, y: 0 });
    expect(clampContextMenuPosition(40, 60, 220, 180, 800, 600)).toEqual({ x: 40, y: 60 });
  });

  it("navigates enabled items, activates Enter and closes only the menu on Escape", () => {
    const enabled = [true, false, true, true];

    expect(getContextMenuKeyboardAction("ArrowDown", 0, enabled)).toEqual({ type: "focus", index: 2 });
    expect(getContextMenuKeyboardAction("ArrowDown", 3, enabled)).toEqual({ type: "focus", index: 0 });
    expect(getContextMenuKeyboardAction("ArrowUp", 0, enabled)).toEqual({ type: "focus", index: 3 });
    expect(getContextMenuKeyboardAction("Home", 3, enabled)).toEqual({ type: "focus", index: 0 });
    expect(getContextMenuKeyboardAction("End", 0, enabled)).toEqual({ type: "focus", index: 3 });
    expect(getContextMenuKeyboardAction("Enter", 2, enabled)).toEqual({ type: "activate", index: 2 });
    expect(getContextMenuKeyboardAction("Escape", 2, enabled)).toEqual({ type: "close" });
    expect(getContextMenuKeyboardAction("ArrowDown", -1, [false, false])).toBeNull();
  });

  it("opens and leaves submenus with standard keyboard commands", () => {
    expect(getContextMenuSubmenuKeyboardAction("Enter", true, false)).toBe("open");
    expect(getContextMenuSubmenuKeyboardAction("ArrowRight", true, false)).toBe("open");
    expect(getContextMenuSubmenuKeyboardAction("ArrowLeft", false, true)).toBe("close");
    expect(getContextMenuSubmenuKeyboardAction("Escape", false, true)).toBe("close");
    expect(getContextMenuSubmenuKeyboardAction("ArrowDown", true, false)).toBeNull();
  });

  it("renders nested priority choices as an announced submenu", () => {
    const html = renderToStaticMarkup(
      <ContextMenu onClose={() => {}} open x={0} y={0}>
        <div className="ctx-menu-sub">
          <button aria-haspopup="menu">Priorität</button>
          <div className="ctx-menu-sub-items" role="menu">
            <button>Hoch</button>
            <button>Standard</button>
            <button>Niedrig</button>
          </div>
        </div>
      </ContextMenu>
    );

    expect(html).toContain("aria-haspopup=\"menu\"");
    expect(html.match(/role=\"menu\"/g)).toHaveLength(2);
    expect(html.match(/role=\"menuitem\"/g)).toHaveLength(4);
  });

  it("places submenus inside the viewport on every edge", () => {
    expect(getContextSubmenuPosition(
      { left: 700, right: 790, top: 40 },
      { width: 180, height: 150 },
      { width: 800, height: 600 }
    )).toEqual({ x: 520, y: 40 });
    expect(getContextSubmenuPosition(
      { left: 8, right: 98, top: 40 },
      { width: 180, height: 150 },
      { width: 800, height: 600 }
    )).toEqual({ x: 98, y: 40 });
    expect(getContextSubmenuPosition(
      { left: 500, right: 590, top: 560 },
      { width: 180, height: 150 },
      { width: 800, height: 600 }
    )).toEqual({ x: 590, y: 450 });
  });

  it("keeps submenus hidden until their viewport-safe position is ready", () => {
    expect(contextMenuSource).toContain('position.ready && position.sourceX === x && position.sourceY === y ? "is-positioned" : ""');
    expect(contextMenuSource).toContain('parts.items.classList.add("is-positioned")');
    expect(stylesSource).toMatch(/\.ctx-menu:not\(\.is-positioned\)\s*\{[^}]*visibility:\s*hidden/s);
    expect(stylesSource).not.toMatch(/\.ctx-menu-sub:hover\s+\.ctx-menu-sub-items\s*\{\s*display:\s*block/s);
    expect(stylesSource).toMatch(/\.ctx-menu-sub:hover\s*>\s*\.ctx-menu-sub-items\.is-positioned/s);
    expect(contextMenuSource).toContain('window.addEventListener("pointerdown", onOutside, true)');
  });
});
