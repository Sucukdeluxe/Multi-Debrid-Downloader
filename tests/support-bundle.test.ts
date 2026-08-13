import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildSupportBundle,
  createSupportBundleExportRunner,
  writeSupportBundleAtomically
} from "../src/main/support-bundle";
import type { DownloadManager } from "../src/main/download-manager";
import { getSessionLogPath, initSessionLog, shutdownSessionLog } from "../src/main/session-log";

const tempDirs: string[] = [];
const legacyManifestFile = ["debug_", "a", "i", "_manifest.json"].join("");

afterEach(() => {
  shutdownSessionLog();
  for (const dir of tempDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {  }
  }
});

function fakeManager(): DownloadManager {
  const snapshot = {
    stats: {},
    session: { packages: {}, items: {}, packageOrder: [] },
    speedText: "",
    etaText: "",
    canStart: false,
    canStop: false,
    canPause: false
  };
  return {
    getSnapshot: () => snapshot,
    getPackageLogPath: () => null,
    getItemLogPath: () => null
  } as unknown as DownloadManager;
}

function populatedFakeManager(): DownloadManager {
  const snapshot = {
    stats: {},
    session: {
      packages: {
        "package-1": { id: "package-1", name: "Paket", itemIds: ["item-1"] }
      },
      items: {
        "item-1": { id: "item-1", packageId: "package-1", fileName: "datei.bin" }
      },
      packageOrder: ["package-1"]
    },
    speedText: "",
    etaText: "",
    canStart: false,
    canStop: false,
    canPause: false
  };
  return {
    getSnapshot: () => snapshot,
    getPackageLogPath: () => { throw new Error("package log getter must not run"); },
    getItemLogPath: () => { throw new Error("item log getter must not run"); }
  } as unknown as DownloadManager;
}

function sensitiveActiveManager(itemCount = 1): DownloadManager {
  const packages = {
    "package-sensitive": {
      id: "package-sensitive",
      name: "Private Collection",
      outputDir: "C:\\Users\\Alice\\Downloads\\Private Collection",
      extractDir: "C:\\Users\\Alice\\Extracted\\Private Collection",
      status: "downloading",
      itemIds: Array.from({ length: itemCount }, (_, index) => `item-${index}`),
      cancelled: false,
      enabled: true,
      cleanedUrls: ["https://files.example.test/archive?api_key=cleaned-secret#private"],
      createdAt: 1,
      updatedAt: 2
    }
  };
  const items = Object.fromEntries(Array.from({ length: itemCount }, (_, index) => [
    `item-${index}`,
    {
      id: `item-${index}`,
      packageId: "package-sensitive",
      url: `https://url-user:url-pass@files.example.test/archive-${index}?token=query-secret-${index}#fragment-secret`,
      provider: "realdebrid",
      status: "downloading",
      retries: 0,
      speedBps: 1024,
      downloadedBytes: index,
      totalBytes: 2048,
      progressPercent: 50,
      fileName: `private-${index}.bin`,
      targetPath: `C:\\Users\\Alice\\Downloads\\Private Collection\\private-${index}.bin`,
      resumable: true,
      attempts: 1,
      lastError: "Authorization: Bearer item-bearer-secret",
      fullStatus: "Cookie: session=item-cookie-secret",
      createdAt: 1,
      updatedAt: index + 2
    }
  ]));
  const snapshot = {
    stats: {},
    session: {
      version: 1,
      packageOrder: ["package-sensitive"],
      packages,
      items,
      runStartedAt: 1,
      totalDownloadedBytes: 10,
      summaryText: "password=summary-secret",
      reconnectUntil: 0,
      reconnectReason: "api_key=reconnect-secret",
      paused: false,
      running: true,
      updatedAt: 2
    },
    speedText: "Geschwindigkeit: 1 KB/s",
    etaText: "ETA: 1m",
    canStart: false,
    canStop: true,
    canPause: true
  };
  return {
    getSnapshot: () => snapshot,
    getPackageLogPath: () => { throw new Error("package log getter must not run"); },
    getItemLogPath: () => { throw new Error("item log getter must not run"); }
  } as unknown as DownloadManager;
}

describe("buildSupportBundle (async, non-blocking)", () => {
  it("returns a Promise and produces a valid zip with overview + a real on-disk file", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-bundle-"));
    tempDirs.push(root);
    fs.writeFileSync(path.join(root, "debug_host.txt"), "host-info-test", "utf8");
    fs.writeFileSync(path.join(root, "debug_support_manifest.json"), JSON.stringify({ purpose: "support" }), "utf8");
    fs.writeFileSync(path.join(root, legacyManifestFile), JSON.stringify({ purpose: "legacy" }), "utf8");

    const promise = buildSupportBundle(fakeManager(), root, { hostDiagnosticsMode: "none" });
    expect(promise).toBeInstanceOf(Promise);

    const buffer = await promise;
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);

    const entries = new AdmZip(buffer).getEntries().map((e) => e.entryName);
    expect(entries).toContain("overview/meta.json");
    expect(entries).toContain("overview/settings.json");
    expect(entries).toContain("runtime/debug_host.txt");
    expect(entries).toContain("runtime/debug_support_manifest.json");
    expect(entries).toContain("overview/support-manifest.json");
    expect(entries).not.toContain(`runtime/${legacyManifestFile}`);
    expect(entries).not.toContain(["overview/", "a", "i-manifest.json"].join(""));

    const hostEntry = new AdmZip(buffer).getEntry("runtime/debug_host.txt");
    expect(hostEntry?.getData().toString("utf8")).toBe("host-info-test");
  });

  it("does not block the event loop while building (a concurrent timer still fires)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-bundle-"));
    tempDirs.push(root);

    let timerFired = false;
    const timer = setTimeout(() => { timerFired = true; }, 0);
    await buildSupportBundle(fakeManager(), root, { hostDiagnosticsMode: "none" });
    clearTimeout(timer);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(timerFired).toBe(true);
  });

  it("includes only recent directory logs without live duplicates or log getter side effects", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-bundle-"));
    tempDirs.push(root);
    const itemLogs = path.join(root, "item-logs");
    fs.mkdirSync(itemLogs, { recursive: true });
    const recentLog = path.join(itemLogs, "recent.txt");
    const oldLog = path.join(itemLogs, "old.txt");
    fs.writeFileSync(recentLog, "recent", "utf8");
    fs.writeFileSync(oldLog, "old", "utf8");
    const oldTimestamp = new Date(Date.now() - 9 * 60 * 60 * 1000);
    fs.utimesSync(oldLog, oldTimestamp, oldTimestamp);

    const buffer = await buildSupportBundle(populatedFakeManager(), root, {
      hostDiagnosticsMode: "none",
      debugSetupMode: "deferred"
    });
    const entries = new AdmZip(buffer).getEntries().map((entry) => entry.entryName);

    expect(entries).toContain("logs/item-logs/recent.txt");
    expect(entries).not.toContain("logs/item-logs/old.txt");
    expect(entries.some((entry) => entry.startsWith("logs/live/"))).toBe(false);
  });

  it("includes each physical session log only once", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-bundle-"));
    tempDirs.push(root);
    initSessionLog(root);
    const sessionLogPath = getSessionLogPath();
    expect(sessionLogPath).not.toBeNull();

    const buffer = await buildSupportBundle(fakeManager(), root, {
      hostDiagnosticsMode: "none",
      debugSetupMode: "deferred"
    });
    const entries = new AdmZip(buffer).getEntries().map((entry) => entry.entryName);
    const sessionEntries = entries.filter((entry) => (
      entry === "logs/session.log" || entry.startsWith("logs/session-logs/")
    ));

    expect(sessionEntries).toHaveLength(1);
  });

  it("bounds recent item logs to the newest diagnostic files", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-bundle-"));
    tempDirs.push(root);
    const itemLogs = path.join(root, "item-logs");
    fs.mkdirSync(itemLogs, { recursive: true });
    const baseTime = Date.now() - 60_000;
    for (let index = 0; index < 365; index += 1) {
      const filePath = path.join(itemLogs, `item-${String(index).padStart(3, "0")}.txt`);
      fs.writeFileSync(filePath, String(index), "utf8");
      const timestamp = new Date(baseTime + index);
      fs.utimesSync(filePath, timestamp, timestamp);
    }

    const buffer = await buildSupportBundle(fakeManager(), root, {
      hostDiagnosticsMode: "none",
      debugSetupMode: "deferred"
    });
    const entries = new AdmZip(buffer).getEntries().map((entry) => entry.entryName);
    const itemEntries = entries.filter((entry) => entry.startsWith("logs/item-logs/"));

    expect(itemEntries).toHaveLength(16);
    expect(itemEntries).not.toContain("logs/item-logs/item-000.txt");
    expect(itemEntries).toContain("logs/item-logs/item-364.txt");
  });

  it("redacts active DTOs, runtime text and logs at the ZIP boundary", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-bundle-sensitive-"));
    tempDirs.push(root);
    fs.writeFileSync(path.join(root, "rd_downloader_config.json"), JSON.stringify({
      megaDebridWebCredentials: "primary-user:primary-password-secret\nsecondary-user:secondary-password-secret",
      megaDebridWebEnabled: true
    }), "utf8");
    const itemLogs = path.join(root, "item-logs");
    fs.mkdirSync(itemLogs, { recursive: true });
    fs.writeFileSync(path.join(itemLogs, "token=filename-secret.log"), [
      "Authorization: Bearer log-bearer-secret",
      "Cookie: session=log-cookie-secret; auth=second-cookie-secret",
      "username=account-secret",
      "password=log-password-secret",
      "api_key=log-api-key-secret",
      "provider rejected secondary-password-secret during rotation",
      "https://log-user:log-pass@files.example.test/archive?token=log-query-secret#log-fragment-secret",
      "C:\\Users\\Alice\\Downloads\\Private Collection\\private.bin"
    ].join("\n"), "utf8");
    fs.writeFileSync(path.join(root, "debug_support_manifest.json"), JSON.stringify({
      authorization: "Bearer manifest-bearer-secret",
      supportManifestPath: "C:\\Users\\Alice\\AppData\\debug_support_manifest.json",
      endpoint: "https://support.example.test/check?api_key=manifest-query-secret#manifest-fragment"
    }), "utf8");

    const buffer = await buildSupportBundle(sensitiveActiveManager(), root, {
      hostDiagnosticsMode: "none",
      debugSetupMode: "deferred"
    });
    const zip = new AdmZip(buffer);
    const archiveText = zip.getEntries()
      .map((entry) => `${entry.entryName}\n${entry.getData().toString("utf8")}`)
      .join("\n");
    const forbidden = [
      root,
      "C:\\Users\\Alice",
      "url-user",
      "url-pass",
      "query-secret-0",
      "fragment-secret",
      "item-bearer-secret",
      "item-cookie-secret",
      "summary-secret",
      "reconnect-secret",
      "cleaned-secret",
      "filename-secret",
      "log-bearer-secret",
      "log-cookie-secret",
      "second-cookie-secret",
      "account-secret",
      "log-password-secret",
      "log-api-key-secret",
      "primary-password-secret",
      "secondary-password-secret",
      "log-query-secret",
      "log-fragment-secret",
      "manifest-bearer-secret",
      "manifest-query-secret",
      "manifest-fragment"
    ];

    for (const secret of forbidden) {
      expect(archiveText).not.toContain(secret);
    }
    expect(archiveText).toContain("<redacted>");
    expect(archiveText).toContain("<local-path>");
    const itemOverview = JSON.parse(zip.getEntry("overview/items.json")?.getData().toString("utf8") || "{}") as {
      items?: Array<Record<string, unknown>>;
    };
    expect(itemOverview.items?.[0]).toMatchObject({ sourceHost: "files.example.test" });
    expect(itemOverview.items?.[0]).not.toHaveProperty("url");
  });

  it("bounds active DTOs and recent log tails while keeping the event loop responsive", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-bundle-load-"));
    tempDirs.push(root);
    const itemLogs = path.join(root, "item-logs");
    fs.mkdirSync(itemLogs, { recursive: true });
    const payload = `${"x".repeat(512 * 1024)}\napi_key=tail-secret`;
    for (let index = 0; index < 48; index += 1) {
      fs.writeFileSync(path.join(itemLogs, `active-${String(index).padStart(2, "0")}.log`), payload, "utf8");
    }
    const oldRotatedLog = path.join(itemLogs, "rotated.log.old");
    fs.writeFileSync(oldRotatedLog, "api_key=old-secret", "utf8");
    const oldTimestamp = new Date(Date.now() - 9 * 60 * 60 * 1000);
    fs.utimesSync(oldRotatedLog, oldTimestamp, oldTimestamp);

    const timerGaps: number[] = [];
    let lastTick = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      timerGaps.push(now - lastTick);
      lastTick = now;
    }, 5);
    const buffer = await buildSupportBundle(sensitiveActiveManager(1_800), root, {
      hostDiagnosticsMode: "none",
      debugSetupMode: "deferred"
    });
    clearInterval(timer);

    const zip = new AdmZip(buffer);
    const logEntries = zip.getEntries().filter((entry) => entry.entryName.startsWith("logs/item-logs/"));
    const itemOverview = JSON.parse(zip.getEntry("overview/items.json")?.getData().toString("utf8") || "{}") as {
      count?: number;
      included?: number;
      omitted?: number;
      items?: unknown[];
    };
    const totalUncompressedBytes = zip.getEntries().reduce((sum, entry) => sum + entry.getData().length, 0);

    expect(logEntries.length).toBeLessThanOrEqual(16);
    expect(Math.max(...logEntries.map((entry) => entry.getData().length))).toBeLessThanOrEqual(256 * 1024);
    expect(logEntries.some((entry) => entry.entryName.includes("rotated"))).toBe(false);
    expect(itemOverview.count).toBe(1_800);
    expect(itemOverview.items?.length).toBeLessThanOrEqual(500);
    expect(itemOverview.omitted).toBeGreaterThan(0);
    expect(totalUncompressedBytes).toBeLessThan(8 * 1024 * 1024);
    expect(timerGaps.length).toBeGreaterThan(2);
    expect(Math.max(...timerGaps)).toBeLessThan(100);
  }, 15_000);
});

describe("support bundle export runner", () => {
  it("returns a visible busy result for reentry without choosing another target", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-bundle-export-"));
    tempDirs.push(root);
    const target = path.join(root, "support.zip");
    let chooseCount = 0;
    let releaseBuild: (buffer: Buffer) => void = () => undefined;
    let signalBuildStarted: () => void = () => undefined;
    const buildStarted = new Promise<void>((resolve) => { signalBuildStarted = resolve; });
    const buildPending = new Promise<Buffer>((resolve) => { releaseBuild = resolve; });
    const run = createSupportBundleExportRunner({
      chooseFile: async () => {
        chooseCount += 1;
        return target;
      },
      build: async () => {
        signalBuildStarted();
        return buildPending;
      },
      write: async () => undefined
    });

    const first = run();
    await buildStarted;
    const second = await run();

    expect(second).toEqual({
      saved: false,
      busy: true,
      message: "Support-Bundle wird bereits erstellt."
    });
    expect(chooseCount).toBe(1);

    releaseBuild(Buffer.from("zip"));
    await expect(first).resolves.toEqual({ saved: true, busy: false, filePath: target });
  });

  it("reports success only after the target write has completed", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-bundle-export-"));
    tempDirs.push(root);
    const target = path.join(root, "support.zip");
    let releaseWrite: () => void = () => undefined;
    let signalWriteStarted: () => void = () => undefined;
    let successCount = 0;
    const writeStarted = new Promise<void>((resolve) => { signalWriteStarted = resolve; });
    const writePending = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const run = createSupportBundleExportRunner({
      chooseFile: async () => target,
      build: async () => Buffer.from("zip"),
      write: async () => {
        signalWriteStarted();
        await writePending;
      },
      onSuccess: async () => {
        successCount += 1;
      }
    });

    const result = run();
    await writeStarted;
    expect(successCount).toBe(0);

    releaseWrite();
    await expect(result).resolves.toEqual({ saved: true, busy: false, filePath: target });
    expect(successCount).toBe(1);
  });

  it("releases the busy guard after an export failure", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-bundle-export-"));
    tempDirs.push(root);
    const target = path.join(root, "support.zip");
    let writeCount = 0;
    const run = createSupportBundleExportRunner({
      chooseFile: async () => target,
      build: async () => Buffer.from("zip"),
      write: async () => {
        writeCount += 1;
        if (writeCount === 1) {
          throw new Error("write failed");
        }
      }
    });

    await expect(run()).rejects.toThrow("write failed");
    await expect(run()).resolves.toEqual({ saved: true, busy: false, filePath: target });
  });

  it("releases the busy guard after the target dialog is canceled", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-bundle-export-"));
    tempDirs.push(root);
    const target = path.join(root, "support.zip");
    let chooseCount = 0;
    const run = createSupportBundleExportRunner({
      chooseFile: async () => {
        chooseCount += 1;
        return chooseCount === 1 ? null : target;
      },
      build: async () => Buffer.from("zip"),
      write: async () => undefined
    });

    await expect(run()).resolves.toEqual({ saved: false, busy: false });
    await expect(run()).resolves.toEqual({ saved: true, busy: false, filePath: target });
  });

  it("replaces the target atomically without leaving temporary files", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-bundle-export-"));
    tempDirs.push(root);
    const target = path.join(root, "support.zip");
    fs.writeFileSync(target, "old", "utf8");

    await writeSupportBundleAtomically(target, Buffer.from("new"));

    expect(fs.readFileSync(target, "utf8")).toBe("new");
    expect(fs.readdirSync(root)).toEqual(["support.zip"]);
  });
});
