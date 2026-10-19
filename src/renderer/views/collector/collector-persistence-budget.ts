import {
  COLLECTOR_MAX_PERSISTENCE_BYTES,
  type CollectorLink,
  type CollectorPackage,
  type CollectorPersistenceState
} from "../../../shared/collector";
import type { CollectorPersistenceDelta } from "./collector-model";

const encoder = new TextEncoder();
const overflowMessage = "Der Linksammler ist zu groß, um gespeichert zu werden.";

export interface CollectorPersistenceBudget {
  byteCount: number;
  packageByteTotal: number;
  packageCount: number;
  packageByteCounts: ReadonlyMap<string, number>;
  packageBaseByteCounts: ReadonlyMap<string, number>;
  packageLinkByteTotals: ReadonlyMap<string, number>;
  packageLinkCounts: ReadonlyMap<string, number>;
  linkByteCounts: ReadonlyMap<string, number>;
  linkPackageIds: ReadonlyMap<string, string>;
  linkIds: ReadonlyMap<string, string>;
}

export type CollectorPersistenceBudgetResult = {
  ok: true;
  byteCount: number;
  nextBudget: CollectorPersistenceBudget;
} | {
  ok: false;
  byteCount: number;
  message: string;
};

interface PackageCandidate {
  id: string;
  existed: boolean;
  oldByteCount: number;
  baseByteCount: number;
  linkByteTotal: number;
  linkCount: number;
  removed: boolean;
}

interface LinkCandidate {
  byteCount: number;
  id: string;
  packageId: string;
}

type MutableCollectorPersistenceBudget = CollectorPersistenceBudget & {
  packageByteCounts: Map<string, number>;
  packageBaseByteCounts: Map<string, number>;
  packageLinkByteTotals: Map<string, number>;
  packageLinkCounts: Map<string, number>;
  linkByteCounts: Map<string, number>;
  linkPackageIds: Map<string, string>;
  linkIds: Map<string, string>;
};

function utf8ByteCount(value: string): number {
  return encoder.encode(value).byteLength;
}

function normalizedUrl(url: string): string {
  return url.trim();
}

function linkByteCount(link: CollectorLink): number {
  return utf8ByteCount(JSON.stringify(link));
}

function samePersistentLink(left: CollectorLink, right: CollectorLink): boolean {
  return left.id === right.id
    && left.url === right.url
    && left.fileName === right.fileName
    && left.fileSizeBytes === right.fileSizeBytes
    && left.hoster === right.hoster
    && left.availability === right.availability
    && left.status === right.status
    && left.addedAt === right.addedAt;
}

function packageBaseByteCount(pkg: Pick<CollectorPackage, "id" | "name" | "nameSource" | "addedAt">): number {
  return utf8ByteCount(JSON.stringify({
    id: pkg.id,
    name: pkg.name,
    nameSource: pkg.nameSource,
    links: [],
    addedAt: pkg.addedAt
  }));
}

function completePackageByteCount(baseByteCount: number, linkByteTotal: number, linkCount: number): number {
  return baseByteCount + linkByteTotal + Math.max(0, linkCount - 1);
}

function envelopeByteCount(collapsedPackageIds: readonly string[]): number {
  return utf8ByteCount(JSON.stringify({
    version: 1,
    packages: [],
    collapsedPackageIds,
    updatedAt: Number.MAX_SAFE_INTEGER
  }));
}

function totalByteCount(packageByteTotal: number, packageCount: number, collapsedPackageIds: readonly string[]): number {
  return envelopeByteCount(collapsedPackageIds) + packageByteTotal + Math.max(0, packageCount - 1);
}

export function createCollectorPersistenceBudget(
  state: CollectorPersistenceState,
  maximumBytes = COLLECTOR_MAX_PERSISTENCE_BYTES
): CollectorPersistenceBudgetResult {
  const packageByteCounts = new Map<string, number>();
  const packageBaseByteCounts = new Map<string, number>();
  const packageLinkByteTotals = new Map<string, number>();
  const packageLinkCounts = new Map<string, number>();
  const linkByteCounts = new Map<string, number>();
  const linkPackageIds = new Map<string, string>();
  const linkIds = new Map<string, string>();
  let packageByteTotal = 0;
  for (const pkg of state.packages) {
    const baseByteCount = packageBaseByteCount(pkg);
    let linkByteTotal = 0;
    for (const link of pkg.links) {
      const url = normalizedUrl(link.url);
      const byteCount = linkByteCount(link);
      linkByteCounts.set(url, byteCount);
      linkPackageIds.set(url, pkg.id);
      linkIds.set(url, link.id);
      linkByteTotal += byteCount;
    }
    const byteCount = completePackageByteCount(baseByteCount, linkByteTotal, pkg.links.length);
    packageByteCounts.set(pkg.id, byteCount);
    packageBaseByteCounts.set(pkg.id, baseByteCount);
    packageLinkByteTotals.set(pkg.id, linkByteTotal);
    packageLinkCounts.set(pkg.id, pkg.links.length);
    packageByteTotal += byteCount;
  }
  const packageCount = state.packages.length;
  const byteCount = totalByteCount(packageByteTotal, packageCount, state.collapsedPackageIds);
  if (byteCount > maximumBytes) return { ok: false, byteCount, message: overflowMessage };
  return {
    ok: true,
    byteCount,
    nextBudget: {
      byteCount,
      packageByteTotal,
      packageCount,
      packageByteCounts,
      packageBaseByteCounts,
      packageLinkByteTotals,
      packageLinkCounts,
      linkByteCounts,
      linkPackageIds,
      linkIds
    }
  };
}

export function advanceCollectorPersistenceBudget(
  budget: CollectorPersistenceBudget,
  delta: CollectorPersistenceDelta,
  collapsedPackageIds: readonly string[],
  maximumBytes = COLLECTOR_MAX_PERSISTENCE_BYTES
): CollectorPersistenceBudgetResult {
  const packageCandidates = new Map<string, PackageCandidate>();
  const linkCandidates = new Map<string, LinkCandidate | null>();
  const packageCandidate = (id: string): PackageCandidate => {
    const existing = packageCandidates.get(id);
    if (existing) return existing;
    const existed = budget.packageByteCounts.has(id);
    const candidate = {
      id,
      existed,
      oldByteCount: budget.packageByteCounts.get(id) ?? 0,
      baseByteCount: budget.packageBaseByteCounts.get(id) ?? 0,
      linkByteTotal: budget.packageLinkByteTotals.get(id) ?? 0,
      linkCount: budget.packageLinkCounts.get(id) ?? 0,
      removed: false
    };
    packageCandidates.set(id, candidate);
    return candidate;
  };

  for (const change of delta.links) {
    const url = normalizedUrl(change.url);
    const previousPackageId = budget.linkPackageIds.get(url) ?? change.previousPackageId;
    const previousByteCount = budget.linkByteCounts.get(url);
    if (previousPackageId && previousByteCount !== undefined) {
      const previousPackage = packageCandidate(previousPackageId);
      previousPackage.linkByteTotal -= previousByteCount;
      previousPackage.linkCount -= 1;
    }
    if (change.nextPackageId && change.nextLink) {
      const canReuse = previousByteCount !== undefined
        && change.previousLink !== null
        && samePersistentLink(change.previousLink, change.nextLink);
      const byteCount = canReuse ? previousByteCount : linkByteCount(change.nextLink);
      const nextPackage = packageCandidate(change.nextPackageId);
      nextPackage.linkByteTotal += byteCount;
      nextPackage.linkCount += 1;
      linkCandidates.set(url, { byteCount, id: change.nextLink.id, packageId: change.nextPackageId });
    } else {
      linkCandidates.set(url, null);
    }
  }

  const removedPackageIds = new Set(delta.removedPackageIds);
  for (const change of delta.packages) {
    const candidate = packageCandidate(change.package.id);
    candidate.baseByteCount = packageBaseByteCount(change.package);
    candidate.linkCount = change.linkCount;
    candidate.removed = false;
    removedPackageIds.delete(change.package.id);
  }
  for (const id of removedPackageIds) packageCandidate(id).removed = true;

  let packageByteTotal = budget.packageByteTotal;
  const nextPackageByteCounts = new Map<string, number>();
  for (const candidate of packageCandidates.values()) {
    if (candidate.existed) packageByteTotal -= candidate.oldByteCount;
    if (candidate.removed) continue;
    const byteCount = completePackageByteCount(candidate.baseByteCount, candidate.linkByteTotal, candidate.linkCount);
    nextPackageByteCounts.set(candidate.id, byteCount);
    packageByteTotal += byteCount;
  }
  const byteCount = totalByteCount(packageByteTotal, delta.packageCount, collapsedPackageIds);
  if (byteCount > maximumBytes) return { ok: false, byteCount, message: overflowMessage };

  const nextBudget = budget as MutableCollectorPersistenceBudget;
  for (const candidate of packageCandidates.values()) {
    if (candidate.removed) {
      nextBudget.packageByteCounts.delete(candidate.id);
      nextBudget.packageBaseByteCounts.delete(candidate.id);
      nextBudget.packageLinkByteTotals.delete(candidate.id);
      nextBudget.packageLinkCounts.delete(candidate.id);
      continue;
    }
    nextBudget.packageByteCounts.set(candidate.id, nextPackageByteCounts.get(candidate.id) ?? 0);
    nextBudget.packageBaseByteCounts.set(candidate.id, candidate.baseByteCount);
    nextBudget.packageLinkByteTotals.set(candidate.id, candidate.linkByteTotal);
    nextBudget.packageLinkCounts.set(candidate.id, candidate.linkCount);
  }
  for (const [url, candidate] of linkCandidates) {
    if (!candidate) {
      nextBudget.linkByteCounts.delete(url);
      nextBudget.linkPackageIds.delete(url);
      nextBudget.linkIds.delete(url);
      continue;
    }
    nextBudget.linkByteCounts.set(url, candidate.byteCount);
    nextBudget.linkPackageIds.set(url, candidate.packageId);
    nextBudget.linkIds.set(url, candidate.id);
  }
  nextBudget.byteCount = byteCount;
  nextBudget.packageByteTotal = packageByteTotal;
  nextBudget.packageCount = delta.packageCount;
  return { ok: true, byteCount, nextBudget };
}
