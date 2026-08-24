import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/main/constants";
import { logger } from "../src/main/logger";
import { collectAccountStatusRedactionValues, sanitizeAccountStatusText } from "../src/main/account-status-sanitizer";
import {
  configureCredentialProtector,
  CredentialProtector,
  needsPersistedSettingsRewrite,
  protectPersistedSettings,
  projectSettingsForRenderer,
  restorePersistedSettings
} from "../src/main/credential-protection";

function createProtector(available = true): CredentialProtector {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(value, "utf8").reverse(),
    decryptString: (value) => Buffer.from(value).reverse().toString("utf8")
  };
}

describe("credential protection", () => {
  beforeEach(() => {
    configureCredentialProtector(createProtector());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("protects remembered provider values and restores them for the main process", () => {
    const input = {
      ...defaultSettings(),
      rememberToken: true,
      token: "value-to-protect",
      realDebridApiTokens: "first-real-debrid-token\nsecond-real-debrid-token",
      megaLogin: "account@example.invalid",
      megaPassword: "password-value"
    };

    const persisted = protectPersistedSettings(input);

    expect(persisted.token).not.toBe(input.token);
    expect(persisted.realDebridApiTokens).not.toBe(input.realDebridApiTokens);
    expect(persisted.megaLogin).not.toBe(input.megaLogin);
    expect(JSON.stringify(persisted)).not.toContain(input.token);
    expect(JSON.stringify(persisted)).not.toContain("first-real-debrid-token");
    expect(restorePersistedSettings(persisted)).toMatchObject({
      token: input.token,
      realDebridApiTokens: input.realDebridApiTokens,
      megaLogin: input.megaLogin,
      megaPassword: input.megaPassword
    });
  });

  it("protects, restores, clears and redacts the Deepbrid API key", () => {
    const key = "fixture-deepbrid-protection-key-3cD5";
    const input = { ...defaultSettings(), rememberToken: true, deepbridApiKey: key };
    const persisted = protectPersistedSettings(input);

    expect(JSON.stringify(persisted)).not.toContain(key);
    expect(restorePersistedSettings(persisted).deepbridApiKey).toBe(key);
    expect(projectSettingsForRenderer(input).deepbridApiKey).toBe("••••••••");
    expect(protectPersistedSettings({ ...input, rememberToken: false }).deepbridApiKey).toBe("");

    const redactions = collectAccountStatusRedactionValues(input);
    expect(sanitizeAccountStatusText(`Deepbrid api_key=${key}`, redactions)).not.toContain(key);
  });

  it("requires a persisted settings rewrite only while the Deepbrid key is unprotected", () => {
    const input = {
      ...defaultSettings(),
      rememberToken: true,
      deepbridApiKey: "fixture-deepbrid-rewrite-key-6rS7"
    };

    expect(needsPersistedSettingsRewrite(input)).toBe(true);
    expect(needsPersistedSettingsRewrite(protectPersistedSettings(input))).toBe(false);
  });

  it("accepts plaintext values once so existing settings can be migrated", () => {
    const input = {
      ...defaultSettings(),
      rememberToken: true,
      token: "legacy-value"
    };

    expect(restorePersistedSettings(input).token).toBe(input.token);
    expect(protectPersistedSettings(restorePersistedSettings(input)).token).not.toBe(input.token);
  });

  it("protects plaintext credentials that begin with the legacy marker text", () => {
    const input = {
      ...defaultSettings(),
      rememberToken: true,
      token: "mdd-safe-storage:v1:literal-credential"
    };

    const persisted = protectPersistedSettings(input);

    expect(persisted.token).not.toBe(input.token);
    expect(JSON.stringify(persisted)).not.toContain(input.token);
    expect(restorePersistedSettings(persisted).token).toBe(input.token);
  });

  it("reports encryption failures without logging credential data", () => {
    const value = "credential-value-not-for-logs";
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    configureCredentialProtector({
      isEncryptionAvailable: () => true,
      encryptString: () => { throw new Error("encryption failed"); },
      decryptString: () => ""
    });

    const persisted = protectPersistedSettings({ ...defaultSettings(), token: value });

    expect(persisted.token).toBe("");
    expect(warn).toHaveBeenCalledWith("Credential-Verschlüsselung fehlgeschlagen: token");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(value);
  });

  it("reports decryption failures without logging persisted data", () => {
    const persisted = protectPersistedSettings({ ...defaultSettings(), token: "value-to-encrypt" });
    const serialized = JSON.stringify(persisted.token);
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    configureCredentialProtector({
      isEncryptionAvailable: () => true,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => { throw new Error("decryption failed"); }
    });

    const restored = restorePersistedSettings(persisted);

    expect(restored.token).toBe("");
    expect(warn).toHaveBeenCalledWith("Credential-Entschlüsselung fehlgeschlagen: token");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(serialized);
  });

  it("does not persist provider values when encryption is unavailable", () => {
    configureCredentialProtector(createProtector(false));
    const persisted = protectPersistedSettings({
      ...defaultSettings(),
      rememberToken: true,
      token: "ephemeral-value"
    });

    expect(persisted.token).toBe("");
  });

  it("removes persisted provider values when remembering is disabled", () => {
    const persisted = protectPersistedSettings({
      ...defaultSettings(),
      rememberToken: false,
      token: "ephemeral-value",
      megaLogin: "account@example.invalid",
      megaPassword: "password-value"
    });

    expect(persisted.token).toBe("");
    expect(persisted.megaLogin).toBe("");
    expect(persisted.megaPassword).toBe("");
  });

  it("projects only masked presence metadata into renderer settings", () => {
    const input = {
      ...defaultSettings(),
      rememberToken: true,
      token: "value-to-protect",
      realDebridApiTokens: "pool-value-to-protect",
      megaDebridApiCredentials: "account@example.invalid:password-value",
      debridLinkApiKeys: "key-value"
    };

    const projected = projectSettingsForRenderer(input);
    const serialized = JSON.stringify(projected);

    expect(serialized).not.toContain(input.token);
    expect(serialized).not.toContain(input.realDebridApiTokens);
    expect(serialized).not.toContain("account@example.invalid");
    expect(serialized).not.toContain("password-value");
    expect(serialized).not.toContain("key-value");
    expect(projected.token).not.toBe("");
    expect(projected.realDebridApiTokens).not.toBe("");
    expect(projected.megaDebridApiCredentials).not.toBe("");
    expect(projected.debridLinkApiKeys).not.toBe("");
  });

  it("redacts every Real-Debrid pool token from account status text", () => {
    const settings = {
      ...defaultSettings(),
      realDebridApiTokens: "first-private-token\nsecond-private-token"
    };
    const redactions = collectAccountStatusRedactionValues(settings);
    const sanitized = sanitizeAccountStatusText(
      "Unrestrict first-private-token schlug fehl; Fallback second-private-token ebenfalls",
      redactions
    );

    expect(sanitized).not.toContain("first-private-token");
    expect(sanitized).not.toContain("second-private-token");
  });
});
