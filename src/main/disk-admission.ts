export type PackageDiskDemand = {
  started: boolean;
  remainingBytes: number;
};

export function packageDiskBudget(freeBytes: number, reserveBytes: number, demands: Iterable<PackageDiskDemand>): number {
  let committed = 0;
  for (const demand of demands) {
    if (demand.started) committed += Math.max(0, demand.remainingBytes);
  }
  return freeBytes - Math.max(0, reserveBytes) - committed;
}

export function canOpenPackage(demand: PackageDiskDemand, budgetBytes: number): boolean {
  return demand.started || demand.remainingBytes <= budgetBytes;
}

export function chooseLeastRemainingCandidate<T extends { packageId: string }>(candidates: readonly T[], demands: ReadonlyMap<string, PackageDiskDemand>): T | null {
  let chosen: T | null = null;
  let chosenRemaining = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const remaining = demands.get(candidate.packageId)?.remainingBytes ?? Number.POSITIVE_INFINITY;
    if (remaining < chosenRemaining) {
      chosen = candidate;
      chosenRemaining = remaining;
    }
  }
  return chosen ?? candidates[0] ?? null;
}
