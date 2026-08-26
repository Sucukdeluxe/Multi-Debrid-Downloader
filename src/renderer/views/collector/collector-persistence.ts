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
  setBaseline: (state: CollectorPersistenceState) => void;
  flush: () => Promise<void>;
  dispose: () => void;
}

export interface CollectorPersistenceFailure {
  error: unknown;
  attemptedState: CollectorPersistenceState;
  rollbackState: CollectorPersistenceState | null;
}

export function createCollectorPersistenceCoordinator(
  save: (state: CollectorPersistenceState) => Promise<CollectorPersistenceState>,
  delayMs = 300,
  onFailure?: (failure: CollectorPersistenceFailure) => void
): CollectorPersistenceCoordinator {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: CollectorPersistenceState | null = null;
  let running: Promise<void> | null = null;
  let rollbackState: CollectorPersistenceState | null = null;
  let disposed = false;

  const reportFailure = (error: unknown, attemptedState: CollectorPersistenceState): void => {
    try {
      onFailure?.({ error, attemptedState, rollbackState });
    } catch {
    }
  };

  const drain = (): Promise<void> => {
    if (running) return running;
    const task = (async () => {
      while (pending && !disposed) {
        const attemptedState = pending;
        pending = null;
        let state: CollectorPersistenceState;
        try {
          state = validateCollectorPersistenceState(attemptedState);
        } catch (error) {
          reportFailure(error, attemptedState);
          continue;
        }
        try {
          await save(state);
          rollbackState = state;
        } catch (error) {
          reportFailure(error, attemptedState);
        }
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
      pending = state;
      try {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          void drain();
        }, Math.max(0, delayMs));
      } catch {
        timer = null;
        void drain();
      }
    },
    setBaseline: (state) => {
      rollbackState = state;
    },
    flush: async () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      while (!disposed) {
        await drain();
        if (!pending) break;
      }
    },
    dispose: () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    }
  };
}
