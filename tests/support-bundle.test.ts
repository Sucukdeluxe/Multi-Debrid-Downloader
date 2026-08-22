import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { afterEach, describe, expect, it } from "vitest";
import { buildSupportBundle } from "../src/main/support-bundle";
import { createStoragePaths } from "../src/main/storage";
import type { DownloadManager } from "../src/main/download-manager";
import type { NotificationSupportPayload } from "../src/main/support-data";

const tempDirs: string[] = [];
const legacyManifestFile = ["debug_", "a", "i", "_manifest.json"].join("");

afterEach(() => {
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

  it("writes only the safe notification aggregate and excludes its runtime files", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-bundle-notifications-"));
    tempDirs.push(root);
    const paths = createStoragePaths(root);
    fs.writeFileSync(paths.notificationOutboxFile, "PRIVATE_OUTBOX_RUNTIME_PAYLOAD", "utf8");
    fs.writeFileSync(paths.notificationHealthFile, "PRIVATE_HEALTH_RUNTIME_PAYLOAD", "utf8");
    const notificationStatus: NotificationSupportPayload & Record<string, unknown> = {
      queued: 7,
      lastSuccessAt: 1_700_000_000_000,
      incidentType: "scheduler",
      incidentAgeMs: 45_000,
      events: [{ payload: "PRIVATE_EVENT_PAYLOAD" }],
      url: "https://private.example.test/webhook",
      mention: "@private"
    };

    const buffer = await buildSupportBundle(fakeManager(), root, { hostDiagnosticsMode: "none", notificationStatus });
    const zip = new AdmZip(buffer);
    const entry = zip.getEntry("overview/notifications.json");
    const payload = JSON.parse(entry?.getData().toString("utf8") || "null");
    const serialized = buffer.toString("utf8");

    expect(payload).toEqual({
      queued: 7,
      lastSuccessAt: 1_700_000_000_000,
      incidentType: "scheduler",
      incidentAgeMs: 45_000
    });
    expect(zip.getEntries().map((item) => item.entryName)).not.toContain(path.basename(paths.notificationOutboxFile));
    expect(zip.getEntries().map((item) => item.entryName)).not.toContain(path.basename(paths.notificationHealthFile));
    expect(serialized).not.toMatch(/PRIVATE_|https:\/\/private|@private/);
  });
});
