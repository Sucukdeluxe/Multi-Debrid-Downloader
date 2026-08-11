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
    on: unknown;
    setWindowOpenHandler: unknown;
    session: {
      setPermissionRequestHandler: unknown;
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
    webSecurity: true,
    allowRunningInsecureContent: false,
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

export async function openAllowedExternalUrl(rawUrl: string, hosts: readonly HttpsHostRule[]): Promise<boolean> {
  if (!isAllowedHttpsUrl(rawUrl, hosts)) {
    return false;
  }
  try {
    await shell.openExternal(new URL(rawUrl).toString());
    return true;
  } catch {
    return false;
  }
}

export function applyMainWindowSecurity(window: SecurityWindow, options: MainWindowSecurityOptions): void {
  applyCommonSecurity(window, options.externalHosts);
  const handleNavigation = (event: NavigationEvent, url: string): void => {
    if (isExpectedRendererUrl(url, options.rendererUrl)) {
      return;
    }
    event.preventDefault();
    void openAllowedExternalUrl(url, options.externalHosts);
  };
  onNavigation(window, "will-navigate", handleNavigation);
  onNavigation(window, "will-redirect", handleNavigation);
}

export function applyRemoteLoginSecurity(window: SecurityWindow, options: RemoteLoginSecurityOptions): void {
  applyCommonSecurity(window, options.externalHosts);
  const handleNavigation = (event: NavigationEvent, url: string): void => {
    if (isAllowedHttpsUrl(url, options.providerHosts)) {
      return;
    }
    event.preventDefault();
    void openAllowedExternalUrl(url, options.externalHosts);
  };
  onNavigation(window, "will-navigate", handleNavigation);
  onNavigation(window, "will-redirect", handleNavigation);
}

function applyCommonSecurity(window: SecurityWindow, externalHosts: readonly HttpsHostRule[]): void {
  const setWindowOpenHandler = window.webContents.setWindowOpenHandler as (handler: (details: { url: string }) => { action: "deny" }) => unknown;
  setWindowOpenHandler((details) => {
    void openAllowedExternalUrl(details.url, externalHosts);
    return { action: "deny" };
  });
  const setPermissionRequestHandler = window.webContents.session.setPermissionRequestHandler as (handler: (webContents: unknown, permission: string, callback: (allowed: boolean) => void) => void) => unknown;
  setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}

function onNavigation(window: SecurityWindow, event: "will-navigate" | "will-redirect", listener: (event: NavigationEvent, url: string) => void): void {
  const on = window.webContents.on as (event: "will-navigate" | "will-redirect", listener: (event: NavigationEvent, url: string) => void) => unknown;
  on(event, listener);
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
