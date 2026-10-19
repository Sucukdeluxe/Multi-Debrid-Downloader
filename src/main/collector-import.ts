import type { ParsedPackageInput } from "../shared/types";
import { COLLECTOR_MAX_LINKS, COLLECTOR_MAX_NAME_LENGTH, COLLECTOR_MAX_PACKAGES } from "../shared/collector";
import { mergePackageInputs } from "./link-parser";
import { isHttpLink } from "./utils";

const invalidQueueExport = (): never => {
  throw new Error("Der Queue-Export ist ungültig.");
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

export function parseCollectorQueueExport(rawText: string): ParsedPackageInput[] | null {
  const text = String(rawText || "").trim();
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    if (!text.startsWith("{") && !text.startsWith("[")) return null;
    throw new Error("Der Queue-Export enthält ungültiges JSON.");
  }
  if (!isRecord(parsed)
    || !hasOnlyKeys(parsed, ["version", "packages"])
    || parsed.version !== 1
    || !Array.isArray(parsed.packages)) {
    return invalidQueueExport();
  }
  if (parsed.packages.length > COLLECTOR_MAX_PACKAGES) {
    throw new Error(`Der Queue-Export überschreitet das Collector-Limit von ${COLLECTOR_MAX_PACKAGES.toLocaleString("de-DE")} Paketen.`);
  }

  let linkCount = 0;
  const packages: ParsedPackageInput[] = parsed.packages.map((value) => {
    if (!isRecord(value)
      || !hasOnlyKeys(value, ["name", "links", "fileNames"])
      || typeof value.name !== "string"
      || value.name.trim().length === 0
      || value.name.length > COLLECTOR_MAX_NAME_LENGTH
      || !Array.isArray(value.links)
      || (value.fileNames !== undefined && !Array.isArray(value.fileNames))) {
      return invalidQueueExport();
    }
    const fileNamesRaw = value.fileNames as unknown[] | undefined;
    if (fileNamesRaw && fileNamesRaw.length > value.links.length) return invalidQueueExport();
    linkCount += value.links.length;
    if (linkCount > COLLECTOR_MAX_LINKS) {
      throw new Error(`Der Queue-Export überschreitet das Collector-Limit von ${COLLECTOR_MAX_LINKS.toLocaleString("de-DE")} Links.`);
    }
    const links = value.links.map((entry) => {
      if (typeof entry !== "string" || entry.length > 32767 || !isHttpLink(entry)) return invalidQueueExport();
      return entry.trim();
    });
    const fileNames = links.map((_, index) => {
      const entry = fileNamesRaw?.[index];
      if (entry === undefined) return "";
      if (typeof entry !== "string" || entry.length > COLLECTOR_MAX_NAME_LENGTH) return invalidQueueExport();
      return entry.trim();
    });
    return {
      name: value.name,
      links,
      ...(fileNames.some((fileName) => fileName.length > 0) ? { fileNames } : {})
    };
  });

  return mergePackageInputs(packages).filter((pkg) => pkg.links.length > 0);
}
