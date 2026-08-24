import { AppSettings } from "../shared/types";
import { logger } from "./logger";

export interface CredentialProtector {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

const MASKED_CREDENTIAL = "••••••••";
const CREDENTIAL_KEYS = [
  "token",
  "realDebridApiTokens",
  "megaLogin",
  "megaPassword",
  "megaCredentials",
  "megaDebridApiCredentials",
  "megaDebridWebCredentials",
  "bestToken",
  "allDebridToken",
  "deepbridApiKey",
  "ddownloadLogin",
  "ddownloadPassword",
  "oneFichierApiKey",
  "debridLinkApiKeys",
  "linkSnappyLogin",
  "linkSnappyPassword"
] as const satisfies readonly (keyof AppSettings)[];
type CredentialKey = typeof CREDENTIAL_KEYS[number];

interface PersistedCredentialEnvelope {
  type: "safe-storage";
  version: 1;
  payload: string;
}

export type PersistedAppSettings = Omit<AppSettings, CredentialKey> & {
  [K in CredentialKey]: string | PersistedCredentialEnvelope;
};

let credentialProtector: CredentialProtector = {
  isEncryptionAvailable: () => false,
  encryptString: () => Buffer.alloc(0),
  decryptString: () => ""
};

export function configureCredentialProtector(protector: CredentialProtector): void {
  credentialProtector = protector;
}

function isEncryptionAvailable(): boolean {
  try {
    return credentialProtector.isEncryptionAvailable();
  } catch {
    logger.warn("Credential-Verschlüsselungsverfügbarkeit konnte nicht ermittelt werden");
    return false;
  }
}

function isPersistedCredentialEnvelope(value: unknown): value is PersistedCredentialEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const envelope = value as Partial<PersistedCredentialEnvelope>;
  return envelope.type === "safe-storage"
    && envelope.version === 1
    && typeof envelope.payload === "string"
    && envelope.payload.length > 0;
}

function clearCredentials(settings: AppSettings): AppSettings {
  const cleared = { ...settings };
  for (const key of CREDENTIAL_KEYS) {
    cleared[key] = "";
  }
  return cleared;
}

export function protectPersistedSettings(settings: AppSettings): PersistedAppSettings {
  if (settings.rememberToken === false || !isEncryptionAvailable()) {
    return clearCredentials(settings);
  }

  const protectedSettings = { ...settings } as PersistedAppSettings;
  for (const key of CREDENTIAL_KEYS) {
    const value = typeof settings[key] === "string" ? settings[key] : "";
    if (!value) {
      protectedSettings[key] = value;
      continue;
    }
    try {
      protectedSettings[key] = {
        type: "safe-storage",
        version: 1,
        payload: credentialProtector.encryptString(value).toString("base64")
      };
    } catch {
      protectedSettings[key] = "";
      logger.warn(`Credential-Verschlüsselung fehlgeschlagen: ${key}`);
    }
  }
  return protectedSettings;
}

export function restorePersistedSettings(settings: AppSettings | PersistedAppSettings): AppSettings {
  if (settings.rememberToken === false) {
    return clearCredentials(settings as AppSettings);
  }

  const restored = { ...settings } as AppSettings;
  for (const key of CREDENTIAL_KEYS) {
    const value = settings[key];
    if (typeof value === "string") {
      restored[key] = value;
      continue;
    }
    if (!isPersistedCredentialEnvelope(value)) {
      restored[key] = "";
      continue;
    }
    if (!isEncryptionAvailable()) {
      restored[key] = "";
      continue;
    }
    try {
      restored[key] = credentialProtector.decryptString(Buffer.from(value.payload, "base64"));
    } catch {
      restored[key] = "";
      logger.warn(`Credential-Entschlüsselung fehlgeschlagen: ${key}`);
    }
  }
  return restored;
}

export function needsPersistedSettingsRewrite(settings: AppSettings | PersistedAppSettings): boolean {
  const values = CREDENTIAL_KEYS.map((key) => settings[key]).filter((value) => {
    return typeof value === "string" ? value.length > 0 : value !== null && value !== undefined;
  });
  if (values.length === 0) {
    return false;
  }
  if (settings.rememberToken === false || !isEncryptionAvailable()) {
    return true;
  }
  return values.some((value) => !isPersistedCredentialEnvelope(value));
}

export function projectSettingsForRenderer(settings: AppSettings): AppSettings {
  const projected = { ...settings };
  for (const key of CREDENTIAL_KEYS) {
    projected[key] = settings[key] ? MASKED_CREDENTIAL : "";
  }
  return projected;
}
