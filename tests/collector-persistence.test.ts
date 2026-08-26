import { describe, expect, it, vi } from "vitest";
import { validateCollectorPersistenceState } from "../src/shared/collector";
import {
  createCollectorPersistenceCoordinator,
  restoreCollectorPersistenceState,
  type CollectorPersistenceFailure
} from "../src/renderer/views/collector/collector-persistence";

const packageEntry = {
  id: "package-one",
  name: "Staffel Eins",
  nameSource: "explicit" as const,
  links: [{
    id: "link-one",
    url: "https://1fichier.com/?example",
    fileName: "episode.part01.rar",
    fileSizeBytes: 471_859_200,
    hoster: "1fichier",
    availability: "online" as const,
    status: "ready" as const,
    addedAt: 1_000
  }],
  addedAt: 1_000
};

describe("collector persistence payload", () => {
  it("accepts a complete state and prunes unknown collapsed package ids", () => {
    const input = { packages: [packageEntry], collapsedPackageIds: ["package-one", "missing", "package-one"] };

    expect(validateCollectorPersistenceState(input)).toEqual({
      packages: [packageEntry],
      collapsedPackageIds: ["package-one"]
    });
    expect(validateCollectorPersistenceState(input)).not.toBe(input);
  });

  it("accepts an empty collector without loosening the payload shape", () => {
    expect(validateCollectorPersistenceState({ packages: [], collapsedPackageIds: [] })).toEqual({ packages: [], collapsedPackageIds: [] });
    expect(() => validateCollectorPersistenceState({ packages: [], collapsedPackageIds: [], selectedLinkIds: [] })).toThrow("Linksammler-Speicherzustand ist ungültig");
  });

  it("rejects invalid packages and excessive queue sizes", () => {
    expect(() => validateCollectorPersistenceState({ packages: [{ ...packageEntry, name: "" }], collapsedPackageIds: [] })).toThrow("Linksammler-Speicherzustand ist ungültig");
    expect(() => validateCollectorPersistenceState({ packages: Array.from({ length: 2_001 }, () => packageEntry), collapsedPackageIds: [] })).toThrow("Linksammler-Speicherzustand ist ungültig");
  });
});

describe("collector persistence renderer flow", () => {
  it("does not inspect or clone scheduled state", () => {
    const coordinator = createCollectorPersistenceCoordinator(async (state) => state, 60_000);
    const inaccessibleState = new Proxy({ packages: [], collapsedPackageIds: [] }, {
      ownKeys: () => {
        throw new Error("scheduled state was inspected");
      }
    });

    expect(() => coordinator.schedule(inaccessibleState)).not.toThrow();

    coordinator.dispose();
  });

  it("does not throw when timer scheduling fails", async () => {
    const saved: string[] = [];
    const coordinator = createCollectorPersistenceCoordinator(async (state) => {
      saved.push(state.packages[0]?.id || "empty");
      return state;
    });
    const timerSpy = vi.spyOn(globalThis, "setTimeout").mockImplementationOnce(() => {
      throw new Error("timer failed");
    });

    try {
      expect(() => coordinator.schedule({ packages: [packageEntry], collapsedPackageIds: [] })).not.toThrow();
    } finally {
      timerSpy.mockRestore();
    }

    await coordinator.flush();

    expect(saved).toEqual(["package-one"]);
  });

  it("debounces twenty thousand progressive schedules before validating only the newest state", async () => {
    const saved: string[] = [];
    const coordinator = createCollectorPersistenceCoordinator(async (state) => {
      saved.push(state.packages[0]?.id || "empty");
      return state;
    }, 60_000);
    const cloneSpy = vi.spyOn(globalThis, "structuredClone");

    try {
      for (let index = 0; index < 20_000; index += 1) {
        coordinator.schedule({
          packages: [{ ...packageEntry, id: `progress-${index}` }],
          collapsedPackageIds: []
        });
      }

      expect(cloneSpy).not.toHaveBeenCalled();

      await coordinator.flush();

      expect(saved).toEqual(["progress-19999"]);
      expect(cloneSpy).toHaveBeenCalledTimes(1);
    } finally {
      coordinator.dispose();
      cloneSpy.mockRestore();
    }
  });

  it("reports validation failures with the attempted state and configured rollback baseline", async () => {
    const baseline = { packages: [packageEntry], collapsedPackageIds: ["package-one"] };
    const attemptedState = {
      packages: [{ ...packageEntry, name: "" }],
      collapsedPackageIds: []
    };
    const failures: CollectorPersistenceFailure[] = [];
    let saveCalls = 0;
    const coordinator = createCollectorPersistenceCoordinator(async (state) => {
      saveCalls += 1;
      return state;
    }, 60_000, (failure) => {
      failures.push(failure);
    });
    coordinator.setBaseline(baseline);

    expect(() => coordinator.schedule(attemptedState)).not.toThrow();
    await expect(coordinator.flush()).resolves.toBeUndefined();

    expect(saveCalls).toBe(0);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.error).toBeInstanceOf(Error);
    expect(failures[0]?.attemptedState).toBe(attemptedState);
    expect(failures[0]?.rollbackState).toBe(baseline);
  });

  it("reports save failures without rejecting flush and rolls back to the last successful save", async () => {
    const failures: CollectorPersistenceFailure[] = [];
    const coordinator = createCollectorPersistenceCoordinator(async (state) => {
      if (state.packages[0]?.id === "save-fails") throw new Error("save failed");
      return state;
    }, 60_000, (failure) => {
      failures.push(failure);
    });
    const successfulState = {
      packages: [{ ...packageEntry, id: "saved" }],
      collapsedPackageIds: []
    };
    const failedState = {
      packages: [{ ...packageEntry, id: "save-fails" }],
      collapsedPackageIds: []
    };

    coordinator.schedule(successfulState);
    await coordinator.flush();
    coordinator.schedule(failedState);
    await expect(coordinator.flush()).resolves.toBeUndefined();

    expect(failures).toHaveLength(1);
    expect(failures[0]?.error).toEqual(new Error("save failed"));
    expect(failures[0]?.attemptedState).toBe(failedState);
    expect(failures[0]?.rollbackState).toEqual(successfulState);
    expect(failures[0]?.rollbackState).not.toBe(successfulState);
  });

  it("merges a late restore with current imports and keeps collapse state from both sides", () => {
    const persisted = { packages: [packageEntry], collapsedPackageIds: ["package-one"] };
    const currentPackage = {
      ...packageEntry,
      id: "package-current",
      name: "Aktueller Import",
      links: [{ ...packageEntry.links[0], id: "link-current", url: "https://example.com/current" }]
    };

    expect(restoreCollectorPersistenceState(persisted, [currentPackage], new Set(["package-current"]))).toEqual({
      packages: [packageEntry, currentPackage],
      collapsedPackageIds: ["package-one", "package-current"]
    });
  });

  it("serializes saves and lets the newest queued state win", async () => {
    const saved: string[] = [];
    let releaseFirst: () => void = () => {};
    const coordinator = createCollectorPersistenceCoordinator(async (state) => {
      saved.push(state.packages[0]?.id || "empty");
      if (saved.length === 1) await new Promise<void>((resolve) => { releaseFirst = resolve; });
      return state;
    }, 0);

    coordinator.schedule({ packages: [{ ...packageEntry, id: "first" }], collapsedPackageIds: [] });
    const firstFlush = coordinator.flush();
    await Promise.resolve();
    coordinator.schedule({ packages: [{ ...packageEntry, id: "latest" }], collapsedPackageIds: [] });
    releaseFirst();
    await firstFlush;
    await coordinator.flush();

    expect(saved).toEqual(["first", "latest"]);
  });
});
