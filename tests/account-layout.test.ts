import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workspaceSource = readFileSync(
  new URL("../src/renderer/views/settings/AccountWorkspace.tsx", import.meta.url),
  "utf8"
);
const styles = readFileSync(
  new URL("../src/renderer/views/settings/settings.css", import.meta.url),
  "utf8"
);

describe("account management layout", () => {
  it("keeps both account tabs inside the same fixed content row", () => {
    expect(workspaceSource).toContain('<div className="settings-account-workspace">');
    expect(workspaceSource.match(/className="settings-account-panel"/g)).toHaveLength(2);
    expect(workspaceSource).toContain('hidden={model.activePanel !== "overview"}');
    expect(workspaceSource).toContain('hidden={model.activePanel !== "rules"}');
    expect(styles).toMatch(
      /\.settings-account-workspace\s*{[^}]*grid-template-rows:\s*auto auto minmax\(0, 1fr\);[^}]*min-width:\s*0;[^}]*min-height:\s*0;/s
    );
    expect(styles).toMatch(
      /\.settings-account-panel\s*{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*min-height:\s*0;/s
    );
    expect(styles).toMatch(/\.settings-account-rules\s*{[^}]*min-width:\s*0;[^}]*overflow-y:\s*auto;/s);
  });
});
