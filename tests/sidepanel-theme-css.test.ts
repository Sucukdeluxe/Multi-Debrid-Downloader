import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const themeCss = readFileSync(new URL("../src/renderer/theme.css", import.meta.url), "utf8");
const settingsCss = readFileSync(new URL("../src/renderer/views/settings/settings.css", import.meta.url), "utf8");
const historyCss = readFileSync(new URL("../src/renderer/views/history/history.css", import.meta.url), "utf8");

describe("sidepanel theme surfaces", () => {
  it("defines the shared panel token used by account and history surfaces", () => {
    expect(themeCss).toMatch(/--ui-panel:\s*var\(--ui-surface\);/);
    expect(settingsCss).toContain("var(--ui-panel)");
    expect(historyCss).toContain("var(--ui-panel)");
  });

  it("removes the standalone settings divider inside the shell sidebar", () => {
    expect(settingsCss).toMatch(/\.md-shell-sidebar-scroll\s*>\s*\.settings-sidebar\s*\{[^}]*border-right:\s*0;/s);
  });
});
