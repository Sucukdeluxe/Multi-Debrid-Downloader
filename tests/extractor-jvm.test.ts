import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import AdmZip from "adm-zip";
import { afterEach, describe, expect, it } from "vitest";
import { extractPackageArchives, shutdownDaemon } from "../src/main/extractor";

const tempDirs: string[] = [];
const originalBackend = process.env.RD_EXTRACT_BACKEND;
const originalArchivePasswords = process.env.RD_ARCHIVE_PASSWORDS;
const require = createRequire(import.meta.url);
const rarCliPath = [
  "C:\\Program Files\\WinRAR\\Rar.exe",
  "C:\\Program Files (x86)\\WinRAR\\Rar.exe"
].find((candidate) => fs.existsSync(candidate)) || "";

type ZipFixtureEntry = { name: string; directory?: boolean; content?: string };

type TargetTreeEntry = { path: string; type: "directory" | "file"; bytes?: string };

function readTargetTree(root: string): TargetTreeEntry[] {
  const entries: TargetTreeEntry[] = [];
  const visit = (directory: string): void => {
    for (const name of fs.readdirSync(directory).sort((left, right) => left.localeCompare(right))) {
      const absolutePath = path.join(directory, name);
      const relativePath = path.relative(root, absolutePath).replace(/\\/g, "/");
      const stat = fs.lstatSync(absolutePath);
      if (stat.isDirectory()) {
        entries.push({ path: relativePath, type: "directory" });
        visit(absolutePath);
      } else {
        entries.push({ path: relativePath, type: "file", bytes: fs.readFileSync(absolutePath).toString("base64") });
      }
    }
  };
  visit(root);
  return entries;
}

function writeZipFixture(filePath: string, entries: readonly ZipFixtureEntry[]): void {
  const ZipFile = require("adm-zip/zipFile") as new (input: null, options: Record<string, unknown>) => {
    setEntry: (entry: unknown) => void;
    compressToBuffer: () => Buffer;
  };
  const ZipEntry = require("adm-zip/zipEntry") as new (options: Record<string, unknown>) => {
    entryName: string;
    setData: (data: Buffer) => void;
  };
  const utils = require("adm-zip/util") as {
    Constants: { NONE: number };
    decoder: unknown;
  };
  const options = {
    noSort: true,
    readEntries: false,
    method: utils.Constants.NONE,
    decoder: utils.decoder
  };
  const zip = new ZipFile(null, options);
  for (const fixture of entries) {
    const entry = new ZipEntry(options);
    entry.entryName = fixture.directory && !fixture.name.endsWith("/") ? `${fixture.name}/` : fixture.name;
    entry.setData(Buffer.from(fixture.content || ""));
    zip.setEntry(entry);
  }
  fs.writeFileSync(filePath, zip.compressToBuffer());
}

const jvmTargetCollisionCases = [
  ["directory then same-name file", [{ name: "same", directory: true }, { name: "same", content: "file" }]],
  ["file then same-name directory", [{ name: "same", content: "file" }, { name: "same", directory: true }]],
  ["parent file then child file", [{ name: "same", content: "parent" }, { name: "same/child", content: "child" }]],
  ["child file then parent file", [{ name: "same/child", content: "child" }, { name: "same", content: "parent" }]],
  ["upper-case then lower-case file aliases", [{ name: "Name", content: "first" }, { name: "name", content: "second" }]],
  ["lower-case then upper-case file aliases", [{ name: "name", content: "first" }, { name: "Name", content: "second" }]],
  ["upper-case then lower-case directory aliases", [{ name: "Folder", directory: true }, { name: "folder", directory: true }]],
  ["lower-case then upper-case directory aliases", [{ name: "folder", directory: true }, { name: "Folder", directory: true }]],
  ["duplicate file targets in forward order", [{ name: "same", content: "first" }, { name: "same", content: "second" }]],
  ["duplicate file targets in reverse order", [{ name: "same", content: "second" }, { name: "same", content: "first" }]]
] as const satisfies ReadonlyArray<readonly [string, readonly ZipFixtureEntry[]]>;

const rawPlanConflictModes = ["rename", "skip", "overwrite"] as const;

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

function hasCommand(command: string, args: string[]): boolean {
  return spawnSync(command, args, { stdio: "ignore" }).status === 0;
}

function compileJvmExtractorSource(root: string): string {
  const runtimeRoot = path.join(process.cwd(), "resources", "extractor-jvm");
  const classesDir = path.join(root, "classes");
  const libs = [
    path.join(runtimeRoot, "lib", "sevenzipjbinding.jar"),
    path.join(runtimeRoot, "lib", "sevenzipjbinding-all-platforms.jar"),
    path.join(runtimeRoot, "lib", "zip4j.jar")
  ];
  fs.mkdirSync(classesDir, { recursive: true });
  const result = spawnSync("javac", [
    "-source", "8",
    "-target", "8",
    "-encoding", "UTF-8",
    "-cp", libs.join(path.delimiter),
    "-d", classesDir,
    path.join(runtimeRoot, "src", "com", "sucukdeluxe", "extractor", "JBindExtractorMain.java")
  ], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || "javac failed"));
  }
  return [classesDir, ...libs].join(path.delimiter);
}

function findZipCryptoVerifierCollision(root: string, archivePath: string): string {
  const sourcePath = path.join(root, "ZipCryptoCollisionFinder.java");
  const classesDir = path.join(root, "collision-finder-classes");
  const zip4jPath = path.join(process.cwd(), "resources", "extractor-jvm", "lib", "zip4j.jar");
  fs.mkdirSync(classesDir, { recursive: true });
  fs.writeFileSync(sourcePath, `import java.io.InputStream;
import net.lingala.zip4j.ZipFile;
import net.lingala.zip4j.model.FileHeader;
public final class ZipCryptoCollisionFinder {
  public static void main(String[] args) throws Exception {
    for (int index = 0; index < 8192; index++) {
      String candidate = "collision-candidate-" + index;
      ZipFile zipFile = new ZipFile(args[0]);
      zipFile.setPassword(candidate.toCharArray());
      int produced = 0;
      try {
        FileHeader header = zipFile.getFileHeaders().get(0);
        InputStream input = zipFile.getInputStream(header);
        try {
          byte[] buffer = new byte[8192];
          while (true) {
            int read = input.read(buffer);
            if (read < 0) break;
            produced += read;
          }
        } finally {
          input.close();
        }
      } catch (Exception error) {
        if (produced > 0) {
          System.out.println(candidate);
          return;
        }
      } finally {
        zipFile.close();
      }
    }
    System.exit(2);
  }
}`, "utf8");
  const compiled = spawnSync("javac", ["-source", "8", "-target", "8", "-encoding", "UTF-8", "-cp", zip4jPath, "-d", classesDir, sourcePath], { encoding: "utf8" });
  if (compiled.status !== 0) {
    throw new Error(String(compiled.stderr || compiled.stdout || "collision finder compile failed"));
  }
  const run = spawnSync("java", ["-cp", [classesDir, zip4jPath].join(path.delimiter), "ZipCryptoCollisionFinder", archivePath], { encoding: "utf8", timeout: 20_000 });
  if (run.status !== 0) {
    throw new Error(String(run.stderr || run.stdout || "collision finder failed"));
  }
  return String(run.stdout || "").trim();
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
  shutdownDaemon();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (originalBackend === undefined) {
    delete process.env.RD_EXTRACT_BACKEND;
  } else {
    process.env.RD_EXTRACT_BACKEND = originalBackend;
  }
  if (originalArchivePasswords === undefined) {
    delete process.env.RD_ARCHIVE_PASSWORDS;
  } else {
    process.env.RD_ARCHIVE_PASSWORDS = originalArchivePasswords;
  }
});

describe("JVM extractor build pipeline", () => {
  it("compiles the JVM runtime before main and release builds", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));

    expect(packageJson.scripts["build:extractor-jvm"]).toBe("node scripts/build-extractor-jvm.mjs");
    expect(packageJson.scripts["build:main"]).toMatch(/^npm run build:extractor-jvm && /);
    expect(packageJson.scripts.build).toContain("npm run build:main");
    expect(packageJson.scripts["release:win"]).toContain("npm run build");
  });

  it("keeps packaged JVM classes current with Java 8 bytecode and the password attempt protocol", () => {
    const buildScript = path.join(process.cwd(), "scripts", "build-extractor-jvm.mjs");
    const runtimeRoot = path.join(process.cwd(), "resources", "extractor-jvm");

    const current = spawnSync(process.execPath, [buildScript, "--check", "--runtime-root", runtimeRoot], { encoding: "utf8" });

    expect(current.status, `${current.stdout}\n${current.stderr}`).toBe(0);
    const mainClass = fs.readFileSync(path.join(runtimeRoot, "classes", "com", "sucukdeluxe", "extractor", "JBindExtractorMain.class"));
    expect(mainClass.readUInt16BE(6)).toBe(52);
    expect(mainClass.includes(Buffer.from("RD_PASSWORD_ATTEMPT", "utf8"))).toBe(true);
    expect(mainClass.includes(Buffer.from("RD_PASSWORD ", "utf8"))).toBe(false);
  });

  it.skipIf(!hasCommand("javac", ["-version"]))("builds current source and rejects stale classes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-jvm-build-"));
    tempDirs.push(root);
    const sourceRuntime = path.join(process.cwd(), "resources", "extractor-jvm");
    const runtimeRoot = path.join(root, "extractor-jvm");
    fs.mkdirSync(runtimeRoot, { recursive: true });
    fs.cpSync(path.join(sourceRuntime, "src"), path.join(runtimeRoot, "src"), { recursive: true });
    fs.cpSync(path.join(sourceRuntime, "lib"), path.join(runtimeRoot, "lib"), { recursive: true });
    const buildScript = path.join(process.cwd(), "scripts", "build-extractor-jvm.mjs");

    const build = spawnSync(process.execPath, [buildScript, "--runtime-root", runtimeRoot], { encoding: "utf8" });
    expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0);
    const mainClass = path.join(runtimeRoot, "classes", "com", "sucukdeluxe", "extractor", "JBindExtractorMain.class");
    expect(fs.readFileSync(mainClass).includes(Buffer.from("RD_PASSWORD_ATTEMPT", "utf8"))).toBe(true);

    const current = spawnSync(process.execPath, [buildScript, "--check", "--runtime-root", runtimeRoot], { encoding: "utf8" });
    expect(current.status, `${current.stdout}\n${current.stderr}`).toBe(0);

    const javaSource = path.join(runtimeRoot, "src", "com", "sucukdeluxe", "extractor", "JBindExtractorMain.java");
    fs.appendFileSync(javaSource, "\n", "utf8");
    const stale = spawnSync(process.execPath, [buildScript, "--check", "--runtime-root", runtimeRoot], { encoding: "utf8" });
    expect(stale.status).toBe(1);
    expect(`${stale.stdout}\n${stale.stderr}`).toMatch(/veraltet|stale/i);
  }, 30_000);

  it("fails clearly when no JDK compiler is available", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-jvm-no-jdk-"));
    tempDirs.push(root);
    const sourceRuntime = path.join(process.cwd(), "resources", "extractor-jvm");
    const runtimeRoot = path.join(root, "extractor-jvm");
    fs.mkdirSync(runtimeRoot, { recursive: true });
    fs.cpSync(path.join(sourceRuntime, "src"), path.join(runtimeRoot, "src"), { recursive: true });
    fs.cpSync(path.join(sourceRuntime, "lib"), path.join(runtimeRoot, "lib"), { recursive: true });
    const buildScript = path.join(process.cwd(), "scripts", "build-extractor-jvm.mjs");
    const env = { ...process.env, JAVA_HOME: "", PATH: "" };

    const build = spawnSync(process.execPath, [buildScript, "--runtime-root", runtimeRoot], { encoding: "utf8", env });

    expect(build.status).toBe(1);
    expect(`${build.stdout}\n${build.stderr}`).toMatch(/JDK.*javac|javac.*JDK/i);
  });
});

describe.skipIf(!hasJavaRuntime() || !hasJvmExtractorRuntime())("extractor jvm backend", () => {
  it.skipIf(!hasCommand("javac", ["-version"]) || !hasCommand("7z", ["i"]))("emits password attempt indices without exposing candidate values", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-jvm-password-attempt-"));
    tempDirs.push(root);
    const inputPath = path.join(root, "payload.txt");
    const archivePath = path.join(root, "protected.zip");
    const targetDir = path.join(root, "out");
    const actualPassword = "actual-secret-value";
    const wrongPassword = "wrong-secret-value";
    fs.writeFileSync(inputPath, "protected payload", "utf8");
    const created = spawnSync("7z", ["a", "-tzip", `-p${actualPassword}`, "-mem=AES256", archivePath, inputPath], { encoding: "utf8" });
    expect(created.status).toBe(0);
    const classPath = compileJvmExtractorSource(root);

    const run = spawnSync("java", [
      "-cp",
      classPath,
      "com.sucukdeluxe.extractor.JBindExtractorMain",
      "--archive",
      archivePath,
      "--target",
      targetDir,
      "--conflict",
      "overwrite",
      "--backend",
      "zip4j",
      "--password",
      wrongPassword,
      "--password",
      actualPassword
    ], { encoding: "utf8" });

    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    const attemptLines = String(run.stdout).split(/\r?\n/).filter((line) => line.startsWith("RD_PASSWORD_ATTEMPT "));
    expect(attemptLines).toEqual([
      "RD_PASSWORD_ATTEMPT 1 3",
      "RD_PASSWORD_ATTEMPT 2 3",
      "RD_PASSWORD_ATTEMPT 3 3"
    ]);
    expect(attemptLines.every((line) => !line.includes(actualPassword) && !line.includes(wrongPassword))).toBe(true);
    expect(String(run.stdout)).not.toContain("RD_PASSWORD ");
    expect(fs.readFileSync(path.join(targetDir, "payload.txt"), "utf8")).toBe("protected payload");
  }, 20_000);

  it.skipIf(!hasCommand("javac", ["-version"]) || !hasCommand("7z", ["i"]))("keeps encrypted Zip4j corruption distinct from a wrong password", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-jvm-zip4j-encrypted-crc-"));
    tempDirs.push(root);
    const inputPath = path.join(root, "payload.bin");
    const archivePath = path.join(root, "protected-corrupt.zip");
    const targetDir = path.join(root, "out");
    const actualPassword = "zip4j-corrupt-secret";
    const sentinelPassword = "must-not-run-after-zip-crc";
    fs.writeFileSync(inputPath, randomBytes(256 * 1024));
    const created = spawnSync("7z", ["a", "-tzip", `-p${actualPassword}`, "-mem=AES256", archivePath, inputPath], { encoding: "utf8" });
    expect(created.status).toBe(0);
    corruptFirstZipPayload(archivePath);
    const classPath = compileJvmExtractorSource(root);

    const run = spawnSync("java", [
      "-cp",
      classPath,
      "com.sucukdeluxe.extractor.JBindExtractorMain",
      "--archive",
      archivePath,
      "--target",
      targetDir,
      "--conflict",
      "overwrite",
      "--backend",
      "zip4j",
      "--password",
      actualPassword,
      "--password",
      sentinelPassword
    ], { encoding: "utf8" });

    expect(run.status, `${run.stdout}\n${run.stderr}`).not.toBe(0);
    expect(String(run.stdout).split(/\r?\n/).filter((line) => line.startsWith("RD_PASSWORD_ATTEMPT "))).toEqual([
      "RD_PASSWORD_ATTEMPT 1 3",
      "RD_PASSWORD_ATTEMPT 2 3"
    ]);
    expect(String(run.stderr)).toMatch(/CRC|checksum/i);
    expect(String(run.stderr)).not.toContain("Falsches Archiv-Passwort");
  }, 20_000);

  it.skipIf(!hasCommand("javac", ["-version"]) || !hasCommand("7z", ["i"]))("validates encrypted Zip4j entries before extracting plain entries", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-jvm-zip4j-mixed-password-"));
    tempDirs.push(root);
    const plainInput = path.join(root, "a-plain.txt");
    const secretInput = path.join(root, "b-secret.txt");
    const archivePath = path.join(root, "mixed.zip");
    const targetDir = path.join(root, "out");
    const actualPassword = "zip4j-mixed-secret";
    fs.writeFileSync(plainInput, "plain payload", "utf8");
    fs.writeFileSync(secretInput, "secret payload", "utf8");
    expect(spawnSync("7z", ["a", "-tzip", archivePath, plainInput], { encoding: "utf8" }).status).toBe(0);
    expect(spawnSync("7z", ["a", "-tzip", `-p${actualPassword}`, "-mem=AES256", archivePath, secretInput], { encoding: "utf8" }).status).toBe(0);
    const classPath = compileJvmExtractorSource(root);

    const run = spawnSync("java", [
      "-cp",
      classPath,
      "com.sucukdeluxe.extractor.JBindExtractorMain",
      "--archive",
      archivePath,
      "--target",
      targetDir,
      "--conflict",
      "overwrite",
      "--backend",
      "zip4j",
      "--password",
      actualPassword
    ], { encoding: "utf8" });

    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(String(run.stdout).split(/\r?\n/).filter((line) => line.startsWith("RD_PASSWORD_ATTEMPT "))).toEqual([
      "RD_PASSWORD_ATTEMPT 1 2",
      "RD_PASSWORD_ATTEMPT 2 2"
    ]);
    expect(fs.readFileSync(path.join(targetDir, "a-plain.txt"), "utf8")).toBe("plain payload");
    expect(fs.readFileSync(path.join(targetDir, "b-secret.txt"), "utf8")).toBe("secret payload");
  }, 20_000);

  it.skipIf(!hasCommand("javac", ["-version"]) || !hasCommand("7z", ["i"]))("continues after a ZipCrypto verifier collision reaches CRC", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-jvm-zipcrypto-collision-"));
    tempDirs.push(root);
    const inputPath = path.join(root, "payload.bin");
    const archivePath = path.join(root, "collision.zip");
    const targetDir = path.join(root, "out");
    const actualPassword = "actual-password";
    const payload = randomBytes(4096);
    fs.writeFileSync(inputPath, payload);
    const created = spawnSync("7z", ["a", "-tzip", "-mx=0", "-mem=ZipCrypto", `-p${actualPassword}`, archivePath, inputPath], { encoding: "utf8" });
    expect(created.status).toBe(0);
    const collisionPassword = findZipCryptoVerifierCollision(root, archivePath);
    expect(collisionPassword).toMatch(/^collision-candidate-\d+$/);
    const classPath = compileJvmExtractorSource(root);

    const run = spawnSync("java", [
      "-cp",
      classPath,
      "com.sucukdeluxe.extractor.JBindExtractorMain",
      "--archive",
      archivePath,
      "--target",
      targetDir,
      "--conflict",
      "overwrite",
      "--backend",
      "zip4j",
      "--password",
      collisionPassword,
      "--password",
      actualPassword
    ], { encoding: "utf8" });

    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(String(run.stdout).split(/\r?\n/).filter((line) => line.startsWith("RD_PASSWORD_ATTEMPT "))).toEqual([
      "RD_PASSWORD_ATTEMPT 1 3",
      "RD_PASSWORD_ATTEMPT 2 3",
      "RD_PASSWORD_ATTEMPT 3 3"
    ]);
    expect(fs.readFileSync(path.join(targetDir, "payload.bin"))).toEqual(payload);

    const failedTargetDir = path.join(root, "failed-out");
    const failedRun = spawnSync("java", [
      "-cp",
      classPath,
      "com.sucukdeluxe.extractor.JBindExtractorMain",
      "--archive",
      archivePath,
      "--target",
      failedTargetDir,
      "--conflict",
      "overwrite",
      "--backend",
      "zip4j",
      "--password",
      collisionPassword,
      "--password",
      "wrong-after-collision"
    ], { encoding: "utf8" });
    expect(failedRun.status).not.toBe(0);
    expect(String(failedRun.stdout).split(/\r?\n/).filter((line) => line.startsWith("RD_PASSWORD_ATTEMPT "))).toEqual([
      "RD_PASSWORD_ATTEMPT 1 3",
      "RD_PASSWORD_ATTEMPT 2 3",
      "RD_PASSWORD_ATTEMPT 3 3"
    ]);
    expect(String(failedRun.stderr)).toContain("zip4j-Fehler: CRCERROR");
    expect(String(failedRun.stderr)).not.toContain("Falsches Archiv-Passwort");
  }, 30_000);

  it.skipIf(!hasCommand("javac", ["-version"]) || !hasCommand("7z", ["i"]))("parses daemon password candidates with JSON metacharacters and Unicode", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-jvm-daemon-json-"));
    tempDirs.push(root);
    const inputPath = path.join(root, "payload.txt");
    const archivePath = path.join(root, "protected.zip");
    const targetDir = path.join(root, "out");
    const actualPassword = "actual-daemon-secret";
    const bracketPassword = "wrong]candidate";
    const escapedPassword = "päss\\\"\\漢字ß";
    fs.writeFileSync(inputPath, "daemon protected payload", "utf8");
    const created = spawnSync("7z", ["a", "-tzip", `-p${actualPassword}`, "-mem=AES256", archivePath, inputPath], { encoding: "utf8" });
    expect(created.status).toBe(0);
    const classPath = compileJvmExtractorSource(root);
    const request = JSON.stringify({
      archive: archivePath,
      target: targetDir,
      conflict: "overwrite",
      backend: "zip4j",
      passwords: [bracketPassword, escapedPassword, actualPassword]
    });

    const run = spawnSync("java", [
      "-cp",
      classPath,
      "com.sucukdeluxe.extractor.JBindExtractorMain",
      "--daemon"
    ], { encoding: "utf8", input: `${request}\n` });

    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(String(run.stdout)).toContain("RD_REQUEST_DONE 0");
    expect(String(run.stdout).split(/\r?\n/).filter((line) => line.startsWith("RD_PASSWORD_ATTEMPT "))).toEqual([
      "RD_PASSWORD_ATTEMPT 1 4",
      "RD_PASSWORD_ATTEMPT 2 4",
      "RD_PASSWORD_ATTEMPT 3 4",
      "RD_PASSWORD_ATTEMPT 4 4"
    ]);
    expect(`${run.stdout}\n${run.stderr}`).not.toContain(actualPassword);
    expect(`${run.stdout}\n${run.stderr}`).not.toContain(bracketPassword);
    expect(`${run.stdout}\n${run.stderr}`).not.toContain(escapedPassword);
    expect(fs.readFileSync(path.join(targetDir, "payload.txt"), "utf8")).toBe("daemon protected payload");
  }, 20_000);

  it.skipIf(!hasCommand("javac", ["-version"]) || !rarCliPath)("tries the real RAR5 password after unreliable encrypted metadata", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-jvm-rar5-password-"));
    tempDirs.push(root);
    const inputPath = path.join(root, "payload.bin");
    const archivePath = path.join(root, "protected.rar");
    const targetDir = path.join(root, "out");
    const actualPassword = "rar5-actual-secret";
    const wrongPassword = "rar5-wrong-secret";
    const payload = randomBytes(192 * 1024);
    fs.writeFileSync(inputPath, payload);
    const created = spawnSync(rarCliPath, ["a", "-ma5", `-hp${actualPassword}`, "-v64k", "-idq", archivePath, inputPath], { encoding: "utf8" });
    expect(created.status).toBe(0);
    const firstPart = fs.readdirSync(root).find((name) => /^protected\.part0*1\.rar$/i.test(name));
    expect(firstPart).toBeTruthy();
    const classPath = compileJvmExtractorSource(root);

    const run = spawnSync("java", [
      "-cp",
      classPath,
      "com.sucukdeluxe.extractor.JBindExtractorMain",
      "--archive",
      path.join(root, firstPart!),
      "--target",
      targetDir,
      "--conflict",
      "overwrite",
      "--backend",
      "7zjbinding",
      "--password",
      wrongPassword,
      "--password",
      actualPassword
    ], { encoding: "utf8" });

    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(String(run.stdout).split(/\r?\n/).filter((line) => line.startsWith("RD_PASSWORD_ATTEMPT "))).toEqual([
      "RD_PASSWORD_ATTEMPT 1 3",
      "RD_PASSWORD_ATTEMPT 2 3",
      "RD_PASSWORD_ATTEMPT 3 3"
    ]);
    const extractedPayload = readTargetTree(targetDir).find((entry) => entry.type === "file" && entry.path.endsWith("payload.bin"));
    expect(extractedPayload?.bytes).toBe(payload.toString("base64"));
  }, 20_000);

  it.skipIf(!hasCommand("javac", ["-version"]) || !rarCliPath)("continues after an explicit RAR5 WRONG_PASSWORD result", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-jvm-rar5-data-password-"));
    tempDirs.push(root);
    const inputPath = path.join(root, "payload.bin");
    const archivePath = path.join(root, "protected-data.rar");
    const targetDir = path.join(root, "out");
    const actualPassword = "rar5-data-actual";
    const wrongPassword = "rar5-data-wrong";
    const payload = randomBytes(192 * 1024);
    fs.writeFileSync(inputPath, payload);
    const created = spawnSync(rarCliPath, ["a", "-ma5", `-p${actualPassword}`, "-v64k", "-idq", archivePath, inputPath], { encoding: "utf8" });
    expect(created.status).toBe(0);
    const firstPart = fs.readdirSync(root).find((name) => /^protected-data\.part0*1\.rar$/i.test(name));
    expect(firstPart).toBeTruthy();
    const classPath = compileJvmExtractorSource(root);

    const run = spawnSync("java", [
      "-cp",
      classPath,
      "com.sucukdeluxe.extractor.JBindExtractorMain",
      "--archive",
      path.join(root, firstPart!),
      "--target",
      targetDir,
      "--conflict",
      "overwrite",
      "--backend",
      "7zjbinding",
      "--password",
      wrongPassword,
      "--password",
      actualPassword
    ], { encoding: "utf8" });

    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(String(run.stdout).split(/\r?\n/).filter((line) => line.startsWith("RD_PASSWORD_ATTEMPT "))).toEqual([
      "RD_PASSWORD_ATTEMPT 1 3",
      "RD_PASSWORD_ATTEMPT 2 3",
      "RD_PASSWORD_ATTEMPT 3 3"
    ]);
    expect(`${run.stdout}\n${run.stderr}`).not.toContain(actualPassword);
    expect(`${run.stdout}\n${run.stderr}`).not.toContain(wrongPassword);
    const extractedPayload = readTargetTree(targetDir).find((entry) => entry.type === "file" && entry.path.endsWith("payload.bin"));
    expect(extractedPayload?.bytes).toBe(payload.toString("base64"));
  }, 20_000);

  it.skipIf(!hasCommand("javac", ["-version"]) || !rarCliPath)("keeps encrypted RAR5 corruption distinct from an exhausted password list", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-jvm-rar5-encrypted-crc-"));
    tempDirs.push(root);
    const inputPath = path.join(root, "payload.bin");
    const archivePath = path.join(root, "encrypted-corrupt.rar");
    const targetDir = path.join(root, "out");
    const actualPassword = "rar5-corrupt-secret";
    const sentinelPassword = "must-not-be-attempted-after-crc";
    fs.writeFileSync(inputPath, randomBytes(256 * 1024));
    const created = spawnSync(rarCliPath, ["a", "-ma5", `-hp${actualPassword}`, "-v64k", "-idq", archivePath, inputPath], { encoding: "utf8" });
    expect(created.status).toBe(0);
    const parts = fs.readdirSync(root).filter((name) => /^encrypted-corrupt\.part\d+\.rar$/i.test(name)).sort();
    expect(parts.length).toBeGreaterThanOrEqual(3);
    const corruptPath = path.join(root, parts[2]);
    const bytes = fs.readFileSync(corruptPath);
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    fs.writeFileSync(corruptPath, bytes);
    const classPath = compileJvmExtractorSource(root);

    const run = spawnSync("java", [
      "-cp",
      classPath,
      "com.sucukdeluxe.extractor.JBindExtractorMain",
      "--archive",
      path.join(root, parts[0]),
      "--target",
      targetDir,
      "--conflict",
      "overwrite",
      "--backend",
      "7zjbinding",
      "--password",
      actualPassword,
      "--password",
      sentinelPassword
    ], { encoding: "utf8" });

    expect(run.status, `${run.stdout}\n${run.stderr}`).not.toBe(0);
    expect(String(run.stdout).split(/\r?\n/).filter((line) => line.startsWith("RD_PASSWORD_ATTEMPT "))).toEqual([
      "RD_PASSWORD_ATTEMPT 1 3",
      "RD_PASSWORD_ATTEMPT 2 3"
    ]);
    expect(String(run.stderr)).toMatch(/RD_ERROR 7z-Fehler: (?:CRCERROR|DATAERROR)/);
    expect(String(run.stderr)).not.toContain("Falsches Archiv-Passwort");
    expect(String(run.stderr).toLowerCase()).not.toContain("wrong_password");
    expect(String(run.stderr).toLowerCase()).not.toContain("wrong password");
    expect(`${run.stdout}\n${run.stderr}`).not.toContain(sentinelPassword);
  }, 20_000);

  it.skipIf(!hasCommand("javac", ["-version"]) || !rarCliPath)("keeps an unencrypted RAR5 CRC failure terminal", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-jvm-rar5-crc-"));
    tempDirs.push(root);
    const inputPath = path.join(root, "payload.bin");
    const archivePath = path.join(root, "corrupt.rar");
    const targetDir = path.join(root, "out");
    fs.writeFileSync(inputPath, randomBytes(192 * 1024));
    const created = spawnSync(rarCliPath, ["a", "-ma5", "-v64k", "-idq", archivePath, inputPath], { encoding: "utf8" });
    expect(created.status).toBe(0);
    const parts = fs.readdirSync(root).filter((name) => /^corrupt\.part\d+\.rar$/i.test(name)).sort();
    expect(parts.length).toBeGreaterThanOrEqual(3);
    const corruptPath = path.join(root, parts[2]);
    const bytes = fs.readFileSync(corruptPath);
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    fs.writeFileSync(corruptPath, bytes);
    const classPath = compileJvmExtractorSource(root);

    const run = spawnSync("java", [
      "-cp",
      classPath,
      "com.sucukdeluxe.extractor.JBindExtractorMain",
      "--archive",
      path.join(root, parts[0]),
      "--target",
      targetDir,
      "--conflict",
      "overwrite",
      "--backend",
      "7zjbinding",
      "--password",
      "unused-one",
      "--password",
      "unused-two"
    ], { encoding: "utf8" });

    expect(run.status).not.toBe(0);
    expect(String(run.stdout).split(/\r?\n/).filter((line) => line.startsWith("RD_PASSWORD_ATTEMPT "))).toEqual([
      "RD_PASSWORD_ATTEMPT 1 3"
    ]);
    expect(String(run.stderr)).toContain("CRCERROR");
  }, 20_000);

  it.skipIf(!hasCommand("javac", ["-version"]) || !rarCliPath)("keeps an encrypted missing RAR5 volume distinct from a wrong password", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-jvm-rar5-missing-volume-"));
    tempDirs.push(root);
    const inputPath = path.join(root, "payload.bin");
    const archivePath = path.join(root, "missing-volume.rar");
    const targetDir = path.join(root, "out");
    const actualPassword = "rar5-missing-volume-secret";
    const sentinelPassword = "must-not-run-after-missing-volume";
    fs.writeFileSync(inputPath, randomBytes(256 * 1024));
    const created = spawnSync(rarCliPath, ["a", "-ma5", `-hp${actualPassword}`, "-v64k", "-idq", archivePath, inputPath], { encoding: "utf8" });
    expect(created.status).toBe(0);
    const parts = fs.readdirSync(root).filter((name) => /^missing-volume\.part\d+\.rar$/i.test(name)).sort();
    expect(parts.length).toBeGreaterThanOrEqual(3);
    fs.unlinkSync(path.join(root, parts[1]));
    const classPath = compileJvmExtractorSource(root);

    const run = spawnSync("java", [
      "-cp",
      classPath,
      "com.sucukdeluxe.extractor.JBindExtractorMain",
      "--archive",
      path.join(root, parts[0]),
      "--target",
      targetDir,
      "--conflict",
      "overwrite",
      "--backend",
      "7zjbinding",
      "--password",
      actualPassword,
      "--password",
      sentinelPassword
    ], { encoding: "utf8" });

    expect(run.status).not.toBe(0);
    expect(String(run.stdout).split(/\r?\n/).filter((line) => line.startsWith("RD_PASSWORD_ATTEMPT "))).toEqual([
      "RD_PASSWORD_ATTEMPT 1 3",
      "RD_PASSWORD_ATTEMPT 2 3"
    ]);
    expect(String(run.stdout)).not.toContain("RD_OUTPUT ");
    expect(String(run.stderr)).not.toContain("Falsches Archiv-Passwort");
    expect(String(run.stderr)).toMatch(/Missing volume|Volume fehlt/i);
  }, 20_000);

  it.skipIf(process.platform !== "win32" || !hasCommand("javac", ["-version"]) || !rarCliPath)("keeps an encrypted locked RAR5 volume distinct from a wrong password", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-jvm-rar5-locked-volume-"));
    tempDirs.push(root);
    const inputDir = path.join(root, "inputs");
    const archivePath = path.join(root, "locked.rar");
    const targetDir = path.join(root, "out");
    const actualPassword = "rar5-locked-volume-secret";
    const sentinelPassword = "must-not-run-after-volume-io";
    fs.mkdirSync(inputDir, { recursive: true });
    const inputPaths: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      const inputPath = path.join(inputDir, `payload-${index.toString().padStart(2, "0")}.bin`);
      fs.writeFileSync(inputPath, randomBytes(48 * 1024));
      inputPaths.push(inputPath);
    }
    const created = spawnSync(rarCliPath, ["a", "-ma5", `-hp${actualPassword}`, "-v64k", "-idq", archivePath, ...inputPaths], { encoding: "utf8" });
    expect(created.status).toBe(0);
    const parts = fs.readdirSync(root).filter((name) => /^locked\.part\d+\.rar$/i.test(name)).sort();
    expect(parts.length).toBeGreaterThanOrEqual(4);
    const classPath = compileJvmExtractorSource(root);
    const script = `$lock = [IO.File]::Open($env:LOCK_PATH, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
try {
  & $env:JAVA_BIN '-cp' $env:CLASS_PATH 'com.sucukdeluxe.extractor.JBindExtractorMain' '--archive' $env:ARCHIVE_PATH '--target' $env:TARGET_PATH '--conflict' 'overwrite' '--backend' '7zjbinding' '--password' $env:ACTUAL_PASSWORD '--password' $env:SENTINEL_PASSWORD
  exit $LASTEXITCODE
} finally {
  $lock.Dispose()
}`;

    const run = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        LOCK_PATH: path.join(root, parts[3]),
        JAVA_BIN: "java",
        CLASS_PATH: classPath,
        ARCHIVE_PATH: path.join(root, parts[0]),
        TARGET_PATH: targetDir,
        ACTUAL_PASSWORD: actualPassword,
        SENTINEL_PASSWORD: sentinelPassword
      }
    });

    expect(run.status, `${run.stdout}\n${run.stderr}`).not.toBe(0);
    expect(String(run.stdout).split(/\r?\n/).filter((line) => line.startsWith("RD_PASSWORD_ATTEMPT "))).toEqual([
      "RD_PASSWORD_ATTEMPT 1 3",
      "RD_PASSWORD_ATTEMPT 2 3"
    ]);
    expect(String(run.stderr)).toContain("Volume konnte nicht geoffnet");
    expect(String(run.stderr)).not.toContain("Falsches Archiv-Passwort");
  }, 30_000);

  it.skipIf(!hasCommand("javac", ["-version"]) || !hasCommand("7z", ["i"]))("does not convert an encrypted 7z open failure into a wrong password", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-jvm-7z-open-failure-"));
    tempDirs.push(root);
    const inputPath = path.join(root, "payload.bin");
    const archivePath = path.join(root, "truncated.7z");
    const targetDir = path.join(root, "out");
    const actualPassword = "sevenzip-open-secret";
    const sentinelPassword = "must-not-run-after-open-failure";
    fs.writeFileSync(inputPath, randomBytes(256 * 1024));
    const created = spawnSync("7z", ["a", "-t7z", `-p${actualPassword}`, "-mhe=on", archivePath, inputPath], { encoding: "utf8" });
    expect(created.status).toBe(0);
    const archiveSize = fs.statSync(archivePath).size;
    expect(archiveSize).toBeGreaterThan(256);
    fs.truncateSync(archivePath, archiveSize - 128);
    const classPath = compileJvmExtractorSource(root);

    const run = spawnSync("java", [
      "-cp",
      classPath,
      "com.sucukdeluxe.extractor.JBindExtractorMain",
      "--archive",
      archivePath,
      "--target",
      targetDir,
      "--conflict",
      "overwrite",
      "--backend",
      "7zjbinding",
      "--password",
      actualPassword,
      "--password",
      sentinelPassword
    ], { encoding: "utf8" });

    expect(run.status, `${run.stdout}\n${run.stderr}`).not.toBe(0);
    expect(String(run.stdout).split(/\r?\n/).filter((line) => line.startsWith("RD_PASSWORD_ATTEMPT "))).toEqual([
      "RD_PASSWORD_ATTEMPT 1 3"
    ]);
    expect(String(run.stderr)).not.toContain("Falsches Archiv-Passwort");
  }, 20_000);

  it.skipIf(!hasCommand("7z", ["i"]))("routes the emitted German archive-password failure through fallback and cache invalidation", async () => {
    process.env.RD_EXTRACT_BACKEND = "jvm";
    process.env.RD_ARCHIVE_PASSWORDS = "";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-jvm-german-password-"));
    tempDirs.push(root);
    const packageDir = path.join(root, "pkg");
    const targetDir = path.join(root, "out");
    const firstInput = path.join(root, "first.txt");
    const secondInput = path.join(root, "second.txt");
    const learnedPassword = "learned-package-secret";
    const unavailablePassword = "unavailable-archive-secret";
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(firstInput, "first payload", "utf8");
    fs.writeFileSync(secondInput, "second payload", "utf8");
    expect(spawnSync("7z", ["a", "-tzip", `-p${learnedPassword}`, "-mem=AES256", path.join(packageDir, "a-first.zip"), firstInput]).status).toBe(0);
    expect(spawnSync("7z", ["a", "-tzip", `-p${unavailablePassword}`, "-mem=AES256", path.join(packageDir, "b-second.zip"), secondInput]).status).toBe(0);
    const failures: import("../src/main/extractor").ExtractArchiveFailureInfo[] = [];
    const logs: string[] = [];

    const result = await extractPackageArchives({
      packageDir,
      targetDir,
      cleanupMode: "none",
      conflictMode: "overwrite",
      removeLinks: false,
      removeSamples: false,
      passwordList: learnedPassword,
      onArchiveFailure: (failure) => failures.push(failure),
      onLog: (_level, message) => logs.push(message)
    });

    expect(result).toEqual(expect.objectContaining({ extracted: 1, failed: 1 }));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toEqual(expect.objectContaining({
      archiveName: "b-second.zip",
      category: "wrong_password",
      suggestRedownload: false
    }));
    expect(String(failures[0]?.jvmFailureReason || "")).toContain("Falsches Archiv-Passwort");
    expect(logs.some((message) => message.includes("JVM-Extractor Fallback-Analyse:") && message.includes("wrongPassword=true"))).toBe(true);
    expect(logs.some((message) => message.startsWith("Legacy-Extractor Start: archive=b-second.zip"))).toBe(true);
    expect(logs.some((message) => message.includes("Passwort-Cache Update"))).toBe(true);
    expect(logs.some((message) => message.includes("Passwort-Cache verworfen"))).toBe(true);
  }, 30_000);

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

  it.each(["7zjbinding", "zip4j"])("reports only removed after deleting a failed %s output", (backend) => {
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
    expect(states).toEqual(["opened", "removed"]);
    expect(fs.existsSync(path.join(targetDir, "episode.bin"))).toBe(false);
  });

  it("preserves the real JVM archive error when a failed output is removed before Node consumes the event", async () => {
    process.env.RD_EXTRACT_BACKEND = "jvm";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-jvm-removed-output-error-"));
    tempDirs.push(root);
    const packageDir = path.join(root, "pkg");
    const targetDir = path.join(root, "out");
    const zipPath = path.join(packageDir, "corrupt.zip");
    fs.mkdirSync(packageDir, { recursive: true });
    const zip = new AdmZip();
    zip.addFile("episode.bin", Buffer.from("payload-".repeat(20_000)));
    zip.writeZip(zipPath);
    corruptFirstZipPayload(zipPath);

    const result = await extractPackageArchives({
      packageDir,
      targetDir,
      cleanupMode: "none",
      conflictMode: "overwrite",
      removeLinks: false,
      removeSamples: false
    });

    expect(result).toEqual(expect.objectContaining({ extracted: 0, failed: 1 }));
    expect(result.lastError).not.toContain("Gemeldete Extract-Ausgabe existiert nicht");
    expect(result.lastError).toMatch(/crc|data|checksum|zip|archive/i);
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

  it.each(["7zjbinding", "zip4j"])("preflights every %s entry before overwriting an earlier safe target", (backend) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `rd-jvm-full-preflight-${backend}-`));
    tempDirs.push(root);
    const targetDir = path.join(root, "out");
    fs.mkdirSync(targetDir, { recursive: true });
    const safePath = path.join(targetDir, "00-safe.txt");
    const aliasPath = path.join(targetDir, "zz-name");
    fs.writeFileSync(safePath, "foreign-safe");
    fs.writeFileSync(aliasPath, "foreign-alias");
    const zipPath = path.join(root, "preflight.zip");
    const zip = new AdmZip();
    zip.addFile("00-safe.txt", Buffer.from("package-safe"));
    zip.addFile("zz-name.", Buffer.from("package-invalid"));
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
    expect(fs.readFileSync(safePath, "utf8")).toBe("foreign-safe");
    expect(fs.readFileSync(aliasPath, "utf8")).toBe("foreign-alias");
  });

  it.each(["7zjbinding", "zip4j"].flatMap((backend) => rawPlanConflictModes.flatMap((conflictMode) => jvmTargetCollisionCases.map(([label, entries]) => [backend, conflictMode, label, entries] as const))))(
    "rejects %s %s %s before any target mutation",
    (backend, conflictMode, _label, entries) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), `rd-jvm-target-plan-${backend}-`));
      tempDirs.push(root);
      const targetDir = path.join(root, "out");
      fs.mkdirSync(targetDir, { recursive: true });
      const sentinelPath = path.join(targetDir, "sentinel.txt");
      fs.writeFileSync(sentinelPath, "foreign");
      const before = readTargetTree(targetDir);
      const zipPath = path.join(root, "collision.zip");
      writeZipFixture(zipPath, entries);
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
        conflictMode,
        "--backend",
        backend
      ], { encoding: "utf8" });

      expect(run.status).not.toBe(0);
      expect(readTargetTree(targetDir)).toEqual(before);
    }
  );

  it.each(["7zjbinding", "zip4j"].flatMap((backend) => rawPlanConflictModes.map((conflictMode) => [backend, conflictMode] as const)))("allows safely identical duplicate directory targets in %s with %s", (backend, conflictMode) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `rd-jvm-identical-directory-${backend}-`));
    tempDirs.push(root);
    const targetDir = path.join(root, "out");
    const zipPath = path.join(root, "directories.zip");
    writeZipFixture(zipPath, [
      { name: "same", directory: true },
      { name: "same", directory: true }
    ]);
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
      conflictMode,
      "--backend",
      backend
    ], { encoding: "utf8" });

    expect(run.status).toBe(0);
    expect(fs.readdirSync(targetDir)).toEqual(["same"]);
    expect(fs.statSync(path.join(targetDir, "same")).isDirectory()).toBe(true);
  });

  it.each(["7zjbinding", "zip4j"].flatMap((backend) => rawPlanConflictModes.map((conflictMode) => [backend, conflictMode] as const)))(
    "preserves existing-target %s behavior for %s",
    (backend, conflictMode) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), `rd-jvm-existing-target-${backend}-${conflictMode}-`));
      tempDirs.push(root);
      const targetDir = path.join(root, "out");
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, "same.txt"), "old");
      const zipPath = path.join(root, "existing-target.zip");
      writeZipFixture(zipPath, [{ name: "same.txt", content: "new" }]);
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
        conflictMode,
        "--backend",
        backend
      ], { encoding: "utf8" });

      expect(run.status).toBe(0);
      expect(fs.readFileSync(path.join(targetDir, "same.txt"), "utf8")).toBe(conflictMode === "overwrite" ? "new" : "old");
      if (conflictMode === "rename") {
        expect(fs.readFileSync(path.join(targetDir, "same (1).txt"), "utf8")).toBe("new");
      } else {
        expect(fs.existsSync(path.join(targetDir, "same (1).txt"))).toBe(false);
      }
    }
  );

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
