import { win32 } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { HistoryEntry } from "../src/shared/types";
import {
  revealHistoryEntry,
  type HistoryRevealDependencies
} from "../src/main/history-reveal";

function historyEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: "known-id",
    name: "Paket",
    totalBytes: 1,
    downloadedBytes: 1,
    fileCount: 1,
    provider: "realdebrid",
    completedAt: 1,
    durationSeconds: 1,
    status: "completed",
    outputDir: "C:\\Downloads\\Paket",
    urls: [],
    ...overrides
  };
}

function dependencies(overrides: Partial<HistoryRevealDependencies> = {}): HistoryRevealDependencies {
  return {
    loadHistory: () => [historyEntry()],
    stat: vi.fn(async () => ({ isDirectory: () => true })),
    openPath: vi.fn(async () => ""),
    ...overrides
  };
}

describe("revealHistoryEntry", () => {
  it.each(["", " ", " padded", "padded ", "x".repeat(257)])("rejects malformed entry id %j before loading history", async (entryId) => {
    const loadHistory = vi.fn(() => [historyEntry()]);
    const deps = dependencies({ loadHistory });

    await expect(revealHistoryEntry({ entryId }, deps)).resolves.toEqual({ ok: false, reason: "entry-not-found" });
    expect(loadHistory).not.toHaveBeenCalled();
    expect(deps.stat).not.toHaveBeenCalled();
    expect(deps.openPath).not.toHaveBeenCalled();
  });

  it("resolves a known case-sensitive id to the authoritative directory and opens it exactly once", async () => {
    const deps = dependencies();

    await expect(revealHistoryEntry({ entryId: "known-id" }, deps)).resolves.toEqual({ ok: true });
    expect(deps.stat).toHaveBeenCalledTimes(1);
    expect(deps.stat).toHaveBeenCalledWith("C:\\Downloads\\Paket");
    expect(deps.openPath).toHaveBeenCalledTimes(1);
    expect(deps.openPath).toHaveBeenCalledWith("C:\\Downloads\\Paket");
  });

  it.each(["partial", "failed", "cancelled"] as const)("opens a %s history result from the same authoritative directory", async (status) => {
    const deps = dependencies({ loadHistory: () => [historyEntry({ status })] });

    await expect(revealHistoryEntry({ entryId: "known-id" }, deps)).resolves.toEqual({ ok: true });
    expect(deps.openPath).toHaveBeenCalledWith("C:\\Downloads\\Paket");
  });

  it("ignores every renderer-supplied field except entryId", async () => {
    const deps = dependencies();

    await expect(revealHistoryEntry({ entryId: "known-id", outputDir: "C:\\Angriff" } as never, deps)).resolves.toEqual({ ok: true });
    expect(deps.openPath).toHaveBeenCalledWith("C:\\Downloads\\Paket");
  });

  it("rejects unknown and differently cased ids before path inspection", async () => {
    const deps = dependencies();

    await expect(revealHistoryEntry({ entryId: "KNOWN-ID" }, deps)).resolves.toEqual({ ok: false, reason: "entry-not-found" });
    expect(deps.stat).not.toHaveBeenCalled();
    expect(deps.openPath).not.toHaveBeenCalled();
  });

  it.each([
    "relative\\folder",
    "C:relative\\folder",
    "\\current-drive-rooted",
    "/current-drive-rooted",
    "\\\\server",
    "\\\\server\\",
    "\\\\..\\share\\folder",
    "\\\\server\\.\\folder",
    "\\\\server\\..\\folder",
    "\\\\.\\C:\\folder",
    "\\\\?\\C:\\folder",
    "\\\\?\\GLOBALROOT\\Device\\HarddiskVolumeShadowCopy1",
    "C:\\folder:stream",
    "\\\\server\\share\\folder:stream",
    "C:\\folder\0bad",
    "C:\\folder\nbad",
    "C:\\bad?name"
  ])("rejects unsafe or non-absolute Windows path %s", async (outputDir) => {
    const deps = dependencies({ loadHistory: () => [historyEntry({ outputDir })] });

    await expect(revealHistoryEntry({ entryId: "known-id" }, deps)).resolves.toEqual({ ok: false, reason: "invalid-output-dir" });
    expect(deps.stat).not.toHaveBeenCalled();
    expect(deps.openPath).not.toHaveBeenCalled();
  });

  it.each([
    ["C:/Media/Folder//Child", win32.normalize("C:/Media/Folder//Child")],
    ["\\\\server\\share\\Folder\\Child\\", win32.normalize("\\\\server\\share\\Folder\\Child\\")]
  ])("normalizes valid drive and UNC paths before stat and openPath", async (outputDir, normalized) => {
    const deps = dependencies({ loadHistory: () => [historyEntry({ outputDir })] });

    await expect(revealHistoryEntry({ entryId: "known-id" }, deps)).resolves.toEqual({ ok: true });
    expect(deps.stat).toHaveBeenCalledWith(normalized);
    expect(deps.openPath).toHaveBeenCalledWith(normalized);
  });

  it("maps a missing directory and a file target without calling openPath", async () => {
    const missing = dependencies({ stat: vi.fn(async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); }) });
    const file = dependencies({ stat: vi.fn(async () => ({ isDirectory: () => false })) });

    await expect(revealHistoryEntry({ entryId: "known-id" }, missing)).resolves.toEqual({ ok: false, reason: "output-dir-missing" });
    await expect(revealHistoryEntry({ entryId: "known-id" }, file)).resolves.toEqual({ ok: false, reason: "output-dir-not-directory" });
    expect(missing.openPath).not.toHaveBeenCalled();
    expect(file.openPath).not.toHaveBeenCalled();
  });

  it.each([
    Object.assign(new Error("denied"), { code: "EACCES" }),
    new Error("network unavailable")
  ])("maps non-missing stat failures to open-failed without calling openPath", async (error) => {
    const deps = dependencies({ stat: vi.fn(async () => { throw error; }) });

    await expect(revealHistoryEntry({ entryId: "known-id" }, deps)).resolves.toEqual({ ok: false, reason: "open-failed" });
    expect(deps.openPath).not.toHaveBeenCalled();
  });

  it("accepts followed junction or symlink stats when the resolved target is a directory", async () => {
    const deps = dependencies({ stat: vi.fn(async () => ({ isDirectory: () => true, isSymbolicLink: () => true })) });

    await expect(revealHistoryEntry({ entryId: "known-id" }, deps)).resolves.toEqual({ ok: true });
    expect(deps.openPath).toHaveBeenCalledTimes(1);
  });

  it("treats a non-empty shell result and a rejected shell promise as open failures", async () => {
    const returnedError = dependencies({ openPath: vi.fn(async () => "Zugriff verweigert") });
    const rejected = dependencies({ openPath: vi.fn(async () => { throw new Error("shell failed"); }) });

    await expect(revealHistoryEntry({ entryId: "known-id" }, returnedError)).resolves.toEqual({ ok: false, reason: "open-failed" });
    await expect(revealHistoryEntry({ entryId: "known-id" }, rejected)).resolves.toEqual({ ok: false, reason: "open-failed" });
  });
});
