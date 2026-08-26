import type { CollectorPackage } from "../shared/collector";

export type CollectorEnrichmentGenerationSnapshot = Map<string, number>;

function collectorUrlKey(url: string): string {
  return url.trim();
}

export function beginCollectorEnrichment(
  packages: CollectorPackage[],
  current: Map<string, number>
): CollectorEnrichmentGenerationSnapshot {
  const snapshot = new Map<string, number>();
  for (const link of packages.flatMap((pkg) => pkg.links)) {
    const url = collectorUrlKey(link.url);
    const generation = (current.get(url) ?? 0) + 1;
    current.set(url, generation);
    snapshot.set(url, generation);
  }
  return snapshot;
}

export function filterCurrentCollectorEnrichment(
  packages: CollectorPackage[],
  requested: CollectorEnrichmentGenerationSnapshot,
  current: ReadonlyMap<string, number>
): CollectorPackage[] {
  return packages.flatMap((pkg) => {
    const links = pkg.links.filter((link) => {
      const url = collectorUrlKey(link.url);
      return requested.get(url) === current.get(url);
    });
    return links.length > 0 ? [{ ...pkg, links }] : [];
  });
}
