import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSessionFetch,
  mockClearStorageData,
  mockClearCache,
  mockFromPartition,
  mockBrowserWindow,
  mockBrowserWindowCtor,
  mockExecuteJavaScript,
  mockLoadURL,
  mockShow,
  mockFocus,
  mockSetWindowOpenHandler,
  mockSetPermissionRequestHandler
} = vi.hoisted(() => {
  const sessionFetch = vi.fn();
  const clearStorageData = vi.fn();
  const clearCache = vi.fn();
  const fromPartition = vi.fn();
  const executeJavaScript = vi.fn();
  const loadURL = vi.fn(async () => {});
  const show = vi.fn();
  const focus = vi.fn();
  const setWindowOpenHandler = vi.fn();
  const setPermissionRequestHandler = vi.fn();
  const webContentsEvents: Record<string, (...args: unknown[]) => void> = {};
  const windowEvents: Record<string, (...args: unknown[]) => void> = {};
  let destroyed = false;

  const browserWindow = {
    isDestroyed: vi.fn(() => destroyed),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show,
    focus,
    close: vi.fn(() => {
      windowEvents.close?.();
      destroyed = true;
      windowEvents.closed?.();
    }),
    setMenuBarVisibility: vi.fn(),
    loadURL,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      windowEvents[event] = handler;
      return browserWindow;
    }),
    webContents: {
      setUserAgent: vi.fn(),
      setWindowOpenHandler,
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        webContentsEvents[event] = handler;
      }),
      executeJavaScript,
      session: {
        setPermissionRequestHandler
      }
    }
  };

  const BrowserWindowCtor = vi.fn((_options: unknown) => {
    destroyed = false;
    return browserWindow;
  });

  return {
    mockSessionFetch: sessionFetch,
    mockClearStorageData: clearStorageData,
    mockClearCache: clearCache,
    mockFromPartition: fromPartition,
    mockBrowserWindow: browserWindow,
    mockBrowserWindowCtor: BrowserWindowCtor,
    mockExecuteJavaScript: executeJavaScript,
    mockLoadURL: loadURL,
    mockShow: show,
    mockFocus: focus,
    mockSetWindowOpenHandler: setWindowOpenHandler,
    mockSetPermissionRequestHandler: setPermissionRequestHandler
  };
});

vi.mock("electron", () => ({
  session: {
    fromPartition: mockFromPartition
  },
  BrowserWindow: mockBrowserWindowCtor,
  shell: {
    openExternal: vi.fn()
  }
}));

import { RealDebridWebFallback, extractPrivateTokenFromHtml } from "../src/main/realdebrid-web";
import { AppController } from "../src/main/app-controller";
import { defaultSettings } from "../src/main/constants";

describe("realdebrid-web", () => {
  const mockSession = {
    fetch: mockSessionFetch,
    clearStorageData: mockClearStorageData,
    clearCache: mockClearCache
  };

  beforeEach(() => {
    mockFromPartition.mockReturnValue(mockSession);
    mockExecuteJavaScript.mockReset();
    mockLoadURL.mockClear();
    mockShow.mockClear();
    mockFocus.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    mockFromPartition.mockReturnValue(mockSession);
  });

  it("extracts private tokens from current Real-Debrid HTML patterns", () => {
    expect(extractPrivateTokenFromHtml("document.querySelectorAll('input[name=private_token]')[0].value = 'abc123';"))
      .toBe("abc123");
    expect(extractPrivateTokenFromHtml("<input type=\"text\" name=\"private_token\" value=\"def456\">"))
      .toBe("def456");
    expect(extractPrivateTokenFromHtml("<input value=\"ghi789\" name=\"private_token\">"))
      .toBe("ghi789");
  });

  it("uses the already logged-in browser window to warm the token cache before unrestricting", async () => {
    const apiFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      download: "https://cdn.real-debrid.example/file.bin",
      filename: "file.bin",
      filesize: 12345
    }), { status: 200 }));
    vi.stubGlobal("fetch", apiFetch);

    mockExecuteJavaScript.mockResolvedValue("token-from-window");

    const fallback = new RealDebridWebFallback("persist:realdebrid-web", () => true);
    await fallback.openLoginWindow();

    const result = await fallback.unrestrict("https://rapidgator.net/file/abc");

    expect(result).toEqual({
      directUrl: "https://cdn.real-debrid.example/file.bin",
      fileName: "file.bin",
      fileSize: 12345,
      retriesUsed: 0
    });
    expect(mockBrowserWindowCtor).toHaveBeenCalledTimes(1);
    expect(mockBrowserWindowCtor.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      webPreferences: {
        partition: "persist:realdebrid-web",
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false
      }
    }));
    expect(mockSetWindowOpenHandler).toHaveBeenCalledTimes(1);
    expect(mockSetPermissionRequestHandler).toHaveBeenCalledTimes(1);
    expect(mockLoadURL).toHaveBeenCalledWith("https://real-debrid.com");
    expect(mockShow).toHaveBeenCalled();
    expect(mockFocus).toHaveBeenCalled();
    expect(mockSessionFetch).not.toHaveBeenCalled();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch.mock.calls[0]?.[0]).toBe("https://api.real-debrid.com/rest/1.0/unrestrict/link");
    expect(mockBrowserWindow.webContents.executeJavaScript).toHaveBeenCalled();
  });

  it("never opens a login window from a background unrestrict request", async () => {
    mockSessionFetch.mockImplementation(async () => new Response("<html>login</html>", { status: 200 }));
    const first = new RealDebridWebFallback("persist:realdebrid-web-rdw_background_first", () => true);
    const second = new RealDebridWebFallback("persist:realdebrid-web-rdw_background_second", () => true);

    const firstController = new AbortController();
    const secondController = new AbortController();
    const abortTimer = setTimeout(() => {
      firstController.abort();
      secondController.abort();
    }, 50);
    try {
      await Promise.all([
        expect(first.unrestrict("https://rapidgator.net/file/background-first", firstController.signal))
          .rejects.toThrow("Login erforderlich"),
        expect(second.unrestrict("https://rapidgator.net/file/background-second", secondController.signal))
          .rejects.toThrow("Login erforderlich")
      ]);
    } finally {
      clearTimeout(abortTimer);
    }

    expect(mockBrowserWindowCtor).not.toHaveBeenCalled();
  });

  it("does not open a login window for an authenticated account with a fair-use error", async () => {
    mockSessionFetch.mockResolvedValue(new Response("<input name=\"private_token\" value=\"session-token\">", { status: 200 }));
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      error: "fair_usage_limit",
      error_code: 36
    }), { status: 440 })));
    const fallback = new RealDebridWebFallback("persist:realdebrid-web-rdw_limited", () => true);

    await expect(fallback.unrestrict("https://rapidgator.net/file/limited"))
      .rejects.toThrow("Real-Debrid Web HTTP 440");

    expect(mockBrowserWindowCtor).not.toHaveBeenCalled();
  });

  it("checks the logged-in browser account without exposing its token", async () => {
    mockExecuteJavaScript.mockResolvedValue("token-from-window");
    const apiFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      username: "web-user",
      email: "web-user@example.test",
      type: "premium",
      expiration: "2030-01-02T03:04:05.000Z"
    }), { status: 200 }));
    vi.stubGlobal("fetch", apiFetch);

    const fallback = new RealDebridWebFallback("persist:realdebrid-web", () => true);
    await fallback.openLoginWindow();
    const status = await fallback.probeLoginState();

    expect(status).toEqual({
      valid: true,
      username: "web-user",
      email: "web-user@example.test",
      isPremium: true,
      premiumUntilMs: Date.parse("2030-01-02T03:04:05.000Z"),
      message: "Premium aktiv"
    });
    expect(JSON.stringify(status)).not.toContain("token-from-window");
    expect(apiFetch).toHaveBeenCalledWith(
      "https://api.real-debrid.com/rest/1.0/user",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer token-from-window" })
      })
    );
  });

  it("does not reopen a login window from downloads after the user closed it", async () => {
    mockExecuteJavaScript.mockResolvedValue("");
    mockSessionFetch.mockImplementation(async () => new Response("<html>login</html>", { status: 200 }));
    const fallback = new RealDebridWebFallback("persist:realdebrid-web-rdw_dismissed", () => true);

    await fallback.openLoginWindow();
    mockBrowserWindow.close();

    await expect(fallback.unrestrict("https://rapidgator.net/file/first")).rejects.toThrow("Login erforderlich");
    await expect(fallback.unrestrict("https://rapidgator.net/file/second")).rejects.toThrow("Login erforderlich");
    expect(mockBrowserWindowCtor).toHaveBeenCalledTimes(1);
  });

  it("allows an explicitly requested login after the user closed the previous window", async () => {
    mockExecuteJavaScript.mockResolvedValue("");
    const fallback = new RealDebridWebFallback("persist:realdebrid-web-rdw_reopen", () => true);

    await fallback.openLoginWindow();
    mockBrowserWindow.close();
    await fallback.openLoginWindow();

    expect(mockBrowserWindowCtor).toHaveBeenCalledTimes(2);
  });

  it("notifies the controller when a new browser token is detected", async () => {
    mockExecuteJavaScript.mockResolvedValue("new-browser-token");
    const onAuthenticated = vi.fn();
    const fallback = new RealDebridWebFallback("persist:realdebrid-web", () => true, onAuthenticated);

    await fallback.openLoginWindow();
    await vi.waitFor(() => expect(onAuthenticated).toHaveBeenCalledTimes(1));
  });

  it("uses isolated persistent and transient partitions for separate browser accounts", async () => {
    const first = new RealDebridWebFallback("persist:realdebrid-web-rdw_first", () => true);
    const second = new RealDebridWebFallback("persist:realdebrid-web-rdw_second", () => true);

    await first.openLoginWindow();
    await second.openLoginWindow();

    expect(mockBrowserWindowCtor).toHaveBeenCalledTimes(2);
    expect(mockBrowserWindowCtor.mock.calls.map((call) => (call[0] as any).webPreferences.partition)).toEqual([
      "persist:realdebrid-web-rdw_first",
      "persist:realdebrid-web-rdw_second"
    ]);

    await first.clearSessions();

    expect(mockFromPartition).toHaveBeenCalledWith("persist:realdebrid-web-rdw_first");
    expect(mockFromPartition).toHaveBeenCalledWith("realdebrid-web-rdw_first");
    expect(mockFromPartition).not.toHaveBeenCalledWith("persist:realdebrid-web-rdw_second");
  });

  it("rejects unsafe browser partitions", () => {
    expect(() => new RealDebridWebFallback("persist:realdebrid-web-../shared", () => true)).toThrow(/Partition/i);
  });

  it("persists a reserved browser account only after a successful probe", async () => {
    const controller = Object.create(AppController.prototype) as any;
    const applyStatuses = vi.fn();
    const updateSettings = vi.fn((settings) => {
      controller.settings = settings;
    });
    const fallback = {
      probeLoginState: vi.fn().mockResolvedValueOnce({
        valid: false,
        username: "",
        email: "",
        isPremium: false,
        premiumUntilMs: null,
        message: "Nicht angemeldet"
      }).mockResolvedValueOnce({
        valid: true,
        username: "fixture-user",
        email: "fixture@example.test",
        isPremium: true,
        premiumUntilMs: Date.parse("2030-01-02T03:04:05.000Z"),
        message: "Premium aktiv"
      }),
      dispose: vi.fn()
    };
    controller.settings = defaultSettings();
    controller.pendingRealDebridWebAccountIds = new Map([["rdw_reserved", { generation: 0, dailyLimitBytes: 987_654 }]]);
    controller.realDebridWebGenerations = new Map([["rdw_reserved", 0]]);
    controller.realDebridWebFallbacks = new Map([["rdw_reserved", fallback]]);
    controller.manager = { applyDebridAccountStatuses: applyStatuses };
    controller.updateSettings = updateSettings;
    controller.getRealDebridWebFallback = () => fallback;

    await controller.refreshRealDebridWebStatus("rdw_reserved");

    expect(updateSettings).not.toHaveBeenCalled();
    expect(applyStatuses).not.toHaveBeenCalled();
    expect(controller.settings.realDebridWebAccountIds).toEqual([]);

    await controller.refreshRealDebridWebStatus("rdw_reserved");

    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(controller.settings.realDebridWebAccountIds).toEqual(["rdw_reserved"]);
    expect(controller.settings.realDebridAccountDailyLimitBytes).toEqual({ rdw_reserved: 987_654 });
    expect(applyStatuses).toHaveBeenCalledWith([
      expect.objectContaining({ accountId: "rdw_reserved", valid: true, username: "fixture-user" })
    ]);
  });

  it("ignores a successful probe that completes after its account was deleted", async () => {
    let resolveProbe!: (value: Record<string, unknown>) => void;
    const probe = new Promise<Record<string, unknown>>((resolve) => {
      resolveProbe = resolve;
    });
    const controller = Object.create(AppController.prototype) as any;
    const settings = defaultSettings();
    settings.realDebridWebAccountIds = ["rdw_existing"];
    const applyStatuses = vi.fn();
    controller.settings = settings;
    controller.pendingRealDebridWebAccountIds = new Map();
    controller.realDebridWebGenerations = new Map([["rdw_existing", 0]]);
    controller.manager = { applyDebridAccountStatuses: applyStatuses };
    controller.getRealDebridWebFallback = () => ({ probeLoginState: () => probe, dispose: vi.fn() });

    const running = controller.refreshRealDebridWebStatus("rdw_existing", 0);
    controller.settings = { ...settings, realDebridWebAccountIds: [] };
    controller.realDebridWebGenerations.set("rdw_existing", 1);
    resolveProbe({
      valid: true,
      username: "deleted-user",
      email: "deleted@example.test",
      isPremium: true,
      premiumUntilMs: Date.now() + 60_000,
      message: "Premium aktiv"
    });
    await running;

    expect(applyStatuses).not.toHaveBeenCalled();
    expect(controller.settings.realDebridWebAccountIds).toEqual([]);
  });

  it("clears cold account partitions without retaining a fallback instance", async () => {
    const controller = Object.create(AppController.prototype) as any;
    controller.settings = defaultSettings();
    controller.realDebridWebFallbacks = new Map();
    controller.pendingRealDebridWebAccountIds = new Map();
    controller.realDebridWebGenerations = new Map();
    controller.realDebridWebAuthenticationTasks = new Map();

    await controller.cleanupRealDebridWebAccount("rdw_cold", true);

    expect(mockFromPartition).toHaveBeenCalledWith("persist:realdebrid-web-rdw_cold");
    expect(mockFromPartition).toHaveBeenCalledWith("realdebrid-web-rdw_cold");
    expect(controller.realDebridWebFallbacks.size).toBe(0);
  });

  it("cleans a reserved account completely when opening its login window fails", async () => {
    mockLoadURL.mockRejectedValueOnce(new Error("load failed"));
    const controller = Object.create(AppController.prototype) as any;
    controller.settings = defaultSettings();
    controller.realDebridWebFallbacks = new Map();
    controller.pendingRealDebridWebAccountIds = new Map();
    controller.realDebridWebGenerations = new Map();
    controller.realDebridWebAuthenticationTasks = new Map();
    controller.audit = vi.fn();

    await expect(controller.openRealDebridLoginWindow({ accountId: "rdw_failed", create: true, dailyLimitBytes: 123_456 })).rejects.toThrow("load failed");

    expect(controller.pendingRealDebridWebAccountIds.size).toBe(0);
    expect(controller.realDebridWebFallbacks.size).toBe(0);
    expect(mockBrowserWindow.close).toHaveBeenCalled();
    expect(mockFromPartition).toHaveBeenCalledWith("persist:realdebrid-web-rdw_failed");
    expect(mockFromPartition).toHaveBeenCalledWith("realdebrid-web-rdw_failed");
  });

  it("cleans a reserved account when the user closes its login window", async () => {
    mockExecuteJavaScript.mockResolvedValue("");
    const controller = Object.create(AppController.prototype) as any;
    controller.settings = defaultSettings();
    controller.realDebridWebFallbacks = new Map();
    controller.pendingRealDebridWebAccountIds = new Map();
    controller.realDebridWebGenerations = new Map();
    controller.realDebridWebAuthenticationTasks = new Map();
    controller.audit = vi.fn();

    await controller.openRealDebridLoginWindow({ accountId: "rdw_closed", create: true, dailyLimitBytes: 123_456 });
    mockBrowserWindow.close();
    await vi.waitFor(() => expect(controller.realDebridWebFallbacks.size).toBe(0));

    expect(controller.pendingRealDebridWebAccountIds.size).toBe(0);
    expect(controller.settings.realDebridAccountDailyLimitBytes).toEqual({});
    expect(mockFromPartition).toHaveBeenCalledWith("persist:realdebrid-web-rdw_closed");
    expect(mockFromPartition).toHaveBeenCalledWith("realdebrid-web-rdw_closed");
  });

  it("does not prime or notify while a browser window is cleared programmatically", async () => {
    mockExecuteJavaScript.mockResolvedValue("");
    const onAuthenticated = vi.fn();
    const onClosed = vi.fn();
    const fallback = new RealDebridWebFallback("persist:realdebrid-web-rdw_cleanup", () => true, onAuthenticated, onClosed);
    await fallback.openLoginWindow();
    await vi.waitFor(() => expect(mockExecuteJavaScript).toHaveBeenCalled());
    mockExecuteJavaScript.mockReset();
    mockExecuteJavaScript.mockResolvedValue("stale-token");

    await fallback.clearSessions();
    await Promise.resolve();

    expect(mockExecuteJavaScript).not.toHaveBeenCalled();
    expect(onAuthenticated).not.toHaveBeenCalled();
    expect(onClosed).not.toHaveBeenCalled();
  });

  it("lets close-time authentication finish before cleaning a reserved account", async () => {
    let resolveClosingToken!: (token: string) => void;
    const closingToken = new Promise<string>((resolve) => {
      resolveClosingToken = resolve;
    });
    mockExecuteJavaScript.mockResolvedValueOnce("").mockReturnValueOnce(closingToken);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      username: "close-user",
      email: "close-user@example.test",
      type: "premium",
      expiration: "2030-01-02T03:04:05.000Z"
    }), { status: 200 })));
    const controller = Object.create(AppController.prototype) as any;
    controller.settings = defaultSettings();
    controller.realDebridWebFallbacks = new Map();
    controller.pendingRealDebridWebAccountIds = new Map();
    controller.realDebridWebGenerations = new Map();
    controller.realDebridWebAuthenticationTasks = new Map();
    controller.manager = { applyDebridAccountStatuses: vi.fn() };
    controller.updateSettings = vi.fn((settings) => {
      controller.settings = settings;
    });
    controller.audit = vi.fn();

    await controller.openRealDebridLoginWindow({ accountId: "rdw_close_auth", create: true, dailyLimitBytes: 123_456 });
    await vi.waitFor(() => expect(mockExecuteJavaScript).toHaveBeenCalledTimes(1));
    mockBrowserWindow.close();
    resolveClosingToken("close-time-token");
    await vi.waitFor(() => expect(controller.settings.realDebridWebAccountIds).toEqual(["rdw_close_auth"]));

    expect(controller.pendingRealDebridWebAccountIds.size).toBe(0);
    expect(controller.settings.realDebridAccountDailyLimitBytes).toEqual({ rdw_close_auth: 123_456 });
    expect(mockFromPartition).not.toHaveBeenCalledWith("persist:realdebrid-web-rdw_close_auth");
    expect(controller.manager.applyDebridAccountStatuses).toHaveBeenCalledWith([
      expect.objectContaining({ accountId: "rdw_close_auth", valid: true, username: "close-user" })
    ]);
  });

  it.each(["clear", "dispose"] as const)("ignores a session token that resolves after %s", async (mode) => {
    let resolveSessionFetch!: (response: Response) => void;
    const delayedResponse = new Promise<Response>((resolve) => {
      resolveSessionFetch = resolve;
    });
    mockSessionFetch.mockReturnValueOnce(delayedResponse);
    const onAuthenticated = vi.fn();
    const fallback = new RealDebridWebFallback(`persist:realdebrid-web-rdw_delayed_${mode}`, () => true, onAuthenticated);

    const probing = fallback.probeLoginState();
    await vi.waitFor(() => expect(mockSessionFetch).toHaveBeenCalledTimes(1));
    if (mode === "clear") {
      await fallback.clearSessions();
    } else {
      fallback.dispose();
    }
    resolveSessionFetch(new Response("<input name=\"private_token\" value=\"late-token\">", { status: 200 }));
    await probing;
    await Promise.resolve();

    expect((fallback as any).cachedToken).toBe("");
    expect(onAuthenticated).not.toHaveBeenCalled();
  });
});
