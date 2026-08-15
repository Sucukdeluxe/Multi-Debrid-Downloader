import { describe, expect, it } from "vitest";
import { defaultSettings } from "../src/main/constants";
import { buildAccountSummary } from "../src/main/support-data";
import { serializeRealDebridApiAccounts } from "../src/shared/real-debrid-accounts";

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
});
