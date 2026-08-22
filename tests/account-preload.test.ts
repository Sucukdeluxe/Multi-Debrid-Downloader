import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "../src/shared/ipc";
import type { ElectronApi } from "../src/shared/preload-api";

const electron = vi.hoisted(() => ({
  api: undefined as ElectronApi | undefined,
  invoke: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined)
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: ElectronApi) => {
      electron.api = api;
    }
  },
  ipcRenderer: {
    invoke: electron.invoke,
    on: vi.fn(),
    removeListener: vi.fn(),
    send: vi.fn()
  }
}));

describe("account preload contract", () => {
  beforeAll(async () => {
    await import("../src/preload/preload");
  });

  beforeEach(() => {
    electron.invoke.mockClear();
  });

  it("forwards submitted secrets only in write-only account commands", async () => {
    const secret = "fixture-preload-secret-5zK1";
    electron.invoke.mockResolvedValueOnce({ accountId: "mda_fixture", settings: { language: "de" }, accounts: [] });
    const result = await electron.api?.createAccount({
      action: "create",
      kind: "megadebrid-api",
      identity: "preload-account@example.test",
      secret,
      dailyLimitBytes: 0
    });

    expect(electron.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.CREATE_ACCOUNT,
      expect.objectContaining({ secret })
    );
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("exposes separate replace, update-secret and delete channels", async () => {
    electron.invoke.mockResolvedValue({ accountId: "mda_fixture", settings: { language: "de" }, accounts: [] });

    await electron.api?.replaceAccount({ action: "replace", kind: "megadebrid-api", accountId: "mda_fixture", identity: "account@example.test", secret: "", dailyLimitBytes: 0 });
    await electron.api?.updateAccountSecret({ action: "update-secret", kind: "megadebrid-api", accountId: "mda_fixture", secret: "fixture-new-secret-8sP4" });
    await electron.api?.deleteAccount({ action: "delete", kind: "megadebrid-api", accountId: "mda_fixture" });

    expect(electron.invoke.mock.calls.map((call) => call[0])).toEqual([
      IPC_CHANNELS.REPLACE_ACCOUNT,
      IPC_CHANNELS.UPDATE_ACCOUNT_SECRET,
      IPC_CHANNELS.DELETE_ACCOUNT
    ]);
  });

  it("forwards the selected bulk account-check scope", async () => {
    electron.invoke.mockResolvedValue([]);

    await electron.api?.checkDebridAccounts("active");
    await electron.api?.checkDebridAccounts("all");

    expect(electron.invoke.mock.calls).toEqual([
      [IPC_CHANNELS.CHECK_DEBRID_ACCOUNTS, "active"],
      [IPC_CHANNELS.CHECK_DEBRID_ACCOUNTS, "all"]
    ]);
  });

  it("forwards account-bound existing and create browser logins", async () => {
    await electron.api?.openRealDebridLogin({ accountId: "rdw_existing" });
    await electron.api?.openRealDebridLogin({ accountId: "rdw_reserved", create: true, dailyLimitBytes: 10_000 });

    expect(electron.invoke.mock.calls).toEqual([
      [IPC_CHANNELS.OPEN_REALDEBRID_LOGIN, { accountId: "rdw_existing" }],
      [IPC_CHANNELS.OPEN_REALDEBRID_LOGIN, { accountId: "rdw_reserved", create: true, dailyLimitBytes: 10_000 }]
    ]);
  });

  it("reveals a stored secret only through the explicit account channel", async () => {
    electron.invoke.mockResolvedValueOnce({ secret: "fixture-revealed-secret-7gH8" });

    const result = await (electron.api as ElectronApi & {
      revealAccountSecret: (request: { kind: "realdebrid-api"; accountId: string }) => Promise<{ secret: string }>;
    }).revealAccountSecret({ kind: "realdebrid-api", accountId: "svc-realdebrid" });

    expect(electron.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.REVEAL_ACCOUNT_SECRET,
      { kind: "realdebrid-api", accountId: "svc-realdebrid" }
    );
    expect(result).toEqual({ secret: "fixture-revealed-secret-7gH8" });
  });

  it("loads the stored archive password list only through its dedicated channel", async () => {
    const passwords = "fixture-archive-one\nfixture-archive-two";
    electron.invoke.mockResolvedValueOnce({ passwords });

    const result = await (electron.api as ElectronApi & {
      getArchivePasswordList: () => Promise<{ passwords: string }>;
    }).getArchivePasswordList();

    expect(electron.invoke).toHaveBeenCalledWith(IPC_CHANNELS.GET_ARCHIVE_PASSWORD_LIST);
    expect(result).toEqual({ passwords });
  });

  it("forwards collector text and container inspection without adding downloads", async () => {
    const result = { packages: [], invalidCount: 0, duplicateCount: 0 };
    electron.invoke.mockResolvedValue(result);

    await electron.api?.inspectCollectorText({ rawText: "https://1fichier.com/?abc12345", addedAt: 1234 });
    await electron.api?.inspectCollectorContainers(["C:\\Imports\\sample.dlc"], 5678);

    expect(electron.invoke.mock.calls).toEqual([
      [IPC_CHANNELS.INSPECT_COLLECTOR_TEXT, { rawText: "https://1fichier.com/?abc12345", addedAt: 1234 }],
      [IPC_CHANNELS.INSPECT_COLLECTOR_CONTAINERS, ["C:\\Imports\\sample.dlc"], 5678]
    ]);
  });
});
