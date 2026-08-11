import { AppSettings } from "../shared/types";

export interface CredentialProtector {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

const PROTECTED_VALUE_PREFIX = "mdd-safe-storage:v1:";
const MASKED_CREDENTIAL = "••••••••";
const CREDENTIAL_KEYS = [
  "token",
  "megaLogin",
  "megaPassword",
  "megaCredentials",
  "megaDebridApiCredentials",
  "megaDebridWebCredentials",
  "bestToken",
  "allDebridToken",
  "ddownloadLogin",
  "ddownloadPassword",
  "oneFichierApiKey",
  "debridLinkApiKeys",
  "linkSnappyLogin",
  "linkSnappyPassword"
] as const satisfies readonly (keyof AppSettings)[];

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
    return false;
  }
}

function isProtectedValue(value: string): boolean {
  return value.startsWith(PROTECTED_VALUE_PREFIX);
}

function clearCredentials(settings: AppSettings): AppSettings {
  const cleared = { ...settings };
  for (const key of CREDENTIAL_KEYS) {
    cleared[key] = "";
  }
  return cleared;
}

export function protectPersistedSettings(settings: AppSettings): AppSettings {
  if (settings.rememberToken === false || !isEncryptionAvailable()) {
    return clearCredentials(settings);
  }

  const protectedSettings = { ...settings };
  for (const key of CREDENTIAL_KEYS) {
    const value = typeof settings[key] === "string" ? settings[key] : "";
    if (!value || isProtectedValue(value)) {
      protectedSettings[key] = value;
      continue;
    }
    try {
      protectedSettings[key] = `${PROTECTED_VALUE_PREFIX}${credentialProtector.encryptString(value).toString("base64")}`;
    } catch {
      protectedSettings[key] = "";
    }
  }
  return protectedSettings;
}

export function restorePersistedSettings(settings: AppSettings): AppSettings {
  if (settings.rememberToken === false) {
    return clearCredentials(settings);
  }

  const restored = { ...settings };
  for (const key of CREDENTIAL_KEYS) {
    const value = typeof settings[key] === "string" ? settings[key] : "";
    if (!isProtectedValue(value)) {
      restored[key] = value;
      continue;
    }
    if (!isEncryptionAvailable()) {
      restored[key] = "";
      continue;
    }
    try {
      restored[key] = credentialProtector.decryptString(Buffer.from(value.slice(PROTECTED_VALUE_PREFIX.length), "base64"));
    } catch {
      restored[key] = "";
    }
  }
  return restored;
}

export function needsPersistedSettingsRewrite(settings: AppSettings): boolean {
  const values = CREDENTIAL_KEYS.map((key) => typeof settings[key] === "string" ? settings[key] : "").filter(Boolean);
  if (values.length === 0) {
    return false;
  }
  if (settings.rememberToken === false || !isEncryptionAvailable()) {
    return true;
  }
  return values.some((value) => !isProtectedValue(value));
}

export function projectSettingsForRenderer(settings: AppSettings): AppSettings {
  const projected = { ...settings };
  for (const key of CREDENTIAL_KEYS) {
    projected[key] = settings[key] ? MASKED_CREDENTIAL : "";
  }
  return projected;
}
