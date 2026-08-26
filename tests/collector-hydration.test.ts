import { describe, expect, it, vi } from "vitest";
import type { CollectorLink, CollectorPackage, CollectorPersistenceState } from "../src/shared/collector";
import * as collectorHydration from "../src/renderer/views/collector/collector-hydration";

function link(index: number): CollectorLink {
  return {
    id: `link-${index}`,
    url: `https://example.test/${index}`,
    fileName: `file-${index}.bin`,
    fileSizeBytes: null,
    hoster: "example",
    availability: "unknown",
    status: "unknown",
    addedAt: index
  };
}

function packageEntry(index: number, links: CollectorLink[] = [link(index)]): CollectorPackage {
  return {
    id: `package-${index}`,
    name: `Package ${index}`,
    nameSource: "explicit",
    links,
    addedAt: index
  };
}

type ResolveCollectorLateHydration = (
  persistedState: CollectorPersistenceState,
  currentState: CollectorPersistenceState,
  maximumBytes?: number
) => {
  ok: boolean;
  state?: CollectorPersistenceState;
  message?: string;
  packageCount?: number;
  linkCount?: number;
  attemptedState?: CollectorPersistenceState;
  currentState?: CollectorPersistenceState;
  rollbackState?: CollectorPersistenceState;
};

type PersistCollectorStateBeforeUnload = (request: {
  hydrated: boolean;
  currentState: CollectorPersistenceState;
  getPersistedStateSync: () => unknown;
  saveStateSync: (state: CollectorPersistenceState) => boolean;
  maximumBytes?: number;
}) => boolean;

type GuardCollectorBeforeUnload = (
  event: { preventDefault: () => void; returnValue: string },
  request: Parameters<PersistCollectorStateBeforeUnload>[0]
) => boolean;

function resolver(): ResolveCollectorLateHydration | undefined {
  return (collectorHydration as unknown as {
    resolveCollectorLateHydration?: ResolveCollectorLateHydration;
  }).resolveCollectorLateHydration;
}

function beforeUnloadPersistence(): PersistCollectorStateBeforeUnload | undefined {
  return (collectorHydration as unknown as {
    persistCollectorStateBeforeUnload?: PersistCollectorStateBeforeUnload;
  }).persistCollectorStateBeforeUnload;
}

function beforeUnloadGuard(): GuardCollectorBeforeUnload | undefined {
  return (collectorHydration as unknown as {
    guardCollectorBeforeUnload?: GuardCollectorBeforeUnload;
  }).guardCollectorBeforeUnload;
}

describe("collector late hydration", () => {
  it.each([
    ["synchronous loading fails", {
      hydrated: false,
      currentState: { packages: [packageEntry(1)], collapsedPackageIds: [] },
      getPersistedStateSync: () => { throw new Error("collector unavailable"); },
      saveStateSync: (): boolean => true
    }],
    ["synchronous saving fails", {
      hydrated: true,
      currentState: { packages: [packageEntry(1)], collapsedPackageIds: [] },
      getPersistedStateSync: vi.fn(),
      saveStateSync: (): boolean => false
    }],
    ["the merged state exceeds the persistence limit", {
      hydrated: false,
      currentState: { packages: [packageEntry(2)], collapsedPackageIds: [] },
      getPersistedStateSync: () => ({ packages: [packageEntry(1)], collapsedPackageIds: [] }),
      saveStateSync: (): boolean => true,
      maximumBytes: 128
    }]
  ])("blocks unload when %s", (_name, request) => {
    const event = { preventDefault: vi.fn(), returnValue: "unchanged" };

    expect(beforeUnloadGuard()).toBeTypeOf("function");
    const persisted = beforeUnloadGuard()?.(event, request);

    expect(persisted).toBe(false);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.returnValue).toBe("");
  });

  it("allows unload without changing the event after confirmed persistence", () => {
    const event = { preventDefault: vi.fn(), returnValue: "unchanged" };

    const persisted = beforeUnloadGuard()?.(event, {
      hydrated: true,
      currentState: { packages: [packageEntry(1)], collapsedPackageIds: [] },
      getPersistedStateSync: vi.fn(),
      saveStateSync: () => true
    });

    expect(persisted).toBe(true);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.returnValue).toBe("unchanged");
  });

  it("synchronously merges a later main-store snapshot while async hydration is still pending", async () => {
    const persistedState = {
      packages: [packageEntry(1)],
      collapsedPackageIds: ["package-1"]
    };
    const currentState = {
      packages: [packageEntry(2)],
      collapsedPackageIds: ["package-2"]
    };
    let resolveAsyncHydration = (_state: CollectorPersistenceState): void => {};
    let asyncHydrationSettled = false;
    const asyncHydration = new Promise<CollectorPersistenceState>((resolve) => {
      resolveAsyncHydration = resolve;
    }).then((state) => {
      asyncHydrationSettled = true;
      return state;
    });
    const getPersistedStateSync = vi.fn(() => persistedState);
    const saveStateSync = vi.fn(() => true);

    expect(beforeUnloadPersistence()).toBeTypeOf("function");
    const saved = beforeUnloadPersistence()?.({
      hydrated: false,
      currentState,
      getPersistedStateSync,
      saveStateSync
    });

    expect(asyncHydrationSettled).toBe(false);
    expect(saved).toBe(true);
    expect(getPersistedStateSync).toHaveBeenCalledTimes(1);
    expect(saveStateSync).toHaveBeenCalledWith({
      packages: [packageEntry(1), packageEntry(2)],
      collapsedPackageIds: ["package-1", "package-2"]
    });
    expect(saveStateSync).not.toHaveBeenCalledWith(currentState);
    resolveAsyncHydration(persistedState);
    await asyncHydration;
  });

  it("saves the validated current renderer state without reloading after hydration", () => {
    const currentState = {
      packages: [packageEntry(1)],
      collapsedPackageIds: ["package-1", "missing-package"]
    };
    const getPersistedStateSync = vi.fn();
    const saveStateSync = vi.fn(() => true);

    const saved = beforeUnloadPersistence()?.({
      hydrated: true,
      currentState,
      getPersistedStateSync,
      saveStateSync
    });

    expect(saved).toBe(true);
    expect(getPersistedStateSync).not.toHaveBeenCalled();
    expect(saveStateSync).toHaveBeenCalledWith({
      packages: [packageEntry(1)],
      collapsedPackageIds: ["package-1"]
    });
  });

  it("leaves the persisted state untouched when the early merge exceeds a limit", () => {
    const persistedState = {
      packages: [packageEntry(1)],
      collapsedPackageIds: []
    };
    const saveStateSync = vi.fn(() => true);

    const saved = beforeUnloadPersistence()?.({
      hydrated: false,
      currentState: {
        packages: [packageEntry(2)],
        collapsedPackageIds: []
      },
      getPersistedStateSync: () => persistedState,
      saveStateSync,
      maximumBytes: 128
    });

    expect(saved).toBe(false);
    expect(saveStateSync).not.toHaveBeenCalled();
  });

  it("leaves the persisted state untouched when synchronous loading fails", () => {
    const saveStateSync = vi.fn(() => true);

    expect(() => beforeUnloadPersistence()?.({
      hydrated: false,
      currentState: {
        packages: [packageEntry(2)],
        collapsedPackageIds: []
      },
      getPersistedStateSync: () => { throw new Error("collector unavailable"); },
      saveStateSync
    })).not.toThrow();
    expect(saveStateSync).not.toHaveBeenCalled();
  });

  it("does not report success when synchronous persistence rejects the write", () => {
    const saveStateSync = vi.fn(() => false);

    const saved = beforeUnloadPersistence()?.({
      hydrated: true,
      currentState: {
        packages: [packageEntry(1)],
        collapsedPackageIds: []
      },
      getPersistedStateSync: vi.fn(),
      saveStateSync
    });

    expect(saved).toBe(false);
    expect(saveStateSync).toHaveBeenCalledTimes(1);
  });

  it("merges persisted and pre-load imports with collapse state from both sides", () => {
    const persistedState = {
      packages: [packageEntry(1)],
      collapsedPackageIds: ["package-1"]
    };
    const duplicateCurrentPackage = {
      ...packageEntry(1),
      id: "current-duplicate",
      links: [{ ...link(1), id: "current-duplicate-link" }]
    };
    const currentState = {
      packages: [duplicateCurrentPackage, packageEntry(2)],
      collapsedPackageIds: ["current-duplicate", "package-2"]
    };

    expect(resolver()).toBeTypeOf("function");
    expect(resolver()?.(persistedState, currentState)).toEqual({
      ok: true,
      state: {
        packages: [packageEntry(1), packageEntry(2)],
        collapsedPackageIds: ["package-1", "package-2"]
      }
    });
    expect(persistedState.packages).toEqual([packageEntry(1)]);
    expect(currentState.packages).toEqual([duplicateCurrentPackage, packageEntry(2)]);
  });

  it("returns the cumulative attempted state and persisted rollback when package capacity is exceeded", () => {
    const persistedState = {
      packages: Array.from({ length: 1_999 }, (_, index) => packageEntry(index)),
      collapsedPackageIds: ["package-0"]
    };
    const currentState = {
      packages: [packageEntry(1_999), packageEntry(2_000)],
      collapsedPackageIds: ["package-2000"]
    };

    expect(resolver()).toBeTypeOf("function");
    expect(() => resolver()?.(persistedState, currentState)).not.toThrow();
    const result = resolver()?.(persistedState, currentState);

    expect(result).toMatchObject({
      ok: false,
      message: "Der Linksammler kann höchstens 2.000 Pakete enthalten.",
      packageCount: 2_001,
      linkCount: 2_001,
      currentState,
      rollbackState: persistedState
    });
    expect(result?.attemptedState?.packages).toHaveLength(2_001);
    expect(result?.attemptedState?.collapsedPackageIds).toEqual(["package-0", "package-2000"]);
  });

  it("returns an explicit failure when only cumulative link capacity is exceeded", () => {
    const persistedState = {
      packages: [packageEntry(1, Array.from({ length: 10_000 }, (_, index) => link(index)))],
      collapsedPackageIds: ["package-1"]
    };
    const currentState = {
      packages: [packageEntry(2, Array.from({ length: 10_001 }, (_, index) => link(index + 10_000)))],
      collapsedPackageIds: ["package-2"]
    };

    expect(resolver()).toBeTypeOf("function");
    const result = resolver()?.(persistedState, currentState);

    expect(result).toMatchObject({
      ok: false,
      message: "Der Linksammler kann höchstens 20.000 Links enthalten.",
      packageCount: 2,
      linkCount: 20_001,
      currentState,
      rollbackState: persistedState
    });
    expect(result?.attemptedState?.packages.flatMap((pkg) => pkg.links)).toHaveLength(20_001);
  });

  it("returns the persisted rollback before a cumulatively oversized state reaches the UI", () => {
    const persistedState = { packages: [packageEntry(1)], collapsedPackageIds: [] };
    const currentState = { packages: [packageEntry(2)], collapsedPackageIds: [] };

    const result = resolver()?.(persistedState, currentState, 128);

    expect(result).toMatchObject({
      ok: false,
      message: "Der Linksammler ist zu groß, um gespeichert zu werden.",
      currentState,
      rollbackState: persistedState
    });
    expect(result?.attemptedState?.packages).toHaveLength(2);
  });
});
