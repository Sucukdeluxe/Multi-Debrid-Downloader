export type CollectorAvailability = "online" | "offline" | "unknown";
export type CollectorLinkStatus = "ready" | "offline" | "unknown";

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
  links: CollectorLink[];
  addedAt: number;
}

export interface CollectorInspectionRequest {
  rawText: string;
  addedAt: number;
}

export interface CollectorInspectionResult {
  packages: CollectorPackage[];
  invalidCount: number;
  duplicateCount: number;
}

export interface CollectorContainerInspectionRequest {
  filePaths: string[];
  addedAt: number;
}

function validAddedAt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function validateCollectorInspectionRequest(value: unknown): CollectorInspectionRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Linksammler-Payload ist ungültig");
  }
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => key !== "rawText" && key !== "addedAt")
    || typeof raw.rawText !== "string"
    || raw.rawText.length > 2_000_000
    || !validAddedAt(raw.addedAt)) {
    throw new Error("Linksammler-Payload ist ungültig");
  }
  return { rawText: raw.rawText, addedAt: raw.addedAt };
}

export function validateCollectorContainerInspectionRequest(filePaths: unknown, addedAt: unknown): CollectorContainerInspectionRequest {
  if (!Array.isArray(filePaths)
    || filePaths.length === 0
    || filePaths.length > 100
    || !validAddedAt(addedAt)
    || filePaths.some((entry) => typeof entry !== "string"
      || entry.length === 0
      || entry.length > 32767
      || !/^(?:[a-z]:[\\/]|\\\\|\/)/i.test(entry)
      || !entry.toLowerCase().endsWith(".dlc"))) {
    throw new Error("Container-Payload ist ungültig");
  }
  return { filePaths: [...filePaths], addedAt };
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
