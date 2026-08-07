import http from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import type { AppSettings } from "../src/shared/types";
import {
  createOnlineBackup,
  deleteOnlineBackup,
  downloadOnlineBackup,
  parseOnlineBackupKey,
  restoreOnlineBackup,
  uploadOnlineBackup
} from "../src/main/online-backup";

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function settings(): AppSettings {
  return {
    token: "rd-secret-token",
    megaLogin: "backup-user",
    megaPassword: "backup-password",
    outputDir: "D:\\Downloads",
    backupIncludeDownloads: true
  } as AppSettings;
}

describe("online backup key", () => {
  it("creates a compact key and restores every immutable settings snapshot independently", () => {
    const first = createOnlineBackup(settings(), "2.0.0", "2026-08-07T00:00:00.000Z");
    const second = createOnlineBackup({ ...settings(), outputDir: "E:\\Neu" }, "2.0.0", "2026-08-08T00:00:00.000Z");

    expect(first.key).toMatch(/^MDD2-[A-Za-z0-9_-]{70}$/);
    expect(first.key).toHaveLength(75);
    expect(second.key).not.toBe(first.key);
    expect(restoreOnlineBackup(first.key, first.record.blob).settings).toEqual(settings());
    expect(restoreOnlineBackup(second.key, second.record.blob).settings.outputDir).toBe("E:\\Neu");
  });

  it("never places credentials or the decryption secret in the server record", () => {
    const created = createOnlineBackup(settings(), "2.0.0", "2026-08-07T00:00:00.000Z");
    const serialized = JSON.stringify(created.record);
    const parsed = parseOnlineBackupKey(created.key);

    expect(serialized).not.toContain("rd-secret-token");
    expect(serialized).not.toContain("backup-password");
    expect(serialized).not.toContain(parsed.masterKey.toString("base64url"));
    expect(Object.keys(created.record).sort()).toEqual(["blob", "deleteVerifier", "id"]);
  });

  it("rejects corrupted keys and encrypted payloads before returning settings", () => {
    const created = createOnlineBackup(settings(), "2.0.0", "2026-08-07T00:00:00.000Z");
    const keyTail = created.key.endsWith("A") ? "B" : "A";
    const corruptedKey = `${created.key.slice(0, -1)}${keyTail}`;
    const blobTail = created.record.blob.endsWith("A") ? "B" : "A";
    const corruptedBlob = `${created.record.blob.slice(0, -1)}${blobTail}`;

    expect(() => parseOnlineBackupKey(corruptedKey)).toThrow(/Schlüssel/i);
    expect(() => restoreOnlineBackup(created.key, corruptedBlob)).toThrow(/entschlüsselt|beschädigt/i);
  });

  it("rejects plaintext that cannot be restored before returning a key", () => {
    const oversized = { ...settings(), archivePasswordList: "x".repeat(600_000) };

    expect(() => createOnlineBackup(oversized, "2.0.0")).toThrow(/zu groß/i);
  });
});

describe("online backup transport", () => {
  it("never reflects service response bodies into client errors", async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "internal", leaked: "server-secret-value" }));
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Testserver nicht verfügbar");
    const created = createOnlineBackup(settings(), "2.0.0");

    await expect(uploadOnlineBackup(created.record, `http://127.0.0.1:${address.port}`)).rejects.not.toThrow(/server-secret-value/);
  });

  it("uploads and downloads through the real HTTP contract without sending the master key", async () => {
    let stored: Record<string, string> | null = null;
    let deleteRequest: Record<string, string> | null = null;
    const requestedUrls: string[] = [];
    const server = http.createServer(async (request, response) => {
      requestedUrls.push(String(request.url || ""));
      if (request.method === "POST" && request.url === "/v1/backups") {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        stored = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, string>;
        response.writeHead(201, { "content-type": "application/json" });
        response.end(JSON.stringify({ created: true }));
        return;
      }
      if (request.method === "POST" && stored && request.url === "/v1/backups/restore") {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const restoreRequest = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, string>;
        if (restoreRequest.id !== stored.id) throw new Error("Falsche Restore-ID");
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ blob: stored.blob }));
        return;
      }
      if (request.method === "POST" && stored && request.url === "/v1/backups/delete") {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        deleteRequest = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, string>;
        response.writeHead(204);
        response.end();
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Nicht gefunden" }));
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Testserver nicht verfügbar");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const created = createOnlineBackup(settings(), "2.0.0", "2026-08-07T00:00:00.000Z");

    await uploadOnlineBackup(created.record, baseUrl);
    const restored = await downloadOnlineBackup(created.key, baseUrl);
    await deleteOnlineBackup(created.key, baseUrl);

    expect(restored.settings).toEqual(settings());
    expect(stored).not.toBeNull();
    const uploadedRecord = stored as unknown as { id: string; blob: string; deleteVerifier: string };
    const capturedDeleteRequest = deleteRequest as unknown as Record<string, string>;
    expect(JSON.stringify(uploadedRecord)).not.toContain(parseOnlineBackupKey(created.key).masterKey.toString("base64url"));
    expect(capturedDeleteRequest.deleteSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(requestedUrls).toEqual(["/v1/backups", "/v1/backups/restore", "/v1/backups/delete"]);
    expect(requestedUrls.join(" ")).not.toContain(uploadedRecord.id);
  });
});
