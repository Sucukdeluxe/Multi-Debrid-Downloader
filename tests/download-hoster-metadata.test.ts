import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/main/constants";
import { DownloadManager } from "../src/main/download-manager";
import { createStoragePaths, emptySession } from "../src/main/storage";
import * as storageModule from "../src/main/storage";

const originalFetch = globalThis.fetch;
const tempDirs: string[] = [];

async function waitFor(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("download hoster metadata", () => {
  it("resolves 1Fichier and DDownload names, sizes and availability after import", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-hoster-metadata-"));
    tempDirs.push(root);
    const oneFichier = "https://1fichier.com/?abc12345";
    const ddownload = "https://ddownload.com/ntwscdw62gyb";
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://1fichier.com/check_links.pl") {
        return new Response(`${oneFichier};Show.S01E01.part01.rar;1073741824`, { status: 200 });
      }
      if (url === ddownload) {
        return new Response('<h2 class="dk-dl-name">Show.S01E01.part02.rar</h2><p class="dk-dl-size">502.00 MB</p>', { status: 200, headers: { "Content-Type": "text/html" } });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const manager = new DownloadManager({
      ...defaultSettings(),
      outputDir: path.join(root, "downloads"),
      extractDir: path.join(root, "extract")
    }, emptySession(), createStoragePaths(path.join(root, "state")));
    manager.addPackages([{ name: "metadata", links: [oneFichier, ddownload] }]);

    await waitFor(() => Object.values(manager.getSnapshot().session.items).every((item) => item.onlineStatus === "online"), 3_000);
    const items = Object.values(manager.getSnapshot().session.items);

    expect(items.map((item) => item.fileName)).toEqual(["Show.S01E01.part01.rar", "Show.S01E01.part02.rar"]);
    expect(items.map((item) => item.totalBytes)).toEqual([1_073_741_824, 526_385_152]);
    expect(items.map((item) => path.basename(item.targetPath))).toEqual(["Show.S01E01.part01.rar", "Show.S01E01.part02.rar"]);
  });

  it("keeps an existing partial file attached while applying a resolved 1Fichier name", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-hoster-partial-"));
    tempDirs.push(root);
    const link = "https://1fichier.com/?partial12";
    let resolveMetadata: (response: Response) => void = () => undefined;
    const metadata = new Promise<Response>((resolve) => {
      resolveMetadata = resolve;
    });
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://1fichier.com/check_links.pl") return metadata;
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const manager = new DownloadManager({
      ...defaultSettings(),
      outputDir: path.join(root, "downloads"),
      extractDir: path.join(root, "extract")
    }, emptySession(), createStoragePaths(path.join(root, "state")));
    manager.addPackages([{ name: "partial", links: [link] }]);
    const item = Object.values(manager.getSnapshot().session.items)[0];
    const partialPath = item.targetPath;
    fs.mkdirSync(path.dirname(partialPath), { recursive: true });
    fs.writeFileSync(partialPath, Buffer.alloc(64 * 1024, 9));
    item.downloadedBytes = 64 * 1024;

    resolveMetadata(new Response(`${link};Resolved.Partial.rar;1048576`, { status: 200 }));
    await waitFor(() => item.onlineStatus === "online", 3_000);

    expect(item.fileName).toBe("Resolved.Partial.rar");
    expect(item.targetPath).toBe(partialPath);
    expect(fs.existsSync(partialPath)).toBe(true);
    expect(fs.statSync(partialPath).size).toBe(64 * 1024);
  });

  it("applies delayed DDownload metadata after the download already started", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-hoster-race-"));
    tempDirs.push(root);
    const link = "https://ddownload.com/race1234567";
    const expectedName = "Resolved.Race.part01.rar";
    const binary = Buffer.alloc(192 * 1024, 17);
    let releaseBody: () => void = () => undefined;
    const bodyGate = new Promise<void>((resolve) => {
      releaseBody = resolve;
    });
    const server = http.createServer(async (_request, response) => {
      await bodyGate;
      response.statusCode = 200;
      response.setHeader("Accept-Ranges", "bytes");
      response.setHeader("Content-Length", String(binary.length));
      response.end(binary);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server address unavailable");
    const directUrl = `http://127.0.0.1:${address.port}/download`;
    let resolveMetadata: (response: Response) => void = () => undefined;
    const metadata = new Promise<Response>((resolve) => {
      resolveMetadata = resolve;
    });

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === link) return metadata;
      if (url.includes("api.real-debrid.com/rest/1.0/unrestrict/link")) {
        return new Response(JSON.stringify({ download: directUrl, filename: "download.bin", filesize: binary.length }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      const manager = new DownloadManager({
        ...defaultSettings(),
        token: "rd-token",
        outputDir: path.join(root, "downloads"),
        extractDir: path.join(root, "extract"),
        autoExtract: false
      }, emptySession(), createStoragePaths(path.join(root, "state")));
      manager.addPackages([{ name: "race", links: [link] }]);
      await manager.start();
      await waitFor(() => Object.values(manager.getSnapshot().session.items)[0]?.status === "downloading", 8_000);

      resolveMetadata(new Response(`<h2 class="dk-dl-name">${expectedName}</h2><p class="dk-dl-size">192 KB</p>`, { status: 200, headers: { "Content-Type": "text/html" } }));
      await waitFor(() => Object.values(manager.getSnapshot().session.items)[0]?.onlineStatus === "online", 3_000);
      releaseBody();
      await waitFor(() => !manager.getSnapshot().session.running, 15_000);
      const item = Object.values(manager.getSnapshot().session.items)[0];

      expect(item.status).toBe("completed");
      expect(item.fileName).toBe(expectedName);
      expect(path.basename(item.targetPath)).toBe(expectedName);
      expect(fs.existsSync(item.targetPath)).toBe(true);
    } finally {
      releaseBody();
      server.close();
      await once(server, "close");
    }
  }, 25_000);

  it("discards late metadata after shutdown preparation", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-hoster-shutdown-"));
    tempDirs.push(root);
    const link = "https://1fichier.com/?shutdown1";
    let resolveMetadata: (response: Response) => void = () => undefined;
    const metadata = new Promise<Response>((resolve) => {
      resolveMetadata = resolve;
    });
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://1fichier.com/check_links.pl") return metadata;
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const manager = new DownloadManager({
      ...defaultSettings(),
      outputDir: path.join(root, "downloads"),
      extractDir: path.join(root, "extract")
    }, emptySession(), createStoragePaths(path.join(root, "state")));
    manager.addPackages([{ name: "shutdown", links: [link] }]);
    const item = Object.values(manager.getSnapshot().session.items)[0];
    expect(item.onlineStatus).toBe("checking");

    manager.prepareForShutdown();
    resolveMetadata(new Response(`${link};Must.Not.Apply.rar;1048576`, { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(item.onlineStatus).toBeUndefined();
    expect(item.fileName).toBe("download.bin");
    expect(item.totalBytes).toBeNull();
  });

  it("marks a successfully completed download online after a late offline check", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-hoster-late-offline-"));
    tempDirs.push(root);
    const link = "https://ddownload.com/offline1234";
    const binary = Buffer.alloc(192 * 1024, 19);
    let releaseBody: () => void = () => undefined;
    const bodyGate = new Promise<void>((resolve) => {
      releaseBody = resolve;
    });
    const server = http.createServer(async (_request, response) => {
      await bodyGate;
      response.statusCode = 200;
      response.setHeader("Content-Length", String(binary.length));
      response.end(binary);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server address unavailable");
    const directUrl = `http://127.0.0.1:${address.port}/download`;
    let resolveMetadata: (response: Response) => void = () => undefined;
    const metadata = new Promise<Response>((resolve) => {
      resolveMetadata = resolve;
    });

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === link) return metadata;
      if (url.includes("api.real-debrid.com/rest/1.0/unrestrict/link")) {
        return new Response(JSON.stringify({ download: directUrl, filename: "download.bin", filesize: binary.length }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      const manager = new DownloadManager({
        ...defaultSettings(),
        token: "rd-token",
        outputDir: path.join(root, "downloads"),
        extractDir: path.join(root, "extract"),
        autoExtract: false
      }, emptySession(), createStoragePaths(path.join(root, "state")));
      manager.addPackages([{ name: "late-offline", links: [link] }]);
      await manager.start();
      await waitFor(() => Object.values(manager.getSnapshot().session.items)[0]?.status === "downloading", 8_000);

      resolveMetadata(new Response("<h1>File Not Found</h1>", { status: 200, headers: { "Content-Type": "text/html" } }));
      await waitFor(() => Object.values(manager.getSnapshot().session.items)[0]?.onlineStatus === "offline", 3_000);
      releaseBody();
      await waitFor(() => !manager.getSnapshot().session.running, 15_000);
      const item = Object.values(manager.getSnapshot().session.items)[0];

      expect(item.status).toBe("completed");
      expect(item.onlineStatus).toBe("online");
    } finally {
      releaseBody();
      server.close();
      await once(server, "close");
    }
  }, 25_000);

  it("reconstructs a completed metadata rename after a crash window", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-hoster-crash-rename-"));
    tempDirs.push(root);
    const link = "https://ddownload.com/crash12345";
    globalThis.fetch = (async () => new Response("<title>Just a moment...</title>", { status: 200, headers: { "Content-Type": "text/html" } })) as typeof fetch;
    const settings = {
      ...defaultSettings(),
      outputDir: path.join(root, "downloads"),
      extractDir: path.join(root, "extract")
    };
    const session = emptySession();
    const paths = createStoragePaths(path.join(root, "state"));
    const manager = new DownloadManager(settings, session, paths);
    manager.addPackages([{ name: "crash-rename", links: [link] }]);
    const item = Object.values(session.items)[0];
    const pkg = session.packages[item.packageId];
    const stalePath = item.targetPath;
    const expectedName = "Recovered.After.Crash.rar";
    const recoveredPath = path.join(pkg.outputDir, expectedName);
    fs.mkdirSync(pkg.outputDir, { recursive: true });
    fs.writeFileSync(recoveredPath, Buffer.alloc(128 * 1024, 21));
    item.status = "completed";
    item.fileName = expectedName;
    item.targetPath = stalePath;
    item.downloadedBytes = 128 * 1024;
    item.totalBytes = 128 * 1024;
    item.progressPercent = 100;
    item.onlineStatus = "online";
    (item as typeof item & { metadataRenameTargetPath?: string }).metadataRenameTargetPath = recoveredPath;

    new DownloadManager(settings, session, paths);

    expect(item.targetPath).toBe(recoveredPath);
    expect(fs.existsSync(item.targetPath)).toBe(true);
  });

  it("does not adopt an unrelated same-name file without a rename journal", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-hoster-foreign-collision-"));
    tempDirs.push(root);
    const link = "https://ddownload.com/foreign1234";
    globalThis.fetch = (async () => new Response("<title>Just a moment...</title>", { status: 200, headers: { "Content-Type": "text/html" } })) as typeof fetch;
    const settings = {
      ...defaultSettings(),
      outputDir: path.join(root, "downloads"),
      extractDir: path.join(root, "extract")
    };
    const session = emptySession();
    const paths = createStoragePaths(path.join(root, "state"));
    const manager = new DownloadManager(settings, session, paths);
    manager.addPackages([{ name: "foreign-collision", links: [link] }]);
    const item = Object.values(session.items)[0];
    const pkg = session.packages[item.packageId];
    const stalePath = item.targetPath;
    const expectedName = "Existing.Foreign.File.rar";
    const foreignPath = path.join(pkg.outputDir, expectedName);
    fs.mkdirSync(pkg.outputDir, { recursive: true });
    fs.writeFileSync(foreignPath, Buffer.alloc(128 * 1024, 33));
    item.status = "completed";
    item.fileName = expectedName;
    item.targetPath = stalePath;
    item.downloadedBytes = 128 * 1024;
    item.totalBytes = 128 * 1024;
    item.progressPercent = 100;
    item.onlineStatus = "online";

    new DownloadManager(settings, session, paths);

    expect(item.targetPath).toBe(stalePath);
    expect(fs.existsSync(foreignPath)).toBe(true);
  });

  it("keeps the renamed file attached when the post-rename session save fails", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-hoster-rename-save-"));
    tempDirs.push(root);
    const link = "https://1fichier.com/?savefail1";
    globalThis.fetch = (async () => new Response("invalid", { status: 200 })) as typeof fetch;
    const settings = {
      ...defaultSettings(),
      outputDir: path.join(root, "downloads"),
      extractDir: path.join(root, "extract")
    };
    const session = emptySession();
    const manager = new DownloadManager(settings, session, createStoragePaths(path.join(root, "state")));
    manager.addPackages([{ name: "rename-save", links: [link] }]);
    const item = Object.values(session.items)[0];
    const pkg = session.packages[item.packageId];
    const currentPath = item.targetPath;
    const expectedName = "Rename.Save.Failure.rar";
    const expectedPath = path.join(pkg.outputDir, expectedName);
    fs.mkdirSync(pkg.outputDir, { recursive: true });
    fs.writeFileSync(currentPath, Buffer.alloc(64 * 1024, 41));
    item.fileName = expectedName;
    vi.spyOn(storageModule, "saveSession")
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error("simulated save failure");
      });

    (manager as unknown as { finalizeResolvedMetadataTargetPath: (target: typeof item) => void }).finalizeResolvedMetadataTargetPath(item);

    expect(item.targetPath).toBe(expectedPath);
    expect(fs.existsSync(expectedPath)).toBe(true);
    expect(fs.existsSync(currentPath)).toBe(false);
  });

  it("keeps a foreign journal target and renames the real source to a free collision path", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-hoster-journal-collision-"));
    tempDirs.push(root);
    const link = "https://ddownload.com/journal123";
    globalThis.fetch = (async () => new Response("<title>Just a moment...</title>", { status: 200, headers: { "Content-Type": "text/html" } })) as typeof fetch;
    const settings = {
      ...defaultSettings(),
      outputDir: path.join(root, "downloads"),
      extractDir: path.join(root, "extract")
    };
    const session = emptySession();
    const paths = createStoragePaths(path.join(root, "state"));
    const manager = new DownloadManager(settings, session, paths);
    manager.addPackages([{ name: "journal-collision", links: [link] }]);
    const item = Object.values(session.items)[0];
    const pkg = session.packages[item.packageId];
    const sourcePath = item.targetPath;
    const expectedName = "Journal.Collision.rar";
    const foreignPath = path.join(pkg.outputDir, expectedName);
    fs.mkdirSync(pkg.outputDir, { recursive: true });
    fs.writeFileSync(sourcePath, Buffer.alloc(64 * 1024, 51));
    fs.writeFileSync(foreignPath, Buffer.alloc(64 * 1024, 52));
    item.status = "completed";
    item.fileName = expectedName;
    item.downloadedBytes = 64 * 1024;
    item.totalBytes = 64 * 1024;
    item.progressPercent = 100;
    item.onlineStatus = "online";
    item.metadataRenameTargetPath = foreignPath;

    new DownloadManager(settings, session, paths);

    expect(item.targetPath).toBe(path.join(pkg.outputDir, "Journal.Collision (1).rar"));
    expect(fs.readFileSync(foreignPath).equals(Buffer.alloc(64 * 1024, 52))).toBe(true);
    expect(fs.readFileSync(item.targetPath).equals(Buffer.alloc(64 * 1024, 51))).toBe(true);
  });

  it.each([
    { hoster: "1Fichier", link: "https://1fichier.com/?keep12345" },
    { hoster: "DDownload", link: "https://ddownload.com/keep1234567" }
  ])("keeps resolved $hoster metadata when Real-Debrid returns download.bin", async ({ hoster, link }) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-hoster-preserve-"));
    tempDirs.push(root);
    const expectedName = `${hoster}.Series.S02E03.part01.rar`;
    const binary = Buffer.alloc(192 * 1024, 31);
    const server = http.createServer((_request, response) => {
      response.statusCode = 200;
      response.setHeader("Accept-Ranges", "bytes");
      response.setHeader("Content-Length", String(binary.length));
      response.end(binary);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server address unavailable");
    const directUrl = `http://127.0.0.1:${address.port}/download`;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://1fichier.com/check_links.pl") return new Response(`${link};${expectedName};${binary.length}`, { status: 200 });
      if (url === link) return new Response(`<h2 class="dk-dl-name">${expectedName}</h2><p class="dk-dl-size">192 KB</p>`, { status: 200, headers: { "Content-Type": "text/html" } });
      if (url.includes("api.real-debrid.com/rest/1.0/unrestrict/link")) {
        return new Response(JSON.stringify({ download: directUrl, filename: "download.bin", filesize: binary.length }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      const manager = new DownloadManager({
        ...defaultSettings(),
        token: "rd-token",
        outputDir: path.join(root, "downloads"),
        extractDir: path.join(root, "extract"),
        autoExtract: false
      }, emptySession(), createStoragePaths(path.join(root, "state")));
      manager.addPackages([{ name: "preserve", links: [link] }]);
      await waitFor(() => Object.values(manager.getSnapshot().session.items)[0]?.fileName === expectedName, 3_000);

      await manager.start();
      await waitFor(() => !manager.getSnapshot().session.running, 15_000);
      const item = Object.values(manager.getSnapshot().session.items)[0];

      expect(item.status).toBe("completed");
      expect(item.fileName).toBe(expectedName);
      expect(path.basename(item.targetPath)).toBe(expectedName);
    } finally {
      server.close();
      await once(server, "close");
    }
  }, 20_000);
});
