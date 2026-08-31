import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultSettings } from "../src/main/constants";
import { ensureStartupWorkDirectories } from "../src/main/startup-work-directories";

const tempDirs: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-startup-dirs-"));
  tempDirs.push(root);
  return root;
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("startup work directories", () => {
  it("does nothing while the setting is disabled", () => {
    const root = tempRoot();
    const outputDir = path.join(root, "downloads");
    const result = ensureStartupWorkDirectories({
      ...defaultSettings(),
      outputDir,
      createWorkDirectoriesOnStartup: false
    });

    expect(result).toEqual({ created: [], existing: [], failures: [] });
    expect(fs.existsSync(outputDir)).toBe(false);
  });

  it("creates only the enabled work directories and preserves existing contents", () => {
    const root = tempRoot();
    const outputDir = path.join(root, "downloads");
    const extractDir = path.join(root, "extracted");
    const mkvLibraryDir = path.join(root, "videos");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, "keep.bin"), "keep");

    const result = ensureStartupWorkDirectories({
      ...defaultSettings(),
      outputDir,
      extractDir,
      mkvLibraryDir,
      autoExtract: true,
      collectMkvToLibrary: true,
      createWorkDirectoriesOnStartup: true
    });

    expect(result.created.map((entry) => entry.kind)).toEqual(["extract", "video-library"]);
    expect(result.existing.map((entry) => entry.kind)).toEqual(["download"]);
    expect(result.failures).toEqual([]);
    expect(fs.readFileSync(path.join(outputDir, "keep.bin"), "utf8")).toBe("keep");
    expect(fs.statSync(extractDir).isDirectory()).toBe(true);
    expect(fs.statSync(mkvLibraryDir).isDirectory()).toBe(true);
  });

  it("skips inactive optional directories", () => {
    const root = tempRoot();
    const outputDir = path.join(root, "downloads");
    const extractDir = path.join(root, "extracted");
    const mkvLibraryDir = path.join(root, "videos");

    const result = ensureStartupWorkDirectories({
      ...defaultSettings(),
      outputDir,
      extractDir,
      mkvLibraryDir,
      autoExtract: false,
      collectMkvToLibrary: false,
      createWorkDirectoriesOnStartup: true
    });

    expect(result.created.map((entry) => entry.kind)).toEqual(["download"]);
    expect(fs.existsSync(extractDir)).toBe(false);
    expect(fs.existsSync(mkvLibraryDir)).toBe(false);
  });

  it("reports one invalid target without blocking the other directories", () => {
    const root = tempRoot();
    const blockedOutput = path.join(root, "blocked");
    const extractDir = path.join(root, "extracted");
    fs.writeFileSync(blockedOutput, "file");

    const result = ensureStartupWorkDirectories({
      ...defaultSettings(),
      outputDir: blockedOutput,
      extractDir,
      autoExtract: true,
      createWorkDirectoriesOnStartup: true
    });

    expect(result.failures.map((entry) => entry.kind)).toEqual(["download"]);
    expect(result.created.map((entry) => entry.kind)).toEqual(["extract"]);
    expect(fs.statSync(extractDir).isDirectory()).toBe(true);
  });
});
