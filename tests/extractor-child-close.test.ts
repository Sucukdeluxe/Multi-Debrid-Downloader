import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const childProcesses = vi.hoisted(() => {
  class FakeEmitter {
    private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

    public on(name: string, listener: (...args: unknown[]) => void): this {
      const listeners = this.listeners.get(name) || [];
      listeners.push(listener);
      this.listeners.set(name, listeners);
      return this;
    }

    public emit(name: string, ...args: unknown[]): boolean {
      for (const listener of this.listeners.get(name) || []) {
        listener(...args);
      }
      return true;
    }
  }

  class FakeChild extends FakeEmitter {
    public readonly stdout = new FakeEmitter();
    public readonly stderr = new FakeEmitter();
    public readonly stdin = { end: vi.fn(), write: vi.fn() };
    public readonly pid: number;
    public readonly kill = vi.fn();

    public constructor(pid: number) {
      super();
      this.pid = pid;
    }
  }

  return {
    nextPid: 10_000,
    activeExtraction: null as FakeChild | null,
    spawn: vi.fn((_command: string, args: string[]) => {
      const child = new FakeChild(childProcesses.nextPid++);
      if (args[0] === "?") {
        queueMicrotask(() => child.emit("close", 0));
      } else if (args[0] === "l") {
        queueMicrotask(() => {
          child.stdout.emit("data", "----------\nPath = episode.mkv\nFolder = -\n");
          child.emit("close", 0);
        });
      } else if (args[0] === "/PID") {
        queueMicrotask(() => child.emit("close", 0));
      } else {
        childProcesses.activeExtraction = child;
      }
      return child;
    }),
    spawnSync: vi.fn(() => ({ status: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }))
  };
});

vi.mock("node:child_process", () => ({
  spawn: childProcesses.spawn,
  spawnSync: childProcesses.spawnSync
}));

import { extractPackageArchives } from "../src/main/extractor";

const tempDirs: string[] = [];
const originalBackend = process.env.RD_EXTRACT_BACKEND;
const originalSevenZip = process.env.RD_7Z_BIN;

afterEach(() => {
  vi.useRealTimers();
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  childProcesses.activeExtraction = null;
  childProcesses.spawn.mockClear();
  if (originalBackend === undefined) {
    delete process.env.RD_EXTRACT_BACKEND;
  } else {
    process.env.RD_EXTRACT_BACKEND = originalBackend;
  }
  if (originalSevenZip === undefined) {
    delete process.env.RD_7Z_BIN;
  } else {
    process.env.RD_7Z_BIN = originalSevenZip;
  }
});

describe("extractor child close lifecycle", () => {
  it("keeps an aborted native archive job active until the original child closes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-native-child-close-"));
    tempDirs.push(root);
    const packageDir = path.join(root, "package");
    const targetDir = path.join(root, "target");
    const sevenZipPath = path.join(root, "7z.exe");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(sevenZipPath, "fake");
    fs.writeFileSync(path.join(packageDir, "release.7z"), Buffer.from("377abcaf271c", "hex"));
    process.env.RD_EXTRACT_BACKEND = "legacy";
    process.env.RD_7Z_BIN = sevenZipPath;
    const controller = new AbortController();
    let settled = false;
    let failure: unknown;

    const extraction = extractPackageArchives({
      packageDir,
      targetDir,
      cleanupMode: "none",
      conflictMode: "overwrite",
      removeLinks: false,
      removeSamples: false,
      passwordList: "",
      signal: controller.signal
    }).catch((error) => {
      failure = error;
    }).finally(() => {
      settled = true;
    });

    await vi.waitFor(() => expect(childProcesses.activeExtraction).not.toBeNull());
    controller.abort("abort-test");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);

    childProcesses.activeExtraction?.emit("close", 1);
    await extraction;
    expect(String(failure)).toContain("aborted:extract");
  });

  it("keeps a timed-out native archive job active until the original child closes", async () => {
    vi.useFakeTimers();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-native-timeout-close-"));
    tempDirs.push(root);
    const packageDir = path.join(root, "package");
    const targetDir = path.join(root, "target");
    const sevenZipPath = path.join(root, "7z.exe");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(sevenZipPath, "fake");
    fs.writeFileSync(path.join(packageDir, "release.7z"), Buffer.from("377abcaf271c", "hex"));
    process.env.RD_EXTRACT_BACKEND = "legacy";
    process.env.RD_7Z_BIN = sevenZipPath;
    let settled = false;
    const results: Awaited<ReturnType<typeof extractPackageArchives>>[] = [];

    const extraction = extractPackageArchives({
      packageDir,
      targetDir,
      cleanupMode: "none",
      conflictMode: "overwrite",
      removeLinks: false,
      removeSamples: false,
      passwordList: ""
    }).then((value) => {
      results.push(value);
    }).finally(() => {
      settled = true;
    });

    await vi.waitFor(() => expect(childProcesses.activeExtraction).not.toBeNull());
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000);
    expect(settled).toBe(false);

    childProcesses.activeExtraction?.emit("close", 1);
    await extraction;
    expect(results[0]).toEqual(expect.objectContaining({ failed: 1 }));
    expect(results[0]?.lastError).toContain("Timeout");
  });
});
