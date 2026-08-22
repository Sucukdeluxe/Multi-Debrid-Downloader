import { describe, expect, it, vi } from "vitest";
import {
  ExtractionCancelledError,
  ExtractionCoordinator,
  type ExtractionOperationContext
} from "../src/main/extraction-coordinator";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function context(operationId: string, packageId: string, runOwnerId: string): ExtractionOperationContext {
  return {
    operationId,
    packageId,
    generation: 1,
    runOwnerId
  };
}

function lease(events: string[] = []) {
  let released = false;
  return {
    get released() {
      return released;
    },
    release: vi.fn(() => {
      if (released) {
        return;
      }
      released = true;
      events.push("lease-release");
    })
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("ExtractionCoordinator", () => {
  it("enforces one global archive-child peak across full, hybrid and nested operations", async () => {
    const coordinator = new ExtractionCoordinator(2);
    const operations = await Promise.all([
      coordinator.beginOperation({ context: context("full", "package-a", "run-a") }),
      coordinator.beginOperation({ context: context("hybrid", "package-b", "run-a") }),
      coordinator.beginOperation({ context: context("nested", "package-c", "run-b") })
    ]);
    let active = 0;
    let peak = 0;
    const gates = Array.from({ length: 6 }, () => deferred<void>());
    const jobs = gates.map((gate, index) => coordinator.scheduleArchive(
      operations[index % operations.length],
      `archive-${index}`,
      async () => {
        active += 1;
        peak = Math.max(peak, active);
        await gate.promise;
        active -= 1;
      }
    ));

    await flush();
    expect(active).toBe(2);
    expect(peak).toBe(2);

    for (const gate of gates) {
      gate.resolve();
      await flush();
    }
    await Promise.all(jobs);
    await Promise.all(operations.map((operation) => operation.finalize()));
    expect(peak).toBe(2);
  });

  it("rotates fairly between operation queues", async () => {
    const coordinator = new ExtractionCoordinator(1);
    const first = await coordinator.beginOperation({ context: context("first", "package-a", "run") });
    const second = await coordinator.beginOperation({ context: context("second", "package-b", "run") });
    const gate = deferred<void>();
    const order: string[] = [];

    const jobs = [
      coordinator.scheduleArchive(first, "a1", async () => {
        order.push("a1");
        await gate.promise;
      }),
      coordinator.scheduleArchive(first, "a2", async () => { order.push("a2"); }),
      coordinator.scheduleArchive(first, "a3", async () => { order.push("a3"); }),
      coordinator.scheduleArchive(second, "b1", async () => { order.push("b1"); })
    ];

    await flush();
    expect(order).toEqual(["a1"]);
    gate.resolve();
    await Promise.all(jobs);
    expect(order).toEqual(["a1", "b1", "a2", "a3"]);
    await Promise.all([first.finalize(), second.finalize()]);
  });

  it("shrinks without revoking active permits and grows by filling the new capacity", async () => {
    const coordinator = new ExtractionCoordinator(3);
    const operation = await coordinator.beginOperation({ context: context("resize", "package-a", "run") });
    const gates = Array.from({ length: 5 }, () => deferred<void>());
    let active = 0;
    const starts: number[] = [];
    const jobs = gates.map((gate, index) => coordinator.scheduleArchive(operation, `archive-${index}`, async () => {
      active += 1;
      starts.push(index);
      await gate.promise;
      active -= 1;
    }));

    await flush();
    expect(active).toBe(3);
    coordinator.resize(1);
    gates[0].resolve();
    gates[1].resolve();
    await flush();
    expect(active).toBe(1);
    expect(starts).toEqual([0, 1, 2]);

    coordinator.resize(3);
    await flush();
    expect(active).toBe(3);
    expect(starts).toEqual([0, 1, 2, 3, 4]);

    for (const gate of gates) {
      gate.resolve();
    }
    await Promise.all(jobs);
    await operation.finalize();
  });

  it("cancels only jobs owned by the selected run", async () => {
    const coordinator = new ExtractionCoordinator(2);
    const cancelled = await coordinator.beginOperation({ context: context("cancelled", "package-a", "run-a") });
    const retained = await coordinator.beginOperation({ context: context("retained", "package-b", "run-b") });
    const cancelledClose = deferred<void>();
    const retainedClose = deferred<void>();
    let cancelledSignal: AbortSignal | null = null;
    let retainedSignal: AbortSignal | null = null;
    const cancelledActive = coordinator.scheduleArchive(cancelled, "a1", async (signal) => {
      cancelledSignal = signal;
      await cancelledClose.promise;
    });
    const retainedActive = coordinator.scheduleArchive(retained, "b1", async (signal) => {
      retainedSignal = signal;
      await retainedClose.promise;
    });
    const cancelledQueued = coordinator.scheduleArchive(cancelled, "a2", async () => undefined);

    await flush();
    const cancellation = coordinator.cancelRun("run-a", "stop");
    await expect(cancelledQueued).rejects.toBeInstanceOf(ExtractionCancelledError);
    expect((cancelledSignal as AbortSignal | null)?.aborted).toBe(true);
    expect((retainedSignal as AbortSignal | null)?.aborted).toBe(false);

    cancelledClose.resolve();
    await expect(cancelledActive).resolves.toBeUndefined();
    await cancellation;
    retainedClose.resolve();
    await retainedActive;
    await Promise.all([cancelled.finalize(), retained.finalize()]);
  });

  it("cancels only jobs owned by the selected package and leaves no ghost waiter", async () => {
    const coordinator = new ExtractionCoordinator(1);
    const selected = await coordinator.beginOperation({ context: context("selected", "package-a", "run") });
    const retained = await coordinator.beginOperation({ context: context("retained", "package-b", "run") });
    const activeClose = deferred<void>();
    const active = coordinator.scheduleArchive(selected, "a1", async () => activeClose.promise);
    const ghost = coordinator.scheduleArchive(selected, "a2", async () => undefined);
    const foreign = coordinator.scheduleArchive(retained, "b1", async () => "foreign");

    await flush();
    const cancellation = coordinator.cancelPackage("package-a", "cancel");
    await expect(ghost).rejects.toBeInstanceOf(ExtractionCancelledError);
    activeClose.resolve();
    await active;
    await cancellation;
    await expect(foreign).resolves.toBe("foreign");
    await Promise.all([selected.finalize(), retained.finalize()]);
  });

  it("releases an archive permit only once when completion races cancellation", async () => {
    const coordinator = new ExtractionCoordinator(1);
    const first = await coordinator.beginOperation({ context: context("first", "package-a", "run") });
    const second = await coordinator.beginOperation({ context: context("second", "package-b", "run") });
    const close = deferred<void>();
    let secondStarts = 0;
    const firstJob = coordinator.scheduleArchive(first, "a1", async () => close.promise);
    const secondJob = coordinator.scheduleArchive(second, "b1", async () => {
      secondStarts += 1;
    });

    await flush();
    const cancelled = coordinator.cancelPackage("package-a", "cancel");
    close.resolve();
    await Promise.all([firstJob, cancelled, secondJob]);
    expect(secondStarts).toBe(1);
    await Promise.all([first.finalize(), second.finalize()]);
  });

  it("renews its drain barrier when one operation schedules another archive batch", async () => {
    const coordinator = new ExtractionCoordinator(1);
    const operation = await coordinator.beginOperation({ context: context("batches", "package-a", "run") });
    await coordinator.scheduleArchive(operation, "first", async () => undefined);
    await flush();
    const secondClose = deferred<void>();
    const second = coordinator.scheduleArchive(operation, "second", async () => secondClose.promise);
    let finalized = false;
    const finalization = operation.finalize().then(() => {
      finalized = true;
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(finalized).toBe(false);
    secondClose.resolve();
    await Promise.all([second, finalization]);
    expect(finalized).toBe(true);
  });

  it.each(["success", "error", "timeout", "abort"] as const)("holds and releases the operation lease once on %s", async (terminal) => {
    const coordinator = new ExtractionCoordinator(1);
    const heldLease = lease();
    const operation = await coordinator.beginOperation({
      context: context(`lease-${terminal}`, "package-a", "run"),
      targetPath: "C:\\target",
      members: [{ path: "C:\\archives\\one.rar", size: 100 }],
      acquireLease: async () => heldLease
    });
    const close = deferred<void>();
    const job = coordinator.scheduleArchive(operation, "archive", async (signal) => {
      if (terminal === "abort") {
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      }
      await close.promise;
      if (terminal === "error") {
        throw new Error("extract failed");
      }
      if (terminal === "timeout") {
        throw new Error("extract timeout");
      }
    });

    await flush();
    const finalized = operation.finalize();
    if (terminal === "abort") {
      void coordinator.cancelPackage("package-a", "abort");
    }
    expect(heldLease.release).not.toHaveBeenCalled();
    close.resolve();
    await job.catch(() => undefined);
    await finalized;
    expect(heldLease.release).toHaveBeenCalledTimes(1);
    await operation.finalize();
    expect(heldLease.release).toHaveBeenCalledTimes(1);
  });

  it("deduplicates multipart members before calculating the disk reservation", async () => {
    const coordinator = new ExtractionCoordinator(1);
    const heldLease = lease();
    const requests: Array<{ requiredBytes: number | null; memberPaths: readonly string[] }> = [];
    const operation = await coordinator.beginOperation({
      context: context("multipart", "package-a", "run"),
      targetPath: "C:\\target",
      members: [
        { path: "C:\\archives\\show.part1.rar", size: 100 },
        { path: "c:\\ARCHIVES\\show.part1.rar", size: 100 },
        { path: "C:\\archives\\show.part2.rar", size: 200 }
      ],
      acquireLease: async (request) => {
        requests.push({ requiredBytes: request.requiredBytes, memberPaths: request.memberPaths });
        return heldLease;
      }
    });

    expect(requests).toEqual([{
      requiredBytes: 300,
      memberPaths: ["C:\\archives\\show.part1.rar", "C:\\archives\\show.part2.rar"]
    }]);
    await operation.finalize();
  });

  it("shuts down in queue-close, waiter-cancel, active-abort, child-drain, finalization and lease-release order", async () => {
    const coordinator = new ExtractionCoordinator(1);
    const events: string[] = [];
    const heldLease = lease(events);
    const operation = await coordinator.beginOperation({
      context: context("shutdown", "package-a", "run"),
      targetPath: "C:\\target",
      members: [{ path: "C:\\archives\\one.rar", size: 100 }],
      acquireLease: async () => heldLease
    });
    const childClose = deferred<void>();
    const active = coordinator.scheduleArchive(operation, "active", async (signal) => {
      signal.addEventListener("abort", () => events.push("active-abort"), { once: true });
      await childClose.promise;
      events.push("child-close");
    });
    const waiter = coordinator.scheduleArchive(operation, "waiter", async () => undefined).catch((error) => {
      events.push("waiter-cancel");
      throw error;
    });
    const finalized = operation.finalize(async () => {
      events.push("scope-finalize");
    });

    await flush();
    const shutdown = coordinator.shutdownAndDrain(Date.now() + 1000);
    await expect(waiter).rejects.toBeInstanceOf(ExtractionCancelledError);
    expect(events).toEqual(["waiter-cancel", "active-abort"]);
    await expect(coordinator.beginOperation({ context: context("late", "package-b", "run") })).rejects.toBeInstanceOf(ExtractionCancelledError);
    expect(heldLease.release).not.toHaveBeenCalled();

    childClose.resolve();
    await Promise.all([active, finalized, shutdown]);
    expect(events).toEqual(["waiter-cancel", "active-abort", "child-close", "scope-finalize", "lease-release"]);
  });
});
