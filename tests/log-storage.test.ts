import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DESKTOP_LOG_DIRECTORY_NAME,
  LEGACY_DESKTOP_LOG_DIRECTORY_NAME,
  migrateLogDirectories,
  prepareLogDirectory,
  resolveLogDirectory
} from "../src/main/log-storage";
import { defaultSettings } from "../src/main/constants";
import { normalizeSettings } from "../src/main/storage";

const createdDirectories: string[] = [];

function createTempDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-log-storage-"));
  createdDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of createdDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  createdDirectories.length = 0;
});

describe("log-storage", () => {
  it("uses the runtime directory by default and the named desktop directory on request", () => {
    const runtimeDirectory = path.join(createTempDirectory(), "runtime");
    const desktopDirectory = path.join(createTempDirectory(), "Desktop");

    expect(resolveLogDirectory(runtimeDirectory, desktopDirectory, "appdata")).toBe(runtimeDirectory);
    expect(resolveLogDirectory(runtimeDirectory, desktopDirectory, "desktop")).toBe(
      path.join(desktopDirectory, DESKTOP_LOG_DIRECTORY_NAME)
    );
    expect(resolveLogDirectory(runtimeDirectory, null, "desktop")).toBe(runtimeDirectory);
    expect(defaultSettings().logStorageLocation).toBe("appdata");
    expect(normalizeSettings({ ...defaultSettings(), logStorageLocation: "invalid" as "appdata" }).logStorageLocation).toBe("appdata");
  });

  it("creates the selected directory and carries only log files and log folders", () => {
    const source = path.join(createTempDirectory(), "source");
    const target = path.join(createTempDirectory(), "target");
    fs.mkdirSync(path.join(source, "session-logs"), { recursive: true });
    fs.mkdirSync(path.join(source, "package-logs"), { recursive: true });
    fs.writeFileSync(path.join(source, "rd_downloader.log"), "main\n", "utf8");
    fs.writeFileSync(path.join(source, "session-logs", "session_1.txt"), "session\n", "utf8");
    fs.writeFileSync(path.join(source, "package-logs", "package_1.txt"), "package\n", "utf8");
    fs.writeFileSync(path.join(source, "settings.json"), "secret\n", "utf8");

    expect(prepareLogDirectory(target)).toBe(true);
    const result = migrateLogDirectories([source], target);

    expect(result.copiedFiles).toBe(3);
    expect(fs.readFileSync(path.join(target, "rd_downloader.log"), "utf8")).toBe("main\n");
    expect(fs.readFileSync(path.join(target, "session-logs", "session_1.txt"), "utf8")).toBe("session\n");
    expect(fs.readFileSync(path.join(target, "package-logs", "package_1.txt"), "utf8")).toBe("package\n");
    expect(fs.existsSync(path.join(target, "settings.json"))).toBe(false);
  });

  it("merges a legacy hyphenated desktop folder without exposing unrelated files", () => {
    const root = createTempDirectory();
    const legacy = path.join(root, LEGACY_DESKTOP_LOG_DIRECTORY_NAME);
    const target = path.join(root, DESKTOP_LOG_DIRECTORY_NAME);
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, "rename-session_1.txt"), "rename\n", "utf8");
    fs.writeFileSync(path.join(legacy, "credentials.json"), "secret\n", "utf8");

    const result = migrateLogDirectories([legacy], target);

    expect(result.copiedFiles).toBe(1);
    expect(fs.readFileSync(path.join(target, "rename-session_1.txt"), "utf8")).toBe("rename\n");
    expect(fs.existsSync(path.join(target, "credentials.json"))).toBe(false);
  });

  it("replaces trace configuration instead of concatenating JSON from an older location", () => {
    const source = path.join(createTempDirectory(), "source");
    const target = path.join(createTempDirectory(), "target");
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(source, "trace_config.json"), JSON.stringify({ enabled: true, expiresAt: 123 }), "utf8");
    fs.writeFileSync(path.join(target, "trace_config.json"), JSON.stringify({ enabled: false, expiresAt: 456 }), "utf8");

    const result = migrateLogDirectories([source], target);

    expect(result.copiedFiles).toBe(1);
    expect(JSON.parse(fs.readFileSync(path.join(target, "trace_config.json"), "utf8"))).toEqual({ enabled: true, expiresAt: 123 });
  });
});
