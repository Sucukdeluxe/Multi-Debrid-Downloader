import { describe, expect, it } from "vitest";
import { matchesAccountModeFilter } from "../src/renderer/account-ui";

describe("account mode filter", () => {
  it("shows only API options for the API filter", () => {
    expect(matchesAccountModeFilter({ modeLabel: "API" }, "api")).toBe(true);
    expect(matchesAccountModeFilter({ modeLabel: "Web-Login" }, "api")).toBe(false);
  });

  it("shows Web-Login options for the Web filter", () => {
    expect(matchesAccountModeFilter({ modeLabel: "Web-Login" }, "web")).toBe(true);
    expect(matchesAccountModeFilter({ modeLabel: "API" }, "web")).toBe(false);
  });
});
