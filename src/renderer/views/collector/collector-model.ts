import { inspectCollectorCapacity, type CollectorAvailability, type CollectorLink, type CollectorPackage } from "../../../shared/collector";

export type { CollectorAvailability, CollectorLink, CollectorPackage } from "../../../shared/collector";
export type CollectorWorkspaceFilter = "all" | CollectorAvailability;

export interface CollectorWorkspaceFilterEntry {
  id: CollectorWorkspaceFilter;
  label: string;
  count: number;
}

export interface CollectorWorkspacePackageRow {
  id: string;
  name: string;
  links: CollectorLink[];
  allLinks: CollectorLink[];
  totalBytes: number;
  unknownSizeCount: number;
  onlineCount: number;
  offlineCount: number;
  unknownCount: number;
  totalCount: number;
  selectedCount: number;
  collapsed: boolean;
  addedAt: number;
  hosters: string[];
}

export interface CollectorWorkspaceViewModel {
  packages: CollectorWorkspacePackageRow[];
  packageCount: number;
  filters: CollectorWorkspaceFilterEntry[];
  filter: CollectorWorkspaceFilter;
  query: string;
  analyzing: boolean;
  error: string;
  empty: boolean;
  totalCount: number;
  selectedCount: number;
  visibleIds: string[];
  visibleTransferableIds: string[];
  selectedIds: string[];
  selectedTransferableIds: string[];
  animationsEnabled: boolean;
}

export interface CollectorMergeResult {
  packages: CollectorPackage[];
  addedLinks: number;
  duplicateLinks: number;
  enrichedLinks: number;
  persistenceDelta: CollectorPersistenceDelta;
}

export interface CollectorPersistenceLinkDelta {
  url: string;
  previousPackageId: string | null;
  previousLink: CollectorLink | null;
  nextPackageId: string | null;
  nextLink: CollectorLink | null;
}

export interface CollectorPersistencePackageDelta {
  package: Pick<CollectorPackage, "id" | "name" | "nameSource" | "addedAt">;
  linkCount: number;
}

export interface CollectorPersistenceDelta {
  links: CollectorPersistenceLinkDelta[];
  packages: CollectorPersistencePackageDelta[];
  removedPackageIds: string[];
  packageCount: number;
}

export type CollectorCapacityMergeResult = {
  ok: true;
  value: CollectorMergeResult;
} | {
  ok: false;
  packageCount: number;
  linkCount: number;
  message: string;
};

function collectorUrlKey(url: string): string {
  return url.trim();
}

function sameCollectorMetadata(left: CollectorLink, right: CollectorLink): boolean {
  return left.fileName === right.fileName
    && left.fileSizeBytes === right.fileSizeBytes
    && left.hoster === right.hoster
    && left.availability === right.availability
    && left.status === right.status;
}

function incomingCollectorMetadataDegrades(existing: CollectorLink, incoming: CollectorLink): boolean {
  return (existing.status !== "unknown" && incoming.status === "unknown")
    || (existing.availability !== "unknown" && incoming.availability === "unknown")
    || (existing.fileSizeBytes !== null && incoming.fileSizeBytes === null);
}

function mergeCollectorLinkMetadata(existing: CollectorLink, incoming: CollectorLink): CollectorLink {
  const preserveKnownName = existing.status === "ready" && incoming.status === "unknown";
  return {
    ...existing,
    ...incoming,
    id: existing.id,
    url: existing.url,
    fileName: preserveKnownName ? existing.fileName : (incoming.fileName || existing.fileName),
    fileSizeBytes: incoming.fileSizeBytes ?? existing.fileSizeBytes,
    hoster: incoming.hoster || existing.hoster,
    availability: incoming.availability === "unknown" ? existing.availability : incoming.availability,
    status: incoming.status === "unknown" ? existing.status : incoming.status,
    addedAt: Math.min(existing.addedAt, incoming.addedAt)
  };
}

function packageNameKey(name: string): string {
  return name.trim().toLocaleLowerCase("de");
}

export function mergeCollectorPackages(current: CollectorPackage[], incoming: CollectorPackage[]): CollectorMergeResult {
  const packages = current.map((pkg) => ({ ...pkg, links: pkg.links.map((link) => ({ ...link })) }));
  const packageByName = new Map(packages.map((pkg) => [packageNameKey(pkg.name), pkg]));
  const existingByUrl = new Map<string, { pkg: CollectorPackage; link: CollectorLink }>();
  for (const pkg of packages) {
    for (const link of pkg.links) existingByUrl.set(collectorUrlKey(link.url), { pkg, link });
  }
  const replacements = new Map<CollectorLink, CollectorLink>();
  const movedLinks = new Set<CollectorLink>();
  const appendedLinks = new Map<CollectorPackage, CollectorLink[]>();
  const affectedPackages = new Set<CollectorPackage>();
  const persistenceLinkDeltas = new Map<string, CollectorPersistenceLinkDelta>();
  const appendToPackage = (pkg: CollectorPackage, link: CollectorLink): void => {
    const links = appendedLinks.get(pkg);
    if (links) links.push(link);
    else appendedLinks.set(pkg, [link]);
  };
  const incomingUrls = new Set<string>();
  let addedLinks = 0;
  let duplicateLinks = 0;
  let enrichedLinks = 0;

  for (const incomingPackage of incoming) {
    for (const incomingLink of incomingPackage.links) {
      const urlKey = collectorUrlKey(incomingLink.url);
      if (!urlKey || incomingUrls.has(urlKey)) {
        duplicateLinks += 1;
        continue;
      }
      incomingUrls.add(urlKey);
      const existing = existingByUrl.get(urlKey);
      const preserveExplicitPackage = existing?.pkg.nameSource === "explicit" && incomingPackage.nameSource === "inferred";
      const preserveRicherPackage = Boolean(existing
        && incomingPackage.nameSource === "inferred"
        && incomingCollectorMetadataDegrades(existing.link, incomingLink));
      const preserveExistingPackage = preserveExplicitPackage || preserveRicherPackage;
      const incomingPackageKey = packageNameKey(preserveExistingPackage && existing ? existing.pkg.name : incomingPackage.name);
      const upgradePackageIdentity = existing?.pkg.nameSource === "inferred" && incomingPackage.nameSource === "explicit";
      if (existing
        && packageNameKey(existing.pkg.name) === incomingPackageKey
        && !upgradePackageIdentity
        && sameCollectorMetadata(existing.link, incomingLink)) {
        duplicateLinks += 1;
        continue;
      }

      let target = packageByName.get(incomingPackageKey);
      if (!target) {
        target = {
          ...incomingPackage,
          name: preserveExistingPackage && existing ? existing.pkg.name : incomingPackage.name,
          nameSource: preserveExistingPackage && existing ? existing.pkg.nameSource : incomingPackage.nameSource,
          links: [],
          addedAt: incomingPackage.addedAt
        };
        packages.push(target);
        packageByName.set(incomingPackageKey, target);
        affectedPackages.add(target);
      }
      if (incomingPackage.nameSource === "explicit" && target.nameSource !== "explicit") {
        target.nameSource = "explicit";
        affectedPackages.add(target);
      }

      if (existing) {
        const enriched = mergeCollectorLinkMetadata(existing.link, incomingLink);
        if (target === existing.pkg) replacements.set(existing.link, enriched);
        else {
          movedLinks.add(existing.link);
          appendToPackage(target, enriched);
          affectedPackages.add(existing.pkg);
        }
        affectedPackages.add(target);
        target.addedAt = Math.min(target.addedAt, enriched.addedAt);
        existingByUrl.set(urlKey, { pkg: target, link: enriched });
        persistenceLinkDeltas.set(urlKey, {
          url: urlKey,
          previousPackageId: existing.pkg.id,
          previousLink: existing.link,
          nextPackageId: target.id,
          nextLink: enriched
        });
        enrichedLinks += 1;
        continue;
      }

      const added = { ...incomingLink };
      appendToPackage(target, added);
      affectedPackages.add(target);
      target.addedAt = Math.min(target.addedAt, added.addedAt);
      existingByUrl.set(urlKey, { pkg: target, link: added });
      persistenceLinkDeltas.set(urlKey, {
        url: urlKey,
        previousPackageId: null,
        previousLink: null,
        nextPackageId: target.id,
        nextLink: added
      });
      addedLinks += 1;
    }
  }

  const finalPackages: CollectorPackage[] = [];
  const persistencePackages: CollectorPersistencePackageDelta[] = [];
  const removedPackageIds: string[] = [];
  for (const pkg of packages) {
    const links = pkg.links.flatMap((link) => movedLinks.has(link) ? [] : [replacements.get(link) ?? link]);
    links.push(...(appendedLinks.get(pkg) ?? []));
    if (links.length === 0) {
      if (affectedPackages.has(pkg)) removedPackageIds.push(pkg.id);
      continue;
    }
    const finalPackage = { ...pkg, links };
    finalPackages.push(finalPackage);
    if (affectedPackages.has(pkg)) {
      persistencePackages.push({
        package: {
          id: finalPackage.id,
          name: finalPackage.name,
          nameSource: finalPackage.nameSource,
          addedAt: finalPackage.addedAt
        },
        linkCount: finalPackage.links.length
      });
    }
    for (const link of links) {
      const delta = persistenceLinkDeltas.get(collectorUrlKey(link.url));
      if (!delta) continue;
      delta.nextPackageId = finalPackage.id;
      delta.nextLink = link;
    }
  }

  return {
    packages: finalPackages,
    addedLinks,
    duplicateLinks,
    enrichedLinks,
    persistenceDelta: {
      links: [...persistenceLinkDeltas.values()],
      packages: persistencePackages,
      removedPackageIds,
      packageCount: finalPackages.length
    }
  };
}

export function mergeCollectorEnrichment(current: CollectorPackage[], incoming: CollectorPackage[]): CollectorMergeResult {
  const currentUrls = new Set(current.flatMap((pkg) => pkg.links.map((link) => collectorUrlKey(link.url))));
  const retained = incoming.flatMap((pkg) => {
    const links = pkg.links.filter((link) => currentUrls.has(collectorUrlKey(link.url)));
    return links.length > 0 ? [{ ...pkg, links }] : [];
  });
  return mergeCollectorPackages(current, retained);
}

export function mergeCollectorPackagesWithinCapacity(
  current: CollectorPackage[],
  incoming: CollectorPackage[],
  enrichment = false
): CollectorCapacityMergeResult {
  const value = enrichment
    ? mergeCollectorEnrichment(current, incoming)
    : mergeCollectorPackages(current, incoming);
  const capacity = inspectCollectorCapacity(value.packages);
  return capacity.ok ? { ok: true, value } : capacity;
}

function retainAvailableCollectorIds(current: ReadonlySet<string>, availableIds: Iterable<string>): Set<string> {
  const available = new Set(availableIds);
  return new Set([...current].filter((id) => available.has(id)));
}

export function reconcileCollectorCollapsedPackageIds(
  current: Set<string>,
  previousPackages: CollectorPackage[],
  packages: CollectorPackage[],
  incoming: CollectorPackage[],
  collapseImported: boolean
): Set<string> {
  const incomingUrls = new Set(incoming.flatMap((pkg) => pkg.links.map((link) => collectorUrlKey(link.url))));
  const previousPackageByUrl = new Map<string, string>();
  const collapsedUrls = new Set<string>();
  for (const pkg of previousPackages) {
    for (const link of pkg.links) {
      const key = collectorUrlKey(link.url);
      previousPackageByUrl.set(key, pkg.id);
      if (current.has(pkg.id)) collapsedUrls.add(key);
    }
  }
  const next = new Set<string>();
  for (const pkg of packages) {
    const keys = pkg.links.map((link) => collectorUrlKey(link.url));
    const preservesCollapsedState = current.has(pkg.id) || keys.some((key) => collapsedUrls.has(key));
    const receivesImportedContent = collapseImported && keys.some((key) => {
      if (!incomingUrls.has(key)) return false;
      const previousPackageId = previousPackageByUrl.get(key);
      return !previousPackageId || previousPackageId !== pkg.id;
    });
    if (preservesCollapsedState || receivesImportedContent) next.add(pkg.id);
  }
  return next;
}

export function reconcileCollectorCollapsedPackageIdsWithPackages(
  current: ReadonlySet<string>,
  packages: readonly Pick<CollectorPackage, "id">[]
): Set<string> {
  return retainAvailableCollectorIds(current, packages.map((pkg) => pkg.id));
}

export function selectCollectorPackageLinks(current: Set<string>, pkg: Pick<CollectorPackage, "links">, selected: boolean): Set<string> {
  const next = new Set(current);
  for (const link of pkg.links) {
    if (selected) next.add(link.id);
    else next.delete(link.id);
  }
  return next;
}

export function setCollectorVisibleSelection(current: ReadonlySet<string>, visibleIds: readonly string[], selected: boolean): Set<string> {
  const next = new Set(current);
  for (const id of visibleIds) {
    if (selected) next.add(id);
    else next.delete(id);
  }
  return next;
}

export function reconcileCollectorSelectionWithPackages(
  current: ReadonlySet<string>,
  packages: readonly Pick<CollectorPackage, "links">[]
): Set<string> {
  return retainAvailableCollectorIds(current, packages.flatMap((pkg) => pkg.links.map((link) => link.id)));
}

export function buildCollectorTransferPackages(packages: CollectorPackage[], selectedIds: Set<string>): CollectorPackage[] {
  return packages.flatMap((pkg) => {
    const links = pkg.links.filter((link) => selectedIds.has(link.id));
    return links.length > 0 ? [{ ...pkg, links }] : [];
  });
}

export function removeCollectorLinks(packages: CollectorPackage[], removedIds: Set<string>): CollectorPackage[] {
  return packages.flatMap((pkg) => {
    const links = pkg.links.filter((link) => !removedIds.has(link.id));
    return links.length > 0 ? [{ ...pkg, links }] : [];
  });
}

export function reconcileCollectorSelectionAfterRemoval(
  selectedIds: ReadonlySet<string>,
  removedIds: ReadonlySet<string>
): Set<string> {
  return new Set([...selectedIds].filter((id) => !removedIds.has(id)));
}

function filterCollectorLink(link: CollectorLink, filter: CollectorWorkspaceFilter): boolean {
  return filter === "all" || link.availability === filter;
}

function collectorLinkMatchesQuery(link: CollectorLink, query: string): boolean {
  if (!query) return true;
  return `${link.fileName}\n${link.url}\n${link.hoster}\n${link.status}\n${link.availability}`.toLocaleLowerCase("de").includes(query);
}

export function buildCollectorWorkspaceViewModel(
  packages: CollectorPackage[],
  filter: CollectorWorkspaceFilter,
  query: string,
  analyzing: boolean,
  selectedIds: string[],
  collapsedPackageIds: string[],
  error = "",
  animationsEnabled = true
): CollectorWorkspaceViewModel {
  const selected = new Set(selectedIds);
  const collapsed = new Set(collapsedPackageIds);
  const normalizedQuery = query.trim().toLocaleLowerCase("de");
  const allLinks = packages.flatMap((pkg) => pkg.links);
  const availabilityCounts: Record<CollectorAvailability, number> = { online: 0, unknown: 0, offline: 0 };
  for (const link of allLinks) availabilityCounts[link.availability] += 1;
  const rows: CollectorWorkspacePackageRow[] = [];

  for (const pkg of packages) {
    const packageMatches = !normalizedQuery || pkg.name.toLocaleLowerCase("de").includes(normalizedQuery);
    const visibleLinks = pkg.links.filter((link) => filterCollectorLink(link, filter)
      && (packageMatches || collectorLinkMatchesQuery(link, normalizedQuery)));
    if (visibleLinks.length === 0) continue;
    let totalBytes = 0;
    let unknownSizeCount = 0;
    let onlineCount = 0;
    let offlineCount = 0;
    let unknownCount = 0;
    const hosters = new Set<string>();
    for (const link of pkg.links) {
      if (link.fileSizeBytes === null) unknownSizeCount += 1;
      else totalBytes += link.fileSizeBytes;
      if (link.availability === "online") onlineCount += 1;
      else if (link.availability === "offline") offlineCount += 1;
      else unknownCount += 1;
      if (link.hoster) hosters.add(link.hoster);
    }
    const selectedCount = visibleLinks.reduce((count, link) => count + (selected.has(link.id) ? 1 : 0), 0);
    rows.push({
      id: pkg.id,
      name: pkg.name,
      links: visibleLinks,
      allLinks: pkg.links,
      totalBytes,
      unknownSizeCount,
      onlineCount,
      offlineCount,
      unknownCount,
      totalCount: pkg.links.length,
      selectedCount,
      collapsed: collapsed.has(pkg.id),
      addedAt: pkg.addedAt,
      hosters: [...hosters]
    });
  }

  const visibleIds = rows.flatMap((row) => row.links.map((link) => link.id));
  const visibleSelectedIds = visibleIds.filter((id) => selected.has(id));
  const visibleTransferableIds = rows.flatMap((row) => row.links
    .filter((link) => link.availability !== "offline")
    .map((link) => link.id));
  const selectedTransferableIds = visibleTransferableIds.filter((id) => selected.has(id));

  return {
    packages: rows,
    packageCount: packages.length,
    filters: [
      { id: "all", label: "Alle", count: allLinks.length },
      { id: "online", label: "Online", count: availabilityCounts.online },
      { id: "unknown", label: "Ungeprüft", count: availabilityCounts.unknown },
      { id: "offline", label: "Offline", count: availabilityCounts.offline }
    ],
    filter,
    query,
    analyzing,
    error,
    empty: rows.length === 0,
    totalCount: allLinks.length,
    selectedCount: visibleSelectedIds.length,
    visibleIds,
    visibleTransferableIds,
    selectedIds: visibleSelectedIds,
    selectedTransferableIds,
    animationsEnabled
  };
}
