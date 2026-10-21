export function choosePackageCandidate<T extends { packageId: string }>(candidates: readonly T[], activeCountByPackage: ReadonlyMap<string, number>): T | null {
  let chosen: T | null = null;
  let chosenActive = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const active = activeCountByPackage.get(candidate.packageId) || 0;
    if (active < chosenActive) {
      chosen = candidate;
      chosenActive = active;
      if (active === 0) break;
    }
  }
  return chosen;
}
