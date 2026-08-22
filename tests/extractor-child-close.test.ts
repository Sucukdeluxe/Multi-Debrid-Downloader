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
    daemonChild: null as FakeChild | null,
    oneShotJvmChildren: [] as FakeChild[],
    autoDaemonReady: true,
    spawn: vi.fn((_command: string, args: string[]) => {
      const child = new FakeChild(childProcesses.nextPid++);
      if (args.includes("--daemon")) {
        childProcesses.daemonChild = child;
        if (childProcesses.autoDaemonReady) {
          queueMicrotask(() => child.stdout.emit("data", "RD_DAEMON_READY\n"));
        }
      } else if (args.includes("--archive")) {
        childProcesses.oneShotJvmChildren.push(child);
      } else if (args[0] === "?") {
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

import { extractPackageArchives, shutdownDaemon } from "../src/main/extractor";
import { ExtractionCoordinator } from "../src/main/extraction-coordinator";

const tempDirs: string[] = [];
const originalBackend = process.env.RD_EXTRACT_BACKEND;
const originalSevenZip = process.env.RD_7Z_BIN;
const originalJava = process.env.RD_JAVA_BIN;
const originalJvmRoot = process.env.RD_EXTRACTOR_JVM_DIR;

function createJvmFixture(prefix: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(root);
  const packageDir = path.join(root, "package");
  const targetDir = path.join(root, "target");
  const javaPath = path.join(root, "java.exe");
  const jvmRoot = path.join(root, "extractor-jvm");
  const classesDir = path.join(jvmRoot, "classes");
  const libDir = path.join(jvmRoot, "lib");
  fs.mkdirSync(packageDir, { recursive: true });
  fs.mkdirSync(classesDir, { recursive: true });
  fs.mkdirSync(libDir, { recursive: true });
  fs.writeFileSync(javaPath, "fake");
  for (const name of ["sevenzipjbinding.jar", "sevenzipjbinding-all-platforms.jar", "zip4j.jar"]) {
    fs.writeFileSync(path.join(libDir, name), "fake");
  }
  fs.writeFileSync(path.join(packageDir, "release.7z"), Buffer.from("377abcaf271c", "hex"));
  process.env.RD_EXTRACT_BACKEND = "jvm";
  process.env.RD_JAVA_BIN = javaPath;
  process.env.RD_EXTRACTOR_JVM_DIR = jvmRoot;
  return { packageDir, targetDir };
}

function jvmExtractionOptions(fixture: ReturnType<typeof createJvmFixture>, signal?: AbortSignal) {
  return {
    ...fixture,
    cleanupMode: "none" as const,
    conflictMode: "overwrite" as const,
    removeLinks: false,
    removeSamples: false,
    passwordList: "",
    signal
  };
}

afterEach(() => {
  shutdownDaemon();
  vi.useRealTimers();
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  childProcesses.activeExtraction = null;
  childProcesses.daemonChild = null;
  childProcesses.oneShotJvmChildren = [];
  childProcesses.autoDaemonReady = true;
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
  if (originalJava === undefined) {
    delete process.env.RD_JAVA_BIN;
  } else {
    process.env.RD_JAVA_BIN = originalJava;
  }
  if (originalJvmRoot === undefined) {
    delete process.env.RD_EXTRACTOR_JVM_DIR;
  } else {
    process.env.RD_EXTRACTOR_JVM_DIR = originalJvmRoot;
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

  it("does not spawn a JVM one-shot after abort while the daemon is booting", async () => {
    const fixture = createJvmFixture("rd-jvm-boot-abort-");
    childProcesses.autoDaemonReady = false;
    const controller = new AbortController();
    const extraction = extractPackageArchives(jvmExtractionOptions(fixture, controller.signal)).catch(() => undefined);

    await vi.waitFor(() => expect(childProcesses.daemonChild).not.toBeNull());
    controller.abort("boot-abort");
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    const oneShotCount = childProcesses.oneShotJvmChildren.length;

    for (const child of childProcesses.oneShotJvmChildren) {
      child.emit("close", 1);
    }
    childProcesses.daemonChild?.emit("close", 1);
    await extraction;
    expect(oneShotCount).toBe(0);
  });

  it("does not spawn a JVM one-shot after abort while the daemon is busy", async () => {
    const fixture = createJvmFixture("rd-jvm-busy-abort-");
    const firstController = new AbortController();
    const first = extractPackageArchives(jvmExtractionOptions(fixture, firstController.signal)).catch(() => undefined);
    await vi.waitFor(() => expect(childProcesses.daemonChild?.stdin.write).toHaveBeenCalledTimes(1));
    const secondController = new AbortController();
    const second = extractPackageArchives(jvmExtractionOptions(fixture, secondController.signal)).catch(() => undefined);

    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    secondController.abort("busy-abort");
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    const oneShotCount = childProcesses.oneShotJvmChildren.length;

    firstController.abort("cleanup");
    for (const child of childProcesses.oneShotJvmChildren) {
      child.emit("close", 1);
    }
    childProcesses.daemonChild?.emit("close", 1);
    await Promise.all([first, second]);
    expect(oneShotCount).toBe(0);
  });

  it("keeps daemon abort permits and leases until close even when DONE arrives after termination", async () => {
    const fixture = createJvmFixture("rd-jvm-abort-done-");
    const coordinator = new ExtractionCoordinator(1);
    const lease = { release: vi.fn() };
    const operation = await coordinator.beginOperation({
      context: { operationId: "abort-operation", packageId: "package-a", generation: 1, runOwnerId: "run" },
      targetPath: fixture.targetDir,
      members: [{ path: path.join(fixture.packageDir, "release.7z"), size: 6 }],
      acquireLease: async () => lease
    });
    const nextOperation = await coordinator.beginOperation({
      context: { operationId: "next-operation", packageId: "package-b", generation: 1, runOwnerId: "run" }
    });
    const job = coordinator.scheduleArchive(operation, "release.7z", (signal) =>
      extractPackageArchives(jvmExtractionOptions(fixture, signal))
    );
    const finalization = operation.finalize();
    let nextStarted = false;
    const nextJob = coordinator.scheduleArchive(nextOperation, "next", async () => {
      nextStarted = true;
    });
    const nextFinalization = nextOperation.finalize();
    await vi.waitFor(() => expect(childProcesses.daemonChild?.stdin.write).toHaveBeenCalledTimes(1));

    childProcesses.daemonChild?.stdout.emit("data", "RD_REQUEST_DONE 0");
    const cancellation = coordinator.cancelPackage("package-a", "abort");
    childProcesses.daemonChild?.stdout.emit("data", "\n");
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    const releaseBeforeClose = lease.release.mock.calls.length;
    const nextBeforeClose = nextStarted;

    childProcesses.daemonChild?.emit("close", 1);
    await Promise.all([job.catch(() => undefined), cancellation, finalization, nextJob, nextFinalization]);
    expect(releaseBeforeClose).toBe(0);
    expect(nextBeforeClose).toBe(false);
    expect(lease.release).toHaveBeenCalledTimes(1);
  });

  it("keeps daemon timeout permits and leases until close even when DONE arrives after termination", async () => {
    vi.useFakeTimers();
    const fixture = createJvmFixture("rd-jvm-timeout-done-");
    const coordinator = new ExtractionCoordinator(1);
    const lease = { release: vi.fn() };
    const operation = await coordinator.beginOperation({
      context: { operationId: "timeout-operation", packageId: "package-a", generation: 1, runOwnerId: "run" },
      targetPath: fixture.targetDir,
      members: [{ path: path.join(fixture.packageDir, "release.7z"), size: 6 }],
      acquireLease: async () => lease
    });
    const nextOperation = await coordinator.beginOperation({
      context: { operationId: "next-timeout-operation", packageId: "package-b", generation: 1, runOwnerId: "run" }
    });
    const job = coordinator.scheduleArchive(operation, "release.7z", (signal) =>
      extractPackageArchives(jvmExtractionOptions(fixture, signal))
    );
    const finalization = operation.finalize();
    let nextStarted = false;
    const nextJob = coordinator.scheduleArchive(nextOperation, "next", async () => {
      nextStarted = true;
    });
    const nextFinalization = nextOperation.finalize();
    await vi.waitFor(() => expect(childProcesses.daemonChild?.stdin.write).toHaveBeenCalledTimes(1));

    childProcesses.daemonChild?.stdout.emit("data", "RD_REQUEST_DONE 0");
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000);
    expect(childProcesses.spawn.mock.calls.some(([command]) => command === "taskkill")).toBe(true);
    childProcesses.daemonChild?.stdout.emit("data", "\n");
    await vi.waitFor(() => expect(lease.release).toHaveBeenCalledTimes(1), { timeout: 500 }).catch(() => undefined);
    const releaseBeforeClose = lease.release.mock.calls.length;
    const nextBeforeClose = nextStarted;

    childProcesses.daemonChild?.emit("close", 1);
    await Promise.all([job, finalization, nextJob, nextFinalization]);
    expect(releaseBeforeClose).toBe(0);
    expect(nextBeforeClose).toBe(false);
    expect(lease.release).toHaveBeenCalledTimes(1);
  });
});
