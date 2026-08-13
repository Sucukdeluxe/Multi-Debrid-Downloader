import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensurePackageLog, getPackageLogPath, initPackageLogs, logPackageEvent, shutdownPackageLogs } from "../src/main/package-log";

const tempDirs: string[] = [];

afterEach(() => {
  shutdownPackageLogs();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("package-log", () => {
  it("creates a persistent package log file", () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-plog-"));
    tempDirs.push(baseDir);

    initPackageLogs(baseDir);
    const logPath = ensurePackageLog({
      packageId: "pkg-1",
      name: "Test Paket",
      outputDir: "C:\\downloads\\Test Paket",
      extractDir: "C:\\extract\\Test Paket"
    });

    expect(logPath).not.toBeNull();
    expect(fs.existsSync(logPath!)).toBe(true);

    const content = fs.readFileSync(logPath!, "utf8");
    expect(content).toContain("Paket-Log Start");
    expect(content).toContain("Test Paket");
  });

  it("writes detail events into the package log", async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-plog-"));
    tempDirs.push(baseDir);

    initPackageLogs(baseDir);
    ensurePackageLog({
      packageId: "pkg-2",
      name: "Detail Paket",
      outputDir: "C:\\downloads\\Detail Paket",
      extractDir: "C:\\extract\\Detail Paket"
    });

    logPackageEvent("pkg-2", "INFO", "Passwort-Versuch", {
      archive: "episode.part1.rar",
      attempt: "1/3",
      password: "\"secret\""
    });

    await new Promise((resolve) => setTimeout(resolve, 350));

    const logPath = getPackageLogPath("pkg-2");
    expect(logPath).not.toBeNull();
    const content = fs.readFileSync(logPath!, "utf8");
    expect(content).toContain("Passwort-Versuch");
    expect(content).toContain("archive=episode.part1.rar");
    expect(content).toContain("password=<redacted>");
    expect(content).not.toContain("\"secret\"");
  });

  it("redacts secrets, identities, direct links and local paths from package logs", async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-plog-"));
    tempDirs.push(baseDir);

    initPackageLogs(baseDir);
    ensurePackageLog({
      packageId: "pkg-sensitive",
      name: "Sensitive Paket",
      outputDir: "C:\\Users\\Administrator\\Downloads\\Sensitive Paket",
      extractDir: "/srv/downloads/Sensitive Paket"
    });

    logPackageEvent(
      "pkg-sensitive",
      "ERROR",
      "Abruf https://rapidgator.net/file/private-id/archive.rar?token=query-secret für owner@example.org unter C:\\Users\\Administrator\\Downloads\\archive.rar fehlgeschlagen",
      {
        directUrl: "https://rapidgator.net/file/private-id/archive.rar?token=query-secret",
        apiToken: "token-secret-value",
        nested: {
          cookie: "session=cookie-secret-value",
          email: "owner@example.org",
          outputPath: "/home/downloader/archive.rar"
        }
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 350));

    const logPath = getPackageLogPath("pkg-sensitive");
    expect(logPath).not.toBeNull();
    const content = fs.readFileSync(logPath!, "utf8");
    expect(content).toMatch(/rapidgator\.net#[a-f0-9]{10}/);
    expect(content).toContain("<redacted>");
    expect(content).toContain("<redacted-account>");
    expect(content).toContain("<redacted-path>");
    expect(content).not.toContain("private-id");
    expect(content).not.toContain("query-secret");
    expect(content).not.toContain("token-secret-value");
    expect(content).not.toContain("cookie-secret-value");
    expect(content).not.toContain("owner@example.org");
    expect(content).not.toContain("C:\\Users\\Administrator");
    expect(content).not.toContain("/home/downloader");
    expect(content).not.toContain("/srv/downloads");
  });

  it("keeps traversal-like package ids inside the package log directory", () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-plog-"));
    tempDirs.push(baseDir);

    initPackageLogs(baseDir);
    const logPath = ensurePackageLog({
      packageId: "..\\..\\outside",
      name: "Traversal Paket",
      outputDir: "C:\\downloads\\Traversal Paket",
      extractDir: "C:\\extract\\Traversal Paket"
    });

    expect(logPath).not.toBeNull();
    const logsDir = path.resolve(path.join(baseDir, "package-logs"));
    const resolvedLogPath = path.resolve(logPath!);
    expect(resolvedLogPath === logsDir || resolvedLogPath.startsWith(`${logsDir}${path.sep}`)).toBe(true);
  });
});
