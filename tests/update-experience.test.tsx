import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { runLatestUpdateCheck, shouldApplyUpdateCheckResult } from "../src/renderer/App";
import type { UpdateCheckResult } from "../src/shared/types";
import { AppHeader } from "../src/renderer/shell/AppHeader";
import { getUpdateDialogFocusTarget, UpdateExperience } from "../src/renderer/shell/UpdateExperience";

const callbacks = {
  onOpen: () => {},
  onClose: () => {},
  onInstall: () => {},
  onLater: () => {}
};

describe("update experience", () => {
  it("renders the available update and prompt as one accessible experience", () => {
    const html = renderToStaticMarkup(
      <UpdateExperience
        available
        currentVersion="v2.0.12"
        latestTag="v9.9.9"
        open
        progress={0}
        releaseNotes="Changes"
        state="prompt"
        {...callbacks}
      />
    );

    expect(html).toContain("aria-label=\"Update verfügbar\"");
    expect(html).toContain("role=\"tooltip\"");
    expect(html).toContain("Eine neue Version ist bereit. Klicke hier, um sie zu installieren.");
    expect(html).toContain("role=\"dialog\"");
    expect(html).toContain("aria-modal=\"true\"");
    expect(html).toContain("Update installieren");
    expect(html).toContain("Jetzt aktualisieren");
    expect(html).toContain("Später");
    expect(html).toContain("Changes");
    expect(html).toContain("<details");
  });

  it("keeps the update affordance but removes the dialog when the prompt is closed", () => {
    const html = renderToStaticMarkup(
      <UpdateExperience
        available
        currentVersion="v2.0.12"
        latestTag="v9.9.9"
        open={false}
        progress={0}
        releaseNotes="Changes"
        state="prompt"
        {...callbacks}
      />
    );

    expect(html).toContain("aria-label=\"Update verfügbar\"");
    expect(html).not.toContain("role=\"dialog\"");
  });

  it("renders active progress without controls that could close the installation", () => {
    const html = renderToStaticMarkup(
      <UpdateExperience
        available
        currentVersion="v2.0.12"
        latestTag="v9.9.9"
        open
        progress={{ percent: 47, text: "Update-Download: 47% (47 MB / 100 MB)" }}
        releaseNotes=""
        state="downloading"
        {...callbacks}
      />
    );

    expect(html).toContain("Update-Download: 47% (47 MB / 100 MB)");
    expect(html).toContain("aria-valuenow=\"47\"");
    expect(html).not.toContain("Später");
    expect(html).not.toContain("Jetzt aktualisieren");
    expect(html).not.toContain("aria-label=\"Schließen\"");
  });

  it("preserves the original installation error in the reusable dialog", () => {
    const html = renderToStaticMarkup(
      <UpdateExperience
        available
        currentVersion="v2.0.12"
        latestTag="v9.9.9"
        open
        progress={{ percent: null, text: "Update-Fehler: Originale Prüfsummenmeldung" }}
        releaseNotes=""
        state="error"
        {...callbacks}
      />
    );

    expect(html).toContain("Update-Fehler: Originale Prüfsummenmeldung");
    expect(html).toContain("aria-label=\"Schließen\"");
  });

  it("renders nothing when no update is available and no dialog is active", () => {
    const html = renderToStaticMarkup(
      <UpdateExperience
        available={false}
        currentVersion="v2.0.12"
        latestTag=""
        open={false}
        progress={0}
        releaseNotes=""
        state="prompt"
        {...callbacks}
      />
    );

    expect(html).toBe("");
  });

  it("places the update affordance in the accessible global header action group", () => {
    const html = renderToStaticMarkup(
      <AppHeader
        activeView="downloads"
        actions={(
          <UpdateExperience
            available
            currentVersion="v2.0.12"
            latestTag="v9.9.9"
            open={false}
            progress={0}
            releaseNotes=""
            state="prompt"
            {...callbacks}
          />
        )}
        onViewChange={() => {}}
      />
    );

    expect(html).toContain("role=\"group\"");
    expect(html).toContain("aria-label=\"Globale Aktionen\"");
    expect(html).toContain("aria-label=\"Update verfügbar\"");
  });

  it("uses the specified transient and modal elevation tokens", () => {
    const css = readFileSync(new URL("../src/renderer/shell/shell.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.md-update-tooltip\s*\{[^}]*box-shadow:\s*0 4px 12px rgb\(0 0 0 \/ 35%\)/s);
    expect(css).toMatch(/\.md-update-dialog\s*\{[^}]*box-shadow:\s*0 12px 40px rgb\(0 0 0 \/ 45%\)/s);
  });

  it("keeps forward and reverse tabbing inside the update dialog", () => {
    expect(getUpdateDialogFocusTarget(false, -1, 4)).toBe(0);
    expect(getUpdateDialogFocusTarget(true, -1, 4)).toBe(3);
    expect(getUpdateDialogFocusTarget(false, 3, 4)).toBe(0);
    expect(getUpdateDialogFocusTarget(true, 0, 4)).toBe(3);
    expect(getUpdateDialogFocusTarget(false, 1, 4)).toBeNull();
    expect(getUpdateDialogFocusTarget(false, -1, 0)).toBeNull();
  });

  it("rejects stale update-check completions without discarding the latest state", () => {
    expect(shouldApplyUpdateCheckResult(4, 4)).toBe(true);
    expect(shouldApplyUpdateCheckResult(3, 4)).toBe(false);
    expect(shouldApplyUpdateCheckResult(4, 5)).toBe(false);
  });

  it("applies only the latest result when update checks complete out of order", async () => {
    const generation = { current: 0 };
    const applied: string[] = [];
    let finishStartup: ((result: UpdateCheckResult) => void) | undefined;
    let finishManual: ((result: UpdateCheckResult) => void) | undefined;
    const startup = new Promise<UpdateCheckResult>((resolve) => { finishStartup = resolve; });
    const manual = new Promise<UpdateCheckResult>((resolve) => { finishManual = resolve; });
    const apply = (result: UpdateCheckResult): void => { applied.push(result.latestTag); };

    const startupRun = runLatestUpdateCheck(generation, () => startup, apply);
    const manualRun = runLatestUpdateCheck(generation, () => manual, apply);
    finishManual?.({ updateAvailable: true, currentVersion: "2.0.12", latestVersion: "9.9.9", latestTag: "v9.9.9", releaseUrl: "https://example.test/v9.9.9" });
    await manualRun;
    finishStartup?.({ updateAvailable: false, currentVersion: "2.0.12", latestVersion: "2.0.12", latestTag: "v2.0.12", releaseUrl: "https://example.test/v2.0.12" });
    await startupRun;

    expect(applied).toEqual(["v9.9.9"]);
  });
});
