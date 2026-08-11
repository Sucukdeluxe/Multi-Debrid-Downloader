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

describe("backup preload contract", () => {
  beforeAll(async () => {
    await import("../src/preload/preload");
  });

  beforeEach(() => {
    electron.invoke.mockClear();
  });

  it("forwards an export passphrase without adding it to the result contract", async () => {
    electron.invoke.mockResolvedValueOnce({ saved: true });
    const result = await electron.api?.exportBackup("one-operation test phrase");

    expect(electron.invoke).toHaveBeenCalledWith(IPC_CHANNELS.EXPORT_BACKUP, "one-operation test phrase");
    expect(result).toEqual({ saved: true });
  });

  it("keeps import selection and cancellation passphrase-free", async () => {
    electron.invoke.mockResolvedValueOnce({ selected: true, requiresPassphrase: true });
    await electron.api?.selectBackupImport();
    await electron.api?.cancelBackupImport();

    expect(electron.invoke).toHaveBeenNthCalledWith(1, IPC_CHANNELS.SELECT_BACKUP_IMPORT);
    expect(electron.invoke).toHaveBeenNthCalledWith(2, IPC_CHANNELS.CANCEL_BACKUP_IMPORT);
  });

  it("forwards an import passphrase only to the consuming operation", async () => {
    electron.invoke.mockResolvedValueOnce({ restored: true, relaunch: false, message: "Einstellungen wiederhergestellt" });
    const result = await electron.api?.importBackup("one-operation test phrase");

    expect(electron.invoke).toHaveBeenCalledWith(IPC_CHANNELS.IMPORT_BACKUP, "one-operation test phrase");
    expect(result).toEqual({ restored: true, relaunch: false, message: "Einstellungen wiederhergestellt" });
  });
});
