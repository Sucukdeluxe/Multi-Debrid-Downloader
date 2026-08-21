import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveRuntimeAppVersion } from "../src/main/app-version";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("runtime app version", () => {
  it("uses the version from the installed app package instead of a stale bundled fallback", () => {
    const resourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-version-"));
    tempDirs.push(resourcesPath);
    fs.mkdirSync(path.join(resourcesPath, "app.asar"));
    fs.writeFileSync(path.join(resourcesPath, "app.asar", "package.json"), JSON.stringify({ version: "2.0.51" }), "utf8");

    expect(resolveRuntimeAppVersion("2.0.50", resourcesPath)).toBe("2.0.51");
  });

  it("uses the bundled fallback when no installed package metadata is available", () => {
    const resourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-version-"));
    tempDirs.push(resourcesPath);

    expect(resolveRuntimeAppVersion("2.0.51", resourcesPath)).toBe("2.0.51");
  });
});
