import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PackageOutputScope } from "../src/main/package-output-scope";

const tempDirs: string[] = [];

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-output-scope-"));
  tempDirs.push(root);
  return root;
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("PackageOutputScope", () => {
  it("normalizes and deduplicates complete Windows paths case-insensitively", () => {
    const root = createRoot();
    const outputPath = path.join(root, "Season", "Episode.mkv");
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, "video");
    const scope = new PackageOutputScope([root]);

    scope.add({
      version: 1,
      archivePath: path.join(root, "archive-a.rar"),
      entryPath: "Season/Episode.mkv",
      outputPath,
      state: "complete",
      disposition: "written"
    });
    scope.add({
      version: 1,
      archivePath: path.join(root, "archive-b.rar"),
      entryPath: "season/episode.mkv",
      outputPath: outputPath.toUpperCase(),
      state: "complete",
      disposition: "overwritten"
    });

    expect(scope.completeFiles()).toEqual([path.resolve(outputPath)]);
    expect(scope.partialFiles()).toEqual([]);
    expect(scope.records()).toHaveLength(1);
  });

  it.each([
    "../foreign.mkv",
    "folder/../../foreign.mkv",
    "/absolute.mkv",
    "C:\\absolute.mkv",
    "file.mkv:stream",
    "CON",
    "aux.txt",
    "folder/LPT1.mkv",
    "name.",
    "name "
  ])("rejects unsafe archive entry path %s", (entryPath) => {
    const root = createRoot();
    const outputPath = path.join(root, "safe.mkv");
    fs.writeFileSync(outputPath, "video");
    const scope = new PackageOutputScope([root]);

    expect(() => scope.add({
      version: 1,
      archivePath: path.join(root, "archive.rar"),
      entryPath,
      outputPath,
      state: "complete",
      disposition: "written"
    })).toThrow(/Ausgabepfad|entry/i);
  });

  it("rejects outputs outside authorized roots and unknown event versions", () => {
    const root = createRoot();
    const foreignRoot = createRoot();
    const foreignPath = path.join(foreignRoot, "foreign.mkv");
    fs.writeFileSync(foreignPath, "foreign");
    const scope = new PackageOutputScope([root]);
    const event = {
      version: 1 as const,
      archivePath: path.join(root, "archive.rar"),
      entryPath: "foreign.mkv",
      outputPath: foreignPath,
      state: "complete" as const,
      disposition: "written" as const
    };

    expect(() => scope.add(event)).toThrow(/autorisiert/i);
    expect(() => scope.add({ ...event, outputPath: path.join(root, "safe.mkv"), version: 2 as 1 })).toThrow(/Version/i);
  });

  it("rejects symlinked parent chains and keeps complete and partial outputs separate", () => {
    const root = createRoot();
    const foreignRoot = createRoot();
    const completePath = path.join(root, "complete.mkv");
    const partialPath = path.join(root, "partial.mkv");
    fs.writeFileSync(completePath, "complete");
    fs.writeFileSync(partialPath, "partial");
    const scope = new PackageOutputScope([root]);

    scope.add({
      version: 1,
      archivePath: path.join(root, "archive.rar"),
      entryPath: "complete.mkv",
      outputPath: completePath,
      state: "complete",
      disposition: "written"
    });
    scope.add({
      version: 1,
      archivePath: path.join(root, "archive.rar"),
      entryPath: "partial.mkv",
      outputPath: partialPath,
      state: "partial",
      disposition: "written"
    });

    expect(scope.completeFiles()).toEqual([path.resolve(completePath)]);
    expect(scope.partialFiles()).toEqual([path.resolve(partialPath)]);

    const link = path.join(root, "linked");
    try {
      fs.symlinkSync(foreignRoot, link, "junction");
    } catch {
      return;
    }
    const linkedOutput = path.join(link, "linked.mkv");
    fs.writeFileSync(path.join(foreignRoot, "linked.mkv"), "foreign");
    expect(() => scope.add({
      version: 1,
      archivePath: path.join(root, "archive.rar"),
      entryPath: "linked/linked.mkv",
      outputPath: linkedOutput,
      state: "complete",
      disposition: "written"
    })).toThrow(/symbol|reparse/i);
  });

  it("updates ownership after rename and removal without enumerating the root", () => {
    const root = createRoot();
    const sourcePath = path.join(root, "source.mkv");
    const targetPath = path.join(root, "renamed.mkv");
    fs.writeFileSync(sourcePath, "video");
    const scope = new PackageOutputScope([root]);
    scope.add({
      version: 1,
      archivePath: path.join(root, "archive.rar"),
      entryPath: "source.mkv",
      outputPath: sourcePath,
      state: "complete",
      disposition: "written"
    });
    fs.renameSync(sourcePath, targetPath);

    scope.replacePath(sourcePath, targetPath);
    expect(scope.completeFiles()).toEqual([path.resolve(targetPath)]);
    expect(scope.removePath(targetPath)).toBe(true);
    expect(scope.completeFiles()).toEqual([]);
  });

  it("validates opened targets before creation and removes discarded partial ownership", () => {
    const root = createRoot();
    const outputPath = path.join(root, "episode.mkv");
    const scope = new PackageOutputScope([root]);
    const opened = {
      version: 1 as const,
      archivePath: path.join(root, "archive.rar"),
      entryPath: "episode.mkv",
      outputPath,
      state: "opened" as const,
      disposition: "written" as const
    };

    expect(scope.add(opened)).toBe(false);
    expect(scope.records()).toEqual([]);
    fs.writeFileSync(outputPath, "partial");
    scope.add({ ...opened, state: "partial" });
    expect(scope.partialFiles()).toEqual([outputPath]);
    fs.rmSync(outputPath, { force: true });
    expect(scope.add({ ...opened, state: "removed" })).toBe(true);
    expect(scope.records()).toEqual([]);
  });
});
