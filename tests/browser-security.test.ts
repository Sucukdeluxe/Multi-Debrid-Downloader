import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  openExternal: vi.fn(async () => undefined)
}));

vi.mock("electron", () => ({
  shell: {
    openExternal: electron.openExternal
  }
}));

import {
  applyMainWindowSecurity,
  applyRemoteLoginSecurity,
  createMainWindowWebPreferences,
  createRemoteLoginWebPreferences,
  isAllowedHttpsUrl,
  openAllowedExternalUrl,
  type HttpsHostRule
} from "../src/main/browser-security";

type NavigationHandler = (event: { preventDefault: () => void }, url: string) => void;
type WindowOpenHandler = (details: { url: string }) => { action: "allow" | "deny" };
type PermissionHandler = (webContents: unknown, permission: string, callback: (allowed: boolean) => void) => void;

function createWindow() {
  const webContentsHandlers = new Map<string, NavigationHandler>();
  let windowOpenHandler: WindowOpenHandler | null = null;
  let permissionHandler: PermissionHandler | null = null;
  const window = {
    webContents: {
      on: vi.fn((event: string, handler: NavigationHandler) => {
        webContentsHandlers.set(event, handler);
      }),
      setWindowOpenHandler: vi.fn((handler: WindowOpenHandler) => {
        windowOpenHandler = handler;
      }),
      session: {
        setPermissionRequestHandler: vi.fn((handler: PermissionHandler) => {
          permissionHandler = handler;
        })
      }
    }
  };
  return {
    window,
    navigate: (url: string) => {
      const event = { preventDefault: vi.fn() };
      webContentsHandlers.get("will-navigate")?.(event, url);
      return event;
    },
    redirect: (url: string) => {
      const event = { preventDefault: vi.fn() };
      webContentsHandlers.get("will-redirect")?.(event, url);
      return event;
    },
    openWindow: (url: string) => windowOpenHandler?.({ url }),
    requestPermission: (permission: string) => {
      const callback = vi.fn();
      permissionHandler?.(window.webContents, permission, callback);
      return callback;
    }
  };
}

describe("browser-security", () => {
  const githubOnly: HttpsHostRule[] = [{ hostname: "github.com" }];
  const realDebridProvider: HttpsHostRule[] = [{ hostname: "real-debrid.com", includeSubdomains: true }];

  beforeEach(() => {
    electron.openExternal.mockClear();
  });

  it("creates a restrictive main-window webPreferences profile with the existing preload", () => {
    expect(createMainWindowWebPreferences("C:\\MDD\\preload.js")).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: "C:\\MDD\\preload.js"
    });
  });

  it("creates a restrictive remote-login webPreferences profile for the requested partition", () => {
    expect(createRemoteLoginWebPreferences("persist:realdebrid-web")).toEqual({
      partition: "persist:realdebrid-web",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    });
  });

  it("denies main-window navigation to an untrusted origin", () => {
    const harness = createWindow();
    applyMainWindowSecurity(harness.window, {
      rendererUrl: "http://localhost:5180",
      externalHosts: githubOnly
    });

    const event = harness.navigate("https://evil.example/app");

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(electron.openExternal).not.toHaveBeenCalled();
  });

  it("opens only exact allowlisted HTTPS external URLs from denied main-window navigation", () => {
    const harness = createWindow();
    applyMainWindowSecurity(harness.window, {
      rendererUrl: "http://localhost:5180",
      externalHosts: githubOnly
    });

    const allowed = harness.navigate("https://github.com/Sucukdeluxe/multi-debrid-downloader");
    const lookalike = harness.navigate("https://github.com.evil.example/Sucukdeluxe");

    expect(allowed.preventDefault).toHaveBeenCalledTimes(1);
    expect(lookalike.preventDefault).toHaveBeenCalledTimes(1);
    expect(electron.openExternal).toHaveBeenCalledTimes(1);
    expect(electron.openExternal).toHaveBeenCalledWith("https://github.com/Sucukdeluxe/multi-debrid-downloader");
  });

  it("applies the main-window navigation policy to redirects", () => {
    const harness = createWindow();
    applyMainWindowSecurity(harness.window, {
      rendererUrl: "http://localhost:5180",
      externalHosts: githubOnly
    });

    const allowed = harness.redirect("https://github.com/Sucukdeluxe/multi-debrid-downloader");
    const lookalike = harness.redirect("https://github.com.evil.example/Sucukdeluxe");

    expect(allowed.preventDefault).toHaveBeenCalledTimes(1);
    expect(lookalike.preventDefault).toHaveBeenCalledTimes(1);
    expect(electron.openExternal).toHaveBeenCalledTimes(1);
    expect(electron.openExternal).toHaveBeenCalledWith("https://github.com/Sucukdeluxe/multi-debrid-downloader");
  });

  it("denies local-file navigation outside the packaged main renderer file", () => {
    const harness = createWindow();
    const rendererUrl = pathToFileURL(path.join("C:", "Program Files", "MDD", "resources", "app.asar", "build", "renderer", "index.html")).toString();
    const attackerUrl = pathToFileURL(path.join("C:", "Users", "Public", "attacker.html")).toString();
    applyMainWindowSecurity(harness.window, {
      rendererUrl,
      externalHosts: githubOnly
    });

    const renderer = harness.navigate(rendererUrl);
    const attacker = harness.navigate(attackerUrl);

    expect(renderer.preventDefault).not.toHaveBeenCalled();
    expect(attacker.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("allows the packaged renderer file despite Windows path casing differences", () => {
    const harness = createWindow();
    const rendererUrl = "file:///C:/Program%20Files/MDD/resources/app.asar/build/renderer/index.html";
    applyMainWindowSecurity(harness.window, {
      rendererUrl,
      externalHosts: githubOnly
    });

    const renderer = harness.navigate("file:///c:/program%20files/mdd/resources/app.asar/build/renderer/index.html");

    expect(renderer.preventDefault).not.toHaveBeenCalled();
  });

  it("denies popups while allowing exact allowlisted HTTPS popup URLs through the shell", () => {
    const harness = createWindow();
    applyMainWindowSecurity(harness.window, {
      rendererUrl: "http://localhost:5180",
      externalHosts: githubOnly
    });

    expect(harness.openWindow("https://github.com/Sucukdeluxe")).toEqual({ action: "deny" });
    expect(harness.openWindow("https://github.com.evil.example/Sucukdeluxe")).toEqual({ action: "deny" });
    expect(electron.openExternal).toHaveBeenCalledTimes(1);
    expect(electron.openExternal).toHaveBeenCalledWith("https://github.com/Sucukdeluxe");
  });

  it("denies permission requests centrally", () => {
    const harness = createWindow();
    applyMainWindowSecurity(harness.window, {
      rendererUrl: "http://localhost:5180",
      externalHosts: githubOnly
    });

    const callback = harness.requestPermission("media");

    expect(callback).toHaveBeenCalledWith(false);
  });

  it("allows remote-login navigation only to exact provider hostnames or their subdomains", () => {
    const harness = createWindow();
    applyRemoteLoginSecurity(harness.window, {
      providerHosts: realDebridProvider,
      externalHosts: realDebridProvider
    });

    const provider = harness.navigate("https://real-debrid.com/apitoken");
    const subdomain = harness.navigate("https://api.real-debrid.com/oauth");
    const lookalike = harness.navigate("https://real-debrid.com.evil.example/login");

    expect(provider.preventDefault).not.toHaveBeenCalled();
    expect(subdomain.preventDefault).not.toHaveBeenCalled();
    expect(lookalike.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("applies the remote-login navigation policy to redirects", () => {
    const harness = createWindow();
    applyRemoteLoginSecurity(harness.window, {
      providerHosts: realDebridProvider,
      externalHosts: realDebridProvider
    });

    const provider = harness.redirect("https://real-debrid.com/apitoken");
    const subdomain = harness.redirect("https://api.real-debrid.com/oauth");
    const lookalike = harness.redirect("https://real-debrid.com.evil.example/login");

    expect(provider.preventDefault).not.toHaveBeenCalled();
    expect(subdomain.preventDefault).not.toHaveBeenCalled();
    expect(lookalike.preventDefault).toHaveBeenCalledTimes(1);
    expect(electron.openExternal).not.toHaveBeenCalled();
  });

  it("returns false when allowed external URLs cannot be opened", async () => {
    electron.openExternal.mockRejectedValueOnce(new Error("shell rejected"));

    await expect(openAllowedExternalUrl("https://github.com/Sucukdeluxe", githubOnly)).resolves.toBe(false);
  });

  it("matches HTTPS allowlists without includes-based hostname shortcuts", () => {
    expect(isAllowedHttpsUrl("https://real-debrid.com/apitoken", realDebridProvider)).toBe(true);
    expect(isAllowedHttpsUrl("https://api.real-debrid.com/oauth", realDebridProvider)).toBe(true);
    expect(isAllowedHttpsUrl("http://real-debrid.com/apitoken", realDebridProvider)).toBe(false);
    expect(isAllowedHttpsUrl("https://real-debrid.com.evil.example/apitoken", realDebridProvider)).toBe(false);
    expect(isAllowedHttpsUrl("https://evil-real-debrid.com/apitoken", realDebridProvider)).toBe(false);
  });
});
