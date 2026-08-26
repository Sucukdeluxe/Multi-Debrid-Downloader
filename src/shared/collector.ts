export type CollectorAvailability = "online" | "offline" | "unknown";
export type CollectorLinkStatus = "ready" | "offline" | "unknown";
export type CollectorPackageNameSource = "explicit" | "inferred";

export interface CollectorLink {
  id: string;
  url: string;
  fileName: string;
  fileSizeBytes: number | null;
  hoster: string;
  availability: CollectorAvailability;
  status: CollectorLinkStatus;
  addedAt: number;
}

export interface CollectorPackage {
  id: string;
  name: string;
  nameSource: CollectorPackageNameSource;
  links: CollectorLink[];
  addedAt: number;
}

export interface CollectorTextPreparationRequest {
  rawText: string;
  addedAt: number;
}

export interface CollectorContainerPreparationRequest {
  filePaths: string[];
  addedAt: number;
}

export interface CollectorEnrichmentRequest {
  packages: CollectorPackage[];
}

export interface CollectorInspectionResult {
  packages: CollectorPackage[];
  invalidCount: number;
  duplicateCount: number;
}

function validAddedAt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isAbsoluteDlcPath(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 32767
    && /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(value)
    && value.toLowerCase().endsWith(".dlc");
}

export function validateCollectorTextPreparationRequest(value: unknown): CollectorTextPreparationRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Linksammler-Payload ist ungültig");
  }
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => key !== "rawText" && key !== "addedAt")
    || typeof raw.rawText !== "string"
    || new TextEncoder().encode(raw.rawText).byteLength > 2_000_000
    || !validAddedAt(raw.addedAt)) {
    throw new Error("Linksammler-Payload ist ungültig");
  }
  return { rawText: raw.rawText, addedAt: raw.addedAt };
}

export function validateCollectorContainerPreparationRequest(value: unknown): CollectorContainerPreparationRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Container-Payload ist ungültig");
  }
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => key !== "filePaths" && key !== "addedAt")
    || !Array.isArray(raw.filePaths)
    || raw.filePaths.length === 0
    || raw.filePaths.length > 100
    || raw.filePaths.some((entry) => !isAbsoluteDlcPath(entry))
    || !validAddedAt(raw.addedAt)) {
    throw new Error("Container-Payload ist ungültig");
  }
  return { filePaths: [...raw.filePaths] as string[], addedAt: raw.addedAt };
}

function validCollectorLink(value: unknown): value is CollectorLink {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  return Object.keys(raw).every((key) => [
    "id", "url", "fileName", "fileSizeBytes", "hoster", "availability", "status", "addedAt"
  ].includes(key))
    && typeof raw.id === "string"
    && raw.id.length > 0
    && raw.id.length <= 160
    && typeof raw.url === "string"
    && raw.url.length <= 32767
    && /^https?:\/\/[^\s]+$/i.test(raw.url)
    && typeof raw.fileName === "string"
    && raw.fileName.length <= 1024
    && (raw.fileSizeBytes === null || (typeof raw.fileSizeBytes === "number" && Number.isSafeInteger(raw.fileSizeBytes) && raw.fileSizeBytes >= 0))
    && typeof raw.hoster === "string"
    && raw.hoster.length <= 255
    && (raw.availability === "online" || raw.availability === "offline" || raw.availability === "unknown")
    && (raw.status === "ready" || raw.status === "offline" || raw.status === "unknown")
    && validAddedAt(raw.addedAt);
}

function validCollectorPackage(value: unknown): value is CollectorPackage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  return Object.keys(raw).every((key) => ["id", "name", "nameSource", "links", "addedAt"].includes(key))
    && typeof raw.id === "string"
    && raw.id.length > 0
    && raw.id.length <= 160
    && typeof raw.name === "string"
    && raw.name.length > 0
    && raw.name.length <= 1024
    && (raw.nameSource === "explicit" || raw.nameSource === "inferred")
    && Array.isArray(raw.links)
    && raw.links.length > 0
    && raw.links.every(validCollectorLink)
    && validAddedAt(raw.addedAt);
}

export function validateCollectorEnrichmentRequest(value: unknown): CollectorEnrichmentRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Linksammler-Anreicherung ist ungültig");
  }
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => key !== "packages")
    || !Array.isArray(raw.packages)
    || raw.packages.length === 0
    || raw.packages.length > 2_000
    || raw.packages.some((entry) => !validCollectorPackage(entry))
    || raw.packages.reduce((sum, entry) => sum + (entry as CollectorPackage).links.length, 0) > 20_000) {
    throw new Error("Linksammler-Anreicherung ist ungültig");
  }
  return { packages: structuredClone(raw.packages) as CollectorPackage[] };
}

function collectorMarkerValue(value: string): string {
  return String(value || "").replace(/[\r\n]+/g, " ").trim();
}

export function serializeCollectorPackages(packages: CollectorPackage[]): string {
  const lines: string[] = [];
  for (const pkg of packages) {
    if (pkg.links.length === 0) continue;
    lines.push(`# Package: ${collectorMarkerValue(pkg.name)}`);
    for (const link of pkg.links) {
      if (link.fileName) lines.push(`# File: ${collectorMarkerValue(link.fileName)}`);
      lines.push(link.url);
    }
  }
  return lines.join("\n");
}
