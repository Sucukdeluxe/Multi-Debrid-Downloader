import { beforeAll, describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "../src/shared/ipc";
import type { ElectronApi } from "../src/shared/preload-api";
import type { HistoryEntry } from "../src/shared/types";

const electron = vi.hoisted(() => ({
  api: undefined as ElectronApi | undefined,
  listeners: new Map<string, (...args: unknown[]) => void>(),
  invoke: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
  on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
    electron.listeners.set(channel, listener);
  }),
  removeListener: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
    if (electron.listeners.get(channel) === listener) {
      electron.listeners.delete(channel);
    }
  })
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: ElectronApi) => {
      electron.api = api;
    }
  },
  ipcRenderer: {
    invoke: electron.invoke,
    on: electron.on,
    removeListener: electron.removeListener,
    send: vi.fn()
  }
}));

describe("history preload contract", () => {
  beforeAll(async () => {
    await import("../src/preload/preload");
  });

  it("subscribes to saved history entries and removes the exact listener", () => {
    const received: HistoryEntry[] = [];
    const entry = { id: "history-live" } as HistoryEntry;
    const unsubscribe = electron.api?.onHistoryEntryAdded((value) => received.push(value));
    const listener = electron.listeners.get(IPC_CHANNELS.HISTORY_ENTRY_ADDED);

    expect(listener).toBeTypeOf("function");
    listener?.({}, entry);
    expect(received).toEqual([entry]);

    unsubscribe?.();
    expect(electron.removeListener).toHaveBeenCalledWith(IPC_CHANNELS.HISTORY_ENTRY_ADDED, listener);
  });

  it("forwards a history selection through one bulk removal channel", async () => {
    electron.invoke.mockClear();

    await electron.api?.removeHistoryEntries(["history-a", "history-b"]);

    expect(electron.invoke).toHaveBeenCalledTimes(1);
    expect(electron.invoke).toHaveBeenCalledWith(IPC_CHANNELS.REMOVE_HISTORY_ENTRIES, ["history-a", "history-b"]);
  });
});
