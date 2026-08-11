import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";

import { buildBackupPayload, resolveRemoteDiagnosticsRestore, BackupRemoteDiagnostics } from "../src/main/backup-payload";
import { defaultSettings } from "../src/main/constants";
import { normalizeSettings } from "../src/main/storage";
import {
  startDebugServer,
  stopDebugServer,
  restartDebugServer,
  writeDebugServerConfig,
  getDebugAllowlist,
  getDebugServerRuntimeStatus
} from "../src/main/debug-server";
import type { DownloadManager } from "../src/main/download-manager";
import type { AppSettings, SessionState } from "../src/shared/types";

const tempDirs: string[] = [];

function input(settingsOverride: Partial<AppSettings>, remoteDiagnostics?: BackupRemoteDiagnostics) {
  return {
    settings: { ...defaultSettings(), ...settingsOverride } as AppSettings,
    appVersion: "1.7.233",
    exportedAt: "2026-08-01T00:00:00.000Z",
    session: {} as unknown as SessionState,
    history: [],
    remoteDiagnostics
  };
}

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

async function waitForReady(url: string, token = "rt-secret"): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { headers: bearerHeaders(token) });
      if (res.ok) {
        return;
      }
    } catch {
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`debug server not ready: ${url}`);
}

function bearerHeaders(token = "rt-secret"): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

afterEach(() => {
  stopDebugServer();
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

describe("backup remoteDiagnostics export gating", () => {
  it("includes only sanitized remoteDiagnostics when backupIncludeRemoteDiagnostics is on", () => {
    const settings = {
      ...defaultSettings(),
      backupIncludeRemoteDiagnostics: true
    };
    const payload = buildBackupPayload({
      settings,
      appVersion: "1.7.233",
      exportedAt: "2026-08-01T00:00:00.000Z",
      session: {} as unknown as SessionState,
      history: [],
      remoteDiagnostics: {
        allowlist: ["192.0.2.0/24"],
        port: 8976,
        hostMode: "network",
        token: "legacy-backup-token",
        publicHost: "legacy.example.test",
        endpoint: "http://legacy.example.test:8976"
      } as unknown as BackupRemoteDiagnostics
    });

    expect(payload.remoteDiagnostics).toEqual({
      allowlist: ["192.0.2.0/24"]
    });
  });

  it("omits remoteDiagnostics when the toggle is off even if a section is provided", () => {
    const payload = buildBackupPayload(input({ backupIncludeRemoteDiagnostics: false }, { allowlist: ["10.0.0.5"], port: 9868, hostMode: "network" }));
    expect(payload.remoteDiagnostics).toBeUndefined();
  });

  it("omits remoteDiagnostics when toggle on but no section gathered", () => {
    const payload = buildBackupPayload(input({ backupIncludeRemoteDiagnostics: true }, undefined));
    expect(payload.remoteDiagnostics).toBeUndefined();
  });

  it("the remoteDiagnostics section carries ONLY allowlist", () => {
    const payload = buildBackupPayload(input({ backupIncludeRemoteDiagnostics: true }, { allowlist: ["10.0.0.5"], port: 9868, hostMode: "network" }));
    expect(payload.remoteDiagnostics && Object.keys(payload.remoteDiagnostics).sort()).toEqual(["allowlist"]);
    const sectionJson = JSON.stringify(payload.remoteDiagnostics);
    expect(sectionJson.toLowerCase()).not.toContain("token");
    expect(sectionJson).not.toContain("publicHost");
    expect(sectionJson.toLowerCase()).not.toContain("\"name\"");
    expect(sectionJson.toLowerCase()).not.toContain("endpoint");
    expect(sectionJson.toLowerCase()).not.toContain("hostmode");
    expect(sectionJson.toLowerCase()).not.toContain("port");
  });
});

describe("backupIncludeRemoteDiagnostics settings persistence", () => {
  it("normalizeSettings preserves backupIncludeRemoteDiagnostics (the toggle survives save/load)", () => {
    expect(normalizeSettings({ backupIncludeRemoteDiagnostics: true } as unknown as AppSettings).backupIncludeRemoteDiagnostics).toBe(true);
    expect(normalizeSettings({ backupIncludeRemoteDiagnostics: false } as unknown as AppSettings).backupIncludeRemoteDiagnostics).toBe(false);
    expect(normalizeSettings({} as unknown as AppSettings).backupIncludeRemoteDiagnostics).toBe(false);
  });
});

describe("resolveRemoteDiagnosticsRestore", () => {
  it("scrubs network restores to loopback and keeps only allowlist", () => {
    expect(resolveRemoteDiagnosticsRestore({ allowlist: ["10.0.0.5"], port: 9868, hostMode: "network" }))
      .toEqual({ host: "127.0.0.1", allowlist: ["10.0.0.5"] });
  });

  it("scrubs legacy token and endpoint fields during restore planning", () => {
    const restore = resolveRemoteDiagnosticsRestore({
      allowlist: ["198.51.100.8"],
      port: 9999,
      hostMode: "network",
      token: "legacy-backup-token",
      publicHost: "legacy.example.test",
      endpoint: "http://legacy.example.test:9999"
    });
    expect(restore).toEqual({ host: "127.0.0.1", allowlist: ["198.51.100.8"] });
    expect(JSON.stringify(restore).toLowerCase()).not.toContain("token");
    expect(JSON.stringify(restore).toLowerCase()).not.toContain("endpoint");
    expect(JSON.stringify(restore).toLowerCase()).not.toContain("publichost");
    expect(JSON.stringify(restore).toLowerCase()).not.toContain("9999");
  });

  it("maps local to 127.0.0.1", () => {
    expect(resolveRemoteDiagnosticsRestore({ allowlist: ["10.0.0.5"], port: 9868, hostMode: "local" }))
      .toEqual({ host: "127.0.0.1", allowlist: ["10.0.0.5"] });
  });

  it("does not restore any port values", () => {
    expect(resolveRemoteDiagnosticsRestore({ allowlist: ["10.0.0.5"], port: 80, hostMode: "network" })).toEqual({ host: "127.0.0.1", allowlist: ["10.0.0.5"] });
    expect(resolveRemoteDiagnosticsRestore({ allowlist: ["10.0.0.5"], port: 70000, hostMode: "network" })).toEqual({ host: "127.0.0.1", allowlist: ["10.0.0.5"] });
    expect(resolveRemoteDiagnosticsRestore({ allowlist: ["10.0.0.5"], port: 9868.5, hostMode: "network" })).toEqual({ host: "127.0.0.1", allowlist: ["10.0.0.5"] });
  });

  it("filters non-string and blank allowlist entries and trims", () => {
    const r = resolveRemoteDiagnosticsRestore({ allowlist: ["10.0.0.5", "", "  ", 5, null, " 8.8.8.8 "], port: 9868, hostMode: "network" });
    expect(r?.allowlist).toEqual(["10.0.0.5", "8.8.8.8"]);
  });

  it("returns null for missing sections", () => {
    expect(resolveRemoteDiagnosticsRestore(undefined)).toBeNull();
    expect(resolveRemoteDiagnosticsRestore(null)).toBeNull();
    expect(resolveRemoteDiagnosticsRestore("x")).toBeNull();
  });

  it("migrates empty legacy sections to loopback", () => {
    expect(resolveRemoteDiagnosticsRestore({})).toEqual({ host: "127.0.0.1", allowlist: [] });
  });
});

describe("backup remoteDiagnostics live restore round-trip", () => {
  it("export -> resolve -> apply is reflected in the running debug-server (proves restart fired)", async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-backup-remote-"));
    tempDirs.push(baseDir);
    const startPort = await getFreePort();
    const restorePort = await getFreePort();
    fs.writeFileSync(path.join(baseDir, "debug_token.txt"), "rt-secret", "utf8");
    fs.writeFileSync(path.join(baseDir, "debug_port.txt"), String(startPort), "utf8");
    fs.writeFileSync(path.join(baseDir, "debug_host.txt"), "127.0.0.1", "utf8");
    fs.writeFileSync(path.join(baseDir, "debug_allowlist.txt"), "", "utf8");
    startDebugServer({} as unknown as DownloadManager, baseDir);
    await waitForReady(`http://127.0.0.1:${startPort}/health`);
    expect(getDebugAllowlist()).toEqual([]);

    const payload = buildBackupPayload(input(
      { backupIncludeRemoteDiagnostics: true },
      { allowlist: ["203.0.113.4", "10.0.0.0/24"], port: restorePort, hostMode: "network" }
    ));

    const restore = resolveRemoteDiagnosticsRestore(payload.remoteDiagnostics);
    expect(restore).not.toBeNull();
    writeDebugServerConfig({ host: restore!.host, port: restore!.port, allowlist: restore!.allowlist });
    const status = await restartDebugServer();

    expect(getDebugAllowlist()).toEqual(["203.0.113.4", "10.0.0.0/24"]);
    expect(status.port).toBe(startPort);
    expect(status.host).toBe("127.0.0.1");
    expect(status.allowlistCount).toBe(2);

    expect(fs.readFileSync(path.join(baseDir, "debug_token.txt"), "utf8").trim()).toBe("rt-secret");
    expect(fs.existsSync(path.join(baseDir, "debug_remote.json"))).toBe(false);

    await waitForReady(`http://127.0.0.1:${startPort}/health`);
  });

  it("full-backup path writes only safe debug files to disk without a restart", async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-backup-remote2-"));
    tempDirs.push(baseDir);
    const startPort = await getFreePort();
    fs.writeFileSync(path.join(baseDir, "debug_token.txt"), "rt2", "utf8");
    fs.writeFileSync(path.join(baseDir, "debug_port.txt"), String(startPort), "utf8");
    fs.writeFileSync(path.join(baseDir, "debug_host.txt"), "127.0.0.1", "utf8");
    fs.writeFileSync(path.join(baseDir, "debug_allowlist.txt"), "", "utf8");
    startDebugServer({} as unknown as DownloadManager, baseDir);
    await waitForReady(`http://127.0.0.1:${startPort}/health`, "rt2");

    const restore = resolveRemoteDiagnosticsRestore({ allowlist: ["198.51.100.9"], port: 9100, hostMode: "network" });
    writeDebugServerConfig({ host: restore!.host, port: restore!.port, allowlist: restore!.allowlist });

    expect(fs.readFileSync(path.join(baseDir, "debug_host.txt"), "utf8").trim()).toBe("127.0.0.1");
    expect(fs.readFileSync(path.join(baseDir, "debug_port.txt"), "utf8").trim()).toBe(String(startPort));
    expect(fs.readFileSync(path.join(baseDir, "debug_allowlist.txt"), "utf8")).toContain("198.51.100.9");
    expect(getDebugServerRuntimeStatus().port).toBe(startPort);
  });
});

describe("debug-server live diagnostics endpoints", () => {
  it("serves /providers (live cooldown/runtime snapshot) and /logs/conversion over authenticated HTTP", async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-prov-"));
    tempDirs.push(baseDir);
    const port = await getFreePort();
    fs.writeFileSync(path.join(baseDir, "debug_token.txt"), "prov-secret", "utf8");
    fs.writeFileSync(path.join(baseDir, "debug_port.txt"), String(port), "utf8");
    fs.writeFileSync(path.join(baseDir, "debug_host.txt"), "127.0.0.1", "utf8");
    fs.writeFileSync(path.join(baseDir, "debug_allowlist.txt"), "", "utf8");
    startDebugServer({} as unknown as DownloadManager, baseDir);
    await waitForReady(`http://127.0.0.1:${port}/health`, "prov-secret");

    const provRes = await fetch(`http://127.0.0.1:${port}/providers`, { headers: bearerHeaders("prov-secret") });
    expect(provRes.status).toBe(200);
    const prov = await provRes.json();
    expect(typeof prov.capturedAtMs).toBe("number");
    expect(prov.megaDebrid).toBeTruthy();
    expect(Array.isArray(prov.megaDebrid.accounts)).toBe(true);
    expect(typeof prov.megaDebrid.rotationCursor).toBe("number");
    expect(prov.debridLink).toBeTruthy();
    expect(Array.isArray(prov.debridLink.keys)).toBe(true);

    const unauth = await fetch(`http://127.0.0.1:${port}/providers`);
    expect(unauth.status).toBe(401);

    const convRes = await fetch(`http://127.0.0.1:${port}/logs/conversion`, { headers: bearerHeaders("prov-secret") });
    expect(convRes.status).toBe(200);
    const conv = await convRes.json();
    expect(Array.isArray(conv.lines)).toBe(true);
    expect(conv).toHaveProperty("available");
  });
});
