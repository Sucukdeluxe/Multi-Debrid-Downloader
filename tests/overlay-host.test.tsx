import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OverlayHost } from "../src/renderer/shell/OverlayHost";
import { UpdateExperience } from "../src/renderer/shell/UpdateExperience";

describe("OverlayHost", () => {
  it("renders every desktop overlay slot exactly once", () => {
    const slots = {
      confirm: <span>confirm-slot</span>,
      backupPassphrase: <span>backup-passphrase-slot</span>,
      onlineBackup: <span>backup-slot</span>,
      diagnostics: <span>diagnostics-slot</span>,
      deleteConfirmation: <span>delete-slot</span>,
      conflict: <span>conflict-slot</span>,
      accountCreate: <span>account-create-slot</span>,
      accountEdit: <span>account-edit-slot</span>,
      keyStats: <span>key-stats-slot</span>,
      linkPopup: <span>link-popup-slot</span>,
      update: <span>update-slot</span>,
      toast: <span>toast-slot</span>,
      accountContextMenu: <span>account-menu-slot</span>,
      downloadContextMenu: <span>download-menu-slot</span>,
      columnContextMenu: <span>column-menu-slot</span>,
      historyContextMenu: <span>history-menu-slot</span>,
      dropOverlay: <span>drop-slot</span>
    };
    const html = renderToStaticMarkup(<OverlayHost {...slots} />);

    expect(html).toContain("id=\"md-overlay-host\"");
    for (const value of Object.values(slots)) {
      const label = String(value.props.children);
      expect(html.split(label)).toHaveLength(2);
    }
  });

  it("does not render placeholders for empty slots", () => {
    const html = renderToStaticMarkup(<OverlayHost toast={<span>sichtbar</span>} />);

    expect(html).toContain("sichtbar");
    expect(html).not.toContain("data-overlay-slot");
  });

  it("hosts the update surface through the shared dialog without duplicating the trigger", () => {
    const html = renderToStaticMarkup(
      <OverlayHost
        update={(
          <UpdateExperience
            available
            currentVersion="v2.0.12"
            latestTag="v9.9.9"
            onClose={() => {}}
            onInstall={() => {}}
            onLater={() => {}}
            onOpen={() => {}}
            open
            progress={0}
            releaseNotes="Changes"
            renderTrigger={false}
            state="prompt"
          />
        )}
      />
    );

    expect(html).toContain("md-dialog-size-update");
    expect(html).not.toContain("aria-label=\"Update verfügbar\"");
    expect(html.match(/role=\"dialog\"/g)).toHaveLength(1);
  });

  it("defines a stacking-context-safe menu, tooltip, toast and modal layer order", () => {
    const css = readFileSync(new URL("../src/renderer/shell/shell.css", import.meta.url), "utf8");

    expect(css).toMatch(/--md-layer-menu:\s*600/);
    expect(css).toMatch(/--md-layer-tooltip:\s*700/);
    expect(css).toMatch(/--md-layer-toast:\s*800/);
    expect(css).toMatch(/--md-layer-modal:\s*1000/);
    expect(css).toMatch(/\.md-context-menu\s*\{[^}]*z-index:\s*var\(--md-layer-menu\)/s);
    expect(css).toMatch(/\.md-update-tooltip\s*\{[^}]*z-index:\s*var\(--md-layer-tooltip\)/s);
    expect(css).toMatch(/\.md-toast\s*\{[^}]*z-index:\s*var\(--md-layer-toast\)/s);
    expect(css).toMatch(/\.md-dialog-backdrop\s*\{[^}]*z-index:\s*var\(--md-layer-modal\)/s);
    expect(css).toMatch(/\.md-drop-overlay\s*\{[^}]*pointer-events:\s*none/s);
    expect(css).toMatch(/\.md-overlay-host \.md-dialog-backdrop\s*\{[^}]*z-index:\s*var\(--md-layer-modal\)/s);
    expect(css).toMatch(/\.md-overlay-host \.md-context-menu\s*\{[^}]*z-index:\s*var\(--md-layer-menu\)/s);
    expect(css).toMatch(/\.md-overlay-host \.md-toast\s*\{[^}]*z-index:\s*var\(--md-layer-toast\)/s);
    expect(css).toMatch(/\.md-overlay-host \.md-dialog\s*\{[^}]*background:\s*var\(--ui-surface\)/s);
  });
});
