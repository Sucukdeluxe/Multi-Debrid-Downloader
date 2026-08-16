import { afterEach, describe, expect, it } from "vitest";
import { createAccountRuntimeEntries } from "../src/main/account-runtime-snapshot";
import {
  recordAccountRuntimeAttempt,
  recordAccountRuntimeFailure,
  recordAccountRuntimeSuccess,
  resetAccountRuntimeSessionForProvider
} from "../src/main/account-runtime";
import { resetMegaDebridRuntimeStateForTests } from "../src/main/debrid";
import type { DownloadItem, RendererAccount } from "../src/shared/types";

afterEach(() => {
  resetMegaDebridRuntimeStateForTests();
  resetAccountRuntimeSessionForProvider("megadebrid-api");
  resetAccountRuntimeSessionForProvider("megadebrid-web");
});

function account(provider: "megadebrid-api" | "megadebrid-web", enabled = true): RendererAccount {
  return {
    accountId: "shared-account",
    kind: provider,
    provider,
    identity: "runtime-user",
    maskedIdentity: "run***ser",
    hasSecret: true,
    enabled,
    dailyLimitBytes: 0,
    dailyUsageBytes: provider === "megadebrid-api" ? 1000 : 2000,
    totalUsageBytes: 0,
    status: null
  };
}

function item(provider: "megadebrid-api" | "megadebrid-web"): DownloadItem {
  return {
    id: `item-${provider}`,
    packageId: "package-runtime",
    url: "https://hoster.example/runtime.bin",
    provider,
    providerAccountId: "shared-account",
    status: "downloading",
    retries: 0,
    speedBps: 100,
    downloadedBytes: 10,
    totalBytes: 100,
    progressPercent: 10,
    fileName: "runtime.bin",
    targetPath: "runtime.bin",
    resumable: true,
    attempts: 1,
    lastError: "",
    fullStatus: "Download läuft",
    createdAt: 1000,
    updatedAt: 2000
  };
}

describe("account runtime snapshot", () => {
  it("keeps API and web telemetry separate when both modes share an account id", () => {
    recordAccountRuntimeAttempt("megadebrid-api", "shared-account", 1500);
    recordAccountRuntimeSuccess("megadebrid-api", "shared-account", 1600);
    recordAccountRuntimeAttempt("megadebrid-web", "shared-account", 1700);
    recordAccountRuntimeFailure("megadebrid-web", "shared-account", 1800);

    const entries = createAccountRuntimeEntries(
      [account("megadebrid-api"), account("megadebrid-web")],
      [item("megadebrid-api")],
      3000
    );

    expect(entries).toEqual([
      expect.objectContaining({ provider: "megadebrid-api", activeDownloads: 1, attempts: 1, successes: 1, failures: 0 }),
      expect.objectContaining({ provider: "megadebrid-web", activeDownloads: 0, attempts: 1, successes: 0, failures: 1 })
    ]);
  });

  it("keeps a disabled account disabled even when an old item still references it", () => {
    const [entry] = createAccountRuntimeEntries([account("megadebrid-api", false)], [item("megadebrid-api")], 3000);

    expect(entry).toEqual(expect.objectContaining({
      state: "disabled",
      reason: "Account deaktiviert",
      activeDownloads: 1
    }));
  });
});
