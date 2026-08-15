import { describe, expect, it } from "vitest";
import {
  getRealDebridAccountIds,
  getRealDebridAccounts,
  parseRealDebridApiAccounts,
  serializeRealDebridApiAccounts
} from "../src/shared/real-debrid-accounts";

describe("Real-Debrid account pool", () => {
  it("reads persisted opaque API identities and removes duplicate tokens", () => {
    const raw = serializeRealDebridApiAccounts([
      { id: "rda_firstOpaque", token: "first-secret-token" },
      { id: "rda_secondOpaque", token: "second-secret-token" },
      { id: "rda_duplicateOpaque", token: "first-secret-token" }
    ]);
    const accounts = parseRealDebridApiAccounts(raw);

    expect(accounts).toHaveLength(2);
    expect(accounts.map((entry) => entry.id)).toEqual(["rda_firstOpaque", "rda_secondOpaque"]);
    expect(accounts.map((entry) => entry.token)).toEqual(["first-secret-token", "second-secret-token"]);
  });

  it("keeps opaque IDs independent from token material", () => {
    const token = "private-real-debrid-token";
    const raw = serializeRealDebridApiAccounts([{ id: "rda_opaqueAccount42", token }]);
    const account = parseRealDebridApiAccounts(raw)[0];

    expect(account.id).toBe("rda_opaqueAccount42");
    expect(account.id).not.toContain(token);
    expect(account.label).not.toContain(token);
    expect(account.maskedLogin).not.toContain(token);
  });

  it("serializes the versioned pool idempotently", () => {
    const serialized = serializeRealDebridApiAccounts([
      { id: "rda_firstOpaque", token: " first-secret-token " },
      { id: "rda_secondOpaque", token: "second-secret-token" }
    ]);

    expect(serializeRealDebridApiAccounts(parseRealDebridApiAccounts(serialized))).toBe(serialized);
  });

  it("combines API and opaque Web accounts and marks disabled entries", () => {
    const settings = {
      realDebridApiTokens: serializeRealDebridApiAccounts([{ id: "rda_apiOpaque", token: "api-secret" }]),
      realDebridWebAccountIds: ["rdw_legacy", "rdw_second"],
      realDebridDisabledAccountIds: ["rda_apiOpaque", "rdw_second"]
    };

    expect(getRealDebridAccounts(settings)).toEqual([
      expect.objectContaining({ id: "rda_apiOpaque", kind: "api", enabled: false }),
      expect.objectContaining({ id: "rdw_legacy", kind: "web", enabled: true }),
      expect.objectContaining({ id: "rdw_second", kind: "web", enabled: false })
    ]);
    expect(getRealDebridAccountIds(settings)).toEqual(["rda_apiOpaque", "rdw_legacy", "rdw_second"]);
  });
});
