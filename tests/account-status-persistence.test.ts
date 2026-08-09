import { describe, expect, it } from "vitest";
import { canPersistExpectedAccountStatus } from "../src/main/account-status-persistence";
import type { DebridAccountStatus } from "../src/shared/types";

function status(accountId: string, valid = true): DebridAccountStatus {
  return {
    accountId,
    provider: "megadebrid",
    label: "Account 1",
    maskedLogin: "us***om",
    valid,
    isPremium: true,
    premiumUntilMs: null,
    message: valid ? "OK" : "Ungültig",
    checkedAt: 1
  };
}

describe("account status persistence", () => {
  it("accepts only one valid status for the expected account", () => {
    expect(canPersistExpectedAccountStatus([status("expected")], "expected")).toBe(true);
    expect(canPersistExpectedAccountStatus([], "expected")).toBe(false);
    expect(canPersistExpectedAccountStatus([status("other")], "expected")).toBe(false);
    expect(canPersistExpectedAccountStatus([status("expected", false)], "expected")).toBe(false);
    expect(canPersistExpectedAccountStatus([status("expected"), status("other")], "expected")).toBe(false);
    expect(canPersistExpectedAccountStatus([status("expected")], "")).toBe(false);
  });
});
