import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import type { AppSettings } from "../src/shared/types";
import { createBackupServer } from "../services/backup-api/src/server.mjs";
import { createOnlineBackup, deleteOnlineBackup, downloadOnlineBackup, uploadOnlineBackup } from "../src/main/online-backup";

const servers: ReturnType<typeof createBackupServer>[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(directories.splice(0).map((directory) => fs.promises.rm(directory, { recursive: true, force: true })));
});

describe("online backup client and service", () => {
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
