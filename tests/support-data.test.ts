import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import { defaultSettings } from "../src/main/constants";
import { buildAccountSummary, buildNotificationSupportPayload, buildStatsPayload } from "../src/main/support-data";
import { buildSupportBundle } from "../src/main/support-bundle";
import { createStoragePaths } from "../src/main/storage";
import { serializeRealDebridApiAccounts } from "../src/shared/real-debrid-accounts";
import { createVisualFixture } from "./visual/fixtures";

describe("Real-Debrid support summary", () => {
  it("projects only safe notification delivery and incident aggregates", () => {
    const payload = buildNotificationSupportPayload(
      {
        queued: 7,
        lastSuccessAt: 1_700_000_000_000,
        lastFailureAt: 1_700_000_010_000,
        events: [{ payload: { url: "https://private.example.test/hook", mention: "@private" } }]
      } as Parameters<typeof buildNotificationSupportPayload>[0],
      {
        status: "alerted",
        incidentType: "no_data",
        incidentStartedAt: 1_700_000_020_000,
        runFingerprint: "private-run",
        url: "https://private.example.test/hook",
        mention: "@private"
      } as Parameters<typeof buildNotificationSupportPayload>[1],
      1_700_000_050_000
    );

    expect(payload).toEqual({
      queued: 7,
      lastSuccessAt: 1_700_000_000_000,
      incidentType: "no_data",
      incidentAgeMs: 30_000
    });
    expect(JSON.stringify(payload)).not.toMatch(/payload|https?:|mention|private|lastFailure/i);
  });

  it("reports no active incident when the health state has no incident", () => {
    expect(buildNotificationSupportPayload(
      { queued: 0, lastSuccessAt: 0 },
      { incidentType: null, incidentStartedAt: 0 },
      1_700_000_050_000
    )).toEqual({ queued: 0, lastSuccessAt: null, incidentType: null, incidentAgeMs: null });
  });

  it("reports pool counts without exposing account IDs or credentials", () => {
    const summary = buildAccountSummary({
      ...defaultSettings(),
      realDebridApiTokens: serializeRealDebridApiAccounts([
        { id: "rda_private_one", token: "secret-one" },
        { id: "rda_private_two", token: "secret-two" }
      ]),
      realDebridWebAccountIds: ["rdw_private_three"],
      realDebridDisabledAccountIds: ["rda_private_two"]
    });
    const realDebrid = summary.realDebrid as Record<string, unknown>;
    const serialized = JSON.stringify(realDebrid);

    expect(realDebrid).toMatchObject({
      configured: true,
      accountCount: 3,
      enabledAccountCount: 2,
      disabledAccountCount: 1,
      apiAccountCount: 2,
      webAccountCount: 1
    });
    expect(serialized).not.toContain("rda_private");
    expect(serialized).not.toContain("rdw_private");
    expect(serialized).not.toContain("secret-");
  });

  it("removes rolling account IDs and labels from support statistics", () => {
    const snapshot = structuredClone(createVisualFixture("empty").snapshot);
    snapshot.stats.rolling24Hours = {
      from: 1,
      to: 2,
      downloadedBytes: 4_096,
      accounts: [{
        id: "rdw_private_account",
        provider: "realdebrid",
        label: "private-user@example.test",
        bytes: 4_096
      }]
    };

    const payload = buildStatsPayload(snapshot);
    const serialized = JSON.stringify(payload);

    expect(serialized).not.toContain("rdw_private_account");
    expect(serialized).not.toContain("private-user@example.test");
    expect(serialized).toContain("realdebrid");
    expect(serialized).toContain("4096");
  });

  it("keeps the persisted notification health incident outside support bundles", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-support-health-"));
    try {
      const paths = createStoragePaths(root);
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(paths.notificationHealthFile, "PRIVATE_HEALTH_INCIDENT_PAYLOAD", "utf8");
      const snapshot = structuredClone(createVisualFixture("empty").snapshot);
      const manager = {
        getSnapshot: () => snapshot,
        getPackageLogPath: () => null,
        getItemLogPath: () => null
      };

      const buffer = await buildSupportBundle(manager as any, root, { hostDiagnosticsMode: "none" });
      const zip = new AdmZip(buffer);
      const entries = zip.getEntries().map((entry) => entry.entryName);

      expect(entries).not.toContain(path.basename(paths.notificationHealthFile));
      expect(buffer.toString("utf8")).not.toContain("PRIVATE_HEALTH_INCIDENT_PAYLOAD");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
