import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { downloadWithProxySegments, parseProxyList } from "../src/main/proxy-segmented-download";

interface RunningServer {
  port: number;
  close: () => Promise<void>;
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
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

async function createConnectProxy(username: string, password: string, acceptedConnections: { value: number }): Promise<RunningServer> {
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
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      clientSocket.pipe(upstream);
      upstream.pipe(clientSocket);
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
    expect(new Set(targetServer.ranges.filter((range) => range !== "bytes=0-1")).size).toBe(4);
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
