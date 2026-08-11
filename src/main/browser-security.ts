import { shell, type WebPreferences } from "electron";

export type HttpsHostRule = {
  hostname: string;
  includeSubdomains?: boolean;
};

type NavigationEvent = {
  preventDefault: () => void;
};

type SecurityWindow = {
  webContents: {
    on: (event: "will-navigate", listener: (event: NavigationEvent, url: string) => void) => unknown;
    setWindowOpenHandler: (handler: (details: { url: string }) => { action: "deny" }) => unknown;
    session: {
      setPermissionRequestHandler: (handler: (webContents: unknown, permission: string, callback: (allowed: boolean) => void) => void) => unknown;
    };
  };
};

export type MainWindowSecurityOptions = {
  rendererUrl: string;
  externalHosts: readonly HttpsHostRule[];
};

export type RemoteLoginSecurityOptions = {
  providerHosts: readonly HttpsHostRule[];
  externalHosts: readonly HttpsHostRule[];
};

export const MAIN_WINDOW_EXTERNAL_HOSTS: readonly HttpsHostRule[] = [
  { hostname: "github.com" },
  { hostname: "codeberg.org" },
  { hostname: "real-debrid.com", includeSubdomains: true },
  { hostname: "alldebrid.com", includeSubdomains: true },
  { hostname: "bestdebrid.com", includeSubdomains: true }
];

export const REALDEBRID_LOGIN_HOSTS: readonly HttpsHostRule[] = [
  { hostname: "real-debrid.com", includeSubdomains: true }
];

export const ALLDEBRID_LOGIN_HOSTS: readonly HttpsHostRule[] = [
  { hostname: "alldebrid.com", includeSubdomains: true }
];

export function createMainWindowWebPreferences(preload: string): WebPreferences {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    preload
  };
}

export function createRemoteLoginWebPreferences(partition: string): WebPreferences {
  return {
    partition,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false
  };
}

export function isAllowedHttpsUrl(rawUrl: string, hosts: readonly HttpsHostRule[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(String(rawUrl || ""));
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") {
    return false;
  }
  const hostname = parsed.hostname.toLowerCase();
  return hosts.some((host) => {
    const expected = host.hostname.toLowerCase();
    return hostname === expected || (host.includeSubdomains === true && hostname.endsWith(`.${expected}`));
  });
}

export function openAllowedExternalUrl(rawUrl: string, hosts: readonly HttpsHostRule[]): boolean {
  if (!isAllowedHttpsUrl(rawUrl, hosts)) {
    return false;
  }
  void shell.openExternal(new URL(rawUrl).toString());
  return true;
}

export function applyMainWindowSecurity(window: SecurityWindow, options: MainWindowSecurityOptions): void {
  applyCommonSecurity(window, options.externalHosts);
  window.webContents.on("will-navigate", (event, url) => {
    if (isExpectedRendererUrl(url, options.rendererUrl)) {
      return;
    }
    event.preventDefault();
    openAllowedExternalUrl(url, options.externalHosts);
  });
}

export function applyRemoteLoginSecurity(window: SecurityWindow, options: RemoteLoginSecurityOptions): void {
  applyCommonSecurity(window, options.externalHosts);
  window.webContents.on("will-navigate", (event, url) => {
    if (isAllowedHttpsUrl(url, options.providerHosts)) {
      return;
    }
    event.preventDefault();
    openAllowedExternalUrl(url, options.externalHosts);
  });
}

function applyCommonSecurity(window: SecurityWindow, externalHosts: readonly HttpsHostRule[]): void {
  window.webContents.setWindowOpenHandler((details) => {
    openAllowedExternalUrl(details.url, externalHosts);
    return { action: "deny" };
  });
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}

function isExpectedRendererUrl(rawUrl: string, expectedUrl: string): boolean {
  try {
    const parsed = new URL(String(rawUrl || ""));
    const expected = new URL(String(expectedUrl || ""));
    if (expected.protocol === "file:") {
      return parsed.protocol === "file:" && parsed.host === expected.host && parsed.pathname === expected.pathname;
    }
    return parsed.origin === expected.origin;
  } catch {
    return false;
  }
}
