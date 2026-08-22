import crypto from "node:crypto";
import path from "node:path";
import { serializeCollectorPackages } from "../shared/collector";
import type { CollectorInspectionRequest, CollectorInspectionResult, CollectorLink, CollectorPackage } from "../shared/collector";
import type { AppSettings, ParsedPackageInput } from "../shared/types";
import { extractHosterFromUrl } from "../shared/hoster";
import { checkDdownloadOnline, checkOneFichierLinks, checkRapidgatorOnline, DebridService, isDdownloadLink, isOneFichierLink, type OneFichierCheckResult } from "./debrid";
import { parseCollectorInput } from "./link-parser";
import { filenameFromUrl, isHttpLink, looksLikeOpaqueFilename, sanitizeFilename } from "./utils";

interface CollectorInspectionDependencies {
  checkDdownload?: typeof checkDdownloadOnline;
  checkOneFichier?: (links: string[]) => Promise<Map<string, OneFichierCheckResult>>;
  checkRapidgator?: typeof checkRapidgatorOnline;
  resolveFilenames?: (links: string[]) => Promise<Map<string, string>>;
  createId?: (prefix: "package" | "link") => string;
}

interface SourceLink {
  url: string;
  fileName: string;
  packageName: string;
  explicitFileName: boolean;
}

function readableHosterName(hoster: string): string {
  if (hoster === "1fichier") return "1Fichier";
  if (hoster === "rapidgator") return "RapidGator";
  if (hoster === "ddownload") return "DDownload";
  return hoster ? hoster.charAt(0).toLocaleUpperCase("de") + hoster.slice(1) : "Gesammelte Links";
}

export function inferCollectorPackageName(fileName: string, hoster: string): string {
  const safeName = sanitizeFilename(fileName || "");
  if (!safeName || looksLikeOpaqueFilename(safeName)) {
    return readableHosterName(hoster);
  }
  const patterns = [
    /^(.*)\.part\d+\.rar$/i,
    /^(.*)\.pa?r?t?\.?\d+.*?\.rar$/i,
    /^(.*)\.r\d{2,3}$/i,
    /^(.*)\.(?:7z|zip)\.\d{3}$/i,
    /^(.*)\.part\d+$/i
  ];
  for (const pattern of patterns) {
    const match = safeName.match(pattern);
    if (match?.[1]?.trim()) {
      return sanitizeFilename(match[1]);
    }
  }
  const stem = path.parse(safeName).name.trim();
  return sanitizeFilename(stem || readableHosterName(hoster));
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

function countInputLines(rawText: string): { invalidCount: number; duplicateCount: number } {
  const seen = new Set<string>();
  let invalidCount = 0;
  let duplicateCount = 0;
  for (const rawLine of String(rawText || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^#\s*(?:package|file)\s*:/i.test(line)) {
      continue;
    }
    if (!isHttpLink(line)) {
      invalidCount += 1;
      continue;
    }
    if (seen.has(line)) {
      duplicateCount += 1;
    } else {
      seen.add(line);
    }
  }
  return { invalidCount, duplicateCount };
}

function flattenPackages(packages: ParsedPackageInput[]): SourceLink[] {
  const seen = new Set<string>();
  const links: SourceLink[] = [];
  for (const pkg of packages) {
    for (let index = 0; index < pkg.links.length; index += 1) {
      const url = String(pkg.links[index] || "").trim();
      if (!url || seen.has(url)) {
        continue;
      }
      seen.add(url);
      const explicitName = String(pkg.fileNames?.[index] || "").trim();
      links.push({
        url,
        fileName: explicitName ? sanitizeFilename(explicitName) : filenameFromUrl(url),
        packageName: sanitizeFilename(pkg.name),
        explicitFileName: Boolean(explicitName)
      });
    }
  }
  return links;
}

function groupLinks(
  links: CollectorLink[],
  sourceLinks: SourceLink[],
  preservePackageNames: boolean,
  addedAt: number,
  createId: (prefix: "package" | "link") => string
): CollectorPackage[] {
  const sourceByUrl = new Map(sourceLinks.map((link) => [link.url, link]));
  const packageByKey = new Map<string, CollectorPackage>();
  const packages: CollectorPackage[] = [];
  for (const link of links) {
    const source = sourceByUrl.get(link.url);
    const name = preservePackageNames && source?.packageName
      ? source.packageName
      : inferCollectorPackageName(link.fileName, link.hoster);
    const key = name.toLocaleLowerCase("de");
    let pkg = packageByKey.get(key);
    if (!pkg) {
      pkg = { id: createId("package"), name, links: [], addedAt };
      packageByKey.set(key, pkg);
      packages.push(pkg);
    }
    pkg.links.push(link);
  }
  return packages;
}

export async function inspectCollectorPackages(
  packages: ParsedPackageInput[],
  settings: AppSettings,
  addedAt: number,
  dependencies: CollectorInspectionDependencies = {},
  preservePackageNames = true
): Promise<CollectorInspectionResult> {
  const createId = dependencies.createId ?? ((prefix) => `${prefix}-${crypto.randomUUID()}`);
  const sourceLinks = flattenPackages(packages);
  const linksByUrl = new Map<string, CollectorLink>();
  for (const source of sourceLinks) {
    const hoster = extractHosterFromUrl(source.url);
    linksByUrl.set(source.url, {
      id: createId("link"),
      url: source.url,
      fileName: source.fileName,
      fileSizeBytes: null,
      hoster,
      availability: "unknown",
      status: source.explicitFileName ? "ready" : "unknown",
      addedAt
    });
  }

  const oneFichierLinks = sourceLinks.map((link) => link.url).filter(isOneFichierLink);
  const rapidgatorLinks = sourceLinks.map((link) => link.url).filter((url) => extractHosterFromUrl(url) === "rapidgator");
  const ddownloadLinks = sourceLinks.map((link) => link.url).filter(isDdownloadLink);
  const genericLinks = sourceLinks
    .filter((source) => !source.explicitFileName && looksLikeOpaqueFilename(source.fileName))
    .map((source) => source.url)
    .filter((url) => !oneFichierLinks.includes(url) && !rapidgatorLinks.includes(url) && !ddownloadLinks.includes(url));

  const checkDdownload = dependencies.checkDdownload ?? checkDdownloadOnline;
  const checkOneFichier = dependencies.checkOneFichier ?? checkOneFichierLinks;
  const checkRapidgator = dependencies.checkRapidgator ?? checkRapidgatorOnline;
  const resolveFilenames = dependencies.resolveFilenames ?? ((urls) => new DebridService(settings).resolveFilenames(urls));

  const oneFichierPromise = checkOneFichier(oneFichierLinks).catch(() => new Map<string, OneFichierCheckResult>());
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

  const [oneFichierResults, genericResults] = await Promise.all([oneFichierPromise, genericPromise, rapidgatorPromise, ddownloadPromise]).then(([one, generic]) => [one, generic] as const);
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

  return {
    packages: groupLinks(Array.from(linksByUrl.values()), sourceLinks, preservePackageNames, addedAt, createId),
    invalidCount: 0,
    duplicateCount: 0
  };
}

export async function inspectCollectorText(
  request: CollectorInspectionRequest,
  settings: AppSettings,
  dependencies: CollectorInspectionDependencies = {}
): Promise<CollectorInspectionResult> {
  const counts = countInputLines(request.rawText);
  const parsed = parseCollectorInput(request.rawText, "");
  const preservePackageNames = /^#\s*package\s*:/im.test(request.rawText);
  const result = await inspectCollectorPackages(parsed, settings, request.addedAt, dependencies, preservePackageNames);
  return { ...result, ...counts };
}

export { serializeCollectorPackages };
