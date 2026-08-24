import { describe, expect, it } from "vitest";
import { buildBackupPayload, planBackupImport } from "../src/main/backup-payload";
import { decryptBackup, encryptBackup } from "../src/main/backup-crypto";
import { readFileSync } from "node:fs";
import type { AppSettings, SessionState, HistoryEntry, StatisticsLedger } from "../src/shared/types";

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { backupIncludeDownloads: false, token: "secret", outputDir: "C:\\dl", ...overrides } as unknown as AppSettings;
}

const session: SessionState = {
  version: 2, packageOrder: ["p1"], packages: { p1: {} as never }, items: { i1: {} as never },
  runStartedAt: 0, totalDownloadedBytes: 0, summaryText: "", reconnectUntil: 0,
  reconnectReason: "", paused: false, running: true, updatedAt: 0
};
const history: HistoryEntry[] = [{ id: "h1" } as unknown as HistoryEntry];
const statistics: StatisticsLedger = { version: 2, startedAt: 1, days: [], minutes: [] };

const baseInput = { appVersion: "1.7.183", exportedAt: "2026-06-07T00:00:00Z", session, history, statistics };

describe("buildBackupPayload — default is settings-only", () => {
  it("keeps the Deepbrid key only inside the encrypted backup payload", () => {
    const key = "fixture-deepbrid-backup-key-4eF6";
    const payload = buildBackupPayload({
      ...baseInput,
      settings: settings({ deepbridApiKey: key })
    });
    const encrypted = encryptBackup(JSON.stringify(payload), "fixture-backup-passphrase-5gH7");

    expect(encrypted.toString("utf8")).not.toContain(key);
    const restored = JSON.parse(decryptBackup(encrypted, "fixture-backup-passphrase-5gH7")) as { settings: AppSettings };
    expect(restored.settings.deepbridApiKey).toBe(key);
  });

  it("exports the full statistics ledger instead of the renderer projection", () => {
    const source = readFileSync(new URL("../src/main/app-controller.ts", import.meta.url), "utf8");
    const exportBlock = source.slice(source.indexOf("public exportBackup"), source.indexOf("public async exportOnlineBackup"));

    expect(exportBlock).toContain("getStatisticsLedgerForBackup()");
    expect(exportBlock).not.toContain("getStats().statistics");
  });

  it("omits session AND history when backupIncludeDownloads is false (default)", () => {
    const p = buildBackupPayload({ ...baseInput, settings: { backupIncludeDownloads: false } as AppSettings });
    expect(p.kind).toBe("settings-only");
    expect(p.session).toBeUndefined();
    expect(p.history).toBeUndefined();
    expect(p.statistics).toBeUndefined();
    expect(p.settings).toBeDefined();
  });

  it("includes session + history when backupIncludeDownloads is true", () => {
    const p = buildBackupPayload({ ...baseInput, settings: { backupIncludeDownloads: true } as AppSettings });
    expect(p.kind).toBe("full");
    expect(p.session).toBe(session);
    expect(p.history).toBe(history);
    expect(p.statistics).toBe(statistics);
  });

  it("treats a missing flag as settings-only (safe default)", () => {
    const p = buildBackupPayload({ ...baseInput, settings: {} as AppSettings });
    expect(p.kind).toBe("settings-only");
    expect(p.session).toBeUndefined();
  });

  it("ROUND-TRIP: toggle off -> exported payload carries the flag still false", () => {
    // "Haken aus bleibt aus": the exported settings object preserves the flag,
    // so importing it keeps the toggle off.
    const p = buildBackupPayload({ ...baseInput, settings: { backupIncludeDownloads: false } as AppSettings });
    expect((p.settings as AppSettings).backupIncludeDownloads).toBe(false);
  });
});

describe("planBackupImport — decision follows the file, not the local toggle", () => {
  it("settings-only backup (no session) -> restore settings only, no relaunch", () => {
    const plan = planBackupImport({ version: 2, kind: "settings-only", settings: { theme: "dark" } });
    expect(plan.valid).toBe(true);
    expect(plan.restoreDownloads).toBe(false);
    expect(plan.message).toMatch(/Einstellungen/);
  });

  it("full backup (with session) -> restore downloads + relaunch", () => {
    const plan = planBackupImport({ version: 2, kind: "full", settings: { theme: "dark" }, session });
    expect(plan.valid).toBe(true);
    expect(plan.restoreDownloads).toBe(true);
  });

  it("rejects payloads without settings", () => {
    expect(planBackupImport({ session }).valid).toBe(false);
    expect(planBackupImport(null).valid).toBe(false);
    expect(planBackupImport("nope").valid).toBe(false);
    expect(planBackupImport({}).valid).toBe(false);
  });

  it("a settings-only export then import does NOT pull in the download list", () => {
    // Build with toggle off, then plan the import of exactly that payload.
    const exported = buildBackupPayload({ ...baseInput, settings: { backupIncludeDownloads: false } as AppSettings });
    const plan = planBackupImport(JSON.parse(JSON.stringify(exported)));
    expect(plan.restoreDownloads).toBe(false); // queue stays untouched
  });

  it("a full export then import DOES restore the download list", () => {
    const exported = buildBackupPayload({ ...baseInput, settings: { backupIncludeDownloads: true } as AppSettings });
    const plan = planBackupImport(JSON.parse(JSON.stringify(exported)));
    expect(plan.restoreDownloads).toBe(true);
  });
});
