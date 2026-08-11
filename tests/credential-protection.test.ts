import { beforeEach, describe, expect, it } from "vitest";
import { defaultSettings } from "../src/main/constants";
import {
  configureCredentialProtector,
  CredentialProtector,
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

  it("protects remembered provider values and restores them for the main process", () => {
    const input = {
      ...defaultSettings(),
      rememberToken: true,
      token: "value-to-protect",
      megaLogin: "account@example.invalid",
      megaPassword: "password-value"
    };

    const persisted = protectPersistedSettings(input);

    expect(persisted.token).not.toBe(input.token);
    expect(persisted.megaLogin).not.toBe(input.megaLogin);
    expect(JSON.stringify(persisted)).not.toContain(input.token);
    expect(restorePersistedSettings(persisted)).toMatchObject({
      token: input.token,
      megaLogin: input.megaLogin,
      megaPassword: input.megaPassword
    });
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
      megaDebridApiCredentials: "account@example.invalid:password-value",
      debridLinkApiKeys: "key-value"
    };

    const projected = projectSettingsForRenderer(input);
    const serialized = JSON.stringify(projected);

    expect(serialized).not.toContain(input.token);
    expect(serialized).not.toContain("account@example.invalid");
    expect(serialized).not.toContain("password-value");
    expect(serialized).not.toContain("key-value");
    expect(projected.token).not.toBe("");
    expect(projected.megaDebridApiCredentials).not.toBe("");
    expect(projected.debridLinkApiKeys).not.toBe("");
  });
});
