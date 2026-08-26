import type { CollectorAvailability, CollectorLink, CollectorPackage } from "../../../shared/collector";

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
  selectedIds: string[];
  animationsEnabled: boolean;
}

export interface CollectorMergeResult {
  packages: CollectorPackage[];
  addedLinks: number;
  duplicateLinks: number;
  enrichedLinks: number;
}

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
      }
      if (incomingPackage.nameSource === "explicit") target.nameSource = "explicit";

      if (existing) {
        const enriched = mergeCollectorLinkMetadata(existing.link, incomingLink);
        if (target === existing.pkg) replacements.set(existing.link, enriched);
        else {
          movedLinks.add(existing.link);
          appendToPackage(target, enriched);
        }
        target.addedAt = Math.min(target.addedAt, enriched.addedAt);
        existingByUrl.set(urlKey, { pkg: target, link: enriched });
        enrichedLinks += 1;
        continue;
      }

      const added = { ...incomingLink };
      appendToPackage(target, added);
      target.addedAt = Math.min(target.addedAt, added.addedAt);
      existingByUrl.set(urlKey, { pkg: target, link: added });
      addedLinks += 1;
    }
  }

  return {
    packages: packages.flatMap((pkg) => {
      const links = pkg.links.flatMap((link) => movedLinks.has(link) ? [] : [replacements.get(link) ?? link]);
      links.push(...(appendedLinks.get(pkg) ?? []));
      return links.length > 0 ? [{ ...pkg, links }] : [];
    }),
    addedLinks,
    duplicateLinks,
    enrichedLinks
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

export function selectCollectorPackageLinks(current: Set<string>, pkg: CollectorPackage, selected: boolean): Set<string> {
  const next = new Set(current);
  for (const link of pkg.links) {
    if (selected) next.add(link.id);
    else next.delete(link.id);
  }
  return next;
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
    let selectedCount = 0;
    const hosters = new Set<string>();
    for (const link of pkg.links) {
      if (link.fileSizeBytes === null) unknownSizeCount += 1;
      else totalBytes += link.fileSizeBytes;
      if (link.availability === "online") onlineCount += 1;
      else if (link.availability === "offline") offlineCount += 1;
      else unknownCount += 1;
      if (selected.has(link.id)) selectedCount += 1;
      if (link.hoster) hosters.add(link.hoster);
    }
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
    selectedCount: allLinks.reduce((count, link) => count + (selected.has(link.id) ? 1 : 0), 0),
    selectedIds: allLinks.filter((link) => selected.has(link.id)).map((link) => link.id),
    animationsEnabled
  };
}
