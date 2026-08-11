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
});
