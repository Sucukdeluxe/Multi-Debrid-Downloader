import crypto from "node:crypto";
import path from "node:path";
import type {
  CollectorEnrichmentRequest,
  CollectorInspectionResult,
  CollectorLink,
  CollectorPackage,
  CollectorTextPreparationRequest
} from "../shared/collector";
import { serializeCollectorPackages } from "../shared/collector";
import { extractHosterFromUrl } from "../shared/hoster";
import type { AppSettings, ParsedPackageInput } from "../shared/types";
import {
  checkDdownloadOnline,
  checkOneFichierLinks,
  checkRapidgatorOnline,
  DebridService,
  isDdownloadLink,
  isOneFichierLink,
  type OneFichierCheckResult
} from "./debrid";
import { importDlcContainers } from "./container";
import { parseCollectorInput } from "./link-parser";
import { filenameFromUrl, isHttpLink, looksLikeOpaqueFilename, sanitizeFilename } from "./utils";

export interface CollectorInspectionDependencies {
  checkDdownload?: typeof checkDdownloadOnline;
  checkOneFichier?: (links: string[]) => Promise<Map<string, OneFichierCheckResult>>;
  checkRapidgator?: typeof checkRapidgatorOnline;
  resolveFilenames?: (links: string[]) => Promise<Map<string, string>>;
  importContainers?: typeof importDlcContainers;
}

interface PreparedSourceLink {
  url: string;
  fileName: string;
  explicitFileName: boolean;
  addedAt: number;
}

function stableId(prefix: "package" | "link", value: string): string {
  return `${prefix}-${crypto.createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function readableHosterName(hoster: string): string {
  if (hoster === "1fichier") return "1Fichier";
  if (hoster === "rapidgator") return "RapidGator";
  if (hoster === "ddownload") return "DDownload";
  return hoster ? hoster.charAt(0).toLocaleUpperCase("de") + hoster.slice(1) : "Gesammelte Links";
}

export function inferCollectorPackageName(fileName: string, hoster: string): string {
  const safeName = sanitizeFilename(fileName || "");
  if (!safeName || looksLikeOpaqueFilename(safeName)) return readableHosterName(hoster);
  const patterns = [
    /^(.*)\.part\d+\.rar$/i,
    /^(.*)\.pa?r?t?\.?\d+.*?\.rar$/i,
    /^(.*)\.r\d{2,3}$/i,
    /^(.*)\.(?:7z|zip)\.\d{3}$/i,
    /^(.*)\.part\d+$/i
  ];
  for (const pattern of patterns) {
    const match = safeName.match(pattern);
    if (match?.[1]?.trim()) return sanitizeFilename(match[1]);
  }
  const stem = path.parse(safeName).name.trim();
  return sanitizeFilename(stem || readableHosterName(hoster));
}

function countInputLines(rawText: string): { invalidCount: number; duplicateCount: number } {
  const seen = new Set<string>();
  let invalidCount = 0;
  let duplicateCount = 0;
  for (const rawLine of String(rawText || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^#\s*(?:package|file)\s*:/i.test(line)) continue;
    if (!isHttpLink(line)) {
      invalidCount += 1;
      continue;
    }
    if (seen.has(line)) duplicateCount += 1;
    else seen.add(line);
  }
  return { invalidCount, duplicateCount };
}

function packageId(links: CollectorLink[]): string {
  return stableId("package", links.map((link) => link.url).sort().join("\n"));
}

function preparePackages(packages: ParsedPackageInput[], addedAt: number, nameSource: CollectorPackage["nameSource"]): CollectorPackage[] {
  const seen = new Set<string>();
  const prepared: CollectorPackage[] = [];
  for (const pkg of packages) {
    const links: CollectorLink[] = [];
    for (let index = 0; index < pkg.links.length; index += 1) {
      const url = String(pkg.links[index] || "").trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const explicitFileName = sanitizeFilename(String(pkg.fileNames?.[index] || "").trim());
      const fileName = explicitFileName || filenameFromUrl(url);
      links.push({
        id: stableId("link", url),
        url,
        fileName,
        fileSizeBytes: null,
        hoster: extractHosterFromUrl(url),
        availability: "unknown",
        status: explicitFileName || (fileName && !looksLikeOpaqueFilename(fileName)) ? "ready" : "unknown",
        addedAt
      });
    }
    if (links.length === 0) continue;
    const name = sanitizeFilename(pkg.name || inferCollectorPackageName(links[0].fileName, links[0].hoster));
    prepared.push({ id: packageId(links), name, nameSource, links, addedAt });
  }
  return prepared;
}

export function prepareCollectorText(request: CollectorTextPreparationRequest): CollectorInspectionResult {
  const parsed = parseCollectorInput(request.rawText, "");
  const nameSource = /^#\s*package\s*:/im.test(request.rawText) ? "explicit" : "inferred";
  return {
    packages: preparePackages(parsed, request.addedAt, nameSource),
    ...countInputLines(request.rawText)
  };
}

export async function prepareCollectorContainers(
  filePaths: string[],
  addedAt: number,
  dependencies: Pick<CollectorInspectionDependencies, "importContainers"> = {}
): Promise<CollectorInspectionResult> {
  const importContainers = dependencies.importContainers ?? importDlcContainers;
  const packages = await importContainers(filePaths);
  return { packages: preparePackages(packages, addedAt, "explicit"), invalidCount: 0, duplicateCount: 0 };
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await worker(current);
    }
  });
  await Promise.all(runners);
}

function regroupEnrichedPackages(packages: CollectorPackage[]): CollectorPackage[] {
  const explicit = packages.filter((pkg) => pkg.nameSource === "explicit").map((pkg) => ({
    ...pkg,
    links: pkg.links.map((link) => ({ ...link }))
  }));
  const groups = new Map<string, CollectorLink[]>();
  for (const link of packages.filter((pkg) => pkg.nameSource === "inferred").flatMap((pkg) => pkg.links)) {
    const name = inferCollectorPackageName(link.fileName, link.hoster);
    const key = name.toLocaleLowerCase("de");
    const links = groups.get(key) ?? [];
    links.push({ ...link });
    groups.set(key, links);
  }
  const inferred = Array.from(groups.entries()).map(([key, links]) => {
    const name = inferCollectorPackageName(links[0].fileName, links[0].hoster);
    return {
      id: packageId(links),
      name: name || key,
      nameSource: "inferred" as const,
      links,
      addedAt: Math.min(...links.map((link) => link.addedAt))
    };
  });
  return [...explicit, ...inferred];
}

export async function enrichCollectorPackages(
  request: CollectorEnrichmentRequest,
  settings: AppSettings,
  dependencies: CollectorInspectionDependencies = {}
): Promise<CollectorInspectionResult> {
  const packages = request.packages.map((pkg) => ({ ...pkg, links: pkg.links.map((link) => ({ ...link })) }));
  const linksByUrl = new Map(packages.flatMap((pkg) => pkg.links).map((link) => [link.url, link]));
  const urls = [...linksByUrl.keys()];
  const oneFichierLinks = urls.filter(isOneFichierLink);
  const rapidgatorLinks = urls.filter((url) => extractHosterFromUrl(url) === "rapidgator");
  const ddownloadLinks = urls.filter(isDdownloadLink);
  const genericLinks = urls.filter((url) => {
    const link = linksByUrl.get(url);
    return Boolean(link && looksLikeOpaqueFilename(link.fileName)
      && !oneFichierLinks.includes(url)
      && !rapidgatorLinks.includes(url)
      && !ddownloadLinks.includes(url));
  });
  const checkOneFichier = dependencies.checkOneFichier ?? checkOneFichierLinks;
  const checkRapidgator = dependencies.checkRapidgator ?? checkRapidgatorOnline;
  const checkDdownload = dependencies.checkDdownload ?? checkDdownloadOnline;
  const resolveFilenames = dependencies.resolveFilenames ?? ((links) => new DebridService(settings).resolveFilenames(links));
  const oneFichierPromise = oneFichierLinks.length > 0
    ? checkOneFichier(oneFichierLinks).catch(() => new Map<string, OneFichierCheckResult>())
    : Promise.resolve(new Map<string, OneFichierCheckResult>());
  const rapidgatorPromise = runWithConcurrency(rapidgatorLinks, 8, async (url) => {
    const result = await checkRapidgator(url).catch(() => null);
    const link = linksByUrl.get(url);
    if (!link || !result) return;
    link.availability = result.online ? "online" : "offline";
    link.status = result.online ? (result.fileName ? "ready" : "unknown") : "offline";
    if (result.fileName) link.fileName = sanitizeFilename(result.fileName);
    if (result.fileSizeBytes !== null && result.fileSizeBytes >= 0) link.fileSizeBytes = result.fileSizeBytes;
  });
  const ddownloadPromise = runWithConcurrency(ddownloadLinks, 4, async (url) => {
    const result = await checkDdownload(url).catch(() => null);
    const link = linksByUrl.get(url);
    if (!link || !result) return;
    link.availability = result.online ? "online" : "offline";
    link.status = result.online ? (result.fileName ? "ready" : "unknown") : "offline";
    if (result.fileName) link.fileName = sanitizeFilename(result.fileName);
    if (result.fileSizeBytes !== null && result.fileSizeBytes >= 0) link.fileSizeBytes = result.fileSizeBytes;
  });
  const genericPromise = genericLinks.length > 0
    ? resolveFilenames(genericLinks).catch(() => new Map<string, string>())
    : Promise.resolve(new Map<string, string>());
  const [oneFichierResults, genericResults] = await Promise.all([
    oneFichierPromise,
    genericPromise,
    rapidgatorPromise,
    ddownloadPromise
  ]).then(([oneFichier, generic]) => [oneFichier, generic] as const);
  for (const [url, result] of oneFichierResults) {
    const link = linksByUrl.get(url);
    if (!link) continue;
    link.availability = result.online ? "online" : "offline";
    link.status = result.online ? (result.fileName ? "ready" : "unknown") : "offline";
    if (result.fileName) link.fileName = sanitizeFilename(result.fileName);
    if (result.fileSizeBytes !== null && result.fileSizeBytes >= 0) link.fileSizeBytes = result.fileSizeBytes;
  }
  for (const [url, fileName] of genericResults) {
    const link = linksByUrl.get(url);
    if (!link || !fileName) continue;
    link.fileName = sanitizeFilename(fileName);
    link.status = "ready";
  }
  return { packages: regroupEnrichedPackages(packages), invalidCount: 0, duplicateCount: 0 };
}

export { serializeCollectorPackages };
