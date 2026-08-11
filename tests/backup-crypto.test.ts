import { describe, expect, it } from "vitest";
import { encryptBackup, decryptBackup } from "../src/main/backup-crypto";

describe("backup-crypto", () => {
  it("encrypts and decrypts a round-trip correctly", () => {
    const original = JSON.stringify({
      version: 2,
      settings: { outputDir: "C:\\Downloads" },
      session: { packages: {}, items: {} },
      history: [{ id: "h1", name: "Test" }]
    });

    const encrypted = encryptBackup(original);
    const decrypted = decryptBackup(encrypted);
    expect(decrypted).toBe(original);
  });

  it("produces binary output that is not plaintext readable", () => {
    const sensitiveValue = "value-that-must-not-be-readable";
    const plaintext = JSON.stringify({ settings: { value: sensitiveValue } });
    const encrypted = encryptBackup(plaintext);

    expect(encrypted.toString("utf8")).not.toContain(sensitiveValue);
    expect(encrypted.toString("latin1")).not.toContain(sensitiveValue);
  });

  it("writes the MDD2 backup format", () => {
    const encrypted = encryptBackup("test");
    expect(encrypted.subarray(0, 4).toString("utf8")).toBe("MDD2");
    expect(encrypted.length).toBeGreaterThan(48);
  });

  it("reads the legacy backup format for migration", () => {
    const legacy = Buffer.from("TUREMQcHBwcHBwcHBwcHB7h4ood1DE8Wc+BPgzE6EYdio3HAN/UB1Mru6Fmvtw==", "base64");
    expect(decryptBackup(legacy)).toBe("legacy payload");
  });

  it("uses a new salt and IV for every encryption", () => {
    const plaintext = "same input data";
    const a = encryptBackup(plaintext);
    const b = encryptBackup(plaintext);
    expect(a.equals(b)).toBe(false);
    expect(a.subarray(4, 20).equals(b.subarray(4, 20))).toBe(false);
    expect(a.subarray(20, 32).equals(b.subarray(20, 32))).toBe(false);
    expect(decryptBackup(a)).toBe(plaintext);
    expect(decryptBackup(b)).toBe(plaintext);
  });

  it("throws on truncated data", () => {
    const encrypted = encryptBackup("test data");
    expect(() => decryptBackup(encrypted.subarray(0, 47))).toThrow(/zu kurz|ungültig/);
  });

  it.each([
    ["salt", 4],
    ["IV", 20],
    ["authentication tag", 32],
    ["ciphertext", 48]
  ])("rejects a modified %s", (_part, offset) => {
    const encrypted = encryptBackup("test data");
    const corrupted = Buffer.from(encrypted);
    corrupted[offset] ^= 0xff;
    expect(() => decryptBackup(corrupted)).toThrow(/beschädigt|authentifiziert/);
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
    const encrypted = encryptBackup("test data");
    const wrongMagic = Buffer.from(encrypted);
    wrongMagic[0] = 0x00;
    expect(() => decryptBackup(wrongMagic)).toThrow(/Signatur/);
  });

  it("throws on empty buffer", () => {
    expect(() => decryptBackup(Buffer.alloc(0))).toThrow();
  });

  it("handles large payloads", () => {
    const large = JSON.stringify({ data: "x".repeat(1_000_000) });
    const encrypted = encryptBackup(large);
    const decrypted = decryptBackup(encrypted);
    expect(decrypted).toBe(large);
  });

  it("handles unicode content", () => {
    const unicode = JSON.stringify({ name: "Ünïcödé 日本語 🎉", path: "C:\\Benutzer\\Ö" });
    const encrypted = encryptBackup(unicode);
    expect(decryptBackup(encrypted)).toBe(unicode);
  });

  it("handles empty string round-trip", () => {
    const encrypted = encryptBackup("");
    expect(decryptBackup(encrypted)).toBe("");
  });
});
