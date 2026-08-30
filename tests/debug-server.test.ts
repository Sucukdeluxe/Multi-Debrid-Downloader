import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import AdmZip from "adm-zip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/main/windows-host-diagnostics", () => ({
  getWindowsHostDiagnostics: () => ({
    collectedAt: "2026-03-09T00:00:03.000Z",
    supported: true,
    platform: "win32",
    crashControl: {
      crashDumpEnabled: 3,
      minidumpDir: "C:\\Windows\\Minidumps",
      dumpFile: "C:\\Windows\\MEMORY.DMP",
      overwrite: 1,
      logEvent: 1,
      autoReboot: 1
    },
    recentKernelPower: [
      {
        timeCreated: "2026-03-09T00:00:04.000Z",
        id: 41,
        providerName: "Microsoft-Windows-Kernel-Power",
        levelDisplayName: "Critical",
        message: "unexpected restart",
        bugcheckCode: "0",
        bugcheckCodeHex: "",
        reportId: ""
      }
    ],
    recentWerKernel: [],
    recentKernelDump: [],
    recentAppCrashes: [],
    recentMinidumps: [],
    assessmentHints: ["watchdog hint"],
    errors: []
  })
}));

import { defaultSettings } from "../src/main/constants";
import { configureCredentialProtector } from "../src/main/credential-protection";
import { createRendererState } from "../src/main/renderer-state";
import { getAuditLogPath, initAuditLog, logAuditEvent, shutdownAuditLog } from "../src/main/audit-log";
import { getDebugServerRuntimeStatus, restartDebugServer, startDebugServer, stopDebugServer, writeDebugServerConfig } from "../src/main/debug-server";
import { ensureItemLog, initItemLogs, shutdownItemLogs } from "../src/main/item-log";
import { configureLogger, getLogFilePath, logger } from "../src/main/logger";
import { ensurePackageLog, initPackageLogs, shutdownPackageLogs } from "../src/main/package-log";
import { getRenameLogPath, initRenameLog, logRenameEvent, shutdownRenameLog } from "../src/main/rename-log";
import { getSessionLogPath, initSessionLog, shutdownSessionLog } from "../src/main/session-log";
import { createStoragePaths, saveHistory, saveSettings } from "../src/main/storage";
import { getTraceConfigPath, getTraceLogPath, initTraceLog, logTraceEvent, setTraceEnabled, shutdownTraceLog } from "../src/main/trace-log";
import { getDebridLinkApiKeyIds } from "../src/shared/debrid-link-keys";
import type { DownloadManager } from "../src/main/download-manager";
import type { NotificationSupportPayload } from "../src/main/support-data";
import type { UiSnapshot } from "../src/shared/types";

const tempDirs: string[] = [];
const legacyManifestFile = ["debug_", "a", "i", "_manifest.json"].join("");
const legacyManifestField = ["a", "i", "Manifest"].join("");
const forbiddenSupportMarkers = [
  ["A", "I"].join(""),
  ["assist", "ant"].join(""),
  ["assist", "ants"].join(""),
  ["ag", "ent"].join(""),
  ["ag", "ents"].join(""),
  ["Clau", "de"].join(""),
  ["Anthro", "pic"].join(""),
  ["Co", "dex"].join(""),
  ["Open", "AI"].join(""),
  ["M", "C", "P"].join(""),
  ["K", "I"].join("")
];

beforeEach(() => {
  configureCredentialProtector({
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, "utf8").reverse(),
    decryptString: (value) => Buffer.from(value).reverse().toString("utf8")
  });
});

async function getFreePort(): Promise<number> {
  const probe = http.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  if (!address || typeof address === "string") {
    throw new Error("port probe failed");
  }
  probe.close();
  await once(probe, "close");
  return address.port;
}

async function waitForReady(url: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers: bearerHeaders("debug-secret") });
      if (response.ok) {
        return;
      }
    } catch {
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`debug server not ready: ${url}`);
}

function bearerHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

function authedFetch(url: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      ...bearerHeaders(token)
    }
  });
}

function buildSnapshot(baseDir: string): UiSnapshot {
  const settings = {
    ...defaultSettings(),
    outputDir: path.join(baseDir, "downloads"),
    extractDir: path.join(baseDir, "extract")
  };

  const renderer = createRendererState(settings);
  return {
    ...renderer,
    session: {
      version: 1,
      packageOrder: ["pkg-1"],
      packages: {
        "pkg-1": {
          id: "pkg-1",
          name: "server-package",
          outputDir: path.join(baseDir, "downloads", "server-package"),
          extractDir: path.join(baseDir, "extract", "server-package"),
          status: "downloading",
          itemIds: ["item-1", "item-2"],
          cancelled: false,
          enabled: true,
          priority: "normal",
          postProcessLabel: "",
          createdAt: Date.now() - 30_000,
          updatedAt: Date.now()
        }
      },
      items: {
        "item-1": {
          id: "item-1",
          packageId: "pkg-1",
          url: "https://hoster.example/file-1",
          provider: "realdebrid",
          providerLabel: "Real-Debrid",
          status: "downloading",
          retries: 1,
          speedBps: 8 * 1024 * 1024,
          downloadedBytes: 64 * 1024 * 1024,
          totalBytes: 256 * 1024 * 1024,
          progressPercent: 25,
          fileName: "episode.part1.rar",
          targetPath: path.join(baseDir, "downloads", "server-package", "episode.part1.rar"),
          resumable: true,
          attempts: 1,
          lastError: "",
          fullStatus: "Download läuft (Real-Debrid)",
          createdAt: Date.now() - 30_000,
          updatedAt: Date.now()
        },
        "item-2": {
          id: "item-2",
          packageId: "pkg-1",
          url: "https://hoster.example/file-2",
          provider: "realdebrid",
          providerLabel: "Real-Debrid",
          status: "failed",
          retries: 3,
          speedBps: 0,
          downloadedBytes: 0,
          totalBytes: null,
          progressPercent: 0,
          fileName: "episode.part2.rar",
          targetPath: path.join(baseDir, "downloads", "server-package", "episode.part2.rar"),
          resumable: false,
          attempts: 3,
          lastError: "hoster unavailable",
          fullStatus: "Fehler: hoster unavailable",
          createdAt: Date.now() - 30_000,
          updatedAt: Date.now()
        }
      },
      runStartedAt: Date.now() - 30_000,
      totalDownloadedBytes: 64 * 1024 * 1024,
      summaryText: "",
      reconnectUntil: 0,
      reconnectReason: "",
      paused: false,
      running: true,
      updatedAt: Date.now()
    },
    summary: null,
    stats: {
      totalDownloaded: 64 * 1024 * 1024,
      totalDownloadedAllTime: 128 * 1024 * 1024,
      totalFilesSession: 0,
      totalFilesAllTime: 0,
      totalPackages: 1,
      sessionStartedAt: Date.now() - 30_000,
      appSessionStartedAt: Date.now() - 60_000,
      sessionRuntimeMs: 60_000,
      totalRuntimeMs: 3 * 60_000,
      runtimeMeasuredAt: Date.now()
    },
    speedText: "8.0 MB/s",
    etaText: "ETA: 00:25",
    canStart: false,
    canStop: true,
    canPause: true,
    clipboardActive: false,
    reconnectSeconds: 0,
    packageSpeedBps: {
      "pkg-1": 8 * 1024 * 1024
    }
  };
}

async function createFixture() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-debug-"));
  tempDirs.push(baseDir);
  const token = "debug-secret";
  const port = await getFreePort();
  const snapshot = buildSnapshot(baseDir);
  const storagePaths = createStoragePaths(baseDir);

  fs.writeFileSync(path.join(baseDir, "debug_token.txt"), token, "utf8");
  fs.writeFileSync(path.join(baseDir, "debug_port.txt"), String(port), "utf8");
  const debridLinkApiKeys = "key-a\nkey-b";
  const debridLinkKeyIds = getDebridLinkApiKeyIds(debridLinkApiKeys);

  saveSettings(storagePaths, {
    ...defaultSettings(),
    outputDir: snapshot.settings.outputDir,
    extractDir: snapshot.settings.extractDir,
    token: "rd-secret-token",
    realDebridUseWebLogin: true,
    debridLinkApiKeys,
    debridLinkDisabledKeyIds: debridLinkKeyIds[1] ? [debridLinkKeyIds[1]] : [],
    totalDownloadedAllTime: 128 * 1024 * 1024,
    totalCompletedFilesAllTime: 12,
    totalRuntimeAllTimeMs: 5 * 60_000
  });
  saveHistory(storagePaths, [
    {
      id: "hist-1",
      name: "server-package",
      totalBytes: 123,
      downloadedBytes: 123,
      fileCount: 2,
      provider: "realdebrid",
      completedAt: Date.now() - 5_000,
      durationSeconds: 42,
      status: "completed",
      outputDir: path.join(baseDir, "downloads", "server-package"),
      urls: ["https://hoster.example/file-1"]
    }
  ]);

  configureLogger(baseDir);
  fs.writeFileSync(getLogFilePath(), "2026-03-09T00:00:00.000Z [INFO] MAIN-LINE\n", "utf8");
  initAuditLog(baseDir);
  const auditLogPath = getAuditLogPath();
  if (!auditLogPath) {
    throw new Error("audit log path missing");
  }
  logAuditEvent("INFO", "AUDIT-LINE", { scope: "settings" });

  initRenameLog(baseDir);
  logRenameEvent("INFO", "RENAME-LINE", { stage: "auto-rename", sourcePath: "C:\\extract\\old.mkv" });

  initTraceLog(baseDir);
  setTraceEnabled(true, "test-fixture");
  logTraceEvent("INFO", "support", "TRACE-EVENT", { scope: "fixture" });

  initSessionLog(baseDir);
  const sessionLogPath = getSessionLogPath();
  if (!sessionLogPath) {
    throw new Error("session log path missing");
  }
  fs.appendFileSync(sessionLogPath, "2026-03-09T00:00:01.000Z [INFO] SESSION-LINE\n", "utf8");
  logger.info("TRACE-MAIN-LINE");

  initPackageLogs(baseDir);
  initItemLogs(baseDir);
  const packageLogPath = ensurePackageLog({
    packageId: "pkg-1",
    name: "server-package",
    outputDir: snapshot.session.packages["pkg-1"]!.outputDir,
    extractDir: snapshot.session.packages["pkg-1"]!.extractDir
  });
  if (!packageLogPath) {
    throw new Error("package log path missing");
  }
  fs.appendFileSync(packageLogPath, "2026-03-09T00:00:02.000Z [INFO] PACKAGE-LINE\n", "utf8");
  const itemLogPath = ensureItemLog({
    itemId: "item-2",
    packageId: "pkg-1",
    packageName: "server-package",
    fileName: "episode.part2.rar",
    targetPath: snapshot.session.items["item-2"]!.targetPath
  });
  if (!itemLogPath) {
    throw new Error("item log path missing");
  }
  fs.appendFileSync(itemLogPath, "2026-03-09T00:00:03.000Z [ERROR] ITEM-LINE\n", "utf8");

  const manager = {
    getSnapshot: () => snapshot,
    getPackageLogPath: (packageId: string) => packageId === "pkg-1" ? packageLogPath : null,
    getItemLogPath: (itemId: string) => itemId === "item-2" ? itemLogPath : null
  } as unknown as DownloadManager;

  const notificationStatus: NotificationSupportPayload & Record<string, unknown> = {
    queued: 7,
    lastSuccessAt: 1_700_000_000_000,
    incidentType: "no_data",
    incidentAgeMs: 30_000,
    events: [{ payload: "PRIVATE_DEBUG_EVENT_PAYLOAD" }],
    url: "https://private.example.test/webhook",
    mention: "@private"
  };
  startDebugServer(manager, baseDir, () => notificationStatus);
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForReady(`${baseUrl}/health`);
  await new Promise((resolve) => setTimeout(resolve, 300));

  return {
    baseUrl,
    token,
    baseDir,
    notificationStatus
  };
}

afterEach(() => {
  stopDebugServer();
  shutdownSessionLog();
  shutdownPackageLogs();
  shutdownItemLogs();
  shutdownRenameLog();
  shutdownTraceLog();
  shutdownAuditLog();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
    }
  }
});

describe("debug-server", () => {
  it("keeps exactly one reachable server across concurrent restarts", async () => {
    const fixture = await createFixture();
    writeDebugServerConfig({ allowlist: ["203.0.113.5"] });

    await Promise.all([restartDebugServer(), restartDebugServer()]);

    expect(getDebugServerRuntimeStatus()).toEqual(expect.objectContaining({
      running: true,
      allowlistCount: 1
    }));
    const response = await authedFetch(`${fixture.baseUrl}/health`, fixture.token);
    expect(response.ok).toBe(true);
  });

  it("does not reopen after stop races with queued restarts", async () => {
    const fixture = await createFixture();
    const restarts = Promise.all([restartDebugServer(), restartDebugServer()]);

    stopDebugServer();
    await restarts;

    expect(getDebugServerRuntimeStatus().running).toBe(false);
    await expect(fetch(`${fixture.baseUrl}/health`, {
      signal: AbortSignal.timeout(1000)
    })).rejects.toThrow();
  });

  it("settles the lifecycle queue when stopped during socket startup", async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-debug-start-stop-"));
    tempDirs.push(baseDir);
    const port = await getFreePort();
    fs.writeFileSync(path.join(baseDir, "debug_token.txt"), "debug-secret", "utf8");
    fs.writeFileSync(path.join(baseDir, "debug_port.txt"), String(port), "utf8");
    fs.writeFileSync(path.join(baseDir, "debug_host.txt"), "127.0.0.1", "utf8");
    fs.writeFileSync(path.join(baseDir, "debug_allowlist.txt"), "", "utf8");

    startDebugServer({} as DownloadManager, baseDir);
    await Promise.resolve();
    await Promise.resolve();
    stopDebugServer();

    const outcome = await Promise.race([
      restartDebugServer().then(() => "settled"),
      new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 500))
    ]);

    expect(outcome).toBe("settled");
    expect(getDebugServerRuntimeStatus().running).toBe(false);

    startDebugServer({} as DownloadManager, baseDir);
    await waitForReady(`http://127.0.0.1:${port}/health`);
    expect(getDebugServerRuntimeStatus().running).toBe(true);
  });

  it("serves the exact safe notification DTO in its endpoint and diagnostics", async () => {
    const fixture = await createFixture();
    const response = await authedFetch(`${fixture.baseUrl}/notifications`, fixture.token);
    expect(response.ok).toBe(true);
    const payload = await response.json() as Record<string, unknown>;

    expect(payload).toEqual({
      queued: 7,
      lastSuccessAt: 1_700_000_000_000,
      incidentType: "no_data",
      incidentAgeMs: 30_000
    });

    fixture.notificationStatus.queued = 9;
    fixture.notificationStatus.lastSuccessAt = 1_700_000_060_000;
    const currentResponse = await authedFetch(`${fixture.baseUrl}/notifications`, fixture.token);
    const currentPayload = await currentResponse.json() as Record<string, unknown>;
    expect(currentPayload).toEqual({
      queued: 9,
      lastSuccessAt: 1_700_000_060_000,
      incidentType: "no_data",
      incidentAgeMs: 30_000
    });

    const diagnosticsResponse = await authedFetch(`${fixture.baseUrl}/diagnostics`, fixture.token);
    const diagnostics = await diagnosticsResponse.json() as Record<string, any>;
    expect(diagnostics.notifications).toEqual(currentPayload);
    expect(JSON.stringify([payload, currentPayload, diagnostics.notifications])).not.toMatch(/PRIVATE_|https:\/\/private|@private|events|payload/i);
  });

  it("serves diagnostics with main, session, and package log tails", async () => {
    const fixture = await createFixture();
    const response = await authedFetch(`${fixture.baseUrl}/diagnostics?package=server-package&lines=20`, fixture.token);
    expect(response.ok).toBe(true);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    const payload = await response.json() as Record<string, any>;

    expect(payload.meta?.appVersion).toBeTruthy();
    expect(payload.meta?.debugServer?.host).toBe("127.0.0.1");
    expect(payload.status?.running).toBe(true);
    expect(payload.host?.platform).toBe("win32");
    expect(payload.host?.recentKernelPower?.[0]?.id).toBe(41);
    expect(payload.selectedPackage?.name).toBe("server-package");
    expect((payload.logs?.main?.lines || []).join("\n")).toContain("MAIN-LINE");
    expect((payload.logs?.audit?.lines || []).join("\n")).toContain("AUDIT-LINE");
    expect((payload.logs?.rename?.lines || []).join("\n")).toContain("RENAME-LINE");
    expect((payload.logs?.trace?.lines || []).join("\n")).toContain("TRACE-EVENT");
    expect((payload.logs?.session?.lines || []).join("\n")).toContain("SESSION-LINE");
    expect((payload.logs?.package?.lines || []).join("\n")).toContain("PACKAGE-LINE");
    expect(payload.accounts?.realDebrid?.configured).toBe(true);
    expect(payload.history?.total).toBe(1);
  });

  it("writes a machine-readable support manifest into the runtime folder", async () => {
    const fixture = await createFixture();
    const manifestPath = path.join(fixture.baseDir, "debug_support_manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(fs.existsSync(path.join(fixture.baseDir, legacyManifestFile))).toBe(false);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, any>;
    expect(manifest.purpose).toBe("Machine-readable manifest for support tooling and remote troubleshooting.");
    expect(JSON.stringify(manifest)).not.toMatch(new RegExp(`\\b(?:${forbiddenSupportMarkers.join("|")})\\b`, "i"));
    expect(JSON.stringify(manifest)).not.toContain(fixture.token);
    expect(manifest.debugServer?.port).toBeGreaterThan(0);
    expect(manifest.auth?.methods).toEqual(["Authorization: Bearer <token>"]);
    expect(JSON.stringify(manifest)).not.toContain("?token=");
    expect(manifest.debugServer?.remoteBridgeBaseUrlTemplate).toContain("127.0.0.1");
    expect(manifest.remoteAccessRequirements.join("\n")).toContain("local bridge");
    expect(manifest.setupCheckEndpoint).toBe("/debug/setup");
    expect(manifest.selfCheckEndpoint).toBe("/self-check");
    expect(manifest.runtimeFiles?.tokenFile).toContain("debug_token.txt");
    expect(manifest.endpoints?.some((entry: Record<string, any>) => entry.path === "/diagnostics")).toBe(true);
    expect(manifest.endpoints?.some((entry: Record<string, any>) => entry.path === "/logs/main")).toBe(true);

    const metaResponse = await authedFetch(`${fixture.baseUrl}/meta`, fixture.token);
    expect(metaResponse.ok).toBe(true);
    const metaPayload = await metaResponse.json() as Record<string, any>;
    expect(metaPayload.supportFiles?.supportManifest).toBe(manifestPath);
    expect(metaPayload.supportFiles?.[legacyManifestField]).toBeUndefined();
    expect(metaPayload.supportFiles?.traceConfig).toBe(getTraceConfigPath());
    expect(metaPayload.supportFiles?.traceLog).toBe(getTraceLogPath());
    expect(metaPayload.logPaths?.rename).toBe(getRenameLogPath());
    expect(metaPayload.supportChecks?.setup).toBe("/debug/setup");
    expect(metaPayload.supportChecks?.selfCheck).toBe("/self-check");
  });

  it("serves a debug setup check with trace expiry details", async () => {
    const fixture = await createFixture();
    const response = await authedFetch(`${fixture.baseUrl}/debug/setup`, fixture.token);
    expect(response.ok).toBe(true);
    const payload = await response.json() as Record<string, any>;

    expect(payload.enabled).toBe(true);
    expect(Array.isArray(payload.warnings)).toBe(true);
    expect(payload.status).toBe(payload.warnings.length > 0 ? "warn" : "ok");
    expect(payload.runtimeBaseDir).toBe(fixture.baseDir);
    expect(payload.host).toBe("127.0.0.1");
    expect(payload.localOnly).toBe(true);
    expect(payload.tokenConfigured).toBe(true);
    expect(payload.supportManifestPresent).toBe(true);
    expect(payload[`${legacyManifestField}Present`]).toBeUndefined();
    expect(payload.supportManifestPath).toBe(path.join(fixture.baseDir, "debug_support_manifest.json"));
    expect(payload.traceEnabled).toBe(true);
    expect(payload.traceAutoDisableAt).toBeTruthy();
    expect(payload.diskSpace?.runtime?.freeBytes).toBeGreaterThan(0);
    expect(payload.diskSpace?.output?.freeBytes).toBeGreaterThan(0);
    expect(payload.diskSpace?.extract?.freeBytes).toBeGreaterThan(0);
    expect(payload.logSummary?.totalBytes).toBeGreaterThan(0);
    expect(payload.logSummary?.rename?.bytes).toBeGreaterThan(0);
    expect(payload.logSummary?.packageLogs?.fileCount).toBe(1);
    expect(payload.logSummary?.itemLogs?.fileCount).toBe(1);
    expect(payload.supportBundle?.estimatedBytes).toBeGreaterThan(0);
    expect(JSON.stringify(payload.localUrls)).not.toContain(fixture.token);
    expect(JSON.stringify(payload.remoteUrlTemplates)).not.toContain(fixture.token);
    expect(JSON.stringify(payload.localUrls)).not.toContain("?token=");
    expect(JSON.stringify(payload.remoteUrlTemplates)).not.toContain("?token=");
    expect(payload.remoteUrlTemplates?.health).toContain("127.0.0.1");
    expect(Array.isArray(payload.notes)).toBe(true);
  });

  it("serves the self-check alias", async () => {
    const fixture = await createFixture();
    const response = await authedFetch(`${fixture.baseUrl}/self-check`, fixture.token);
    expect(response.ok).toBe(true);
    const payload = await response.json() as Record<string, any>;
    expect(Array.isArray(payload.warnings)).toBe(true);
    expect(payload.status).toBe(payload.warnings.length > 0 ? "warn" : "ok");
    expect(payload.supportBundle?.estimatedEntries).toBeGreaterThan(0);
  });

  it("writes the client IP into the debug trace log", async () => {
    const fixture = await createFixture();
    const response = await authedFetch(`${fixture.baseUrl}/health`, fixture.token, {
      headers: {
        "X-Forwarded-For": "203.0.113.46"
      }
    });
    expect(response.ok).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 200));
    const traceLogPath = getTraceLogPath();
    expect(traceLogPath).toBeTruthy();
    const traceText = fs.readFileSync(traceLogPath!, "utf8");
    expect(traceText).toContain("clientIp=203.0.113.46");
  });

  it("serves package details and package log by package query", async () => {
    const fixture = await createFixture();

    const packagesResponse = await authedFetch(`${fixture.baseUrl}/packages?package=server&includeItems=1`, fixture.token);
    expect(packagesResponse.ok).toBe(true);
    const packagesPayload = await packagesResponse.json() as Record<string, any>;
    expect(packagesPayload.count).toBe(1);
    expect(packagesPayload.packages?.[0]?.items?.length).toBe(2);

    const logResponse = await authedFetch(`${fixture.baseUrl}/logs/package?package=server-package&lines=20`, fixture.token);
    expect(logResponse.ok).toBe(true);
    const logPayload = await logResponse.json() as Record<string, any>;
    expect(logPayload.package?.name).toBe("server-package");
    expect((logPayload.lines || []).join("\n")).toContain("PACKAGE-LINE");
  });

  it("serves item log by item query", async () => {
    const fixture = await createFixture();

    const response = await authedFetch(`${fixture.baseUrl}/logs/item?item=episode.part2.rar&lines=20`, fixture.token);
    expect(response.ok).toBe(true);
    const payload = await response.json() as Record<string, any>;
    expect(payload.item?.id).toBe("item-2");
    expect(payload.item?.fileName).toBe("episode.part2.rar");
    expect((payload.lines || []).join("\n")).toContain("ITEM-LINE");
  });

  it("serves host diagnostics separately", async () => {
    const fixture = await createFixture();
    const response = await authedFetch(`${fixture.baseUrl}/host/diagnostics`, fixture.token);
    expect(response.ok).toBe(true);
    const payload = await response.json() as Record<string, any>;
    expect(payload.platform).toBe("win32");
    expect(payload.crashControl?.crashDumpEnabled).toBe(3);
    expect(payload.assessmentHints?.[0]).toContain("watchdog");
  });

  it("serves audit log, settings, accounts, stats, and history", async () => {
    const fixture = await createFixture();

    const auditResponse = await authedFetch(`${fixture.baseUrl}/logs/audit?lines=20`, fixture.token);
    expect(auditResponse.ok).toBe(true);
    const auditPayload = await auditResponse.json() as Record<string, any>;
    expect((auditPayload.lines || []).join("\n")).toContain("AUDIT-LINE");

    const renameResponse = await authedFetch(`${fixture.baseUrl}/logs/rename?lines=20`, fixture.token);
    expect(renameResponse.ok).toBe(true);
    const renamePayload = await renameResponse.json() as Record<string, any>;
    expect((renamePayload.lines || []).join("\n")).toContain("RENAME-LINE");

    const traceResponse = await authedFetch(`${fixture.baseUrl}/logs/trace?lines=50`, fixture.token);
    expect(traceResponse.ok).toBe(true);
    const tracePayload = await traceResponse.json() as Record<string, any>;
    expect((tracePayload.lines || []).join("\n")).toContain("TRACE-EVENT");
    expect((tracePayload.lines || []).join("\n")).toContain("TRACE-MAIN-LINE");

    const traceConfigGetResponse = await authedFetch(`${fixture.baseUrl}/trace/config?enable=0&note=test`, fixture.token);
    expect(traceConfigGetResponse.status).toBe(405);
    const traceConfigResponse = await authedFetch(`${fixture.baseUrl}/trace/config?enable=0&note=test`, fixture.token, { method: "POST" });
    expect(traceConfigResponse.ok).toBe(true);
    const traceConfigPayload = await traceConfigResponse.json() as Record<string, any>;
    expect(traceConfigPayload.config?.enabled).toBe(false);

    const settingsResponse = await authedFetch(`${fixture.baseUrl}/settings`, fixture.token);
    expect(settingsResponse.ok).toBe(true);
    const settingsPayload = await settingsResponse.json() as Record<string, any>;
    expect(settingsPayload.accounts?.realDebrid?.configured).toBe(true);
    expect(settingsPayload.extraction?.archivePasswordCount).toBe(0);
    expect(JSON.stringify(settingsPayload)).not.toContain("rd-secret-token");
    expect(JSON.stringify(settingsPayload)).not.toContain("key-a");
    expect(JSON.stringify(settingsPayload)).not.toContain("key-b");

    const accountsResponse = await authedFetch(`${fixture.baseUrl}/accounts`, fixture.token);
    expect(accountsResponse.ok).toBe(true);
    const accountsPayload = await accountsResponse.json() as Record<string, any>;
    expect(accountsPayload.debridLink?.keyCount).toBe(2);
    expect(accountsPayload.debridLink?.disabledKeyCount).toBe(1);

    const statsResponse = await authedFetch(`${fixture.baseUrl}/stats`, fixture.token);
    expect(statsResponse.ok).toBe(true);
    const statsPayload = await statsResponse.json() as Record<string, any>;
    expect(statsPayload.session?.totalDownloaded).toBeGreaterThan(0);
    expect(statsPayload.allTime?.totalDownloadedAllTime).toBeGreaterThan(0);

    const historyResponse = await authedFetch(`${fixture.baseUrl}/history?limit=10`, fixture.token);
    expect(historyResponse.ok).toBe(true);
    const historyPayload = await historyResponse.json() as Record<string, any>;
    expect(historyPayload.total).toBe(1);
    expect(historyPayload.entries?.[0]?.name).toBe("server-package");
    expect(historyPayload.entries?.[0]?.urlCount).toBe(1);
  });

  it("downloads a support bundle zip", async () => {
    const fixture = await createFixture();
    fs.writeFileSync(path.join(fixture.baseDir, legacyManifestFile), JSON.stringify({ purpose: "legacy" }), "utf8");
    const response = await authedFetch(`${fixture.baseUrl}/support/bundle`, fixture.token);
    expect(response.ok).toBe(true);
    expect(response.headers.get("content-type")).toContain("application/zip");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();

    const buffer = Buffer.from(await response.arrayBuffer());
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries().map((entry) => entry.entryName);
    expect(entries).toContain("overview/settings.json");
    expect(entries).toContain("overview/accounts.json");
    expect(entries).toContain("overview/debug-setup.json");
    expect(entries).toContain("overview/self-check.json");
    expect(entries).toContain("overview/trace-config.json");
    expect(entries).toContain("overview/notifications.json");
    expect(entries).toContain("logs/audit.log");
    expect(entries).toContain("logs/rename.log");
    expect(entries).toContain("logs/trace.log");
    expect(entries).toContain("runtime/debug_support_manifest.json");
    expect(entries).toContain("overview/support-manifest.json");
    expect(entries).not.toContain(`runtime/${legacyManifestFile}`);
    expect(entries).not.toContain(["overview/", "a", "i-manifest.json"].join(""));
    expect(entries).not.toContain("runtime/debug_token.txt");
    const notifications = JSON.parse(zip.getEntry("overview/notifications.json")?.getData().toString("utf8") || "null");
    expect(notifications).toEqual({
      queued: 7,
      lastSuccessAt: 1_700_000_000_000,
      incidentType: "no_data",
      incidentAgeMs: 30_000
    });
    expect(buffer.toString("utf8")).not.toMatch(/PRIVATE_DEBUG_EVENT_PAYLOAD|https:\/\/private|@private/);
  });

  it("rejects unauthenticated requests", async () => {
    const fixture = await createFixture();
    const response = await fetch(`${fixture.baseUrl}/status`);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("accepts bearer auth and rejects query tokens", async () => {
    const fixture = await createFixture();
    const bearer = await authedFetch(`${fixture.baseUrl}/health`, fixture.token);
    expect(bearer.status).toBe(200);

    const queryOnly = await fetch(`${fixture.baseUrl}/health?token=${fixture.token}`);
    expect(queryOnly.status).toBe(400);
    const queryOnlyPayload = await queryOnly.json() as Record<string, any>;
    expect(queryOnlyPayload.code).toBe("query_token_rejected");

    const mixed = await authedFetch(`${fixture.baseUrl}/health?token=bad-fixture-token`, fixture.token);
    expect(mixed.status).toBe(400);
  });

  it("rejects unsupported methods with a controlled method response", async () => {
    const fixture = await createFixture();
    const response = await authedFetch(`${fixture.baseUrl}/status`, fixture.token, { method: "PUT" });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toContain("GET");
    const payload = await response.json() as Record<string, any>;
    expect(payload.code).toBe("method_not_allowed");
  });

  it("limits repeated loopback requests with a controlled response", async () => {
    const fixture = await createFixture();
    let limited: Response | null = null;
    for (let i = 0; i < 130; i += 1) {
      const response = await authedFetch(`${fixture.baseUrl}/health`, fixture.token);
      if (response.status === 429) {
        limited = response;
        break;
      }
    }
    expect(limited).not.toBeNull();
    expect(limited!.headers.get("retry-after")).toBeTruthy();
    const payload = await limited!.json() as Record<string, any>;
    expect(payload.code).toBe("rate_limited");
  });
});
