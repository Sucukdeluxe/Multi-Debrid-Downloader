import type { Session } from "electron";
import { getGlobalDispatcher, ProxyAgent, setGlobalDispatcher, type Dispatcher } from "undici";
import type { AppSettings } from "../shared/types";
import { selectFixedProxy, type ProxyEndpoint } from "./proxy-segmented-download";

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
  if (active && active !== originalDispatcher) {
    await active.close().catch(() => {});
  }
}
