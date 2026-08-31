import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadWithProxySegments, normalizeProxyConnectionLimit, parseProxyList, selectFixedProxy } from "../src/main/proxy-segmented-download";

interface RunningServer {
  port: number;
  close: () => Promise<void>;
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.restoreAllMocks();
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

async function listen(server: http.Server): Promise<RunningServer> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Testserver konnte nicht gestartet werden");
  }
  const sockets = new Set<net.Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  const close = async (): Promise<void> => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  cleanups.push(close);
  return { port: address.port, close };
}

async function createRangeServer(content: Buffer, supportsRanges = true): Promise<RunningServer & { ranges: string[] }> {
  const ranges: string[] = [];
  const server = http.createServer((request, response) => {
    const rangeHeader = String(request.headers.range || "");
    ranges.push(rangeHeader);
    if (!supportsRanges || !rangeHeader) {
      response.writeHead(200, { "Content-Length": content.length });
      response.end(content);
      return;
    }
    const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
    if (!match) {
      response.writeHead(416, { "Content-Range": `bytes */${content.length}` });
      response.end();
      return;
    }
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), content.length - 1);
    const body = content.subarray(start, end + 1);
    response.writeHead(206, {
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${start}-${end}/${content.length}`,
      "Content-Length": body.length
    });
    response.end(body);
  });
  const running = await listen(server);
  return { ...running, ranges };
}

async function createConnectProxy(
  username: string,
  password: string,
  acceptedConnections: { value: number; active?: number; maxActive?: number },
  responseDelayMs = 0
): Promise<RunningServer> {
  const server = http.createServer();
  server.on("connect", (request, clientSocket, head) => {
    const expectedAuth = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
    if (request.headers["proxy-authorization"] !== expectedAuth) {
      clientSocket.end("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n");
      return;
    }
    const target = new URL(`http://${request.url}`);
    const upstream = net.connect(Number(target.port), target.hostname, () => {
      acceptedConnections.value += 1;
      acceptedConnections.active = (acceptedConnections.active || 0) + 1;
      acceptedConnections.maxActive = Math.max(acceptedConnections.maxActive || 0, acceptedConnections.active);
      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        acceptedConnections.active = Math.max(0, (acceptedConnections.active || 0) - 1);
      };
      upstream.once("close", release);
      clientSocket.once("close", release);
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      clientSocket.pipe(upstream);
      if (responseDelayMs > 0) {
        const delayed = new Transform({
          transform(chunk, _encoding, callback) {
            setTimeout(() => callback(null, chunk), responseDelayMs);
          }
        });
        upstream.pipe(delayed).pipe(clientSocket);
      } else {
        upstream.pipe(clientSocket);
      }
    });
    upstream.once("error", () => clientSocket.destroy());
    clientSocket.once("error", () => upstream.destroy());
  });
  return listen(server);
}

async function createRejectingProxy(): Promise<RunningServer> {
  const server = http.createServer();
  server.on("connect", (_request, socket) => socket.end("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n"));
  return listen(server);
}

async function createTempDirectory(): Promise<string> {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "mdd-proxy-test-"));
  cleanups.push(() => fs.promises.rm(directory, { recursive: true, force: true }));
  return directory;
}

describe("proxy segmented download", () => {
  it("uses 32 connections by default and clamps the configurable maximum to 40", () => {
    expect(normalizeProxyConnectionLimit(0)).toBe(32);
    expect(normalizeProxyConnectionLimit(40)).toBe(40);
    expect(normalizeProxyConnectionLimit(999)).toBe(40);
    expect(normalizeProxyConnectionLimit(1)).toBe(2);
  });

  it("accepts authenticated premium proxy list formats without exposing entries", () => {
    const secret = "private-password";
    const count = parseProxyList([
      `user:${secret}@127.0.0.1:8080`,
      "http://name:password@example.test:3128",
      "127.0.0.1:9000:name:password",
      "invalid",
      "# ignored"
    ].join("\n"));

    expect(count).toBe(3);
    expect(String(count)).not.toContain(secret);
  });

  it("selects one fixed valid proxy by its 1-based list index", async () => {
    const directory = await createTempDirectory();
    const proxyFile = path.join(directory, "fixed-proxies.txt");
    await fs.promises.writeFile(proxyFile, [
      "invalid",
      "first:secret-one@127.0.0.1:8080",
      "second:secret-two@127.0.0.1:9090"
    ].join("\n"));

    const selected = selectFixedProxy(proxyFile, 2);

    expect(selected.status).toBe("ok");
    if (selected.status !== "ok") throw new Error("Proxy wurde nicht ausgewählt");
    expect(selected.selectedIndex).toBe(2);
    expect(selected.proxyCount).toBe(2);
    expect(selected.proxy.url).toBe("http://127.0.0.1:9090/");
    expect(selected.proxy.username).toBe("second");
    expect(selected.proxy.password).toBe("secret-two");
    expect(selected.proxy.url).not.toContain("secret-two");
  });

  it("downloads exact byte segments through different authenticated proxies", async () => {
    const content = Buffer.allocUnsafe(256 * 1024);
    for (let index = 0; index < content.length; index += 1) content[index] = index % 251;
    const targetServer = await createRangeServer(content);
    const proxyCounters = Array.from({ length: 4 }, () => ({ value: 0 }));
    const proxies = await Promise.all(proxyCounters.map((counter, index) => createConnectProxy(`user${index}`, `pass${index}`, counter)));
    const directory = await createTempDirectory();
    const proxyFile = path.join(directory, "proxies.txt");
    const targetFile = path.join(directory, "archive.bin");
    await fs.promises.writeFile(
      proxyFile,
      proxies.map((proxy, index) => `user${index}:pass${index}@127.0.0.1:${proxy.port}`).join("\n"),
      "utf8"
    );
    const progress: number[] = [];
    let trafficBytes = 0;

    const result = await downloadWithProxySegments({
      directUrl: `http://127.0.0.1:${targetServer.port}/archive.bin`,
      targetPath: targetFile,
      proxyListPath: proxyFile,
      connections: 4,
      signal: new AbortController().signal,
      minSegmentBytes: 1,
      onTrafficBytes: (bytes) => { trafficBytes += bytes; },
      onProgress: (_delta, downloaded) => progress.push(downloaded)
    });

    expect(result).toEqual({ status: "completed", totalBytes: content.length, connections: 4 });
    expect(await fs.promises.readFile(targetFile)).toEqual(content);
    expect(proxyCounters.every((counter) => counter.value > 0)).toBe(true);
    expect(targetServer.ranges).toContain("bytes=0-1");
    expect(new Set(targetServer.ranges.filter((range) => range !== "bytes=0-1")).size).toBe(32);
    expect(progress.at(-1)).toBe(content.length);
    expect(trafficBytes).toBe(content.length + 2);
    expect((await fs.promises.readdir(directory)).filter((name) => name.includes(".proxy-")).length).toBe(0);
  });

  it("uses another proxy after a rejected connection", async () => {
    const content = Buffer.alloc(64 * 1024, 7);
    const targetServer = await createRangeServer(content);
    const rejected = await createRejectingProxy();
    const counters = Array.from({ length: 3 }, () => ({ value: 0 }));
    const working = await Promise.all(counters.map((counter, index) => createConnectProxy(`ok${index}`, `secret${index}`, counter)));
    const directory = await createTempDirectory();
    const proxyFile = path.join(directory, "proxies.txt");
    const targetFile = path.join(directory, "retry.bin");
    await fs.promises.writeFile(proxyFile, [
      `bad:bad@127.0.0.1:${rejected.port}`,
      ...working.map((proxy, index) => `ok${index}:secret${index}@127.0.0.1:${proxy.port}`)
    ].join("\n"));

    const result = await downloadWithProxySegments({
      directUrl: `http://127.0.0.1:${targetServer.port}/retry.bin`,
      targetPath: targetFile,
      proxyListPath: proxyFile,
      connections: 2,
      signal: new AbortController().signal,
      minSegmentBytes: 1
    });

    expect(result.status).toBe("completed");
    expect(await fs.promises.readFile(targetFile)).toEqual(content);
    expect(counters.some((counter) => counter.value > 0)).toBe(true);
  });

  it("reloads a segment when another proxy disproves a suspicious zero-filled range", async () => {
    const content = Buffer.alloc(64 * 1024, 7);
    const ranges: string[] = [];
    let corruptedResponseSent = false;
    const server = http.createServer((request, response) => {
      const rangeHeader = String(request.headers.range || "");
      ranges.push(rangeHeader);
      const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
      if (!match) {
        response.writeHead(416);
        response.end();
        return;
      }
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), content.length - 1);
      let body = content.subarray(start, end + 1);
      if (!corruptedResponseSent && rangeHeader === "bytes=0-4095") {
        body = Buffer.from(body);
        body.fill(0, 0, 2048);
        corruptedResponseSent = true;
      }
      response.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${content.length}`,
        "Content-Length": body.length
      });
      response.end(body);
    });
    const targetServer = await listen(server);
    const counters = Array.from({ length: 3 }, () => ({ value: 0 }));
    const proxies = await Promise.all(counters.map((counter, index) => createConnectProxy(`zero${index}`, `pass${index}`, counter)));
    const directory = await createTempDirectory();
    const proxyFile = path.join(directory, "zero-retry-proxies.txt");
    const targetFile = path.join(directory, "zero-retry.bin");
    await fs.promises.writeFile(
      proxyFile,
      proxies.map((proxy, index) => `zero${index}:pass${index}@127.0.0.1:${proxy.port}`).join("\n")
    );
    const validationRetries: string[] = [];

    const result = await downloadWithProxySegments({
      directUrl: `http://127.0.0.1:${targetServer.port}/zero-retry.bin`,
      targetPath: targetFile,
      proxyListPath: proxyFile,
      connections: 2,
      totalConnectionLimit: 2,
      signal: new AbortController().signal,
      minSegmentBytes: 1,
      onValidationRetry: (event) => validationRetries.push(event.reason)
    });

    expect(result.status).toBe("completed");
    expect(await fs.promises.readFile(targetFile)).toEqual(content);
    expect(validationRetries).toContain("zero_run_mismatch");
    expect(ranges.filter((range) => range === "bytes=0-4095")).toHaveLength(2);
    expect(ranges).toContain("bytes=0-1023");
  });

  it("accepts a legitimate zero-filled range after another proxy confirms it", async () => {
    const content = Buffer.alloc(64 * 1024, 9);
    content.fill(0, 8192, 10_240);
    const targetServer = await createRangeServer(content);
    const counters = Array.from({ length: 3 }, () => ({ value: 0 }));
    const proxies = await Promise.all(counters.map((counter, index) => createConnectProxy(`legit${index}`, `pass${index}`, counter)));
    const directory = await createTempDirectory();
    const proxyFile = path.join(directory, "legitimate-zero-proxies.txt");
    const targetFile = path.join(directory, "legitimate-zero.bin");
    await fs.promises.writeFile(
      proxyFile,
      proxies.map((proxy, index) => `legit${index}:pass${index}@127.0.0.1:${proxy.port}`).join("\n")
    );
    const validationRetries: string[] = [];

    const result = await downloadWithProxySegments({
      directUrl: `http://127.0.0.1:${targetServer.port}/legitimate-zero.bin`,
      targetPath: targetFile,
      proxyListPath: proxyFile,
      connections: 2,
      totalConnectionLimit: 2,
      signal: new AbortController().signal,
      minSegmentBytes: 1,
      onValidationRetry: (event) => validationRetries.push(event.reason)
    });

    expect(result.status).toBe("completed");
    expect(await fs.promises.readFile(targetFile)).toEqual(content);
    expect(validationRetries).toEqual([]);
    expect(targetServer.ranges).toContain("bytes=8192-9215");
  });

  it("reloads a segment when the bytes read back from disk differ from the received bytes", async () => {
    const content = Buffer.alloc(64 * 1024, 13);
    const targetServer = await createRangeServer(content);
    const counters = Array.from({ length: 3 }, () => ({ value: 0 }));
    const proxies = await Promise.all(counters.map((counter, index) => createConnectProxy(`readback${index}`, `pass${index}`, counter)));
    const directory = await createTempDirectory();
    const proxyFile = path.join(directory, "readback-proxies.txt");
    const targetFile = path.join(directory, "readback.bin");
    await fs.promises.writeFile(
      proxyFile,
      proxies.map((proxy, index) => `readback${index}:pass${index}@127.0.0.1:${proxy.port}`).join("\n")
    );

    const originalOpen = fs.promises.open.bind(fs.promises);
    let corruptionInjected = false;
    vi.spyOn(fs.promises, "open").mockImplementation((async (
      file: fs.PathLike,
      flags: fs.OpenMode,
      mode?: fs.Mode
    ) => {
      const handle = await originalOpen(file, flags, mode);
      if (!corruptionInjected && flags === "r+" && String(file).includes(".proxy-")) {
        const originalWrite = handle.write.bind(handle) as (...args: unknown[]) => Promise<unknown>;
        const originalClose = handle.close.bind(handle);
        let firstPosition: number | null = null;
        handle.write = (async (...args: unknown[]) => {
          if (firstPosition === null && typeof args[3] === "number") {
            firstPosition = args[3];
          }
          return originalWrite(...args);
        }) as typeof handle.write;
        handle.close = (async () => {
          if (!corruptionInjected && firstPosition !== null) {
            corruptionInjected = true;
            await originalWrite(Buffer.alloc(1024), 0, 1024, firstPosition);
          }
          await originalClose();
        }) as typeof handle.close;
      }
      return handle;
    }) as typeof fs.promises.open);
    const validationRetries: string[] = [];

    const result = await downloadWithProxySegments({
      directUrl: `http://127.0.0.1:${targetServer.port}/readback.bin`,
      targetPath: targetFile,
      proxyListPath: proxyFile,
      connections: 2,
      totalConnectionLimit: 2,
      signal: new AbortController().signal,
      minSegmentBytes: 1,
      onValidationRetry: (event) => validationRetries.push(event.reason)
    });

    expect(result.status).toBe("completed");
    expect(corruptionInjected).toBe(true);
    expect(await fs.promises.readFile(targetFile)).toEqual(content);
    expect(validationRetries).toContain("readback_mismatch");
  });

  it("lets fast proxies take over additional rolling chunks", async () => {
    const content = Buffer.allocUnsafe(512 * 1024);
    for (let index = 0; index < content.length; index += 1) content[index] = index % 233;
    const targetServer = await createRangeServer(content);
    const fastCounter = { value: 0 };
    const slowCounter = { value: 0 };
    const fastProxy = await createConnectProxy("fast", "secret", fastCounter);
    const slowProxy = await createConnectProxy("slow", "secret", slowCounter, 40);
    const directory = await createTempDirectory();
    const proxyFile = path.join(directory, "speed-proxies.txt");
    const targetFile = path.join(directory, "rolling.bin");
    await fs.promises.writeFile(proxyFile, [
      `fast:secret@127.0.0.1:${fastProxy.port}`,
      `slow:secret@127.0.0.1:${slowProxy.port}`
    ].join("\n"));

    const result = await downloadWithProxySegments({
      directUrl: `http://127.0.0.1:${targetServer.port}/rolling.bin`,
      targetPath: targetFile,
      proxyListPath: proxyFile,
      connections: 2,
      totalConnectionLimit: 2,
      signal: new AbortController().signal,
      minSegmentBytes: 1
    });

    expect(result.status).toBe("completed");
    expect(await fs.promises.readFile(targetFile)).toEqual(content);
    expect(fastCounter.value).toBeGreaterThan(slowCounter.value * 2);
    expect(new Set(targetServer.ranges.filter((range) => range !== "bytes=0-1")).size).toBe(16);
  });

  it("shares one connection budget across concurrent downloads and reserves the fixed API proxy", async () => {
    const content = Buffer.allocUnsafe(128 * 1024);
    for (let index = 0; index < content.length; index += 1) content[index] = index % 239;
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const activeByDownload = new Map<string, number>();
    const maxActiveByDownload = new Map<string, number>();
    let downloadsOverlapped = false;
    const server = http.createServer((request, response) => {
      const match = /^bytes=(\d+)-(\d+)$/.exec(String(request.headers.range || ""));
      if (!match) {
        response.writeHead(416);
        response.end();
        return;
      }
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), content.length - 1);
      const body = content.subarray(start, end + 1);
      const downloadKey = new URL(request.url || "/", "http://localhost").searchParams.get("download") || "unknown";
      activeRequests += 1;
      activeByDownload.set(downloadKey, (activeByDownload.get(downloadKey) || 0) + 1);
      maxActiveByDownload.set(downloadKey, Math.max(maxActiveByDownload.get(downloadKey) || 0, activeByDownload.get(downloadKey) || 0));
      downloadsOverlapped ||= (activeByDownload.get("first") || 0) > 0 && (activeByDownload.get("second") || 0) > 0;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        activeRequests = Math.max(0, activeRequests - 1);
        activeByDownload.set(downloadKey, Math.max(0, (activeByDownload.get(downloadKey) || 1) - 1));
      };
      response.once("close", finish);
      response.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${content.length}`,
        "Content-Length": body.length
      });
      if (start === 0 && end === 1) {
        response.end(body);
      } else {
        setTimeout(() => response.end(body), 60);
      }
    });
    const targetServer = await listen(server);
    const counters = Array.from({ length: 9 }, () => ({ value: 0, active: 0, maxActive: 0 }));
    const proxies = await Promise.all(counters.map((counter, index) => createConnectProxy(`shared${index}`, `pass${index}`, counter)));
    const directory = await createTempDirectory();
    const proxyFile = path.join(directory, "shared-proxies.txt");
    const firstTarget = path.join(directory, "first.bin");
    const secondTarget = path.join(directory, "second.bin");
    await fs.promises.writeFile(
      proxyFile,
      proxies.map((proxy, index) => `shared${index}:pass${index}@127.0.0.1:${proxy.port}`).join("\n")
    );
    const commonOptions = {
      proxyListPath: proxyFile,
      connections: 4,
      totalConnectionLimit: 4,
      reservedProxyIndex: 1,
      minSegmentBytes: 1,
      signal: new AbortController().signal
    };

    const [firstResult, secondResult] = await Promise.all([
      downloadWithProxySegments({ ...commonOptions, directUrl: `http://127.0.0.1:${targetServer.port}/shared.bin?download=first`, targetPath: firstTarget }),
      downloadWithProxySegments({ ...commonOptions, directUrl: `http://127.0.0.1:${targetServer.port}/shared.bin?download=second`, targetPath: secondTarget })
    ]);

    expect(firstResult.status).toBe("completed");
    expect(secondResult.status).toBe("completed");
    expect(await fs.promises.readFile(firstTarget)).toEqual(content);
    expect(await fs.promises.readFile(secondTarget)).toEqual(content);
    expect(maxActiveRequests).toBeLessThanOrEqual(4);
    expect(maxActiveByDownload.get("first")).toBeLessThanOrEqual(2);
    expect(maxActiveByDownload.get("second")).toBeLessThanOrEqual(2);
    expect(downloadsOverlapped).toBe(true);
    expect(counters[0].value).toBe(0);
    expect(counters.every((counter) => counter.maxActive <= 1)).toBe(true);
  });

  it("reduces new parallel range requests after a transient origin 503", async () => {
    const content = Buffer.allocUnsafe(192 * 1024);
    for (let index = 0; index < content.length; index += 1) content[index] = index % 227;
    let activeRequests = 0;
    let initialRequests = 0;
    let maxActiveAfter503 = 0;
    const server = http.createServer((request, response) => {
      const rangeHeader = String(request.headers.range || "");
      const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
      if (!match) {
        response.writeHead(416);
        response.end();
        return;
      }
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), content.length - 1);
      const body = content.subarray(start, end + 1);
      if (rangeHeader === "bytes=0-1") {
        response.writeHead(206, {
          "Content-Range": `bytes 0-1/${content.length}`,
          "Content-Length": 2
        });
        response.end(body);
        return;
      }
      initialRequests += 1;
      activeRequests += 1;
      if (initialRequests > 6) {
        maxActiveAfter503 = Math.max(maxActiveAfter503, activeRequests);
      }
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        activeRequests = Math.max(0, activeRequests - 1);
      };
      response.once("close", finish);
      if (initialRequests === 6) {
        response.writeHead(503, { "Content-Length": 0 });
        response.end();
        return;
      }
      const delayMs = initialRequests < 6 ? 80 : 5;
      setTimeout(() => {
        response.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${content.length}`,
          "Content-Length": body.length
        });
        response.end(body);
      }, delayMs);
    });
    const targetServer = await listen(server);
    const counters = Array.from({ length: 6 }, () => ({ value: 0 }));
    const proxies = await Promise.all(counters.map((counter, index) => createConnectProxy(`adaptive${index}`, `pass${index}`, counter)));
    const directory = await createTempDirectory();
    const proxyFile = path.join(directory, "adaptive-proxies.txt");
    const targetFile = path.join(directory, "adaptive.bin");
    await fs.promises.writeFile(
      proxyFile,
      proxies.map((proxy, index) => `adaptive${index}:pass${index}@127.0.0.1:${proxy.port}`).join("\n")
    );

    const result = await downloadWithProxySegments({
      directUrl: `http://127.0.0.1:${targetServer.port}/adaptive.bin`,
      targetPath: targetFile,
      proxyListPath: proxyFile,
      connections: 6,
      totalConnectionLimit: 6,
      signal: new AbortController().signal,
      minSegmentBytes: 1
    });

    expect(result.status).toBe("completed");
    expect(await fs.promises.readFile(targetFile)).toEqual(content);
    expect(initialRequests).toBeGreaterThan(6);
    expect(maxActiveAfter503).toBeLessThanOrEqual(4);
  });

  it("reports an origin HTTP status instead of marking reachable proxies unavailable", async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(503, { "Content-Type": "text/plain", "Content-Length": 19 });
      response.end("Service Unavailable");
    });
    const targetServer = await listen(server);
    const counters = Array.from({ length: 3 }, () => ({ value: 0 }));
    const proxies = await Promise.all(counters.map((counter, index) => createConnectProxy(`status${index}`, `pass${index}`, counter)));
    const directory = await createTempDirectory();
    const proxyFile = path.join(directory, "status-proxies.txt");
    await fs.promises.writeFile(
      proxyFile,
      proxies.map((proxy, index) => `status${index}:pass${index}@127.0.0.1:${proxy.port}`).join("\n")
    );

    const result = await downloadWithProxySegments({
      directUrl: `http://127.0.0.1:${targetServer.port}/unavailable.bin`,
      targetPath: path.join(directory, "unavailable.bin"),
      proxyListPath: proxyFile,
      connections: 2,
      signal: new AbortController().signal,
      minSegmentBytes: 1
    });

    expect(result).toEqual({ status: "fallback", reason: "origin_http_error", httpStatus: 503 });
    expect(counters.every((counter) => counter.value > 0)).toBe(true);
  });

  it("preserves an origin HTTP status from failed segment requests and removes temporary data", async () => {
    const content = Buffer.alloc(64 * 1024, 11);
    const server = http.createServer((request, response) => {
      const rangeHeader = String(request.headers.range || "");
      if (rangeHeader === "bytes=0-1") {
        response.writeHead(206, {
          "Content-Range": `bytes 0-1/${content.length}`,
          "Content-Length": 2
        });
        response.end(content.subarray(0, 2));
        return;
      }
      response.writeHead(503, { "Content-Type": "text/plain", "Content-Length": 19 });
      response.end("Service Unavailable");
    });
    const targetServer = await listen(server);
    const counters = Array.from({ length: 4 }, () => ({ value: 0 }));
    const proxies = await Promise.all(counters.map((counter, index) => createConnectProxy(`segment${index}`, `pass${index}`, counter)));
    const directory = await createTempDirectory();
    const proxyFile = path.join(directory, "segment-status-proxies.txt");
    const targetFile = path.join(directory, "segment-status.bin");
    await fs.promises.writeFile(
      proxyFile,
      proxies.map((proxy, index) => `segment${index}:pass${index}@127.0.0.1:${proxy.port}`).join("\n")
    );

    const result = await downloadWithProxySegments({
      directUrl: `http://127.0.0.1:${targetServer.port}/segment-status.bin`,
      targetPath: targetFile,
      proxyListPath: proxyFile,
      connections: 2,
      signal: new AbortController().signal,
      minSegmentBytes: 1
    });

    expect(result).toEqual({ status: "fallback", reason: "origin_http_error", httpStatus: 503 });
    expect(fs.existsSync(targetFile)).toBe(false);
    expect((await fs.promises.readdir(directory)).filter((name) => name.includes(".proxy-")).length).toBe(0);
  });

  it("falls back cleanly when the origin ignores byte ranges", async () => {
    const content = Buffer.alloc(4096, 3);
    const targetServer = await createRangeServer(content, false);
    const counter = { value: 0 };
    const proxy = await createConnectProxy("user", "password", counter);
    const directory = await createTempDirectory();
    const proxyFile = path.join(directory, "proxies.txt");
    const targetFile = path.join(directory, "fallback.bin");
    await fs.promises.writeFile(proxyFile, `user:password@127.0.0.1:${proxy.port}`);

    const result = await downloadWithProxySegments({
      directUrl: `http://127.0.0.1:${targetServer.port}/fallback.bin`,
      targetPath: targetFile,
      proxyListPath: proxyFile,
      connections: 4,
      signal: new AbortController().signal,
      minSegmentBytes: 1
    });

    expect(result).toEqual({ status: "fallback", reason: "range_unsupported" });
    expect(fs.existsSync(targetFile)).toBe(false);
    expect((await fs.promises.readdir(directory)).filter((name) => name.includes(".proxy-")).length).toBe(0);
  });

  it("cancels all segments and removes temporary data", async () => {
    const content = Buffer.alloc(256 * 1024, 5);
    const server = http.createServer((request, response) => {
      const match = /^bytes=(\d+)-(\d+)$/.exec(String(request.headers.range || ""));
      if (!match) {
        response.writeHead(416);
        response.end();
        return;
      }
      const start = Number(match[1]);
      const end = Number(match[2]);
      const body = content.subarray(start, end + 1);
      response.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${content.length}`,
        "Content-Length": body.length
      });
      if (start === 0 && end === 1) {
        response.end(body);
        return;
      }
      let offset = 0;
      const timer = setInterval(() => {
        if (offset >= body.length) {
          clearInterval(timer);
          response.end();
          return;
        }
        const next = Math.min(body.length, offset + 1024);
        response.write(body.subarray(offset, next));
        offset = next;
      }, 5);
      response.once("close", () => clearInterval(timer));
    });
    const targetServer = await listen(server);
    const counters = Array.from({ length: 2 }, () => ({ value: 0 }));
    const proxies = await Promise.all(counters.map((counter, index) => createConnectProxy(`cancel${index}`, `pass${index}`, counter)));
    const directory = await createTempDirectory();
    const proxyFile = path.join(directory, "proxies.txt");
    const targetFile = path.join(directory, "cancel.bin");
    await fs.promises.writeFile(
      proxyFile,
      proxies.map((proxy, index) => `cancel${index}:pass${index}@127.0.0.1:${proxy.port}`).join("\n")
    );
    const controller = new AbortController();
    const progress: number[] = [];

    const download = downloadWithProxySegments({
      directUrl: `http://127.0.0.1:${targetServer.port}/cancel.bin`,
      targetPath: targetFile,
      proxyListPath: proxyFile,
      connections: 2,
      signal: controller.signal,
      minSegmentBytes: 1,
      onProgress: (_delta, downloaded) => {
        progress.push(downloaded);
        if (downloaded >= 4096) controller.abort("test_cancel");
      }
    });

    await expect(download).rejects.toThrow("aborted:proxy_download");
    expect(progress.at(-1)).toBe(0);
    expect(fs.existsSync(targetFile)).toBe(false);
    expect((await fs.promises.readdir(directory)).filter((name) => name.includes(".proxy-")).length).toBe(0);
  });
});
