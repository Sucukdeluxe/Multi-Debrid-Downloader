import http from "node:http";
import https from "node:https";
import type { Session } from "electron";
import { getGlobalDispatcher, ProxyAgent, setGlobalDispatcher, type Dispatcher } from "undici";
import type { AppSettings, NetworkProxyProbe } from "../shared/types";
import { selectFixedProxy, type ProxyEndpoint } from "./proxy-segmented-download";
import { setNetworkErrorContext } from "./utils";
import { logger } from "./logger";

export type NetworkProxyState =
  | { status: "disabled" }
  | { status: "active"; selectedIndex: number; proxyCount: number }
  | { status: "blocked"; reason: "proxy_file_unavailable" | "no_valid_proxies" | "proxy_index_unavailable" };

interface ActiveProxyConfiguration {
  status: "active";
  proxy: ProxyEndpoint;
  selectedIndex: number;
  proxyCount: number;
  fingerprint: string;
}

interface BlockedProxyConfiguration {
  status: "blocked";
  reason: "proxy_file_unavailable" | "no_valid_proxies" | "proxy_index_unavailable";
  fingerprint: string;
}

type ProxyConfiguration = { status: "disabled"; fingerprint: "disabled" } | ActiveProxyConfiguration | BlockedProxyConfiguration;

const originalDispatcher = getGlobalDispatcher();
const configuredSessions = new WeakMap<object, string>();
const knownSessions = new Set<Session>();
let currentConfiguration: ProxyConfiguration = { status: "disabled", fingerprint: "disabled" };
let installedDispatcher: Dispatcher | null = null;
let currentProbe: NetworkProxyProbe | null = null;
let probeGeneration = 0;
const probeListeners = new Set<(probe: NetworkProxyProbe | null) => void>();
const PROBE_TARGET = "api.real-debrid.com:443";

export function proxyEndpointLabel(proxy: Pick<ProxyEndpoint, "hostname" | "port">): string {
  return `${proxy.hostname}:${proxy.port}`;
}

setNetworkErrorContext(() => currentConfiguration.status === "active" ? proxyEndpointLabel(currentConfiguration.proxy) : null);

export function probeProxyEndpoint(proxy: ProxyEndpoint, options: { target?: string; timeoutMs?: number } = {}): Promise<NetworkProxyProbe> {
  const target = options.target ?? PROBE_TARGET;
  const label = proxyEndpointLabel(proxy);
  const timeoutMs = options.timeoutMs ?? 8000;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (probe: Omit<NetworkProxyProbe, "proxy" | "checkedAt">): void => {
      if (settled) return;
      settled = true;
      resolve({ ...probe, proxy: label, checkedAt: Date.now() });
    };
    const client = proxy.url.startsWith("https:") ? https : http;
    const request = client.request({
      host: proxy.hostname,
      port: proxy.port,
      method: "CONNECT",
      path: target,
      headers: { Host: target, ...(proxy.authorization ? { "Proxy-Authorization": proxy.authorization } : {}) },
      timeout: timeoutMs
    });
    request.once("connect", (response, socket) => {
      socket.destroy();
      const status = response.statusCode || 0;
      if (status === 200) finish({ status: "reachable", httpStatus: status });
      else if (status === 407) finish({ status: "auth_required", httpStatus: status });
      else finish({ status: "rejected", httpStatus: status });
    });
    request.once("response", (response) => {
      response.resume();
      const status = response.statusCode || 0;
      finish(status === 407 ? { status: "auth_required", httpStatus: status } : { status: "rejected", httpStatus: status });
    });
    request.once("timeout", () => request.destroy(Object.assign(new Error("proxy_probe_timeout"), { code: "ETIMEDOUT" })));
    request.once("error", (error: NodeJS.ErrnoException) => finish({ status: "unreachable", code: String(error.code || "ERROR") }));
    request.end();
  });
}

function publishProbe(probe: NetworkProxyProbe | null): void {
  currentProbe = probe;
  for (const listener of probeListeners) {
    try { listener(probe); } catch {}
  }
}

function startProbe(proxy: ProxyEndpoint): void {
  const generation = ++probeGeneration;
  const label = proxyEndpointLabel(proxy);
  publishProbe({ status: "checking", proxy: label, checkedAt: Date.now() });
  void probeProxyEndpoint(proxy).then((probe) => {
    if (generation !== probeGeneration) return;
    if (probe.status === "reachable") logger.info(`Proxy-only: fester API-Proxy ${label} erreichbar`);
    else logger.warn(`Proxy-only: fester API-Proxy ${label} ${probe.status === "auth_required" ? "verlangt Anmeldung (HTTP 407)" : probe.httpStatus ? `lehnt Tunnel ab (HTTP ${probe.httpStatus})` : `nicht erreichbar (${probe.code})`}`);
    publishProbe(probe);
  });
}

export function getNetworkProxyProbe(): NetworkProxyProbe | null {
  return currentProbe ? { ...currentProbe } : null;
}

export function onNetworkProxyProbe(listener: (probe: NetworkProxyProbe | null) => void): () => void {
  probeListeners.add(listener);
  return () => probeListeners.delete(listener);
}

function blockedDispatcher(reason: string): Dispatcher {
  return {
    dispatch: (_options, handler) => {
      queueMicrotask(() => handler.onError?.(new Error(`proxy_only_blocked:${reason}`)));
      return true;
    },
    close: async () => {},
    destroy: async () => {}
  } as Dispatcher;
}

function closeInstalledDispatcher(dispatcher: Dispatcher | null): void {
  if (!dispatcher || dispatcher === originalDispatcher) return;
  void dispatcher.close().catch(() => {});
}

function installDispatcher(dispatcher: Dispatcher | null): void {
  const previous = installedDispatcher;
  installedDispatcher = dispatcher;
  setGlobalDispatcher(dispatcher || originalDispatcher);
  if (previous && previous !== dispatcher) closeInstalledDispatcher(previous);
}

function refreshKnownElectronSessions(): void {
  for (const currentSession of knownSessions) {
    void configureElectronProxySession(currentSession).catch(() => {});
  }
}

export function configureNetworkProxy(settings: Pick<AppSettings, "proxyDownloadEnabled" | "proxyListPath" | "proxyApiProxyIndex">): NetworkProxyState {
  if (!settings.proxyDownloadEnabled) {
    if (currentConfiguration.status !== "disabled") {
      currentConfiguration = { status: "disabled", fingerprint: "disabled" };
      installDispatcher(null);
      refreshKnownElectronSessions();
      probeGeneration += 1;
      publishProbe(null);
    }
    return { status: "disabled" };
  }

  const selected = selectFixedProxy(settings.proxyListPath, settings.proxyApiProxyIndex);
  if (selected.status !== "ok") {
    const fingerprint = `blocked:${selected.status}`;
    if (currentConfiguration.fingerprint !== fingerprint) {
      currentConfiguration = { status: "blocked", reason: selected.status, fingerprint };
      installDispatcher(blockedDispatcher(selected.status));
      refreshKnownElectronSessions();
      probeGeneration += 1;
      publishProbe(null);
    }
    return { status: "blocked", reason: selected.status };
  }

  const fingerprint = `${selected.proxy.url}\0${selected.proxy.authorization}\0${selected.selectedIndex}`;
  if (currentConfiguration.fingerprint !== fingerprint) {
    const dispatcher = new ProxyAgent({
      uri: selected.proxy.url,
      ...(selected.proxy.authorization ? { token: selected.proxy.authorization } : {})
    });
    currentConfiguration = {
      status: "active",
      proxy: selected.proxy,
      selectedIndex: selected.selectedIndex,
      proxyCount: selected.proxyCount,
      fingerprint
    };
    installDispatcher(dispatcher);
    refreshKnownElectronSessions();
    startProbe(selected.proxy);
  }
  return { status: "active", selectedIndex: selected.selectedIndex, proxyCount: selected.proxyCount };
}

export function getNetworkProxyState(): NetworkProxyState {
  if (currentConfiguration.status === "disabled") return { status: "disabled" };
  if (currentConfiguration.status === "blocked") {
    return { status: "blocked", reason: currentConfiguration.reason };
  }
  return {
    status: "active",
    selectedIndex: currentConfiguration.selectedIndex,
    proxyCount: currentConfiguration.proxyCount
  };
}

export function getProxyAuthentication(authInfo: { isProxy: boolean; host: string; port: number }): { username: string; password: string } | null {
  if (!authInfo.isProxy || currentConfiguration.status !== "active") return null;
  const proxy = currentConfiguration.proxy;
  if (authInfo.host.toLowerCase() !== proxy.hostname.toLowerCase() || authInfo.port !== proxy.port) return null;
  if (!proxy.username && !proxy.password) return null;
  return { username: proxy.username, password: proxy.password };
}

export async function configureElectronProxySession(currentSession: Session): Promise<void> {
  knownSessions.add(currentSession);
  const previousFingerprint = configuredSessions.get(currentSession);
  if (previousFingerprint === currentConfiguration.fingerprint) return;

  try {
    if (currentConfiguration.status === "disabled") {
      if (previousFingerprint !== undefined) {
        await currentSession.setProxy({ mode: "direct" });
        await currentSession.closeAllConnections();
      }
    } else if (currentConfiguration.status === "active") {
      await currentSession.setProxy({
        mode: "fixed_servers",
        proxyRules: currentConfiguration.proxy.url.replace(/\/$/, "")
      });
      await currentSession.closeAllConnections();
    } else {
      await currentSession.setProxy({
        mode: "fixed_servers",
        proxyRules: "http://127.0.0.1:1"
      });
      await currentSession.closeAllConnections();
    }
    configuredSessions.set(currentSession, currentConfiguration.fingerprint);
  } catch {
    if (currentConfiguration.status !== "disabled") {
      await currentSession.setProxy({ mode: "fixed_servers", proxyRules: "http://127.0.0.1:1" }).catch(() => {});
      await currentSession.closeAllConnections().catch(() => {});
    }
    throw new Error("proxy_only_session_configuration_failed");
  }
}

export async function shutdownNetworkProxy(): Promise<void> {
  const active = installedDispatcher;
  installedDispatcher = null;
  currentConfiguration = { status: "disabled", fingerprint: "disabled" };
  setGlobalDispatcher(originalDispatcher);
  knownSessions.clear();
  probeGeneration += 1;
  currentProbe = null;
  if (active && active !== originalDispatcher) {
    await active.close().catch(() => {});
  }
}
