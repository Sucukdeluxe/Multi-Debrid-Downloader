import {
  inspectCollectorCapacity,
  inspectCollectorPersistenceSize,
  validateCollectorPersistenceState,
  type CollectorPersistenceState
} from "../../../shared/collector";
import {
  mergeCollectorPackages,
  reconcileCollectorCollapsedPackageIds
} from "./collector-model";

export type CollectorLateHydrationResult = {
  ok: true;
  state: CollectorPersistenceState;
} | {
  ok: false;
  message: string;
  packageCount: number;
  linkCount: number;
  attemptedState: CollectorPersistenceState;
  currentState: CollectorPersistenceState;
  rollbackState: CollectorPersistenceState;
};

export interface CollectorBeforeUnloadPersistenceRequest {
  hydrated: boolean;
  currentState: CollectorPersistenceState;
  getPersistedStateSync: () => unknown;
  saveStateSync: (state: CollectorPersistenceState) => boolean;
  maximumBytes?: number;
}

export interface CollectorBeforeUnloadEvent {
  preventDefault: () => void;
  returnValue: string;
}

function mergeCollapsedPackageIds(
  persistedState: CollectorPersistenceState,
  currentState: CollectorPersistenceState,
  packages: CollectorPersistenceState["packages"]
): string[] {
  const persistedCollapsed = reconcileCollectorCollapsedPackageIds(
    new Set(persistedState.collapsedPackageIds),
    persistedState.packages,
    packages,
    [],
    false
  );
  const currentCollapsed = reconcileCollectorCollapsedPackageIds(
    new Set(currentState.collapsedPackageIds),
    currentState.packages,
    packages,
    [],
    false
  );
  return [...new Set([...persistedCollapsed, ...currentCollapsed])];
}

export function resolveCollectorLateHydration(
  persistedState: CollectorPersistenceState,
  currentState: CollectorPersistenceState,
  maximumBytes?: number
): CollectorLateHydrationResult {
  let persisted = persistedState;
  let current = currentState;
  let attemptedState: CollectorPersistenceState = {
    packages: [],
    collapsedPackageIds: []
  };
  try {
    persisted = validateCollectorPersistenceState(persistedState);
    current = validateCollectorPersistenceState(currentState);
    const packages = mergeCollectorPackages(persisted.packages, current.packages).packages;
    attemptedState = {
      packages,
      collapsedPackageIds: mergeCollapsedPackageIds(persisted, current, packages)
    };
    const capacity = inspectCollectorCapacity(packages);
    if (!capacity.ok) {
      return {
        ...capacity,
        attemptedState,
        currentState: current,
        rollbackState: persisted
      };
    }
    const persistenceSize = inspectCollectorPersistenceSize(attemptedState, maximumBytes);
    if (!persistenceSize.ok) {
      return {
        ok: false,
        message: persistenceSize.message,
        packageCount: capacity.packageCount,
        linkCount: capacity.linkCount,
        attemptedState,
        currentState: current,
        rollbackState: persisted
      };
    }
    return {
      ok: true,
      state: validateCollectorPersistenceState(attemptedState)
    };
  } catch (error) {
    const capacity = inspectCollectorCapacity(attemptedState.packages);
    return {
      ok: false,
      message: error instanceof Error
        ? `Linksammler konnte nicht wiederhergestellt werden: ${error.message}`
        : "Linksammler konnte nicht wiederhergestellt werden.",
      packageCount: capacity.packageCount,
      linkCount: capacity.linkCount,
      attemptedState,
      currentState: current,
      rollbackState: persisted
    };
  }
}

export function persistCollectorStateBeforeUnload(
  request: CollectorBeforeUnloadPersistenceRequest
): boolean {
  try {
    const current = validateCollectorPersistenceState(request.currentState);
    if (request.hydrated) {
      if (!inspectCollectorPersistenceSize(current, request.maximumBytes).ok) return false;
      return request.saveStateSync(current) === true;
    }
    const hydration = resolveCollectorLateHydration(
      validateCollectorPersistenceState(request.getPersistedStateSync()),
      current,
      request.maximumBytes
    );
    if (!hydration.ok) return false;
    return request.saveStateSync(hydration.state) === true;
  } catch {
    return false;
  }
}

export function guardCollectorBeforeUnload(
  event: CollectorBeforeUnloadEvent,
  request: CollectorBeforeUnloadPersistenceRequest
): boolean {
  if (persistCollectorStateBeforeUnload(request)) return true;
  event.preventDefault();
  event.returnValue = "";
  return false;
}
