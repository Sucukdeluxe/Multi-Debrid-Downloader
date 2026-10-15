import crypto from "node:crypto";
import type { McpScope } from "../../shared/mcp";

export type Schema = {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean";
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  enum?: unknown[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  maxItems?: number;
  minItems?: number;
  description?: string;
};

export function validateSchema(value: unknown, schema: Schema, depth = 0): void {
  if (depth > 16) throw new Error("Eingabe zu tief verschachtelt.");
  if (schema.enum && !schema.enum.includes(value)) throw new Error("Ungültiger Auswahlwert.");
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("Objekt erwartet.");
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length > 512) throw new Error("Zu viele Felder.");
    for (const key of schema.required || []) if (!Object.hasOwn(record, key)) throw new Error(`Pflichtfeld fehlt: ${key}`);
    for (const [key, child] of Object.entries(record)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("Ungültiger Feldname.");
      const definition = schema.properties?.[key];
      if (!definition && schema.additionalProperties !== true) throw new Error(`Unbekanntes Feld: ${key}`);
      if (definition) validateSchema(child, definition, depth + 1);
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value) || value.length > (schema.maxItems ?? 1000) || value.length < (schema.minItems ?? 0)) throw new Error("Ungültige Liste.");
    for (const entry of value) if (schema.items) validateSchema(entry, schema.items, depth + 1);
  } else if (schema.type === "string") {
    if (typeof value !== "string" || value.length > (schema.maxLength ?? 100_000) || value.length < (schema.minLength ?? 0) || value.includes("\0")) throw new Error("Ungültiger Text.");
  } else if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value) || (schema.type === "integer" && !Number.isSafeInteger(value)) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) throw new Error("Ungültige Zahl.");
  } else if (schema.type === "boolean" && typeof value !== "boolean") throw new Error("Wahrheitswert erwartet.");
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function actionDigest(tool: string, args: unknown): string {
  return crypto.createHash("sha256").update(`${tool}\n${canonical(args)}`).digest("hex");
}

export function requireScopes(actual: readonly McpScope[], required: readonly McpScope[]): void {
  if (required.some(scope => !actual.includes(scope))) throw new Error("MCP-Berechtigung nicht freigegeben.");
}

const secretKey = /password|passphrase|secret|token|cookie|authorization|api.?key|connection.?code|notify.?url|credentials/i;
const safeKey = /(?:configured|count|enabled|hasToken|keyId|accountId|tokenUsage|status|errorCode)$/i;

export function redact(value: unknown, secrets: readonly string[] = [], depth = 0): unknown {
  if (depth > 16) return "[gekürzt]";
  if (typeof value === "string") {
    let text = value.slice(0, 64_000);
    for (const secret of secrets) if (secret.length >= 4) text = text.split(secret).join("[geschützt]");
    return text
      .replace(/(?:media-mcp:v1:|rddiag:v1:|MDD2-)[A-Za-z0-9_\-:.]+/g, "[geschützter Verbindungscode]")
      .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, "$1[geschützt]")
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[geschützt]@")
      .replace(/([?&](?:token|key|api_?key|password|auth|signature|sig)=)[^&\s]+/gi, "$1[geschützt]")
      .replace(/((?:password|passphrase|secret|token|api_?key|authorization)\s*[=:]\s*)[^\s,;|]+/gi, "$1[geschützt]");
  }
  if (Buffer.isBuffer(value)) return "[Binärdaten]";
  if (Array.isArray(value)) return value.slice(0, 1000).map(entry => redact(entry, secrets, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
      ((secretKey.test(key) && !safeKey.test(key)) || /^(?:directUrl|downloadUrl)$/i.test(key)) ? "[geschützt]" : redact(entry, secrets, depth + 1)
    ]));
  }
  return value;
}

export function validateRelayUrl(raw: string, allowLoopback = false): string {
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash) throw new Error("Ungültige MCP-Relay-Adresse.");
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(allowLoopback && loopback && url.protocol === "http:")) throw new Error("MCP benötigt HTTPS.");
  if (!url.hostname || url.pathname.includes("//")) throw new Error("Ungültige MCP-Relay-Adresse.");
  return url.toString().replace(/\/$/, "");
}
