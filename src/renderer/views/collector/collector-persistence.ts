import {
  validateCollectorPersistenceState,
  type CollectorPackage,
  type CollectorPersistenceState
} from "../../../shared/collector";
import {
  mergeCollectorPackages,
  reconcileCollectorCollapsedPackageIds
} from "./collector-model";

export function restoreCollectorPersistenceState(
  persisted: CollectorPersistenceState,
  currentPackages: CollectorPackage[],
  currentCollapsedPackageIds: Set<string>
): CollectorPersistenceState {
  const merged = mergeCollectorPackages(persisted.packages, currentPackages).packages;
  const persistedCollapsed = reconcileCollectorCollapsedPackageIds(
    new Set(persisted.collapsedPackageIds),
    persisted.packages,
    merged,
    [],
    false
  );
  const currentCollapsed = reconcileCollectorCollapsedPackageIds(
    currentCollapsedPackageIds,
    currentPackages,
    merged,
    [],
    false
  );
  return validateCollectorPersistenceState({
    packages: merged,
    collapsedPackageIds: [...new Set([...persistedCollapsed, ...currentCollapsed])]
  });
}

export interface CollectorPersistenceCoordinator {
  schedule: (state: CollectorPersistenceState) => void;
  flush: () => Promise<void>;
  dispose: () => void;
}

export function createCollectorPersistenceCoordinator(
  save: (state: CollectorPersistenceState) => Promise<CollectorPersistenceState>,
  delayMs = 300
): CollectorPersistenceCoordinator {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: CollectorPersistenceState | null = null;
  let running: Promise<void> | null = null;
  let disposed = false;

  const drain = (): Promise<void> => {
    if (running) return running;
    const task = (async () => {
      while (pending && !disposed) {
        const state = pending;
        pending = null;
        await save(state);
      }
    })().finally(() => {
      if (running === task) running = null;
    });
    running = task;
    return task;
  };

  return {
    schedule: (state) => {
      if (disposed) return;
      pending = validateCollectorPersistenceState(state);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void drain().catch(() => {});
      }, Math.max(0, delayMs));
    },
    flush: async () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await drain();
    },
    dispose: () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    }
  };
}
