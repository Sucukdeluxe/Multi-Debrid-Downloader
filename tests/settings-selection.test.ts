import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");

describe("settings text selection", () => {
  it("blocks selection across the active settings view and its dialogs while preserving editable fields", () => {
    expect(appSource).toContain('${tab === "settings" ? " settings-active" : ""}');
    expect(styles).toMatch(/\.app-shell\.settings-active\s*{[^}]*user-select:\s*none;/s);
    expect(styles).toMatch(/\.app-shell\.settings-active input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="range"\]\),\s*\.app-shell\.settings-active textarea,\s*\.app-shell\.settings-active \[contenteditable\]:not\(\[contenteditable="false"\]\)\s*{[^}]*user-select:\s*text;/s);
  });
});
