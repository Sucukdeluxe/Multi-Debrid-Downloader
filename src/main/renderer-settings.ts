import type { AppSettings, RendererSettingsUpdate } from "../shared/types";
import { createRendererSettings } from "./renderer-state";

const DERIVED_KEYS = new Set(["archivePasswordListConfigured", "notifyUrlConfigured", "configuredProviders"]);
const WRITE_ONLY_KEYS = new Set(["archivePasswordList", "notifyUrl"]);
const MAX_SETTINGS_PAYLOAD_BYTES = 1_000_000;

function invalid(): never {
  throw new Error("Settings-Payload ist ungültig");
}

function validateJsonValue(value: unknown, depth = 0): void {
  if (depth > 8) {
    invalid();
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid();
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 10_000) invalid();
    value.forEach((entry) => validateJsonValue(entry, depth + 1));
    return;
  }
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    invalid();
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 10_000) invalid();
  entries.forEach(([, entry]) => validateJsonValue(entry, depth + 1));
}

function validateTopLevelType(value: unknown, expected: unknown): void {
  if (Array.isArray(expected)) {
    if (!Array.isArray(value)) invalid();
    return;
  }
  if (expected && typeof expected === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid();
    return;
  }
  if (typeof value !== typeof expected) {
    invalid();
  }
}

export function validateRendererSettingsUpdate(value: unknown, current: AppSettings): RendererSettingsUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    invalid();
  }
  let serialized = "";
  try {
    serialized = JSON.stringify(value);
  } catch {
    invalid();
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_SETTINGS_PAYLOAD_BYTES) {
    invalid();
  }
  const safe = createRendererSettings(current) as unknown as Record<string, unknown>;
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(input)) {
    if (DERIVED_KEYS.has(key)) {
      continue;
    }
    if (WRITE_ONLY_KEYS.has(key)) {
      if (typeof entry !== "string" || entry.length > 100_000) invalid();
      output[key] = entry;
      continue;
    }
    if (!(key in safe)) {
      invalid();
    }
    validateTopLevelType(entry, safe[key]);
    validateJsonValue(entry);
    output[key] = entry;
  }
  return output as RendererSettingsUpdate;
}
