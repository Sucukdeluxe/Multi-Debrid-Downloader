import { describe, expect, it } from "vitest";
import { encryptBackup, decryptBackup, isMdd2Backup } from "../src/main/backup-crypto";

const PASSPHRASE = "test-only backup passphrase";

describe("backup-crypto", () => {
  it("encrypts and decrypts a round-trip correctly", () => {
    const original = JSON.stringify({
      version: 2,
      settings: { outputDir: "C:\\Downloads" },
      session: { packages: {}, items: {} },
      history: [{ id: "h1", name: "Test" }]
    });

    const encrypted = encryptBackup(original, PASSPHRASE);
    const decrypted = decryptBackup(encrypted, PASSPHRASE);
    expect(decrypted).toBe(original);
  });

  it("produces binary output that is not plaintext readable", () => {
    const sensitiveValue = "value-that-must-not-be-readable";
    const plaintext = JSON.stringify({ settings: { value: sensitiveValue } });
    const encrypted = encryptBackup(plaintext, PASSPHRASE);

    expect(encrypted.toString("utf8")).not.toContain(sensitiveValue);
    expect(encrypted.toString("latin1")).not.toContain(sensitiveValue);
  });

  it("writes the MDD2 backup format", () => {
    const encrypted = encryptBackup("test", PASSPHRASE);
    expect(encrypted.subarray(0, 4).toString("utf8")).toBe("MDD2");
    expect(encrypted.length).toBeGreaterThan(48);
  });

  it("reads the legacy backup format for migration", () => {
    const legacy = Buffer.from("TUREMQcHBwcHBwcHBwcHB7h4ood1DE8Wc+BPgzE6EYdio3HAN/UB1Mru6Fmvtw==", "base64");
    expect(decryptBackup(legacy)).toBe("legacy payload");
    expect(decryptBackup(legacy, "ignored test passphrase")).toBe("legacy payload");
  });

  it("detects only MDD2 backups as passphrase protected", () => {
    const current = encryptBackup("test", PASSPHRASE);
    const legacy = Buffer.from("TUREMQcHBwcHBwcHBwcHB7h4ood1DE8Wc+BPgzE6EYdio3HAN/UB1Mru6Fmvtw==", "base64");
    expect(isMdd2Backup(current)).toBe(true);
    expect(isMdd2Backup(legacy)).toBe(false);
    expect(isMdd2Backup(Buffer.from('{"version":2}', "utf8"))).toBe(false);
  });

  it("uses a new salt and IV for every encryption", () => {
    const plaintext = "same input data";
    const a = encryptBackup(plaintext, PASSPHRASE);
    const b = encryptBackup(plaintext, PASSPHRASE);
    expect(a.equals(b)).toBe(false);
    expect(a.subarray(4, 20).equals(b.subarray(4, 20))).toBe(false);
    expect(a.subarray(20, 32).equals(b.subarray(20, 32))).toBe(false);
    expect(decryptBackup(a, PASSPHRASE)).toBe(plaintext);
    expect(decryptBackup(b, PASSPHRASE)).toBe(plaintext);
  });

  it("requires a non-empty passphrase for encryption", () => {
    expect(() => encryptBackup("test", "")).toThrow(/Passphrase/);
    expect(() => encryptBackup("test", "   ")).toThrow(/Passphrase/);
  });

  it("uses the same controlled error for missing and wrong MDD2 passphrases", () => {
    const encrypted = encryptBackup("test data", PASSPHRASE);
    expect(() => decryptBackup(encrypted)).toThrow("Backup-Datei konnte nicht entschlüsselt werden");
    expect(() => decryptBackup(encrypted, "   ")).toThrow("Backup-Datei konnte nicht entschlüsselt werden");
    expect(() => decryptBackup(encrypted, "wrong test passphrase")).toThrow("Backup-Datei konnte nicht entschlüsselt werden");
  });

  it("rejects a truncated MDD2 header", () => {
    const encrypted = encryptBackup("test data", PASSPHRASE);
    expect(() => decryptBackup(encrypted.subarray(0, 47), PASSPHRASE)).toThrow(/zu kurz|ungültig/);
  });

  it("rejects a one-byte-short authenticated ciphertext", () => {
    const encrypted = encryptBackup("x", PASSPHRASE);
    expect(() => decryptBackup(encrypted.subarray(0, -1), PASSPHRASE)).toThrow("Backup-Datei konnte nicht entschlüsselt werden");
  });

  it("accepts an authenticated empty ciphertext", () => {
    const encrypted = encryptBackup("", PASSPHRASE);
    expect(encrypted).toHaveLength(48);
    expect(decryptBackup(encrypted, PASSPHRASE)).toBe("");
  });

  it("rejects a truncated MDD1 backup", () => {
    const legacy = Buffer.from("TUREMQcHBwcHBwcHBwcHB7h4ood1DE8Wc+BPgzE6EYdio3HAN/UB1Mru6Fmvtw==", "base64");
    expect(() => decryptBackup(legacy.subarray(0, 31))).toThrow(/zu kurz|ungültig/);
  });

  it.each([
    ["salt", 4],
    ["IV", 20],
    ["authentication tag", 32],
    ["ciphertext", 48]
  ])("rejects a modified %s", (_part, offset) => {
    const encrypted = encryptBackup("test data", PASSPHRASE);
    const corrupted = Buffer.from(encrypted);
    corrupted[offset] ^= 0xff;
    expect(() => decryptBackup(corrupted, PASSPHRASE)).toThrow("Backup-Datei konnte nicht entschlüsselt werden");
  });

  it("rejects modified legacy authentication data", () => {
    const legacy = Buffer.from("TUREMQcHBwcHBwcHBwcHB7h4ood1DE8Wc+BPgzE6EYdio3HAN/UB1Mru6Fmvtw==", "base64");
    legacy[16] ^= 0xff;
    expect(() => decryptBackup(legacy)).toThrow(/beschädigt|authentifiziert/);
  });

  it("rejects unsupported backup versions", () => {
    const unsupported = Buffer.concat([Buffer.from("MDD3"), Buffer.alloc(44)]);
    expect(() => decryptBackup(unsupported)).toThrow(/Version/);
  });

  it("throws on wrong magic bytes", () => {
    const encrypted = encryptBackup("test data", PASSPHRASE);
    const wrongMagic = Buffer.from(encrypted);
    wrongMagic[0] = 0x00;
    expect(() => decryptBackup(wrongMagic)).toThrow(/Signatur/);
  });

  it("throws on empty buffer", () => {
    expect(() => decryptBackup(Buffer.alloc(0))).toThrow();
  });

  it("handles large payloads", () => {
    const large = JSON.stringify({ data: "x".repeat(1_000_000) });
    const encrypted = encryptBackup(large, PASSPHRASE);
    const decrypted = decryptBackup(encrypted, PASSPHRASE);
    expect(decrypted).toBe(large);
  });

  it("handles unicode content", () => {
    const unicode = JSON.stringify({ name: "Ünïcödé 日本語 🎉", path: "C:\\Benutzer\\Ö" });
    const encrypted = encryptBackup(unicode, PASSPHRASE);
    expect(decryptBackup(encrypted, PASSPHRASE)).toBe(unicode);
  });

  it("handles empty string round-trip", () => {
    const encrypted = encryptBackup("", PASSPHRASE);
    expect(decryptBackup(encrypted, PASSPHRASE)).toBe("");
  });
});
