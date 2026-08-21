import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("update process handoff", () => {
  it("starts the verified installer before shutdown and delegates waiting to NSIS", () => {
    const updateSource = fs.readFileSync(new URL("../src/main/update.ts", import.meta.url), "utf8");
    const launchBlock = updateSource.slice(updateSource.indexOf('message: "Starte stille Update-Installation"'), updateSource.indexOf('message: "Update wird im Hintergrund installiert'));

    expect(launchBlock).toContain("childProcess.spawn(targetPath, buildInstallerLaunchArgs()");
    expect(launchBlock).not.toContain("powershell.exe");
    expect(launchBlock).not.toContain("buildDeferredInstallerLaunch");
  });
});
