import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import type { AppSettings } from "../src/shared/types";
import { createBackupServer } from "../services/backup-api/src/server.mjs";
import { recoverOnlineKey } from "../services/backup-api/src/recovery.mjs";
import { createOnlineBackup, deleteOnlineBackup, downloadOnlineBackup, uploadOnlineBackup } from "../src/main/online-backup";

const servers: ReturnType<typeof createBackupServer>[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(directories.splice(0).map((directory) => fs.promises.rm(directory, { recursive: true, force: true })));
});

describe("online backup client and service", () => {
  it("rejects private or weak recovery keys in the service configuration", () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
    expect(() => createBackupServer({ rootDir: "unused", recoveryPublicKey: pair.privateKey })).toThrow(/public/);
    expect(() => createBackupServer({ rootDir: "unused", recoveryPublicKey: pair.publicKey })).toThrow(/3072/);
  });

  it("stores only an encrypted recovery key and recovers it with the separate admin key", async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "mdd-recovery-"));
    directories.push(directory);
    const rootDir = path.join(directory, "data");
    const pair = generateKeyPairSync("rsa", {
      modulusLength: 3072,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });
    const server = createBackupServer({ rootDir, recoveryPublicKey: pair.publicKey });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing address");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const settings = { token: "recovery-secret", outputDir: "D:\\Downloads" } as AppSettings;
    const created = createOnlineBackup(settings, "2.0.90");
    await uploadOnlineBackup(created.record, baseUrl, created.key);
    const raw = await fs.promises.readFile(path.join(rootDir, `${created.record.id}.json`), "utf8");
    expect(raw).not.toContain(created.key);
    expect(raw).not.toContain("recovery-secret");
    expect(raw).not.toContain(pair.privateKey);
    const stored = { ...JSON.parse(raw), id: created.record.id };
    expect(recoverOnlineKey(stored, pair.privateKey)).toBe(created.key);
    expect(() => recoverOnlineKey({ ...stored, blob: stored.blob + "A" }, pair.privateKey)).toThrow();
    expect(() => recoverOnlineKey({ ...stored, id: "AAAAAAAAAAAAAAAAAAAAAA" }, pair.privateKey)).toThrow();
    expect(() => recoverOnlineKey({ ...stored, recovery: undefined }, pair.privateKey)).toThrow();
    const wrongPair = generateKeyPairSync("rsa", { modulusLength: 3072, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
    expect(() => recoverOnlineKey(stored, wrongPair.privateKey)).toThrow();
    const corrupted = { ...stored.recovery, ciphertext: (stored.recovery.ciphertext[0] === "A" ? "B" : "A") + stored.recovery.ciphertext.slice(1) };
    expect(() => recoverOnlineKey({ ...stored, recovery: corrupted }, pair.privateKey)).toThrow();
    const restore = await fetch(`${baseUrl}/v1/backups/restore`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: stored.id }) });
    expect(await restore.json()).toEqual({ blob: stored.blob });
    expect((await downloadOnlineBackup(created.key, baseUrl)).settings).toEqual(settings);
    expect((await fetch(`${baseUrl}/v1/backups/recover`, { method: "POST" })).status).toBe(404);
    const rejected = await fetch(`${baseUrl}/v1/backups`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...created.record, recovery: { ...stored.recovery, keyId: "wrong-key" } }) });
    expect(rejected.status).toBe(400);
    const privateFile = path.join(directory, "private.pem");
    const outputFile = path.join(directory, "recovered.txt");
    await fs.promises.writeFile(privateFile, pair.privateKey, { mode: 0o600 });
    const cli = path.resolve("services/backup-api/src/recovery-admin.mjs");
    const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
    const listed = run("list", rootDir);
    expect(listed.status).toBe(0);
    expect(JSON.parse(listed.stdout).id).toBe(stored.id);
    expect(JSON.parse(listed.stdout).sourceIp).toBe("127.0.0.1");
    expect(listed.stdout).not.toContain(created.key);
    const recovered = run("recover", rootDir, stored.id, privateFile, outputFile);
    expect(recovered.status).toBe(0);
    expect(recovered.stdout + recovered.stderr).not.toContain(created.key);
    expect((await fs.promises.readFile(outputFile, "utf8")).trim()).toBe(created.key);
    const reportFile = path.join(directory, "report.txt");
    const report = run("recover", rootDir, stored.id, privateFile, reportFile, "--with-metadata");
    expect(report.status).toBe(0);
    expect(report.stdout + report.stderr).not.toContain(created.key);
    expect(await fs.promises.readFile(reportFile, "utf8")).toMatch(new RegExp(`^\\d{2}\\.\\d{2}\\.\\d{4} - \\d{2}:\\d{2} \\| IP: 127\\.0\\.0\\.1 \\| Schlüssel: ${created.key}\\n$`));
    const legacyFile = path.join(directory, "legacy-report.txt");
    const legacyRecord = { ...JSON.parse(raw) };
    delete legacyRecord.sourceIp;
    await fs.promises.writeFile(path.join(rootDir, `${stored.id}.json`), JSON.stringify(legacyRecord));
    expect(run("recover", rootDir, stored.id, privateFile, legacyFile, "--with-metadata").status).toBe(0);
    expect(await fs.promises.readFile(legacyFile, "utf8")).toContain(` | IP: unbekannt | Schlüssel: ${created.key}`);
    expect(run("recover", rootDir, stored.id, privateFile, outputFile).status).toBe(1);
    expect(run("recover", rootDir, "../invalid", privateFile, outputFile).status).toBe(1);
    expect(run("recover", rootDir, stored.id, privateFile, path.join(rootDir, "leaked.txt")).status).toBe(1);
    const keyDir = path.join(directory, "new-keys");
    expect(run("init", keyDir).status).toBe(0);
    const initialPrivate = await fs.promises.readFile(path.join(keyDir, "private.pem"), "utf8");
    expect(run("init", keyDir).status).toBe(1);
    expect(await fs.promises.readFile(path.join(keyDir, "private.pem"), "utf8")).toBe(initialPrivate);
    await deleteOnlineBackup(created.key, baseUrl);
    expect(fs.existsSync(path.join(rootDir, `${stored.id}.json`))).toBe(false);
  });

  it("does not silently upload without recovery when the service is not configured", async () => {
    const rootDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "mdd-no-recovery-"));
    directories.push(rootDir);
    const server = createBackupServer({ rootDir });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing address");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const created = createOnlineBackup({ token: "secret" } as AppSettings, "2.0.90");
    await expect(uploadOnlineBackup(created.record, baseUrl, created.key)).rejects.toThrow(/nicht eingerichtet/);
    expect(await fs.promises.readdir(rootDir)).toEqual([]);
    await uploadOnlineBackup(created.record, baseUrl);
    expect((await downloadOnlineBackup(created.key, baseUrl)).settings.token).toBe("secret");
  });

  it("keeps every export independently restorable and deletes only the selected snapshot", async () => {
    const rootDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "mdd-online-backup-"));
    directories.push(rootDir);
    const server = createBackupServer({ rootDir, rateLimit: { max: 20, windowMs: 60_000 } });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Testserver nicht verfügbar");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const firstSettings = { token: "first-secret", outputDir: "D:\\Erster Export" } as AppSettings;
    const secondSettings = { token: "second-secret", outputDir: "E:\\Zweiter Export" } as AppSettings;
    const first = createOnlineBackup(firstSettings, "2.0.0");
    const second = createOnlineBackup(secondSettings, "2.0.0");

    await uploadOnlineBackup(first.record, baseUrl);
    await uploadOnlineBackup(second.record, baseUrl);

    expect((await downloadOnlineBackup(first.key, baseUrl)).settings).toEqual(firstSettings);
    expect((await downloadOnlineBackup(second.key, baseUrl)).settings).toEqual(secondSettings);

    await deleteOnlineBackup(second.key, baseUrl);

    expect((await downloadOnlineBackup(first.key, baseUrl)).settings).toEqual(firstSettings);
    await expect(downloadOnlineBackup(second.key, baseUrl)).rejects.toThrow(/nicht gefunden/i);
  });
});
