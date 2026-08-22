import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import AdmZip from "adm-zip";
import { afterEach, describe, expect, it } from "vitest";
import { extractPackageArchives } from "../src/main/extractor";

const tempDirs: string[] = [];
const originalBackend = process.env.RD_EXTRACT_BACKEND;

function hasJavaRuntime(): boolean {
  const result = spawnSync("java", ["-version"], { stdio: "ignore" });
  return result.status === 0;
}

function hasJvmExtractorRuntime(): boolean {
  const root = path.join(process.cwd(), "resources", "extractor-jvm");
  const classesMain = path.join(root, "classes", "com", "sucukdeluxe", "extractor", "JBindExtractorMain.class");
  const requiredLibs = [
    path.join(root, "lib", "sevenzipjbinding.jar"),
    path.join(root, "lib", "sevenzipjbinding-all-platforms.jar"),
    path.join(root, "lib", "zip4j.jar")
  ];
  return fs.existsSync(classesMain) && requiredLibs.every((libPath) => fs.existsSync(libPath));
}

function corruptFirstZipPayload(zipPath: string): void {
  const bytes = fs.readFileSync(zipPath);
  const signature = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if (signature < 0) {
    throw new Error("local ZIP header missing");
  }
  const compressedSize = bytes.readUInt32LE(signature + 18);
  const nameLength = bytes.readUInt16LE(signature + 26);
  const extraLength = bytes.readUInt16LE(signature + 28);
  const dataOffset = signature + 30 + nameLength + extraLength;
  if (compressedSize < 2 || dataOffset + compressedSize > bytes.length) {
    throw new Error("ZIP payload missing");
  }
  bytes[dataOffset + Math.floor(compressedSize / 2)] ^= 0xff;
  fs.writeFileSync(zipPath, bytes);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (originalBackend === undefined) {
    delete process.env.RD_EXTRACT_BACKEND;
  } else {
    process.env.RD_EXTRACT_BACKEND = originalBackend;
  }
});

describe.skipIf(!hasJavaRuntime() || !hasJvmExtractorRuntime())("extractor jvm backend", () => {
  it("extracts zip archives through SevenZipJBinding backend", async () => {
    process.env.RD_EXTRACT_BACKEND = "jvm";

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-jvm-extract-"));
    tempDirs.push(root);
    const packageDir = path.join(root, "pkg");
    const targetDir = path.join(root, "out");
    fs.mkdirSync(packageDir, { recursive: true });

    const zipPath = path.join(packageDir, "release.zip");
    const zip = new AdmZip();
    zip.addFile("episode.txt", Buffer.from("ok"));
    zip.writeZip(zipPath);
    const events: import("../src/main/extractor").ExtractOutputEvent[] = [];

    const result = await extractPackageArchives({
      packageDir,
      targetDir,
      cleanupMode: "none",
      conflictMode: "overwrite",
      removeLinks: false,
      removeSamples: false,
      onOutput: (event) => events.push(event)
    });

    expect(result.extracted).toBe(1);
    expect(result.failed).toBe(0);
    expect(fs.existsSync(path.join(targetDir, "episode.txt"))).toBe(true);
    expect(events).toEqual([
      expect.objectContaining({
        version: 1,
        archivePath: path.resolve(zipPath),
        entryPath: "episode.txt",
        outputPath: path.join(targetDir, "episode.txt"),
        state: "opened",
        disposition: "written"
      }),
      expect.objectContaining({
        version: 1,
        archivePath: path.resolve(zipPath),
        entryPath: "episode.txt",
        outputPath: path.join(targetDir, "episode.txt"),
        state: "complete",
        disposition: "written"
      })
    ]);
    expect(result.outputFiles).toEqual([path.join(targetDir, "episode.txt")]);
  });

  it.each(["7zjbinding", "zip4j"])("emits versioned Base64 output lines from %s", (backend) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `rd-jvm-output-${backend}-`));
    tempDirs.push(root);
    const targetDir = path.join(root, "out");
    const zipPath = path.join(root, "release.zip");
    const zip = new AdmZip();
    zip.addFile("folder/episode.txt", Buffer.from("ok"));
    zip.writeZip(zipPath);
    const runtimeRoot = path.join(process.cwd(), "resources", "extractor-jvm");
    const classPath = [
      path.join(runtimeRoot, "classes"),
      path.join(runtimeRoot, "lib", "sevenzipjbinding.jar"),
      path.join(runtimeRoot, "lib", "sevenzipjbinding-all-platforms.jar"),
      path.join(runtimeRoot, "lib", "zip4j.jar")
    ].join(path.delimiter);

    const run = spawnSync("java", [
      "-cp",
      classPath,
      "com.sucukdeluxe.extractor.JBindExtractorMain",
      "--archive",
      zipPath,
      "--target",
      targetDir,
      "--conflict",
      "overwrite",
      "--backend",
      backend
    ], { encoding: "utf8" });

    expect(run.status).toBe(0);
    const outputLines = String(run.stdout).split(/\r?\n/).filter((line) => line.startsWith("RD_OUTPUT "));
    expect(outputLines.map((line) => line.split(" ")[2])).toEqual(["opened", "complete"]);
    const fields = outputLines[1].split(" ");
    expect(fields.slice(0, 5)).toEqual(["RD_OUTPUT", "1", "complete", "written", fields[4]]);
    expect(Buffer.from(fields[4], "base64").toString("utf8")).toBe(path.resolve(zipPath));
    expect(Buffer.from(fields[5], "base64").toString("utf8")).toBe("folder/episode.txt");
    expect(Buffer.from(fields[6], "base64").toString("utf8")).toBe(path.join(targetDir, "folder", "episode.txt"));
  });

  it.each(["7zjbinding", "zip4j"])("rejects %s output behind a junction before opening it", (backend) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `rd-jvm-junction-${backend}-`));
    tempDirs.push(root);
    const targetDir = path.join(root, "out");
    const realDir = path.join(targetDir, "real");
    const linkedDir = path.join(targetDir, "linked");
    fs.mkdirSync(realDir, { recursive: true });
    try {
      fs.symlinkSync(realDir, linkedDir, process.platform === "win32" ? "junction" : "dir");
    } catch {
      return;
    }
    const protectedPath = path.join(realDir, "protected.txt");
    fs.writeFileSync(protectedPath, "foreign");
    const zipPath = path.join(root, "release.zip");
    const zip = new AdmZip();
    zip.addFile("linked/protected.txt", Buffer.from("package"));
    zip.writeZip(zipPath);
    const runtimeRoot = path.join(process.cwd(), "resources", "extractor-jvm");
    const classPath = [
      path.join(runtimeRoot, "classes"),
      path.join(runtimeRoot, "lib", "sevenzipjbinding.jar"),
      path.join(runtimeRoot, "lib", "sevenzipjbinding-all-platforms.jar"),
      path.join(runtimeRoot, "lib", "zip4j.jar")
    ].join(path.delimiter);

    const run = spawnSync("java", [
      "-cp",
      classPath,
      "com.sucukdeluxe.extractor.JBindExtractorMain",
      "--archive",
      zipPath,
      "--target",
      targetDir,
      "--conflict",
      "overwrite",
      "--backend",
      backend
    ], { encoding: "utf8" });

    expect(run.status).not.toBe(0);
    expect(fs.readFileSync(protectedPath, "utf8")).toBe("foreign");
  });

  it("turns JVM output callback failures into a controlled archive failure and keeps the next request usable", async () => {
    process.env.RD_EXTRACT_BACKEND = "jvm";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-jvm-callback-"));
    tempDirs.push(root);
    const firstPackage = path.join(root, "first-pkg");
    const secondPackage = path.join(root, "second-pkg");
    fs.mkdirSync(firstPackage, { recursive: true });
    fs.mkdirSync(secondPackage, { recursive: true });
    const firstZip = new AdmZip();
    firstZip.addFile("first.txt", Buffer.from("first"));
    firstZip.writeZip(path.join(firstPackage, "first.zip"));
    const secondZip = new AdmZip();
    secondZip.addFile("second.txt", Buffer.from("second"));
    secondZip.writeZip(path.join(secondPackage, "second.zip"));

    const first = await extractPackageArchives({
      packageDir: firstPackage,
      targetDir: path.join(root, "first-out"),
      cleanupMode: "none",
      conflictMode: "overwrite",
      removeLinks: false,
      removeSamples: false,
      onOutput: () => {
        throw new Error("jvm-output-callback-failed");
      }
    });
    const second = await extractPackageArchives({
      packageDir: secondPackage,
      targetDir: path.join(root, "second-out"),
      cleanupMode: "none",
      conflictMode: "overwrite",
      removeLinks: false,
      removeSamples: false
    });

    expect(first.extracted).toBe(0);
    expect(first.failed).toBe(1);
    expect(first.lastError).toContain("jvm-output-callback-failed");
    expect(second).toEqual(expect.objectContaining({ extracted: 1, failed: 0 }));
  }, 10000);

  it.each(["7zjbinding", "zip4j"])("reports %s partial output before removing a failed file", (backend) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `rd-jvm-partial-${backend}-`));
    tempDirs.push(root);
    const targetDir = path.join(root, "out");
    const zipPath = path.join(root, "corrupt.zip");
    const zip = new AdmZip();
    zip.addFile("episode.bin", Buffer.from("payload-".repeat(20_000)));
    zip.writeZip(zipPath);
    corruptFirstZipPayload(zipPath);
    const runtimeRoot = path.join(process.cwd(), "resources", "extractor-jvm");
    const classPath = [
      path.join(runtimeRoot, "classes"),
      path.join(runtimeRoot, "lib", "sevenzipjbinding.jar"),
      path.join(runtimeRoot, "lib", "sevenzipjbinding-all-platforms.jar"),
      path.join(runtimeRoot, "lib", "zip4j.jar")
    ].join(path.delimiter);

    const run = spawnSync("java", [
      "-cp",
      classPath,
      "com.sucukdeluxe.extractor.JBindExtractorMain",
      "--archive",
      zipPath,
      "--target",
      targetDir,
      "--conflict",
      "overwrite",
      "--backend",
      backend
    ], { encoding: "utf8" });
    const states = String(run.stdout)
      .split(/\r?\n/)
      .filter((line) => line.startsWith("RD_OUTPUT "))
      .map((line) => line.split(" ")[2]);

    expect(run.status).not.toBe(0);
    expect(states[0]).toBe("opened");
    expect(states).toContain("partial");
    expect(states[states.length - 1]).toBe("removed");
    expect(fs.existsSync(path.join(targetDir, "episode.bin"))).toBe(false);
  });

  it.each([
    ["7zjbinding", "file.mkv:stream", "file.mkv"],
    ["7zjbinding", "name.", "name"],
    ["7zjbinding", "name ", "name"],
    ["7zjbinding", "CON", "safe-base.txt"],
    ["7zjbinding", "aux.txt", "safe-base.txt"],
    ["7zjbinding", "folder/LPT1.mkv", "safe-base.txt"],
    ["zip4j", "file.mkv:stream", "file.mkv"],
    ["zip4j", "name.", "name"],
    ["zip4j", "name ", "name"],
    ["zip4j", "CON", "safe-base.txt"],
    ["zip4j", "aux.txt", "safe-base.txt"],
    ["zip4j", "folder/LPT1.mkv", "safe-base.txt"]
  ] as const)("rejects %s Win32-unsafe entry %s before changing its alias", (backend, entryName, baseName) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `rd-jvm-win32-${backend}-`));
    tempDirs.push(root);
    const targetDir = path.join(root, "out");
    fs.mkdirSync(targetDir, { recursive: true });
    const basePath = path.join(targetDir, baseName);
    fs.writeFileSync(basePath, "foreign");
    const zipPath = path.join(root, "unsafe.zip");
    const zip = new AdmZip();
    zip.addFile(entryName, Buffer.from("package"));
    zip.writeZip(zipPath);
    const runtimeRoot = path.join(process.cwd(), "resources", "extractor-jvm");
    const classPath = [
      path.join(runtimeRoot, "classes"),
      path.join(runtimeRoot, "lib", "sevenzipjbinding.jar"),
      path.join(runtimeRoot, "lib", "sevenzipjbinding-all-platforms.jar"),
      path.join(runtimeRoot, "lib", "zip4j.jar")
    ].join(path.delimiter);

    const run = spawnSync("java", [
      "-cp",
      classPath,
      "com.sucukdeluxe.extractor.JBindExtractorMain",
      "--archive",
      zipPath,
      "--target",
      targetDir,
      "--conflict",
      "overwrite",
      "--backend",
      backend
    ], { encoding: "utf8" });

    expect(run.status).not.toBe(0);
    expect(fs.readFileSync(basePath, "utf8")).toBe("foreign");
  });

  it("reconciles a real aborted JVM opened output to partial or removed", async () => {
    process.env.RD_EXTRACT_BACKEND = "jvm";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-jvm-abort-output-"));
    tempDirs.push(root);
    const packageDir = path.join(root, "pkg");
    const targetDir = path.join(root, "out");
    fs.mkdirSync(packageDir, { recursive: true });
    const zip = new AdmZip();
    zip.addFile("episode.bin", Buffer.alloc(8 * 1024 * 1024, 7));
    zip.writeZip(path.join(packageDir, "large.zip"));
    const controller = new AbortController();
    const events: import("../src/main/extractor").ExtractOutputEvent[] = [];

    const extraction = extractPackageArchives({
      packageDir,
      targetDir,
      cleanupMode: "none",
      conflictMode: "overwrite",
      removeLinks: false,
      removeSamples: false,
      signal: controller.signal,
      onOutput: (event) => {
        events.push(event);
        if (event.state === "opened") {
          controller.abort();
        }
      }
    });

    await expect(extraction).rejects.toThrow("aborted:extract");
    expect(events[0]?.state).toBe("opened");
    expect(["partial", "removed"]).toContain(events[events.length - 1]?.state);
    const outputPath = path.join(targetDir, "episode.bin");
    if (events[events.length - 1]?.state === "partial") {
      expect(fs.statSync(outputPath).isFile()).toBe(true);
    } else {
      expect(fs.existsSync(outputPath)).toBe(false);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }, 10000);

  it("emits progress callbacks with archiveName and percent", async () => {
    process.env.RD_EXTRACT_BACKEND = "jvm";

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-jvm-progress-"));
    tempDirs.push(root);
    const packageDir = path.join(root, "pkg");
    const targetDir = path.join(root, "out");
    fs.mkdirSync(packageDir, { recursive: true });

    const zipPath = path.join(packageDir, "progress-test.zip");
    const zip = new AdmZip();
    zip.addFile("file1.txt", Buffer.from("Hello World ".repeat(100)));
    zip.addFile("file2.txt", Buffer.from("Another file ".repeat(100)));
    zip.writeZip(zipPath);

    const progressUpdates: Array<{
      archiveName: string;
      percent: number;
      phase: string;
      archivePercent?: number;
    }> = [];

    const result = await extractPackageArchives({
      packageDir,
      targetDir,
      cleanupMode: "none",
      conflictMode: "overwrite",
      removeLinks: false,
      removeSamples: false,
      onProgress: (update) => {
        progressUpdates.push({
          archiveName: update.archiveName,
          percent: update.percent,
          phase: update.phase,
          archivePercent: update.archivePercent,
        });
      },
    });

    expect(result.extracted).toBe(1);
    expect(result.failed).toBe(0);

    const phases = new Set(progressUpdates.map((u) => u.phase));
    expect(phases.has("preparing")).toBe(true);
    expect(phases.has("extracting")).toBe(true);

    const extracting = progressUpdates.filter((u) => u.phase === "extracting" && u.archiveName === "progress-test.zip");
    expect(extracting.length).toBeGreaterThan(0);

    const lastExtracting = extracting[extracting.length - 1];
    expect(lastExtracting.archivePercent).toBe(100);

    expect(fs.existsSync(path.join(targetDir, "file1.txt"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "file2.txt"))).toBe(true);
  });

  it("extracts multiple archives sequentially with progress for each", async () => {
    process.env.RD_EXTRACT_BACKEND = "jvm";

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-jvm-multi-"));
    tempDirs.push(root);
    const packageDir = path.join(root, "pkg");
    const targetDir = path.join(root, "out");
    fs.mkdirSync(packageDir, { recursive: true });

    const zip1 = new AdmZip();
    zip1.addFile("episode01.txt", Buffer.from("ep1 content"));
    zip1.writeZip(path.join(packageDir, "archive1.zip"));

    const zip2 = new AdmZip();
    zip2.addFile("episode02.txt", Buffer.from("ep2 content"));
    zip2.writeZip(path.join(packageDir, "archive2.zip"));

    const archiveNames = new Set<string>();

    const result = await extractPackageArchives({
      packageDir,
      targetDir,
      cleanupMode: "none",
      conflictMode: "overwrite",
      removeLinks: false,
      removeSamples: false,
      onProgress: (update) => {
        if (update.phase === "extracting" && update.archiveName) {
          archiveNames.add(update.archiveName);
        }
      },
    });

    expect(result.extracted).toBe(2);
    expect(result.failed).toBe(0);
    expect(archiveNames.has("archive1.zip")).toBe(true);
    expect(archiveNames.has("archive2.zip")).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "episode01.txt"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "episode02.txt"))).toBe(true);
  });

  it("respects ask/skip conflict mode in jvm backend", async () => {
    process.env.RD_EXTRACT_BACKEND = "jvm";

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-jvm-extract-"));
    tempDirs.push(root);
    const packageDir = path.join(root, "pkg");
    const targetDir = path.join(root, "out");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.mkdirSync(targetDir, { recursive: true });

    const zipPath = path.join(packageDir, "conflict.zip");
    const zip = new AdmZip();
    zip.addFile("same.txt", Buffer.from("new"));
    zip.writeZip(zipPath);

    const existingPath = path.join(targetDir, "same.txt");
    fs.writeFileSync(existingPath, "old", "utf8");

    const result = await extractPackageArchives({
      packageDir,
      targetDir,
      cleanupMode: "none",
      conflictMode: "ask",
      removeLinks: false,
      removeSamples: false
    });

    expect(result.extracted).toBe(1);
    expect(result.failed).toBe(0);
    expect(fs.readFileSync(existingPath, "utf8")).toBe("old");
  });
});
