import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildSupportBundle,
  createSupportBundleExportRunner,
  type SupportBundleExportLifecycleEvent,
  writeSupportBundleAtomically
} from "../src/main/support-bundle";
import type { DownloadManager } from "../src/main/download-manager";
import { getSessionLogPath, initSessionLog, shutdownSessionLog } from "../src/main/session-log";
import { initAccountRotationLog, logAccountRotation, shutdownAccountRotationLog } from "../src/main/account-rotation-log";
import { configureLogger, flushLoggerSync, logger } from "../src/main/logger";
import { ensurePackageLog, initPackageLogs, logPackageEvent, shutdownPackageLogs } from "../src/main/package-log";
import { ensureItemLog, flushItemLogs, initItemLogs, logItemEvent, shutdownItemLogs } from "../src/main/item-log";
import { initTraceLog, logTraceEvent, setTraceEnabled, shutdownTraceLog } from "../src/main/trace-log";
import {
  primeDebridLinkRuntimeCooldownForTests,
  primeMegaDebridInFlightForTests,
  primeMegaDebridRuntimeCooldownForTests,
  resetDebridLinkRuntimeStateForTests,
  resetMegaDebridRuntimeStateForTests
} from "../src/main/debrid";
import { getDebridLinkApiKeyId } from "../src/shared/debrid-link-keys";
import { getMegaDebridAccountId } from "../src/shared/mega-debrid-accounts";

const tempDirs: string[] = [];
const legacyManifestFile = ["debug_", "a", "i", "_manifest.json"].join("");

afterEach(() => {
  shutdownTraceLog();
  shutdownItemLogs();
  shutdownPackageLogs();
  shutdownSessionLog();
  shutdownAccountRotationLog();
  resetDebridLinkRuntimeStateForTests();
  resetMegaDebridRuntimeStateForTests();
  flushLoggerSync();
  configureLogger(process.cwd());
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
    expect(entries).toContain("overview/debug-setup.json");
    expect(entries).not.toContain("overview/self-check.json");
    expect(entries).toContain("runtime/debug_host.txt");
    expect(entries).toContain("runtime/debug_support_manifest.json");
    expect(entries).toContain("overview/support-manifest.json");
    expect(entries).not.toContain(`runtime/${legacyManifestFile}`);
    expect(entries).not.toContain(["overview/", "a", "i-manifest.json"].join(""));

    const hostEntry = new AdmZip(buffer).getEntry("runtime/debug_host.txt");
    expect(hostEntry?.getData().toString("utf8")).toBe("host-info-test");
    const meta = JSON.parse(new AdmZip(buffer).getEntry("overview/meta.json")!.getData().toString("utf8"));
    expect(meta.limits).toMatchObject({
      directoryLogDiscoveryWindowHours: 8,
      currentAndRelevantLogsIgnoreAgeFilter: true
    });
    expect(meta.limits).not.toHaveProperty("logWindowHours");
  });

  it("replaces overview clear names with stable bundle-local aliases while retaining extension, size, status and correlation", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-bundle-aliases-"));
    tempDirs.push(root);
    fs.writeFileSync(path.join(root, "rd_history.json"), JSON.stringify([{
      id: "history-private-id",
      name: "Private Linux Collection.iso",
      totalBytes: 8_000,
      downloadedBytes: 8_000,
      fileCount: 1,
      provider: "megadebrid-web",
      completedAt: 4,
      durationSeconds: 5,
      status: "completed",
      outputDir: "C:\\Private\\History",
      urls: ["https://example.invalid/private"]
    }]), "utf8");
    const snapshot = {
      stats: {},
      session: {
        version: 1,
        packageOrder: ["package-private-id"],
        packages: {
          "package-private-id": {
            id: "package-private-id",
            name: "Private Series Collection.zip",
            outputDir: "C:\\Private\\Output",
            extractDir: "C:\\Private\\Extract",
            status: "downloading",
            itemIds: ["item-private-id"],
            cancelled: false,
            enabled: true,
            cleanedDownloadedBytes: 500,
            cleanedTotalBytes: 500,
            createdAt: 1,
            updatedAt: 2
          }
        },
        items: {
          "item-private-id": {
            id: "item-private-id",
            packageId: "package-private-id",
            url: "https://rapidgator.net/file/example",
            provider: "megadebrid-web",
            status: "downloading",
            retries: 0,
            speedBps: 100,
            downloadedBytes: 250,
            totalBytes: 1_000,
            progressPercent: 25,
            fileName: "Private.Show.S01E01.part1.rar",
            targetPath: "C:\\Private\\Output\\Private.Show.S01E01.part1.rar",
            resumable: true,
            attempts: 1,
            lastError: "",
            fullStatus: "Download läuft",
            createdAt: 1,
            updatedAt: 2,
            onlineStatus: "online"
          }
        },
        runStartedAt: 1,
        totalDownloadedBytes: 750,
        summaryText: "",
        reconnectUntil: 0,
        reconnectReason: "",
        paused: false,
        running: true,
        updatedAt: 2
      },
      speedText: "Geschwindigkeit: 100 B/s",
      etaText: "ETA: 1m",
      canStart: false,
      canStop: true,
      canPause: true
    };
    const manager = {
      getSnapshot: () => snapshot,
      getPackageLogPath: () => null,
      getItemLogPath: () => null
    } as unknown as DownloadManager;

    const buffer = await buildSupportBundle(manager, root, { hostDiagnosticsMode: "none", debugSetupMode: "deferred" });
    const zip = new AdmZip(buffer);
    const packages = JSON.parse(zip.getEntry("overview/packages.json")!.getData().toString("utf8"));
    const items = JSON.parse(zip.getEntry("overview/items.json")!.getData().toString("utf8"));
    const history = JSON.parse(zip.getEntry("overview/history.json")!.getData().toString("utf8"));
    const overviewText = [packages, items, history].map((value) => JSON.stringify(value)).join("\n");

    expect(packages.packages[0]).toMatchObject({
      id: "package-private-id",
      name: "package-001.zip",
      status: "downloading",
      downloadedBytes: 750,
      totalBytes: 1_500
    });
    expect(items.items[0]).toMatchObject({
      id: "item-private-id",
      packageId: "package-private-id",
      fileName: "item-001.rar",
      status: "downloading",
      downloadedBytes: 250,
      totalBytes: 1_000
    });
    expect(history.entries[0]).toMatchObject({
      id: "history-private-id",
      name: "history-001.iso",
      status: "completed",
      downloadedBytes: 8_000,
      totalBytes: 8_000
    });
    expect(overviewText).not.toContain("Private Series Collection.zip");
    expect(overviewText).not.toContain("Private.Show.S01E01.part1.rar");
    expect(overviewText).not.toContain("Private Linux Collection.iso");
  });

  it("adds provider runtime diagnostics with pool-local aliases and no internal account or key identifiers", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-bundle-provider-runtime-"));
    tempDirs.push(root);
    const disabledApiAccountId = getMegaDebridAccountId("beta-login");
    const disabledDebridKeyId = getDebridLinkApiKeyId("debrid-token-two");
    fs.writeFileSync(path.join(root, "rd_downloader_config.json"), JSON.stringify({
      megaDebridApiCredentials: "alpha-login:alpha-password\nbeta-login:beta-password",
      megaDebridWebCredentials: "gamma-login:gamma-password",
      megaDebridApiEnabled: true,
      megaDebridWebEnabled: false,
      megaDebridApiDisabledAccountIds: [disabledApiAccountId],
      debridLinkApiKeys: "debrid-token-one,debrid-token-two",
      debridLinkDisabledKeyIds: [disabledDebridKeyId]
    }), "utf8");
    const apiAccountKey = `${getMegaDebridAccountId("alpha-login")}:api`;
    const debridKeyId = getDebridLinkApiKeyId("debrid-token-one");
    primeMegaDebridRuntimeCooldownForTests(apiAccountKey, 60_000, "private account cooldown detail");
    primeMegaDebridInFlightForTests(apiAccountKey, 2);
    primeDebridLinkRuntimeCooldownForTests(debridKeyId, 45_000, "private key cooldown detail");

    const buffer = await buildSupportBundle(fakeManager(), root, { hostDiagnosticsMode: "none", debugSetupMode: "deferred" });
    const runtime = JSON.parse(new AdmZip(buffer).getEntry("overview/runtime-diagnostics.json")!.getData().toString("utf8"));
    const providerText = JSON.stringify(runtime.providerRuntime);

    expect(runtime.providerRuntime).toMatchObject({
      megaDebrid: {
        rotationCursor: 0,
        pools: {
          api: {
            configuredCount: 2,
            activeCount: 1,
            disabledCount: 1,
            inFlight: 2,
            accounts: [{
              account: "Account 1/2",
              inFlight: 2,
              cooldown: {
                category: "temporary"
              }
            }]
          },
          web: {
            configuredCount: 1,
            activeCount: 0,
            enabled: false,
            inFlight: 0
          }
        }
      },
      debridLink: {
        configuredCount: 2,
        activeCount: 1,
        disabledCount: 1,
        keys: [{
          account: "Key 1/2",
          cooldown: {
            category: "temporary"
          }
        }]
      }
    });
    expect(runtime.providerRuntime.megaDebrid.pools.api.accounts[0].cooldown.remainingMs).toBeGreaterThan(0);
    expect(runtime.providerRuntime.debridLink.keys[0].cooldown.remainingMs).toBeGreaterThan(0);
    for (const forbidden of [
      "alpha-login",
      "beta-login",
      "gamma-login",
      "debrid-token-one",
      "debrid-token-two",
      getMegaDebridAccountId("alpha-login"),
      debridKeyId
    ]) {
      expect(providerText).not.toContain(forbidden);
    }
  });

  it("includes runtime rotation, disk-wait, export-phase and resume-recovery diagnostics", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-bundle-"));
    tempDirs.push(root);
    const snapshot = {
      stats: {},
      rotationEvents: [{
        id: "rotation-1",
        at: 1_234,
        level: "WARN",
        provider: "Mega-Debrid Web",
        accountLabel: "Account 2/3 (be***ta)",
        event: "FAILED",
        reason: "timeout",
        next: "Account 3/3 (ga***ma)"
      }],
      diskWaitEvents: [{
        phase: "download",
        ownerId: "item-resume",
        itemId: "item-resume",
        packageId: "package-resume",
        volumeKey: "C:",
        requiredBytes: 2_048,
        availableBytes: 1_024,
        deficitBytes: 1_024,
        retryAt: 2_000
      }],
      session: {
        version: 1,
        packageOrder: ["package-resume"],
        packages: {
          "package-resume": {
            id: "package-resume",
            name: "Resume",
            status: "queued",
            itemIds: ["item-resume"],
            cancelled: false,
            enabled: true,
            createdAt: 1,
            updatedAt: 2
          }
        },
        items: {
          "item-resume": {
            id: "item-resume",
            packageId: "package-resume",
            url: "https://rapidgator.net/file/example",
            provider: "megadebrid-web",
            status: "queued",
            retries: 2,
            speedBps: 0,
            downloadedBytes: 1_024,
            totalBytes: 2_048,
            progressPercent: 50,
            fileName: "resume.bin",
            targetPath: "C:\\Downloads\\resume.bin",
            resumable: true,
            attempts: 1,
            lastError: "range_ignored_on_resume:1024/2048",
            fullStatus: "Warte auf Teildatei-Freigabe",
            resumeLinkRenewalFailures: 2,
            resumeHardResetUsed: false,
            resumeResetPending: true,
            createdAt: 1,
            updatedAt: 2,
            onlineStatus: "online"
          }
        },
        runStartedAt: 1,
        totalDownloadedBytes: 1_024,
        summaryText: "",
        reconnectUntil: 0,
        reconnectReason: "",
        paused: false,
        running: true,
        updatedAt: 2
      },
      speedText: "Geschwindigkeit: 0 B/s",
      etaText: "ETA: --",
      canStart: false,
      canStop: true,
      canPause: true
    };
    const manager = {
      getSnapshot: () => snapshot,
      getPackageLogPath: () => null,
      getItemLogPath: () => null
    } as unknown as DownloadManager;

    const buffer = await buildSupportBundle(manager, root, { hostDiagnosticsMode: "none", debugSetupMode: "deferred" });
    const zip = new AdmZip(buffer);
    const runtimeDiagnostics = JSON.parse(zip.getEntry("overview/runtime-diagnostics.json")!.getData().toString("utf8"));
    const itemDiagnostics = JSON.parse(zip.getEntry("overview/items.json")!.getData().toString("utf8"));

    expect(runtimeDiagnostics).toMatchObject({
      bundleBuild: {
        state: "building",
        hostDiagnosticsMode: "none",
        debugSetupMode: "deferred"
      },
      rotationEvents: [{
        provider: "Mega-Debrid Web",
        accountLabel: "Account 2/3 (<redacted-account>)",
        event: "FAILED",
        reason: "timeout"
      }],
      diskWaitEvents: [{
        phase: "download",
        itemId: "item-resume",
        deficitBytes: 1_024
      }]
    });
    expect(runtimeDiagnostics.bundleBuild.startedAt).toEqual(expect.any(String));
    expect(itemDiagnostics.items[0]).toMatchObject({
      id: "item-resume",
      resumeLinkRenewalFailures: 2,
      resumeHardResetUsed: false,
      resumeResetPending: true
    });
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

  it("flushes every pending logger before reading bundle files", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-bundle-flush-"));
    tempDirs.push(root);
    flushLoggerSync();
    configureLogger(root);
    initSessionLog(root);
    initPackageLogs(root);
    initItemLogs(root);
    initTraceLog(root);
    setTraceEnabled(true, "bundle-flush-test", 0);
    ensurePackageLog({
      packageId: "package-flush",
      name: "Flush Package",
      outputDir: path.join(root, "output"),
      extractDir: path.join(root, "extract")
    });
    ensureItemLog({
      itemId: "item-flush",
      packageId: "package-flush",
      packageName: "Flush Package",
      fileName: "flush.bin",
      targetPath: path.join(root, "output", "flush.bin")
    });

    logger.info("main-buffer-marker");
    logPackageEvent("package-flush", "INFO", "package-buffer-marker");
    logItemEvent("item-flush", "INFO", "item-buffer-marker");
    logTraceEvent("INFO", "support", "trace-buffer-marker");

    const buffer = await buildSupportBundle(fakeManager(), root, {
      hostDiagnosticsMode: "none",
      debugSetupMode: "deferred"
    });
    const zip = new AdmZip(buffer);
    const packageEntry = zip.getEntries().find((entry) => entry.entryName.startsWith("logs/package-logs/"));
    const itemEntry = zip.getEntries().find((entry) => entry.entryName.startsWith("logs/item-logs/"));
    const entryNames = zip.getEntries().map((entry) => entry.entryName);

    expect(zip.getEntry("logs/rd_downloader.log")?.getData().toString("utf8") || "").toContain("main-buffer-marker");
    expect(zip.getEntry("logs/session.log")?.getData().toString("utf8") || "").toContain("main-buffer-marker");
    expect(zip.getEntry("logs/trace.log")?.getData().toString("utf8") || "").toContain("trace-buffer-marker");
    expect(packageEntry, entryNames.join("\n")).toBeDefined();
    expect(itemEntry, entryNames.join("\n")).toBeDefined();
    expect(packageEntry?.getData().toString("utf8") || "").toContain("package-buffer-marker");
    expect(itemEntry?.getData().toString("utf8") || "").toContain("item-buffer-marker");
  });

  it("redacts snapshot and runtime package and file names from the tailed main log", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-bundle-main-log-names-"));
    tempDirs.push(root);
    const packageName = "MAINPKG-BEGIN === MAINPKG-MIDDLE | fileName=MAINPKG-END";
    const fileName = "MAINFILE-BEGIN | packageName=MAINFILE-MIDDLE === MAINFILE-END.rar";
    const runtimeOnlyName = "RUNTIME-BEGIN | decoy=RUNTIME-MIDDLE === RUNTIME-END";
    flushLoggerSync();
    configureLogger(root);
    const mainLogPath = path.join(root, "rd_downloader.log");
    const completeTail = [
      "",
      "2026-08-13 12:00:00.000 [INFO] main-diagnostic-marker status=downloading",
      `2026-08-13 12:00:00.000 [INFO] runtime-name-marker packageName=${runtimeOnlyName} | status=queued`,
      `2026-08-13 12:00:00.000 [INFO] main-package-marker ${packageName}`,
      `2026-08-13 12:00:00.000 [INFO] main-file-marker ${fileName}`,
      ""
    ].join("\n");
    const partialOffset = 8;
    const fillerLength = 128 * 1024 - Buffer.byteLength(packageName.slice(partialOffset) + completeTail, "utf8");
    fs.appendFileSync(mainLogPath, `${packageName}${completeTail}${"z".repeat(fillerLength)}`, "utf8");
    const manager = {
      getSnapshot: () => ({
        stats: {},
        session: {
          version: 1,
          packages: {
            "package-main-log": {
              id: "package-main-log",
              name: packageName,
              outputDir: path.join(root, "output", packageName),
              extractDir: path.join(root, "extract", packageName),
              status: "downloading",
              itemIds: ["item-main-log"],
              cancelled: false,
              enabled: true,
              createdAt: 1,
              updatedAt: 2
            }
          },
          items: {
            "item-main-log": {
              id: "item-main-log",
              packageId: "package-main-log",
              url: "https://example.test/main-log",
              provider: "realdebrid",
              status: "downloading",
              retries: 0,
              speedBps: 1,
              downloadedBytes: 1,
              totalBytes: 2,
              progressPercent: 50,
              fileName,
              targetPath: path.join(root, "output", packageName, fileName),
              resumable: true,
              attempts: 1,
              lastError: "",
              fullStatus: "Download läuft",
              createdAt: 1,
              updatedAt: 2
            }
          },
          packageOrder: ["package-main-log"],
          running: true,
          paused: false,
          updatedAt: 2
        },
        speedText: "1 B/s",
        etaText: "1s",
        canStart: false,
        canStop: true,
        canPause: true
      }),
      getPackageLogPath: () => null,
      getItemLogPath: () => null
    } as unknown as DownloadManager;

    const buffer = await buildSupportBundle(manager, root, {
      hostDiagnosticsMode: "none",
      debugSetupMode: "deferred"
    });
    const mainLog = new AdmZip(buffer).getEntry("logs/rd_downloader.log")?.getData().toString("utf8") || "";

    for (const fragment of [
      "MAINPKG-BEGIN",
      "MAINPKG-MIDDLE",
      "MAINPKG-END",
      "MAINFILE-BEGIN",
      "MAINFILE-MIDDLE",
      "MAINFILE-END",
      "RUNTIME-BEGIN",
      "RUNTIME-MIDDLE",
      "RUNTIME-END"
    ]) {
      expect(mainLog).not.toContain(fragment);
    }
    expect(mainLog).toContain("main-diagnostic-marker");
    expect(mainLog).toContain("main-package-marker");
    expect(mainLog).toContain("main-file-marker");
  });

  it("redacts completed download names after the package was removed from the session", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-bundle-removed-main-log-names-"));
    tempDirs.push(root);
    flushLoggerSync();
    configureLogger(root);
    const fileName = "REMOVED-PRIVATE-FILE.part01.rar";
    const packageName = "REMOVED-PRIVATE-PACKAGE";
    fs.appendFileSync(
      path.join(root, "rd_downloader.log"),
      `2026-08-13 12:00:00.000 [INFO] Download fertig: ${fileName} (1.00 GB), pkg=${packageName}\n`,
      "utf8"
    );

    const buffer = await buildSupportBundle(fakeManager(), root, {
      hostDiagnosticsMode: "none",
      debugSetupMode: "deferred"
    });
    const mainLog = new AdmZip(buffer).getEntry("logs/rd_downloader.log")?.getData().toString("utf8") || "";

    expect(mainLog).toContain("Download fertig:");
    expect(mainLog).not.toContain(fileName);
    expect(mainLog).not.toContain(packageName);
  });

  it("redacts runtime package and file names from included package and item logs", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-bundle-runtime-names-"));
    tempDirs.push(root);
    const packageId = "package-runtime-private";
    const itemId = "item-runtime-private";
    const privatePackageName = "Family.Vacation.Private.Release";
    const privateFileName = "Family.Vacation.Private.Release.part01.rar";
    initPackageLogs(root);
    initItemLogs(root);
    ensurePackageLog({
      packageId,
      name: privatePackageName,
      outputDir: path.join(root, "output", privatePackageName),
      extractDir: path.join(root, "extract", privatePackageName)
    });
    ensureItemLog({
      itemId,
      packageId,
      packageName: privatePackageName,
      fileName: privateFileName,
      targetPath: path.join(root, "output", privatePackageName, privateFileName)
    });
    logPackageEvent(packageId, "INFO", `package-transfer-active ${privatePackageName}`, { status: "downloading" });
    logItemEvent(itemId, "INFO", `item-transfer-active ${privateFileName}`, { status: "downloading" });

    const manager = {
      getSnapshot: () => ({
        stats: {},
        session: {
          version: 1,
          packages: {
            [packageId]: {
              id: packageId,
              name: privatePackageName,
              outputDir: path.join(root, "output", privatePackageName),
              extractDir: path.join(root, "extract", privatePackageName),
              status: "downloading",
              itemIds: [itemId],
              cancelled: false,
              enabled: true,
              createdAt: 1,
              updatedAt: 2
            }
          },
          items: {
            [itemId]: {
              id: itemId,
              packageId,
              url: "https://rapidgator.net/file/runtime-private",
              provider: "megadebrid-web",
              status: "downloading",
              retries: 0,
              speedBps: 1024,
              downloadedBytes: 512,
              totalBytes: 1024,
              progressPercent: 50,
              fileName: privateFileName,
              targetPath: path.join(root, "output", privatePackageName, privateFileName),
              resumable: true,
              attempts: 1,
              lastError: "",
              fullStatus: "Download läuft",
              createdAt: 1,
              updatedAt: 2
            }
          },
          packageOrder: [packageId],
          running: true,
          paused: false,
          updatedAt: 2
        },
        speedText: "1 KB/s",
        etaText: "1s",
        canStart: false,
        canStop: true,
        canPause: true
      }),
      getPackageLogPath: () => null,
      getItemLogPath: () => null
    } as unknown as DownloadManager;

    const buffer = await buildSupportBundle(manager, root, {
      hostDiagnosticsMode: "none",
      debugSetupMode: "deferred"
    });
    const zip = new AdmZip(buffer);
    const packageLog = zip.getEntries()
      .find((entry) => entry.entryName.startsWith("logs/package-logs/"))
      ?.getData().toString("utf8") || "";
    const itemLog = zip.getEntries()
      .find((entry) => entry.entryName.startsWith("logs/item-logs/"))
      ?.getData().toString("utf8") || "";
    const overview = [
      zip.getEntry("overview/packages.json")?.getData().toString("utf8") || "",
      zip.getEntry("overview/items.json")?.getData().toString("utf8") || ""
    ].join("\n");

    expect(`${packageLog}\n${itemLog}`).not.toContain(privatePackageName);
    expect(`${packageLog}\n${itemLog}`).not.toContain(privateFileName);
    expect(packageLog).toContain(packageId);
    expect(itemLog).toContain(itemId);
    expect(packageLog).toContain("package-transfer-active");
    expect(itemLog).toContain("item-transfer-active");
    expect(`${packageLog}\n${itemLog}`).toContain("status=downloading");
    expect(overview).toContain('"name": "package-001.release"');
    expect(overview).toContain('"fileName": "item-001.rar"');
  });

  it("removes delimiter-injected package and file names from complete and tailed runtime logs", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-bundle-runtime-name-boundaries-"));
    tempDirs.push(root);
    const packageName = "PRIVATEPKG-BEGIN === PRIVATEPKG-MIDDLE | decoy=PRIVATEPKG-END";
    const fileName = "PRIVATEFILE-BEGIN | decoyField=PRIVATEFILE-MIDDLE | packageName=PRIVATEFILE-END.rar";
    initPackageLogs(root);
    initItemLogs(root);
    const packageLogPath = ensurePackageLog({
      packageId: "package-runtime-boundaries",
      name: packageName,
      outputDir: path.join(root, "output", packageName),
      extractDir: path.join(root, "extract", packageName)
    });
    const itemLogPath = ensureItemLog({
      itemId: "item-runtime-boundaries",
      packageId: "package-runtime-boundaries",
      packageName,
      fileName,
      targetPath: path.join(root, "output", packageName, fileName)
    });
    expect(packageLogPath).not.toBeNull();
    expect(itemLogPath).not.toBeNull();
    fs.appendFileSync(packageLogPath!, `2026-08-13 12:00:00.000 [INFO] package-diagnostic-marker ${packageName} | status=downloading\n`, "utf8");
    const partialOffset = 12;
    const completeTail = `\n2026-08-13 12:00:00.000 [INFO] item-diagnostic-marker ${fileName} | status=downloading\n`;
    const fillerLength = 128 * 1024 - Buffer.byteLength(fileName.slice(partialOffset) + completeTail, "utf8");
    fs.appendFileSync(itemLogPath!, `${"p".repeat(1024)}${fileName}${completeTail}${"z".repeat(fillerLength)}`, "utf8");

    const buffer = await buildSupportBundle(fakeManager(), root, {
      hostDiagnosticsMode: "none",
      debugSetupMode: "deferred"
    });
    const runtimeLogText = new AdmZip(buffer).getEntries()
      .filter((entry) => /logs\/(?:package|item)-logs\//.test(entry.entryName))
      .map((entry) => entry.getData().toString("utf8"))
      .join("\n");

    for (const fragment of [
      "PRIVATEPKG-BEGIN",
      "PRIVATEPKG-MIDDLE",
      "PRIVATEPKG-END",
      "PRIVATEFILE-BEGIN",
      "PRIVATEFILE-MIDDLE",
      "PRIVATEFILE-END"
    ]) {
      expect(runtimeLogText).not.toContain(fragment);
    }
    expect(runtimeLogText).toContain("package-diagnostic-marker");
    expect(runtimeLogText).toContain("item-diagnostic-marker");
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

  it("prioritizes active package and item logs beyond the bounded directory scan", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-bundle-priority-"));
    tempDirs.push(root);
    const packageLogs = path.join(root, "package-logs");
    const itemLogs = path.join(root, "item-logs");
    fs.mkdirSync(packageLogs, { recursive: true });
    fs.mkdirSync(itemLogs, { recursive: true });
    for (let index = 0; index < 2_048; index += 1) {
      const name = `${String(index).padStart(4, "0")}-filler.log`;
      fs.writeFileSync(path.join(packageLogs, name), "package filler", "utf8");
      fs.writeFileSync(path.join(itemLogs, name), "item filler", "utf8");
    }

    initPackageLogs(root);
    initItemLogs(root);
    ensurePackageLog({
      packageId: "zzzz-active-package",
      name: "Active Package",
      outputDir: path.join(root, "output"),
      extractDir: path.join(root, "extract")
    });
    ensureItemLog({
      itemId: "zzzz-active-item",
      packageId: "zzzz-active-package",
      packageName: "Active Package",
      fileName: "active.bin",
      targetPath: path.join(root, "output", "active.bin")
    });
    logPackageEvent("zzzz-active-package", "INFO", "active-package-marker");
    logItemEvent("zzzz-active-item", "INFO", "active-item-marker");

    const snapshot = {
      stats: {},
      session: {
        version: 1,
        packageOrder: ["zzzz-active-package"],
        packages: {
          "zzzz-active-package": {
            id: "zzzz-active-package",
            name: "Active Package",
            status: "downloading",
            itemIds: ["zzzz-active-item"],
            cancelled: false,
            enabled: true,
            createdAt: 1,
            updatedAt: 2
          }
        },
        items: {
          "zzzz-active-item": {
            id: "zzzz-active-item",
            packageId: "zzzz-active-package",
            url: "https://files.example.test/active",
            status: "downloading",
            retries: 0,
            speedBps: 1,
            downloadedBytes: 1,
            totalBytes: 2,
            progressPercent: 50,
            fileName: "active.bin",
            targetPath: path.join(root, "output", "active.bin"),
            resumable: true,
            attempts: 1,
            lastError: "",
            fullStatus: "Lädt",
            createdAt: 1,
            updatedAt: 2,
            onlineStatus: "online"
          }
        },
        runStartedAt: 1,
        totalDownloadedBytes: 1,
        summaryText: "",
        reconnectUntil: 0,
        reconnectReason: "",
        paused: false,
        running: true,
        updatedAt: 2
      },
      speedText: "Geschwindigkeit: 1 B/s",
      etaText: "ETA: 1s",
      canStart: false,
      canStop: true,
      canPause: true
    };
    const manager = {
      getSnapshot: () => snapshot,
      getPackageLogPath: () => { throw new Error("bundle export must not create package logs"); },
      getItemLogPath: () => { throw new Error("bundle export must not create item logs"); }
    } as unknown as DownloadManager;

    const buffer = await buildSupportBundle(manager, root, {
      hostDiagnosticsMode: "none",
      debugSetupMode: "deferred"
    });
    const zip = new AdmZip(buffer);
    const packageEntries = zip.getEntries().filter((entry) => entry.entryName.startsWith("logs/package-logs/"));
    const itemEntries = zip.getEntries().filter((entry) => entry.entryName.startsWith("logs/item-logs/"));
    const packageText = packageEntries.map((entry) => entry.getData().toString("utf8")).join("\n");
    const itemText = itemEntries.map((entry) => entry.getData().toString("utf8")).join("\n");

    expect(packageText).toContain("active-package-marker");
    expect(itemText).toContain("active-item-marker");
    expect(packageEntries.length).toBeLessThanOrEqual(8);
    expect(itemEntries.length).toBeLessThanOrEqual(16);
  }, 15_000);

  it("redacts active DTOs, runtime text and logs at the ZIP boundary", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-bundle-sensitive-"));
    tempDirs.push(root);
    const escapedSecret = "prefix\"suffix\\trail\tend";
    const privatePackageName = "Private Default Package Name";
    const firstKeyId = getDebridLinkApiKeyId("abc123456789xyz");
    fs.writeFileSync(path.join(root, "rd_downloader_config.json"), JSON.stringify({
      megaDebridWebCredentials: `primary-user:primary-password-secret\nsecondary-user:secondary-password-secret\nZ9:Q7!\nAlice:${escapedSecret}`,
      debridLinkApiKeys: "abc123456789xyz,def987654321uvw",
      debridLinkApiKeyDailyUsageBytes: { [firstKeyId]: 1234 },
      debridLinkApiKeyTotalUsageBytes: { [firstKeyId]: 5678 },
      packageName: privatePackageName,
      megaDebridWebEnabled: true
    }), "utf8");
    initAccountRotationLog(root);
    logAccountRotation("INFO", "Debrid-Link", "Key 1 (abc*********xyz)", "TEST");
    logAccountRotation("WARN", "Debrid-Link", "Key 2 (def*********uvw)", "FAILED", { reason: "fixture" });
    logAccountRotation("WARN", "Mega-Debrid", "Account 9/9 (Re*******er)", "FAILED", { next: "Account 8/9 (Al*******ce)" });
    logAccountRotation("WARN", "Debrid-Link", "Key 9/9 (old***********ken)", "FAILED", { next: "Key 8/9 (ret***********key)" });
    const itemLogs = path.join(root, "item-logs");
    fs.mkdirSync(itemLogs, { recursive: true });
    fs.writeFileSync(path.join(itemLogs, "token=filename-secret.log"), [
      "Authorization: Bearer log-bearer-secret",
      "Cookie: session=log-cookie-secret; auth=second-cookie-secret",
      "username=account-secret",
      "password=log-password-secret",
      "api_key=log-api-key-secret",
      "provider rejected secondary-password-secret during rotation",
      "rotation rejected account Z9 before fallback Q7!",
      "rotation tried Mega account Z*",
      "https://log-user:log-pass@files.example.test/archive?token=log-query-secret#log-fragment-secret",
      "https://private-support-host.invalid/archive?id=private-resource",
      "https://private.example/Alice/after-alice-url-segment?token=x",
      "C:\\Users\\Alice\\Downloads\\Private Collection\\private.bin",
      "C:/Users/Alice/Downloads/Private Collection/forward-private.bin",
      "C:/Users/Alice/after-alice-path-segment/private.bin",
      "file:///C:/Users/Alice/Downloads/Private%20Collection/file-private.bin",
      JSON.stringify({ password: escapedSecret })
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
      "Z9",
      "Q7!",
      "Z*",
      "abc*********xyz",
      "def*********uvw",
      "Re*******er",
      "Al*******ce",
      "old***********ken",
      "ret***********key",
      escapedSecret,
      JSON.stringify(escapedSecret).slice(1, -1),
      "log-query-secret",
      "log-fragment-secret",
      "private-support-host.invalid",
      "after-alice-url-segment",
      "after-alice-path-segment",
      "forward-private.bin",
      "file-private.bin",
      "manifest-bearer-secret",
      "manifest-query-secret",
      "manifest-fragment",
      privatePackageName,
      firstKeyId
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

  it("redacts slash-escaped URLs at the ZIP boundary after credentials change", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-bundle-escaped-url-"));
    tempDirs.push(root);
    const itemLogs = path.join(root, "item-logs");
    fs.mkdirSync(itemLogs, { recursive: true });
    fs.writeFileSync(
      path.join(itemLogs, "escaped-url.log"),
      String.raw`{"url":"https:\/\/legacy-user:p!7@escaped-private-host.invalid\/secret?value=private"}`,
      "utf8"
    );

    const buffer = await buildSupportBundle(fakeManager(), root, {
      hostDiagnosticsMode: "none",
      debugSetupMode: "deferred"
    });
    const text = new AdmZip(buffer).getEntry("logs/item-logs/escaped-url.log")?.getData().toString("utf8") || "";

    expect(text).toContain("<redacted-url>");
    expect(text).not.toContain("legacy-user");
    expect(text).not.toContain("p!7");
    expect(text).not.toContain("escaped-private-host.invalid");
  });

  it("redacts historical comma-style account labels at the ZIP boundary", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-bundle-account-label-"));
    tempDirs.push(root);
    const itemLogs = path.join(root, "item-logs");
    fs.mkdirSync(itemLogs, { recursive: true });
    fs.writeFileSync(path.join(itemLogs, "historical-labels.log"), [
      "Mega-Debrid (Account 1/3, Hi*******cal): uebersprungen",
      "Debrid-Link (Key 2/4, old********value): fehlgeschlagen"
    ].join("\n"), "utf8");

    const buffer = await buildSupportBundle(fakeManager(), root, {
      hostDiagnosticsMode: "none",
      debugSetupMode: "deferred"
    });
    const text = new AdmZip(buffer).getEntry("logs/item-logs/historical-labels.log")?.getData().toString("utf8") || "";

    expect(text).toContain("Account 1/3, <redacted-account>");
    expect(text).toContain("Key 2/4, <redacted-account>");
    expect(text).not.toContain("Hi*******cal");
    expect(text).not.toContain("old********value");
  });

  it("keeps static archive directories stable when a short credential matches their name", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-bundle-static-path-"));
    tempDirs.push(root);
    fs.writeFileSync(path.join(root, "rd_downloader_config.json"), JSON.stringify({
      megaDebridWebCredentials: "archive-user:logs"
    }), "utf8");
    const itemLogs = path.join(root, "item-logs");
    fs.mkdirSync(itemLogs, { recursive: true });
    fs.writeFileSync(path.join(itemLogs, "recent.log"), "diagnostic", "utf8");

    const buffer = await buildSupportBundle(fakeManager(), root, {
      hostDiagnosticsMode: "none",
      debugSetupMode: "deferred"
    });
    const entries = new AdmZip(buffer).getEntries().map((entry) => entry.entryName);

    expect(entries).toContain("logs/item-logs/recent.log");
  });

  it("keeps separately redacted log filenames distinct", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-bundle-archive-names-"));
    tempDirs.push(root);
    const itemLogs = path.join(root, "item-logs");
    fs.mkdirSync(itemLogs, { recursive: true });
    fs.writeFileSync(path.join(itemLogs, "abcdefghijklmnopqrstuvwxyz1234567890-one.log"), "first-log-marker", "utf8");
    fs.writeFileSync(path.join(itemLogs, "abcdefghijklmnopqrstuvwxyz1234567890-two.log"), "second-log-marker", "utf8");

    const buffer = await buildSupportBundle(fakeManager(), root, {
      hostDiagnosticsMode: "none",
      debugSetupMode: "deferred"
    });
    const entries = new AdmZip(buffer).getEntries().filter((entry) => entry.entryName.startsWith("logs/item-logs/"));
    const text = entries.map((entry) => entry.getData().toString("utf8")).join("\n");

    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((entry) => entry.entryName)).size).toBe(2);
    expect(text).toContain("first-log-marker");
    expect(text).toContain("second-log-marker");
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

  it("retains failed recovery items when the pending queue exceeds the DTO cap", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-bundle-recovery-priority-"));
    tempDirs.push(root);
    const recoveryId = "failed-recovery-item";
    initItemLogs(root);
    ensureItemLog({ itemId: recoveryId, packageId: "package-recovery", packageName: "Recovery", fileName: "recovery.rar", targetPath: "C:\\Downloads\\recovery.rar" });
    logItemEvent(recoveryId, "ERROR", "failed-recovery-marker");
    flushItemLogs();
    const queuedItems = Object.fromEntries(Array.from({ length: 501 }, (_, index) => {
      const id = `queued-${index}`;
      return [id, {
        id,
        packageId: "package-queued",
        url: `https://rapidgator.net/file/${index}`,
        provider: "megadebrid-web",
        status: "queued",
        retries: 0,
        speedBps: 0,
        downloadedBytes: 0,
        totalBytes: 100,
        progressPercent: 0,
        fileName: `${id}.rar`,
        targetPath: `C:\\Downloads\\${id}.rar`,
        resumable: true,
        attempts: 0,
        lastError: "",
        fullStatus: "Wartet",
        createdAt: index + 1,
        updatedAt: index + 1
      }];
    }));
    const items = {
      ...queuedItems,
      [recoveryId]: {
        id: recoveryId,
        packageId: "package-recovery",
        url: "https://rapidgator.net/file/recovery",
        provider: "megadebrid-web",
        status: "failed",
        retries: 8,
        speedBps: 0,
        downloadedBytes: 512,
        totalBytes: 1024,
        progressPercent: 50,
        fileName: "recovery.rar",
        targetPath: "C:\\Downloads\\recovery.rar",
        resumable: true,
        attempts: 9,
        lastError: "Resume recovery exhausted",
        fullStatus: "Fehler",
        resumeResetPending: true,
        createdAt: 1,
        updatedAt: 1
      }
    };
    const manager = {
      getSnapshot: () => ({
        stats: {},
        session: { version: 1, packages: {}, items, packageOrder: [], running: true, paused: false, updatedAt: 1000 },
        speedText: "",
        etaText: "",
        canStart: false,
        canStop: true,
        canPause: true
      }),
      getPackageLogPath: () => null,
      getItemLogPath: () => null
    } as unknown as DownloadManager;

    const buffer = await buildSupportBundle(manager, root, {
      hostDiagnosticsMode: "none",
      debugSetupMode: "deferred"
    });
    const zip = new AdmZip(buffer);
    const itemOverview = JSON.parse(zip.getEntry("overview/items.json")?.getData().toString("utf8") || "{}") as {
      items?: Array<{ id?: string }>;
    };
    const logText = zip.getEntries()
      .filter((entry) => entry.entryName.startsWith("logs/item-logs/"))
      .map((entry) => entry.getData().toString("utf8"))
      .join("\n");

    expect(itemOverview.items?.some((entry) => entry.id === recoveryId)).toBe(true);
    expect(logText).toContain("failed-recovery-marker");
  });
});

describe("support bundle export runner", () => {
  it("emits busy, cancel, build, write and success lifecycle phases with deterministic durations", async () => {
    let now = 0;
    let releaseBuild: (buffer: Buffer) => void = () => undefined;
    let signalBuildStarted: () => void = () => undefined;
    const buildStarted = new Promise<void>((resolve) => { signalBuildStarted = resolve; });
    const buildPending = new Promise<Buffer>((resolve) => { releaseBuild = resolve; });
    const lifecycle: SupportBundleExportLifecycleEvent[] = [];
    let chooseCount = 0;
    const run = createSupportBundleExportRunner({
      now: () => now,
      chooseFile: async () => {
        chooseCount += 1;
        now += 5;
        return chooseCount === 1 ? "C:\\Private\\support.zip" : null;
      },
      build: async () => {
        signalBuildStarted();
        const buffer = await buildPending;
        now += 20;
        return buffer;
      },
      write: async () => {
        now += 30;
      },
      onLifecycle: (event) => {
        lifecycle.push(event);
      }
    });

    const first = run();
    await buildStarted;
    await expect(run()).resolves.toMatchObject({ saved: false, busy: true });
    releaseBuild(Buffer.from("zip"));
    await expect(first).resolves.toEqual({ saved: true, busy: false, filePath: "C:\\Private\\support.zip" });
    await expect(run()).resolves.toEqual({ saved: false, busy: false });

    expect(lifecycle).toEqual([
      { phase: "busy", durationMs: 0, totalDurationMs: 0 },
      { phase: "build", durationMs: 20, totalDurationMs: 25, bytes: 3 },
      { phase: "write", durationMs: 30, totalDurationMs: 55, bytes: 3 },
      { phase: "success", durationMs: 55, totalDurationMs: 55, bytes: 3 },
      { phase: "cancel", durationMs: 5, totalDurationMs: 5 }
    ]);
  });

  it("reports a path-free failure phase and duration when writing fails", async () => {
    let now = 100;
    const lifecycle: SupportBundleExportLifecycleEvent[] = [];
    const failures: unknown[] = [];
    const target = "C:\\Users\\Alice\\Desktop\\private-support.zip";
    const run = createSupportBundleExportRunner({
      now: () => now,
      chooseFile: async () => {
        now += 4;
        return target;
      },
      build: async () => {
        now += 6;
        return Buffer.from("zip");
      },
      write: async () => {
        now += 9;
        throw Object.assign(new Error(`ENOSPC while writing ${target}`), { code: "ENOSPC" });
      },
      onLifecycle: (event) => {
        lifecycle.push(event);
      },
      onFailure: (error) => {
        failures.push(error);
      }
    });

    await expect(run()).rejects.toMatchObject({
      name: "SupportBundleExportError",
      phase: "write",
      durationMs: 19,
      code: "ENOSPC"
    });
    expect(lifecycle).toEqual([
      { phase: "build", durationMs: 6, totalDurationMs: 10, bytes: 3 },
      {
        phase: "failure",
        failedPhase: "write",
        durationMs: 9,
        totalDurationMs: 19,
        code: "ENOSPC"
      }
    ]);
    expect(failures).toHaveLength(1);
    expect(String((failures[0] as Error).message)).not.toContain(target);
    expect(String((failures[0] as Error).message)).not.toContain("Alice");
  });

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

  it("records the selected export target before bundle construction starts", async () => {
    const phases: string[] = [];
    const run = createSupportBundleExportRunner({
      chooseFile: async () => {
        phases.push("choose");
        return "C:\\Temp\\support.zip";
      },
      onStart: ({ filePath }) => {
        phases.push(`start:${path.basename(filePath)}`);
      },
      build: async () => {
        phases.push("build");
        return Buffer.from("zip");
      },
      write: async () => {
        phases.push("write");
      },
      onSuccess: () => {
        phases.push("success");
      }
    });

    await expect(run()).resolves.toEqual({ saved: true, busy: false, filePath: "C:\\Temp\\support.zip" });
    expect(phases).toEqual(["choose", "start:support.zip", "build", "write", "success"]);
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

    await expect(run()).rejects.toMatchObject({ name: "SupportBundleExportError", phase: "write" });
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
