import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultSettings } from "../src/main/constants";
import {
  configureElectronProxySession,
  configureNetworkProxy,
  getProxyAuthentication,
  shutdownNetworkProxy
} from "../src/main/network-proxy";

interface RunningServer {
  port: number;
  close: () => Promise<void>;
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await shutdownNetworkProxy();
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

async function listen(server: http.Server): Promise<RunningServer> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Testserver konnte nicht gestartet werden");
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

async function createTempDirectory(): Promise<string> {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "mdd-network-proxy-test-"));
  cleanups.push(() => fs.promises.rm(directory, { recursive: true, force: true }));
  return directory;
}

describe("proxy-only network routing", () => {
  it("routes global API fetches only through the selected fixed proxy", async () => {
    let targetRequests = 0;
    const target = await listen(http.createServer((_request, response) => {
      targetRequests += 1;
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("proxied");
    }));
    const counters = [{ value: 0 }, { value: 0 }];
    const proxies = await Promise.all([
      createConnectProxy("first", "secret-one", counters[0]),
      createConnectProxy("second", "secret-two", counters[1])
    ]);
    const directory = await createTempDirectory();
    const proxyFile = path.join(directory, "proxies.txt");
    await fs.promises.writeFile(proxyFile, [
      `first:secret-one@127.0.0.1:${proxies[0].port}`,
      `second:secret-two@127.0.0.1:${proxies[1].port}`
    ].join("\n"));

    expect(configureNetworkProxy({
      ...defaultSettings(),
      proxyDownloadEnabled: true,
      proxyListPath: proxyFile,
      proxyApiProxyIndex: 2
    })).toEqual({ status: "active", selectedIndex: 2, proxyCount: 2 });

    const response = await fetch(`http://127.0.0.1:${target.port}/api`);

    expect(await response.text()).toBe("proxied");
    expect(targetRequests).toBe(1);
    expect(counters[0].value).toBe(0);
    expect(counters[1].value).toBe(1);
  });

  it("fails closed when the configured proxy list cannot be loaded", async () => {
    let targetRequests = 0;
    const target = await listen(http.createServer((_request, response) => {
      targetRequests += 1;
      response.end("direct-leak");
    }));

    expect(configureNetworkProxy({
      ...defaultSettings(),
      proxyDownloadEnabled: true,
      proxyListPath: path.join(os.tmpdir(), `missing-${Date.now()}.txt`),
      proxyApiProxyIndex: 1
    })).toEqual({ status: "blocked", reason: "proxy_file_unavailable" });

    await expect(fetch(`http://127.0.0.1:${target.port}/must-not-connect`)).rejects.toThrow();
    expect(targetRequests).toBe(0);
  });

  it("configures Electron sessions without embedding credentials and supplies matching proxy authentication", async () => {
    const directory = await createTempDirectory();
    const proxyFile = path.join(directory, "proxies.txt");
    await fs.promises.writeFile(proxyFile, "api-user:api-password@proxy.example:3128");
    configureNetworkProxy({
      ...defaultSettings(),
      proxyDownloadEnabled: true,
      proxyListPath: proxyFile,
      proxyApiProxyIndex: 1
    });
    const calls: unknown[] = [];
    let closedConnections = 0;
    const fakeSession = {
      setProxy: async (rules: unknown) => { calls.push(rules); },
      closeAllConnections: async () => { closedConnections += 1; }
    };

    await configureElectronProxySession(fakeSession as never);

    expect(calls).toEqual([{ mode: "fixed_servers", proxyRules: "http://proxy.example:3128" }]);
    expect(JSON.stringify(calls)).not.toContain("api-password");
    expect(closedConnections).toBe(1);
    expect(getProxyAuthentication({ isProxy: true, host: "proxy.example", port: 3128 })).toEqual({
      username: "api-user",
      password: "api-password"
    });
    expect(getProxyAuthentication({ isProxy: false, host: "proxy.example", port: 3128 })).toBeNull();
    expect(getProxyAuthentication({ isProxy: true, host: "other.example", port: 3128 })).toBeNull();
  });
});
