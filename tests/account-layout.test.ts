import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

describe("account management layout", () => {
  it("keeps both account tabs inside the same fixed content row", () => {
    expect(appSource).toContain('<div className="account-settings-layout">');
    expect(appSource).not.toContain("account-settings-layout ${accountManagementTab}");
    expect(appSource).toContain('<div className="account-rules-panel" hidden={accountManagementTab !== "rules"}>');
    expect(styles).not.toMatch(/\.account-settings-layout\.rules\s*{/);
    expect(styles).toMatch(/\.account-rules-panel\s*{[^}]*min-width:\s*0;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
  });
});
