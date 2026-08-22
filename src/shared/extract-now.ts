export interface ExtractNowRequest {
  packageIds: string[];
  itemIds: string[];
}

const MAX_EXTRACT_NOW_TARGETS = 2000;
const MAX_EXTRACT_NOW_ID_LENGTH = 256;

function normalizeIds(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && entry.trim().length > 0)) {
    throw new Error(`${name} muss ein Array nicht-leerer Strings sein`);
  }
  if (value.some((entry) => entry.trim().length > MAX_EXTRACT_NOW_ID_LENGTH)) {
    throw new Error(`${name} enthält eine ID mit ungültiger Länge`);
  }
  return [...new Set(value.map((entry) => entry.trim()))];
}

export function normalizeExtractNowRequest(value: unknown): ExtractNowRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("extractNow muss ein Objekt sein");
  }
  const record = value as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((key) => key !== "packageIds" && key !== "itemIds");
  if (unknownKeys.length > 0) {
    throw new Error(`extractNow enthält unbekannte Felder: ${unknownKeys.join(", ")}`);
  }
  const rawCount = (Array.isArray(record.packageIds) ? record.packageIds.length : 0)
    + (Array.isArray(record.itemIds) ? record.itemIds.length : 0);
  if (rawCount > MAX_EXTRACT_NOW_TARGETS) {
    throw new Error(`extractNow unterstützt höchstens ${MAX_EXTRACT_NOW_TARGETS} Ziele`);
  }
  const packageIds = normalizeIds(record.packageIds, "packageIds");
  const itemIds = normalizeIds(record.itemIds, "itemIds");
  if (packageIds.length + itemIds.length === 0) {
    throw new Error("extractNow benötigt mindestens ein Ziel");
  }
  if (packageIds.length + itemIds.length > MAX_EXTRACT_NOW_TARGETS) {
    throw new Error(`extractNow unterstützt höchstens ${MAX_EXTRACT_NOW_TARGETS} Ziele`);
  }
  return { packageIds, itemIds };
}
