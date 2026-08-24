import { describe, expect, it } from "vitest";
import { defaultSettings } from "../src/main/constants";
import {
  addRealDebridAccountDailyUsageBytes,
  addRealDebridAccountTotalUsageBytes,
  getProviderUsageDayKey,
  getRealDebridAccountDailyRemainingBytes,
  getRealDebridAccountDailyUsageBytes,
  getRealDebridAccountTotalUsageBytes,
  isRealDebridAccountDailyLimitReached,
  resetProviderDailyUsage,
  resetRealDebridAccountDailyUsage
} from "../src/shared/provider-daily-limits";

describe("Real-Debrid account usage", () => {
  it("counts daily and lifetime traffic only for the selected account", () => {
    const settings = {
      ...defaultSettings(),
      providerDailyUsageDay: getProviderUsageDayKey(),
      realDebridAccountDailyUsageBytes: { rda_one: 100, rda_two: 200 },
      realDebridAccountTotalUsageBytes: { rda_one: 1000, rda_two: 2000 }
    };

    const daily = addRealDebridAccountDailyUsageBytes(settings, "rda_two", 50);
    const total = addRealDebridAccountTotalUsageBytes(settings, "rda_two", 50);

    expect(daily.realDebridAccountDailyUsageBytes).toEqual({ rda_one: 100, rda_two: 250 });
    expect(total.realDebridAccountTotalUsageBytes).toEqual({ rda_one: 1000, rda_two: 2050 });
  });

  it("resets stale daily usage before adding new account traffic", () => {
    const settings = {
      ...defaultSettings(),
      providerDailyUsageDay: "2000-01-01",
      realDebridAccountDailyUsageBytes: { rda_one: 900 }
    };

    const next = addRealDebridAccountDailyUsageBytes(settings, "rda_two", 75);

    expect(next.providerDailyUsageDay).toBe(getProviderUsageDayKey());
    expect(next.realDebridAccountDailyUsageBytes).toEqual({ rda_two: 75 });
    expect(getRealDebridAccountDailyUsageBytes(settings, "rda_one")).toBe(0);
  });

  it("marks only the account whose own daily limit is reached", () => {
    const settings = {
      ...defaultSettings(),
      providerDailyUsageDay: getProviderUsageDayKey(),
      realDebridAccountDailyLimitBytes: { rda_one: 100, rda_two: 500 },
      realDebridAccountDailyUsageBytes: { rda_one: 100, rda_two: 100 }
    };

    expect(isRealDebridAccountDailyLimitReached(settings, "rda_one")).toBe(true);
    expect(isRealDebridAccountDailyLimitReached(settings, "rda_two")).toBe(false);
    expect(getRealDebridAccountDailyRemainingBytes(settings, "rda_two")).toBe(400);
    expect(getRealDebridAccountTotalUsageBytes({ ...settings, realDebridAccountTotalUsageBytes: { rda_two: 900 } }, "rda_two")).toBe(900);
  });

  it("resets one Real-Debrid account without clearing the others", () => {
    const settings = {
      ...defaultSettings(),
      providerDailyUsageDay: getProviderUsageDayKey(),
      realDebridAccountDailyUsageBytes: { rda_one: 100, rda_two: 200 }
    };

    const next = resetRealDebridAccountDailyUsage(settings, "rda_one");

    expect(next.realDebridAccountDailyUsageBytes).toEqual({ rda_two: 200 });
  });
});

describe("Deepbrid provider usage", () => {
  it("resets only Deepbrid daily usage while preserving other providers", () => {
    const settings = {
      ...defaultSettings(),
      providerDailyUsageDay: getProviderUsageDayKey(),
      providerDailyUsageBytes: { deepbrid: 300, alldebrid: 900 }
    };

    const next = resetProviderDailyUsage(settings, "deepbrid");

    expect(next.providerDailyUsageBytes).toEqual({ alldebrid: 900 });
  });
});
