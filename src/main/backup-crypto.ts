import crypto from "node:crypto";

const LEGACY_APP_KEY_MATERIAL = "MDD-v2-backup-aes256gcm-2026";
const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const PREFIX = Buffer.from("MDD");
const LEGACY_MAGIC = Buffer.from("MDD1");
const MAGIC = Buffer.from("MDD2");
const LEGACY_HEADER_LENGTH = LEGACY_MAGIC.length + IV_LENGTH + AUTH_TAG_LENGTH;
const HEADER_LENGTH = MAGIC.length + SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH;
const DECRYPTION_ERROR = "Backup-Datei konnte nicht entschlüsselt werden";

function deriveLegacyKey(): Buffer {
  return crypto.createHash("sha256").update(LEGACY_APP_KEY_MATERIAL).digest();
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passphrase, salt, KEY_LENGTH);
}

function decryptAuthenticated(
  ciphertext: Buffer,
  key: Buffer,
  iv: Buffer,
  authTag: Buffer,
  authenticatedData?: Buffer,
  errorMessage = "Backup-Datei ist beschädigt oder konnte nicht authentifiziert werden"
): string {
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    if (authenticatedData) {
      decipher.setAAD(authenticatedData);
    }
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error(errorMessage);
  }
}

function decryptLegacyBackup(data: Buffer): string {
  if (data.length < LEGACY_HEADER_LENGTH) {
    throw new Error("Backup-Datei zu kurz oder ungültig");
  }
  const ivStart = LEGACY_MAGIC.length;
  const authTagStart = ivStart + IV_LENGTH;
  const ciphertextStart = authTagStart + AUTH_TAG_LENGTH;
  return decryptAuthenticated(
    data.subarray(ciphertextStart),
    deriveLegacyKey(),
    data.subarray(ivStart, authTagStart),
    data.subarray(authTagStart, ciphertextStart)
  );
}

function decryptCurrentBackup(data: Buffer, passphrase?: string): string {
  if (data.length < HEADER_LENGTH) {
    throw new Error("Backup-Datei zu kurz oder ungültig");
  }
  if (typeof passphrase !== "string" || passphrase.trim().length === 0) {
    throw new Error(DECRYPTION_ERROR);
  }
  const saltStart = MAGIC.length;
  const ivStart = saltStart + SALT_LENGTH;
  const authTagStart = ivStart + IV_LENGTH;
  const ciphertextStart = authTagStart + AUTH_TAG_LENGTH;
  const salt = data.subarray(saltStart, ivStart);
  const iv = data.subarray(ivStart, authTagStart);
  return decryptAuthenticated(
    data.subarray(ciphertextStart),
    deriveKey(passphrase, salt),
    iv,
    data.subarray(authTagStart, ciphertextStart),
    data.subarray(0, authTagStart),
    DECRYPTION_ERROR
  );
}

export function encryptBackup(plaintext: string, passphrase: string): Buffer {
  if (typeof passphrase !== "string" || passphrase.trim().length === 0) {
    throw new Error("Backup-Passphrase erforderlich");
  }
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  cipher.setAAD(Buffer.concat([MAGIC, salt, iv]));
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), encrypted]);
}

export function isMdd2Backup(data: Buffer): boolean {
  return data.length >= MAGIC.length && data.subarray(0, MAGIC.length).equals(MAGIC);
}

export function decryptBackup(data: Buffer, passphrase?: string): string {
  if (data.length < MAGIC.length) {
    throw new Error("Backup-Datei zu kurz oder ungültig");
  }
  const magic = data.subarray(0, MAGIC.length);
  if (magic.equals(MAGIC)) {
    return decryptCurrentBackup(data, passphrase);
  }
  if (magic.equals(LEGACY_MAGIC)) {
    return decryptLegacyBackup(data);
  }
  if (magic.subarray(0, PREFIX.length).equals(PREFIX)) {
    throw new Error("Nicht unterstützte MDD-Backup-Version");
  }
  throw new Error("Keine gültige MDD-Backup-Datei (falsche Signatur)");
}
