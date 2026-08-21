import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as storage from "../src/main/storage";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("Multi-Debrid-Downloader product metadata", () => {
  it("uses the canonical public product and repository names while preserving the installer identity", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));
    const verifier = fs.readFileSync(path.resolve("scripts", "verify_public_release.mjs"), "utf8");
    const readme = fs.readFileSync(path.resolve("README.md"), "utf8");
    const supportBundle = fs.readFileSync(path.resolve("src", "main", "support-bundle.ts"), "utf8");

    expect(packageJson.name).toBe("multi-debrid-downloader");
    expect(packageJson.build.productName).toBe("Multi-Debrid-Downloader");
    expect(packageJson.build.appId).toBe("com.sucukdeluxe.realdebrid");
    expect(packageJson.build.publish.repo).toBe("Multi-Debrid-Downloader");
    expect(verifier).toContain('repo: "Multi-Debrid-Downloader"');
    expect(verifier).toContain('EXPECTED_PRODUCT_NAME = "Multi-Debrid-Downloader"');
    expect(readme).toContain("Sucukdeluxe/Multi-Debrid-Downloader/releases/latest");
    expect(readme).toContain("Multi-Debrid-Downloader-Setup-<version>.exe");
    expect(readme).not.toContain("Real-Debrid-Downloader-Setup-");
    expect(supportBundle).toContain("mdd-support-bundle-");
  });

  it("packages an update-safe NSIS process handoff for older app versions", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));
    const installer = fs.readFileSync(path.resolve("resources", "installer.nsh"), "utf8");

    expect(packageJson.build.nsis.include).toBe("resources/installer.nsh");
    expect(installer).toContain("!macro customCheckAppRunning");
    expect(installer).toContain("${isUpdated}");
    expect(installer).toContain("FIND_PROCESS");
    expect(installer).toContain("taskkill /f /im");
    expect(installer).toContain("$R1 >= 300");
    expect(installer).toContain("update_force_wait:");
    expect(installer).toContain("update_force_ready:");
  });

  it("moves the legacy user data directory without losing runtime state", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-user-data-"));
    tempDirs.push(root);
    const legacy = path.join(root, "Real-Debrid-Downloader");
    const target = path.join(root, "Multi-Debrid-Downloader");
    fs.mkdirSync(path.join(legacy, "runtime"), { recursive: true });
    fs.writeFileSync(path.join(legacy, "runtime", "settings.json"), "saved-state", "utf8");

    const migrate = (storage as unknown as Record<string, (rootPath: string) => string>).migrateProductUserDataDirectory;

    expect(typeof migrate).toBe("function");
    expect(migrate(root)).toBe(target);
    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.readFileSync(path.join(target, "runtime", "settings.json"), "utf8")).toBe("saved-state");
  });

  it("keeps using legacy user data when the directory cannot be moved", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-user-data-fallback-"));
    tempDirs.push(root);
    const legacy = path.join(root, "Real-Debrid-Downloader");
    fs.mkdirSync(legacy, { recursive: true });
    const rename = fs.renameSync;
    fs.renameSync = (() => {
      throw Object.assign(new Error("locked"), { code: "EPERM" });
    }) as typeof fs.renameSync;

    try {
      const migrate = (storage as unknown as Record<string, (rootPath: string) => string>).migrateProductUserDataDirectory;
      expect(typeof migrate).toBe("function");
      expect(migrate(root)).toBe(legacy);
    } finally {
      fs.renameSync = rename;
    }
  });
});
