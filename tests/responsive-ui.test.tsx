import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorBoundary } from "../src/renderer/error-boundary";
import { AppShell } from "../src/renderer/shell/AppShell";
import * as focusModule from "../src/renderer/ui/focus";
import * as shellModel from "../src/renderer/shell/shell-model";

describe("responsive shell mode", () => {
  it("selects full, compact and minimum modes at every boundary", () => {
    const getResponsiveShellMode = (shellModel as unknown as {
      getResponsiveShellMode?: (width: number) => "full" | "compact" | "minimum";
    }).getResponsiveShellMode;

    expect(getResponsiveShellMode).toBeTypeOf("function");
    expect([
      getResponsiveShellMode!(2560),
      getResponsiveShellMode!(1920),
      getResponsiveShellMode!(1367),
      getResponsiveShellMode!(1366),
      getResponsiveShellMode!(1121),
      getResponsiveShellMode!(1120)
    ]).toEqual(["full", "full", "full", "compact", "compact", "minimum"]);
  });

  it("wires the derived mode into stable shell markup and responsive CSS", () => {
    const html = renderToStaticMarkup(
      <AppShell
        activeView="downloads"
        contextInfo={null}
        footer={null}
        headerActions={null}
        onSidebarCollapsedChange={() => {}}
        onViewChange={() => {}}
        sidebar={<div>Filter</div>}
        sidebarCollapsed={false}
        sidebarStatus={null}
        toolbar={null}
      >
        <div>Downloads</div>
      </AppShell>
    );
    const css = readFileSync(new URL("../src/renderer/shell/shell.css", import.meta.url), "utf8");

    expect(html).toContain('data-responsive-mode="full"');
    expect(html).toContain("md-shell is-full");
    expect(css).toContain(".md-shell.is-compact");
    expect(css).toContain(".md-shell.is-minimum");
    expect(css).toMatch(/grid-template-columns:\s*56px minmax\(0,\s*1fr\)/);
  });

  it("keeps responsive rail content hidden behind a visible expand control", () => {
    const shellSource = readFileSync(new URL("../src/renderer/shell/AppShell.tsx", import.meta.url), "utf8");
    const sidebarSource = readFileSync(new URL("../src/renderer/shell/AppSidebar.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../src/renderer/shell/shell.css", import.meta.url), "utf8");

    expect(shellSource).toContain("responsiveRail={responsiveSidebarCollapsed}");
    expect(sidebarSource).toContain('is-responsive-rail');
    expect(css).toMatch(/\.md-shell-sidebar\.is-responsive-rail \.md-shell-sidebar-toggle\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px;[^}]*opacity:\s*1;/s);
    expect(css).not.toMatch(/\.md-shell-sidebar\.is-responsive-rail \.md-shell-sidebar-scroll\s*\{[^}]*visibility:\s*visible;/s);
  });
});

describe("focus restoration", () => {
  it("restores the preferred connected target after the closing render", () => {
    const restoreFocus = (focusModule as unknown as {
      restoreFocus?: (
        preferredTarget: HTMLElement | null,
        fallbackTarget: HTMLElement | null,
        schedule: (callback: () => void) => void
      ) => void;
    }).restoreFocus;
    let scheduled: (() => void) | null = null;
    let preferredFocusCount = 0;
    let fallbackFocusCount = 0;
    const preferredTarget = {
      isConnected: true,
      focus: () => {
        preferredFocusCount += 1;
      }
    } as HTMLElement;
    const fallbackTarget = {
      isConnected: true,
      focus: () => {
        fallbackFocusCount += 1;
      }
    } as HTMLElement;

    expect(restoreFocus).toBeTypeOf("function");
    restoreFocus!(preferredTarget, fallbackTarget, (callback) => {
      scheduled = callback;
    });

    expect(preferredFocusCount).toBe(0);
    expect(fallbackFocusCount).toBe(0);
    (scheduled as (() => void) | null)?.();
    expect(preferredFocusCount).toBe(1);
    expect(fallbackFocusCount).toBe(0);
  });

  it("uses only a connected fallback when the preferred target was removed", () => {
    const restoreFocus = (focusModule as unknown as {
      restoreFocus?: (
        preferredTarget: HTMLElement | null,
        fallbackTarget: HTMLElement | null,
        schedule: (callback: () => void) => void
      ) => void;
    }).restoreFocus;
    let scheduled: (() => void) | null = null;
    let preferredConnected = true;
    let preferredFocusCount = 0;
    let fallbackFocusCount = 0;
    const preferredTarget = {
      get isConnected() {
        return preferredConnected;
      },
      focus: () => {
        preferredFocusCount += 1;
      }
    } as HTMLElement;
    const fallbackTarget = {
      isConnected: true,
      focus: () => {
        fallbackFocusCount += 1;
      }
    } as HTMLElement;

    restoreFocus!(preferredTarget, fallbackTarget, (callback) => {
      scheduled = callback;
    });
    preferredConnected = false;
    (scheduled as (() => void) | null)?.();

    expect(preferredFocusCount).toBe(0);
    expect(fallbackFocusCount).toBe(1);

    restoreFocus!(null, { ...fallbackTarget, isConnected: false } as HTMLElement, (callback) => callback());
    expect(fallbackFocusCount).toBe(1);
  });

  it("is consumed by dialogs, context menus and the avatar menu", () => {
    const consumers = [
      ["../src/renderer/ui/Dialog.tsx", 'from "./focus"'],
      ["../src/renderer/ui/ContextMenu.tsx", 'from "./focus"'],
      ["../src/renderer/shell/AvatarMenu.tsx", 'from "../ui/focus"']
    ] as const;

    for (const [path, importPath] of consumers) {
      const source = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(source).toContain("restoreFocus");
      expect(source).toContain(importPath);
      expect(source).toMatch(/restoreFocus\(/);
    }
  });
});

describe("renderer error boundary", () => {
  it("renders a tokenized accessible recovery surface", () => {
    const boundary = new ErrorBoundary({ children: "content" });
    boundary.state = { hasError: true, message: "Render failure" };

    const html = renderToStaticMarkup(boundary.render());

    expect(html).toContain('class="ui-error-boundary"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-labelledby="renderer-error-title"');
    expect(html).toContain('aria-describedby="renderer-error-description renderer-error-details"');
    expect(html).toContain('id="renderer-error-title"');
    expect(html).toContain('id="renderer-error-description"');
    expect(html).toContain('id="renderer-error-details"');
    expect(html).toContain("Render failure");
    expect(html).toContain("Oberfläche neu laden");
    expect(html).not.toContain("style=");
  });
});
