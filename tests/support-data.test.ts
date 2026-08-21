import { describe, expect, it } from "vitest";
import { defaultSettings } from "../src/main/constants";
import { buildAccountSummary, buildStatsPayload } from "../src/main/support-data";
import { serializeRealDebridApiAccounts } from "../src/shared/real-debrid-accounts";
import { createVisualFixture } from "./visual/fixtures";

describe("Real-Debrid support summary", () => {
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
});
