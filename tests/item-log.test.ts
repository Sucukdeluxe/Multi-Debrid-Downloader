import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureItemLog, getItemLogPath, initItemLogs, logItemEvent, shutdownItemLogs } from "../src/main/item-log";

const tempDirs: string[] = [];

afterEach(() => {
  shutdownItemLogs();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("item-log", () => {
  it("creates a persistent item log file", () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-ilog-"));
    tempDirs.push(baseDir);

    initItemLogs(baseDir);
    const logPath = ensureItemLog({
      itemId: "item-1",
      packageId: "pkg-1",
      packageName: "Test Paket",
      fileName: "episode.part2.rar",
      targetPath: "C:\\downloads\\Test Paket\\episode.part2.rar"
    });

    expect(logPath).not.toBeNull();
    expect(fs.existsSync(logPath!)).toBe(true);

    const content = fs.readFileSync(logPath!, "utf8");
    expect(content).toContain("Item-Log Start");
    expect(content).toContain("episode.part2.rar");
  });

  it("writes detail events into the item log", async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-ilog-"));
    tempDirs.push(baseDir);

    initItemLogs(baseDir);
    ensureItemLog({
      itemId: "item-2",
      packageId: "pkg-2",
      packageName: "Detail Paket",
      fileName: "episode.part2.rar",
      targetPath: "C:\\downloads\\Detail Paket\\episode.part2.rar"
    });

    logItemEvent("item-2", "ERROR", "Entpack-Fehler", {
      archive: "episode.part2.rar",
      code: "missing_parts",
      detail: "Unexpected end of archive"
    });

    await new Promise((resolve) => setTimeout(resolve, 350));

    const logPath = getItemLogPath("item-2");
    expect(logPath).not.toBeNull();
    const content = fs.readFileSync(logPath!, "utf8");
    expect(content).toContain("Entpack-Fehler");
    expect(content).toContain("archive=episode.part2.rar");
    expect(content).toContain("code=missing_parts");
  });

  it("redacts secrets, identities, direct links and local paths from item logs", async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-ilog-"));
    tempDirs.push(baseDir);

    initItemLogs(baseDir);
    ensureItemLog({
      itemId: "item-sensitive",
      packageId: "pkg-sensitive",
      packageName: "Sensitive Paket",
      fileName: "episode.part2.rar",
      targetPath: "C:\\Users\\Administrator\\Downloads\\Sensitive Paket\\episode.part2.rar"
    });

    logItemEvent(
      "item-sensitive",
      "ERROR",
      "Download https://ddownload.com/private/file.rar?auth=url-secret für user@example.net nach /mnt/downloads/file.rar fehlgeschlagen",
      {
        downloadUrl: "https://ddownload.com/private/file.rar?auth=url-secret",
        password: "password-secret-value",
        metadata: {
          cookies: "sid=cookie-secret-value",
          username: "user@example.net",
          localPath: "\\\\server\\share\\file.rar"
        }
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 350));

    const logPath = getItemLogPath("item-sensitive");
    expect(logPath).not.toBeNull();
    const content = fs.readFileSync(logPath!, "utf8");
    expect(content).toMatch(/ddownload\.com#[a-f0-9]{10}/);
    expect(content).toContain("<redacted>");
    expect(content).toContain("<redacted-account>");
    expect(content).toContain("<redacted-path>");
    expect(content).not.toContain("/private/file.rar");
    expect(content).not.toContain("url-secret");
    expect(content).not.toContain("password-secret-value");
    expect(content).not.toContain("cookie-secret-value");
    expect(content).not.toContain("user@example.net");
    expect(content).not.toContain("C:\\Users\\Administrator");
    expect(content).not.toContain("/mnt/downloads");
    expect(content).not.toContain("\\\\server\\share");
  });

  it("keeps traversal-like item ids inside the item log directory", () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-ilog-"));
    tempDirs.push(baseDir);

    initItemLogs(baseDir);
    const logPath = ensureItemLog({
      itemId: "..\\..\\outside",
      packageId: "pkg-traversal",
      packageName: "Traversal Paket",
      fileName: "episode.part2.rar",
      targetPath: "C:\\downloads\\Traversal Paket\\episode.part2.rar"
    });

    expect(logPath).not.toBeNull();
    const logsDir = path.resolve(path.join(baseDir, "item-logs"));
    const resolvedLogPath = path.resolve(logPath!);
    expect(resolvedLogPath === logsDir || resolvedLogPath.startsWith(`${logsDir}${path.sep}`)).toBe(true);
  });
});
