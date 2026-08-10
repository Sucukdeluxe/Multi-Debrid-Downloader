import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("development Electron branding", () => {
  it("uses a unique executable for each development launcher", () => {
    const source = readFileSync(path.resolve("scripts/run-dev-electron.ts"), "utf8");

    expect(source).toContain("`${productName}-dev-${process.pid}.exe`");
    expect(source).not.toContain("path.join(path.dirname(source), executableName)");
    expect(source).toContain("process.kill(pid, 0)");
  });

  it.runIf(process.platform === "win32")("prepares a branded development executable", () => {
    const root = mkdtempSync(path.join(tmpdir(), "mdd-dev-electron-"));
    roots.push(root);
    const source = path.resolve("node_modules/electron/dist/electron.exe");
    const target = path.join(root, "Multi-Debrid-Downloader.exe");
    const icon = path.resolve("assets/app_icon.ico");
    const result = spawnSync(
      process.execPath,
      [
        path.resolve("node_modules/tsx/dist/cli.mjs"),
        "scripts/run-dev-electron.ts",
        "--prepare-only",
        source,
        target,
        icon,
        "2.0.17"
      ],
      { cwd: path.resolve("."), encoding: "utf8" }
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
    const metadata = JSON.parse(execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "$v=(Get-Item -LiteralPath $env:MDD_TEST_EXE).VersionInfo; [pscustomobject]@{FileDescription=$v.FileDescription;ProductName=$v.ProductName;OriginalFilename=$v.OriginalFilename;FileVersion=$v.FileVersion;ProductVersion=$v.ProductVersion}|ConvertTo-Json -Compress"
      ],
      { encoding: "utf8", env: { ...process.env, MDD_TEST_EXE: target } }
    ));

    expect(metadata).toEqual({
      FileDescription: "Multi-Debrid-Downloader",
      ProductName: "Multi-Debrid-Downloader",
      OriginalFilename: "Multi-Debrid-Downloader.exe",
      FileVersion: "2.0.17",
      ProductVersion: "2.0.17"
    });
  });

  it("preserves executables owned by active launchers while removing stale ones", () => {
    const root = mkdtempSync(path.join(tmpdir(), "mdd-dev-cleanup-"));
    roots.push(root);
    const owner = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    const activeTarget = path.join(root, `Multi-Debrid-Downloader-dev-${process.pid}.exe`);
    const liveTarget = path.join(root, `Multi-Debrid-Downloader-dev-${owner.pid}.exe`);
    const staleTarget = path.join(root, "Multi-Debrid-Downloader-dev-999999.exe");
    writeFileSync(activeTarget, "active");
    writeFileSync(liveTarget, "live");
    writeFileSync(staleTarget, "stale");
    try {
      const result = spawnSync(process.execPath, [
        path.resolve("node_modules/tsx/dist/cli.mjs"),
        "scripts/run-dev-electron.ts",
        "--cleanup-only",
        root,
        activeTarget
      ], { cwd: path.resolve("."), encoding: "utf8" });

      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(existsSync(activeTarget)).toBe(true);
      expect(existsSync(liveTarget)).toBe(true);
      expect(existsSync(staleTarget)).toBe(false);
    } finally {
      owner.kill();
    }
  });
});
