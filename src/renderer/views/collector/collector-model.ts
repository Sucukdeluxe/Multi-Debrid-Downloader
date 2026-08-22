import type { CollectorLink, CollectorPackage } from "../../../shared/collector";

export type CollectorWorkspaceFilter = "all" | "online" | "unknown" | "offline";

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
  filters: CollectorWorkspaceFilterEntry[];
  filter: CollectorWorkspaceFilter;
  query: string;
  busy: boolean;
  error: string;
  empty: boolean;
  totalCount: number;
  selectedCount: number;
  selectedIds: string[];
  animationsEnabled: boolean;
}

export function mergeCollectorPackages(
  current: CollectorPackage[],
  incoming: CollectorPackage[]
): { packages: CollectorPackage[]; addedLinks: number; duplicateLinks: number } {
  const packages = current.map((pkg) => ({ ...pkg, links: [...pkg.links] }));
  const packageByName = new Map(packages.map((pkg) => [pkg.name.toLocaleLowerCase("de"), pkg]));
  const seenUrls = new Set(packages.flatMap((pkg) => pkg.links.map((link) => link.url)));
  let addedLinks = 0;
  let duplicateLinks = 0;

  for (const incomingPackage of incoming) {
    let target = packageByName.get(incomingPackage.name.toLocaleLowerCase("de"));
    for (const link of incomingPackage.links) {
      if (seenUrls.has(link.url)) {
        duplicateLinks += 1;
        continue;
      }
      if (!target) {
        target = { ...incomingPackage, links: [], addedAt: incomingPackage.addedAt };
        packages.push(target);
        packageByName.set(incomingPackage.name.toLocaleLowerCase("de"), target);
      }
      target.links.push(link);
      target.addedAt = Math.min(target.addedAt, link.addedAt);
      seenUrls.add(link.url);
      addedLinks += 1;
    }
  }

  return { packages, addedLinks, duplicateLinks };
}

export function selectCollectorPackageLinks(
  current: Set<string>,
  pkg: CollectorPackage,
  selected: boolean
): Set<string> {
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
  busy: boolean,
  selectedIds: string[],
  collapsedPackageIds: string[],
  error = "",
  animationsEnabled = true
): CollectorWorkspaceViewModel {
  const selected = new Set(selectedIds);
  const collapsed = new Set(collapsedPackageIds);
  const normalizedQuery = query.trim().toLocaleLowerCase("de");
  const allLinks = packages.flatMap((pkg) => pkg.links);
  const countAvailability = (availability: CollectorLink["availability"]): number => allLinks.filter((link) => link.availability === availability).length;
  const rows: CollectorWorkspacePackageRow[] = [];

  for (const pkg of packages) {
    const packageMatches = !normalizedQuery || pkg.name.toLocaleLowerCase("de").includes(normalizedQuery);
    const visibleLinks = pkg.links.filter((link) => filterCollectorLink(link, filter)
      && (packageMatches || collectorLinkMatchesQuery(link, normalizedQuery)));
    if (visibleLinks.length === 0) continue;
    rows.push({
      id: pkg.id,
      name: pkg.name,
      links: visibleLinks,
      allLinks: pkg.links,
      totalBytes: pkg.links.reduce((sum, link) => sum + (link.fileSizeBytes || 0), 0),
      unknownSizeCount: pkg.links.filter((link) => link.fileSizeBytes === null).length,
      onlineCount: pkg.links.filter((link) => link.availability === "online").length,
      offlineCount: pkg.links.filter((link) => link.availability === "offline").length,
      unknownCount: pkg.links.filter((link) => link.availability === "unknown").length,
      totalCount: pkg.links.length,
      selectedCount: pkg.links.filter((link) => selected.has(link.id)).length,
      collapsed: collapsed.has(pkg.id),
      addedAt: pkg.addedAt,
      hosters: [...new Set(pkg.links.map((link) => link.hoster).filter(Boolean))]
    });
  }

  return {
    packages: rows,
    filters: [
      { id: "all", label: "Alle Links", count: allLinks.length },
      { id: "online", label: "Online", count: countAvailability("online") },
      { id: "unknown", label: "Ungeprüft", count: countAvailability("unknown") },
      { id: "offline", label: "Offline", count: countAvailability("offline") }
    ],
    filter,
    query,
    busy,
    error,
    empty: rows.length === 0,
    totalCount: allLinks.length,
    selectedCount: allLinks.filter((link) => selected.has(link.id)).length,
    selectedIds: allLinks.filter((link) => selected.has(link.id)).map((link) => link.id),
    animationsEnabled
  };
}
