import crypto from "node:crypto";
import zlib from "node:zlib";
import type { AppSettings } from "../shared/types";

const KEY_PREFIX = "MDD2-";
const KEY_BODY_LENGTH = 70;
const RECORD_ID_LENGTH = 16;
const MASTER_KEY_LENGTH = 32;
const CHECKSUM_LENGTH = 4;
const NONCE_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const BLOB_VERSION = 1;
const MAX_BLOB_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_PLAINTEXT_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;
const KEY_CONTEXT = Buffer.from("MDD2-ONLINE-KEY-V1", "utf8");
const AAD_CONTEXT = Buffer.from("MDD-ONLINE-BACKUP-V1", "utf8");

export interface OnlineSettingsPayload {
  version: 1;
  kind: "settings-only";
  appVersion: string;
  exportedAt: string;
  settings: AppSettings;
}

export interface OnlineBackupRecord {
  id: string;
  blob: string;
  deleteVerifier: string;
}

export interface CreatedOnlineBackup {
  key: string;
  record: OnlineBackupRecord;
}

export interface ParsedOnlineBackupKey {
  id: string;
  idBytes: Buffer;
  masterKey: Buffer;
}

function checksum(idBytes: Buffer, masterKey: Buffer): Buffer {
  return crypto.createHash("sha256").update(KEY_CONTEXT).update(idBytes).update(masterKey).digest().subarray(0, CHECKSUM_LENGTH);
}

function deriveSecret(masterKey: Buffer, idBytes: Buffer, purpose: string): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", masterKey, idBytes, Buffer.from(`MDD-ONLINE-${purpose}-V1`, "utf8"), 32));
}

function deriveDeleteSecret(parsed: ParsedOnlineBackupKey): Buffer {
  return deriveSecret(parsed.masterKey, parsed.idBytes, "DELETE");
}

function aad(idBytes: Buffer): Buffer {
  return Buffer.concat([AAD_CONTEXT, idBytes]);
}

function encodeKey(idBytes: Buffer, masterKey: Buffer): string {
  const body = Buffer.concat([idBytes, masterKey, checksum(idBytes, masterKey)]).toString("base64url");
  return `${KEY_PREFIX}${body}`;
}

function validatePayload(value: unknown): OnlineSettingsPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Online-Sicherung enthält keine gültigen Einstellungen");
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1
    || record.kind !== "settings-only"
    || typeof record.appVersion !== "string"
    || typeof record.exportedAt !== "string"
    || !record.settings
    || typeof record.settings !== "object"
    || Array.isArray(record.settings)
    || "session" in record
    || "history" in record
  ) {
    throw new Error("Online-Sicherung enthält keine gültigen Einstellungen");
  }
  return record as unknown as OnlineSettingsPayload;
}

function endpoint(baseUrl: string, relativePath: string): string {
  const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
  const url = new URL(`${normalized}${relativePath}`);
  if (url.protocol !== "https:" && !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error("Online-Sicherungen benötigen eine sichere HTTPS-Verbindung");
  }
  return url.toString();
}

async function request(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Online-Sicherungsdienst antwortet nicht");
    }
    throw new Error(`Online-Sicherungsdienst nicht erreichbar: ${String((error as Error)?.message || error)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function readLimitedText(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error("Antwort des Online-Sicherungsdienstes ist zu groß");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Antwort des Online-Sicherungsdienstes ist zu groß");
    }
    chunks.push(result.value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

export function parseOnlineBackupKey(key: string): ParsedOnlineBackupKey {
  const normalized = String(key || "").trim();
  if (!new RegExp(`^${KEY_PREFIX}[A-Za-z0-9_-]{${KEY_BODY_LENGTH}}$`).test(normalized)) {
    throw new Error("Online-Sicherungsschlüssel ist ungültig");
  }
  const decoded = Buffer.from(normalized.slice(KEY_PREFIX.length), "base64url");
  if (decoded.length !== RECORD_ID_LENGTH + MASTER_KEY_LENGTH + CHECKSUM_LENGTH) {
    throw new Error("Online-Sicherungsschlüssel ist ungültig");
  }
  if (decoded.toString("base64url") !== normalized.slice(KEY_PREFIX.length)) {
    throw new Error("Online-Sicherungsschlüssel ist ungültig");
  }
  const idBytes = decoded.subarray(0, RECORD_ID_LENGTH);
  const masterKey = decoded.subarray(RECORD_ID_LENGTH, RECORD_ID_LENGTH + MASTER_KEY_LENGTH);
  const actualChecksum = decoded.subarray(RECORD_ID_LENGTH + MASTER_KEY_LENGTH);
  const expectedChecksum = checksum(idBytes, masterKey);
  if (!crypto.timingSafeEqual(actualChecksum, expectedChecksum)) {
    throw new Error("Online-Sicherungsschlüssel ist beschädigt");
  }
  return { id: idBytes.toString("base64url"), idBytes: Buffer.from(idBytes), masterKey: Buffer.from(masterKey) };
}

export function createOnlineBackup(settings: AppSettings, appVersion: string, exportedAt = new Date().toISOString()): CreatedOnlineBackup {
  const idBytes = crypto.randomBytes(RECORD_ID_LENGTH);
  const masterKey = crypto.randomBytes(MASTER_KEY_LENGTH);
  const key = encodeKey(idBytes, masterKey);
  const encryptionKey = deriveSecret(masterKey, idBytes, "ENCRYPTION");
  const nonce = crypto.randomBytes(NONCE_LENGTH);
  const payload: OnlineSettingsPayload = {
    version: 1,
    kind: "settings-only",
    appVersion,
    exportedAt,
    settings: JSON.parse(JSON.stringify(settings)) as AppSettings
  };
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  if (plaintext.length > MAX_PLAINTEXT_BYTES) {
    throw new Error("Einstellungen sind für eine Online-Sicherung zu groß");
  }
  const compressed = zlib.gzipSync(plaintext, { level: 9 });
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, nonce, { authTagLength: AUTH_TAG_LENGTH });
  cipher.setAAD(aad(idBytes));
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const blobBytes = Buffer.concat([Buffer.from([BLOB_VERSION]), nonce, cipher.getAuthTag(), ciphertext]);
  if (blobBytes.length > MAX_BLOB_BYTES) {
    throw new Error("Einstellungen sind für eine Online-Sicherung zu groß");
  }
  const parsed = parseOnlineBackupKey(key);
  const deleteVerifier = crypto.createHash("sha256").update(deriveDeleteSecret(parsed)).digest("base64url");
  return {
    key,
    record: {
      id: parsed.id,
      blob: blobBytes.toString("base64url"),
      deleteVerifier
    }
  };
}

export function restoreOnlineBackup(key: string, blob: string): OnlineSettingsPayload {
  const parsed = parseOnlineBackupKey(key);
  if (!/^[A-Za-z0-9_-]+$/.test(blob) || blob.length > Math.ceil(MAX_BLOB_BYTES * 4 / 3) + 4) {
    throw new Error("Online-Sicherung ist beschädigt");
  }
  const bytes = Buffer.from(blob, "base64url");
  if (bytes.toString("base64url") !== blob) {
    throw new Error("Online-Sicherung ist beschädigt");
  }
  if (bytes.length < 1 + NONCE_LENGTH + AUTH_TAG_LENGTH || bytes[0] !== BLOB_VERSION) {
    throw new Error("Online-Sicherung ist beschädigt");
  }
  const nonce = bytes.subarray(1, 1 + NONCE_LENGTH);
  const tag = bytes.subarray(1 + NONCE_LENGTH, 1 + NONCE_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = bytes.subarray(1 + NONCE_LENGTH + AUTH_TAG_LENGTH);
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      deriveSecret(parsed.masterKey, parsed.idBytes, "ENCRYPTION"),
      nonce,
      { authTagLength: AUTH_TAG_LENGTH }
    );
    decipher.setAAD(aad(parsed.idBytes));
    decipher.setAuthTag(tag);
    const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const plaintext = zlib.gunzipSync(compressed, { maxOutputLength: MAX_PLAINTEXT_BYTES }).toString("utf8");
    return validatePayload(JSON.parse(plaintext));
  } catch (error) {
    if (error instanceof Error && /keine gültigen Einstellungen/.test(error.message)) throw error;
    throw new Error("Online-Sicherung konnte nicht entschlüsselt werden oder ist beschädigt");
  }
}

export async function uploadOnlineBackup(record: OnlineBackupRecord, baseUrl: string): Promise<void> {
  const response = await request(endpoint(baseUrl, "/v1/backups"), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(record)
  });
  await readLimitedText(response);
  if (response.status !== 201) {
    throw new Error("Online-Sicherung konnte nicht gespeichert werden");
  }
}

export async function downloadOnlineBackup(key: string, baseUrl: string): Promise<OnlineSettingsPayload> {
  const parsed = parseOnlineBackupKey(key);
  const response = await request(endpoint(baseUrl, "/v1/backups/restore"), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ id: parsed.id })
  });
  const body = await readLimitedText(response);
  if (response.status !== 200) {
    throw new Error(response.status === 404 ? "Online-Sicherung wurde nicht gefunden" : "Online-Sicherung konnte nicht geladen werden");
  }
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new Error("Online-Sicherungsdienst hat ungültige Daten geliefert");
  }
  const blob = (value as { blob?: unknown })?.blob;
  if (typeof blob !== "string") {
    throw new Error("Online-Sicherungsdienst hat ungültige Daten geliefert");
  }
  return restoreOnlineBackup(key, blob);
}

export async function deleteOnlineBackup(key: string, baseUrl: string): Promise<void> {
  const parsed = parseOnlineBackupKey(key);
  const deleteSecret = deriveDeleteSecret(parsed).toString("base64url");
  const response = await request(endpoint(baseUrl, "/v1/backups/delete"), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ id: parsed.id, deleteSecret })
  });
  if (response.status !== 204) {
    await readLimitedText(response);
    throw new Error(response.status === 404 ? "Online-Sicherung wurde nicht gefunden" : "Online-Sicherung konnte nicht gelöscht werden");
  }
}
