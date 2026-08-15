import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  getRealDebridAccountIds,
  getRealDebridAccounts,
  getRealDebridApiAccountId,
  parseRealDebridApiAccounts,
  serializeRealDebridApiAccounts
} from "../src/shared/real-debrid-accounts";

describe("Real-Debrid account pool", () => {
  it("parses distinct API tokens and removes exact duplicates", () => {
    const accounts = parseRealDebridApiAccounts("first-secret-token\r\nsecond-secret-token\nfirst-secret-token");

    expect(accounts).toHaveLength(2);
    expect(accounts.map((entry) => entry.token)).toEqual(["first-secret-token", "second-secret-token"]);
    expect(accounts.map((entry) => entry.label)).toEqual(["API-Token 1", "API-Token 2"]);
  });

  it("creates stable opaque IDs without secret material", () => {
    const token = "private-real-debrid-token";
    const first = getRealDebridApiAccountId(token);
    const second = getRealDebridApiAccountId(`  ${token}  `);

    expect(first).toBe(second);
    expect(first).toMatch(/^rda_[a-z0-9]+$/);
    expect(first).not.toContain(token);
    expect(parseRealDebridApiAccounts(token)[0]).toMatchObject({ id: first, kind: "api" });
    expect(parseRealDebridApiAccounts(token)[0].label).not.toContain(token);
    expect(parseRealDebridApiAccounts(token)[0].maskedLogin).not.toContain(token);
  });

  it.each([
    "cryptographic-real-debrid-token",
    "üñîçødé-real-debrid-token",
    "x".repeat(160)
  ])("derives API account IDs from a cryptographic SHA-256 fingerprint", (token) => {
    const digest = crypto.createHash("sha256").update(token, "utf8").digest("hex").slice(0, 32);

    expect(getRealDebridApiAccountId(token)).toBe(`rda_${digest}`);
  });

  it("serializes normalized unique API tokens one per line", () => {
    expect(serializeRealDebridApiAccounts([
      " first-secret-token ",
      "",
      "second-secret-token",
      "first-secret-token"
    ])).toBe("first-secret-token\nsecond-secret-token");
  });

  it("combines API and opaque Web accounts and marks disabled entries", () => {
    const apiId = getRealDebridApiAccountId("api-secret");
    const settings = {
      realDebridApiTokens: "api-secret",
      realDebridWebAccountIds: ["rdw_legacy", "rdw_second"],
      realDebridDisabledAccountIds: [apiId, "rdw_second"]
    };

    expect(getRealDebridAccounts(settings)).toEqual([
      expect.objectContaining({ id: apiId, kind: "api", enabled: false }),
      expect.objectContaining({ id: "rdw_legacy", kind: "web", enabled: true }),
      expect.objectContaining({ id: "rdw_second", kind: "web", enabled: false })
    ]);
    expect(getRealDebridAccountIds(settings)).toEqual([apiId, "rdw_legacy", "rdw_second"]);
  });
});
