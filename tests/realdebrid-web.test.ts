import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSessionFetch,
  mockClearStorageData,
  mockClearCache,
  mockFromPartition,
  mockBrowserWindows,
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
  const executeJavaScript = vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined);
  const loadURL = vi.fn(async (_url: string) => {});
  const show = vi.fn();
  const focus = vi.fn();
  const setWindowOpenHandler = vi.fn((_handler: unknown) => undefined);
  const setPermissionRequestHandler = vi.fn((_handler: unknown) => undefined);
  const browserWindows: any[] = [];

  const BrowserWindowCtor = vi.fn((_options: unknown) => {
    const webContentsEvents: Record<string, (...args: unknown[]) => void> = {};
    const windowEvents: Record<string, (...args: unknown[]) => void> = {};
    let destroyed = false;
    const browserWindow: any = {
      isDestroyed: vi.fn(() => destroyed),
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      show: vi.fn(() => show()),
      focus: vi.fn(() => focus()),
      close: vi.fn(() => {
        windowEvents.close?.();
        destroyed = true;
        windowEvents.closed?.();
      }),
      destroy: vi.fn(() => {
        destroyed = true;
        windowEvents.closed?.();
      }),
      setMenuBarVisibility: vi.fn(),
      loadURL: vi.fn((url: string) => loadURL(url)),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        windowEvents[event] = handler;
        return browserWindow;
      }),
      webContents: {
        setUserAgent: vi.fn(),
        setWindowOpenHandler: vi.fn((handler: unknown) => setWindowOpenHandler(handler)),
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          webContentsEvents[event] = handler;
        }),
        emit: vi.fn((event: string, ...args: unknown[]) => {
          webContentsEvents[event]?.(...args);
        }),
        executeJavaScript: vi.fn((...args: unknown[]) => executeJavaScript(...args)),
        session: {
          setPermissionRequestHandler: vi.fn((handler: unknown) => setPermissionRequestHandler(handler))
        }
      }
    };
    browserWindows.push(browserWindow);
    return browserWindow;
  });

  return {
    mockSessionFetch: sessionFetch,
    mockClearStorageData: clearStorageData,
    mockClearCache: clearCache,
    mockFromPartition: fromPartition,
    mockBrowserWindows: browserWindows,
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
    mockBrowserWindows.length = 0;
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

  it("uses an invisible authenticated website worker when the normal API host rejects the same link", async () => {
    const apiFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "hoster_unavailable",
      error_code: 19
    }), { status: 503 }));
    vi.stubGlobal("fetch", apiFetch);
    mockExecuteJavaScript.mockResolvedValue({
      kind: "generated",
      download: "https://20-4.download.real-debrid.com/d/example/file.bin",
      text: "DOWNLOAD: file.bin (12345B)"
    });

    const fallback = new RealDebridWebFallback("persist:realdebrid-web", () => true);
    const result = await fallback.unrestrict("https://rapidgator.net/file/abc");

    expect(result).toEqual({
      directUrl: "https://20-4.download.real-debrid.com/d/example/file.bin",
      fileName: "file.bin",
      fileSize: 12345,
      retriesUsed: 0
    });
    expect(mockBrowserWindowCtor).toHaveBeenCalledTimes(1);
    expect(mockBrowserWindowCtor.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      show: false,
      skipTaskbar: true,
      webPreferences: {
        partition: "persist:realdebrid-web",
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        backgroundThrottling: false
      }
    }));
    expect(mockSetWindowOpenHandler).toHaveBeenCalledTimes(1);
    expect(mockSetPermissionRequestHandler).toHaveBeenCalledTimes(1);
    expect(mockLoadURL).toHaveBeenCalledWith("https://real-debrid.com/downloader");
    expect(mockShow).not.toHaveBeenCalled();
    expect(mockFocus).not.toHaveBeenCalled();
    expect(mockSessionFetch).not.toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalled();
    expect(mockExecuteJavaScript).toHaveBeenCalled();
  });

  it("keeps the visible login window and hidden generator as separate account-isolated windows", async () => {
    mockExecuteJavaScript
      .mockResolvedValueOnce("window-token")
      .mockResolvedValueOnce({
        kind: "generated",
        download: "https://20-4.download.real-debrid.com/d/example/separate.bin",
        text: "DOWNLOAD: separate.bin (7B)"
      });
    const fallback = new RealDebridWebFallback("persist:realdebrid-web-rdw_separate", () => true);

    await fallback.openLoginWindow();
    const result = await fallback.unrestrict("https://rapidgator.net/file/separate");

    expect(result?.fileName).toBe("separate.bin");
    expect(mockBrowserWindows).toHaveLength(2);
    expect(mockBrowserWindows[0]).not.toBe(mockBrowserWindows[1]);
    expect(mockBrowserWindowCtor.mock.calls.map((call) => (call[0] as any).webPreferences.partition))
      .toEqual(["persist:realdebrid-web-rdw_separate", "persist:realdebrid-web-rdw_separate"]);
    expect(mockBrowserWindows[0]?.show).toHaveBeenCalledTimes(1);
    expect(mockBrowserWindows[1]?.show).not.toHaveBeenCalled();
  });

  it("surfaces a website hoster error without opening a visible login window", async () => {
    mockExecuteJavaScript.mockResolvedValue({
      kind: "page_error",
      error: "https://rapidgator.net/file/limited: hoster_unavailable"
    });
    const fallback = new RealDebridWebFallback("persist:realdebrid-web-rdw_hoster_error", () => true);

    const error = await fallback.unrestrict("https://rapidgator.net/file/limited").then(() => null, (value) => value);

    expect(error).toMatchObject({
      name: "RealDebridApiError",
      status: 503,
      apiError: "hoster_unavailable",
      apiErrorCode: 19
    });
    expect(mockShow).not.toHaveBeenCalled();
    expect(mockFocus).not.toHaveBeenCalled();
  });

  it("reports an expired website session without opening the login window from a download", async () => {
    mockExecuteJavaScript.mockResolvedValue({ kind: "login_required" });
    const fallback = new RealDebridWebFallback("persist:realdebrid-web-rdw_logged_out", () => true);

    await expect(fallback.unrestrict("https://rapidgator.net/file/logged-out"))
      .rejects.toThrow("Login erforderlich");

    expect(mockBrowserWindowCtor).toHaveBeenCalledTimes(1);
    expect(mockBrowserWindowCtor.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ show: false }));
    expect(mockShow).not.toHaveBeenCalled();
    expect(mockFocus).not.toHaveBeenCalled();
  });

  it("destroys a timed-out website worker before retrying the same link", async () => {
    mockExecuteJavaScript
      .mockResolvedValueOnce({ kind: "request_error", error: "generation_timeout" })
      .mockResolvedValueOnce({
        kind: "generated",
        download: "https://20-4.download.real-debrid.com/d/example/retry.bin",
        text: "DOWNLOAD: retry.bin (64B)"
      });
    const fallback = new RealDebridWebFallback("persist:realdebrid-web-rdw_timeout_retry", () => true);

    const result = await fallback.unrestrict("https://rapidgator.net/file/timeout-retry");

    expect(result?.fileName).toBe("retry.bin");
    expect(mockBrowserWindows).toHaveLength(2);
    expect(mockBrowserWindows[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(mockBrowserWindows[1]?.destroy).not.toHaveBeenCalled();
  });

  it("replaces a hidden worker after its renderer process crashes", async () => {
    mockExecuteJavaScript
      .mockResolvedValueOnce({
        kind: "generated",
        download: "https://20-4.download.real-debrid.com/d/example/before-crash.bin",
        text: "DOWNLOAD: before-crash.bin (32B)"
      })
      .mockResolvedValueOnce({
        kind: "generated",
        download: "https://20-4.download.real-debrid.com/d/example/after-crash.bin",
        text: "DOWNLOAD: after-crash.bin (48B)"
      });
    const fallback = new RealDebridWebFallback("persist:realdebrid-web-rdw_renderer_crash", () => true);
    await fallback.unrestrict("https://rapidgator.net/file/before-crash");

    mockBrowserWindows[0]?.webContents.emit("render-process-gone", {}, { reason: "crashed" });
    const recovered = await fallback.unrestrict("https://rapidgator.net/file/after-crash");

    expect(mockBrowserWindows[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(mockBrowserWindows).toHaveLength(2);
    expect(recovered?.fileName).toBe("after-crash.bin");
  });

  it("aborts a running website generation promptly and rebuilds its hidden worker for the next job", async () => {
    let finishFirst: (value: unknown) => void = () => {};
    const firstPageResult = new Promise<unknown>((resolve) => {
      finishFirst = resolve;
    });
    mockExecuteJavaScript
      .mockReturnValueOnce(firstPageResult)
      .mockResolvedValueOnce({
        kind: "generated",
        download: "https://20-4.download.real-debrid.com/d/example/next.bin",
        text: "DOWNLOAD: next.bin (42B)"
      });
    const fallback = new RealDebridWebFallback("persist:realdebrid-web-rdw_abort", () => true);
    const controller = new AbortController();
    const running = fallback.unrestrict("https://rapidgator.net/file/first", controller.signal);
    await vi.waitFor(() => expect(mockExecuteJavaScript).toHaveBeenCalledTimes(1));

    controller.abort("test-stop");
    const promptResult = await Promise.race([
      running.then(() => "resolved", (error) => String(error)),
      new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 120))
    ]);

    expect(promptResult).toMatch(/aborted:realdebrid-web/i);
    expect(mockBrowserWindows[0]?.destroy).toHaveBeenCalled();

    finishFirst({ kind: "login_required" });
    await running.catch(() => undefined);
    const next = await fallback.unrestrict("https://rapidgator.net/file/next");

    expect(next).toEqual({
      directUrl: "https://20-4.download.real-debrid.com/d/example/next.bin",
      fileName: "next.bin",
      fileSize: 42,
      retriesUsed: 0
    });
    expect(mockBrowserWindowCtor.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("destroys the hidden worker when a download is stopped during downloader page load", async () => {
    let finishLoad: () => void = () => {};
    const pageLoad = new Promise<void>((resolve) => {
      finishLoad = resolve;
    });
    mockLoadURL.mockReturnValueOnce(pageLoad);
    const fallback = new RealDebridWebFallback("persist:realdebrid-web-rdw_load_abort", () => true);
    const controller = new AbortController();
    const running = fallback.unrestrict("https://rapidgator.net/file/load-abort", controller.signal);
    await vi.waitFor(() => expect(mockLoadURL).toHaveBeenCalledWith("https://real-debrid.com/downloader"));

    controller.abort("test-stop-during-load");
    const promptResult = await Promise.race([
      running.then(() => "resolved", (error) => String(error)),
      new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 120))
    ]);

    expect(promptResult).toMatch(/aborted:realdebrid-web/i);
    expect(mockBrowserWindows[0]?.destroy).toHaveBeenCalledTimes(1);
    finishLoad();
  });

  it("never recreates a hidden worker after the account fallback was disposed", async () => {
    let failGeneration: (error: Error) => void = () => {};
    const pageResult = new Promise<unknown>((_resolve, reject) => {
      failGeneration = reject;
    });
    mockExecuteJavaScript.mockReturnValue(pageResult);
    const fallback = new RealDebridWebFallback("persist:realdebrid-web-rdw_disposed", () => true);
    const running = fallback.unrestrict("https://rapidgator.net/file/disposed");
    await vi.waitFor(() => expect(mockExecuteJavaScript).toHaveBeenCalledTimes(1));

    fallback.dispose();
    failGeneration(new Error("execution context destroyed"));

    await expect(running).rejects.toThrow("Sitzung wurde geschlossen");
    expect(mockBrowserWindowCtor).toHaveBeenCalledTimes(1);
  });

  it("interrupts a running website retry wait when the account fallback is disposed", async () => {
    mockExecuteJavaScript.mockResolvedValue({
      kind: "page_error",
      error: "https://rapidgator.net/file/retry-dispose: too_many_requests"
    });
    const fallback = new RealDebridWebFallback("persist:realdebrid-web-rdw_retry_dispose", () => true);
    const running = fallback.unrestrict("https://rapidgator.net/file/retry-dispose");
    await vi.waitFor(() => expect(mockExecuteJavaScript).toHaveBeenCalledTimes(1));

    fallback.dispose();
    const promptResult = await Promise.race([
      running.then(() => "resolved", (error) => String(error)),
      new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 120))
    ]);

    expect(promptResult).toMatch(/Sitzung wurde geschlossen/i);
    expect(mockExecuteJavaScript).toHaveBeenCalledTimes(1);
  });

  it("never opens a login window from a background unrestrict request", async () => {
    mockExecuteJavaScript.mockResolvedValue({ kind: "login_required" });
    const first = new RealDebridWebFallback("persist:realdebrid-web-rdw_background_first", () => true);
    const second = new RealDebridWebFallback("persist:realdebrid-web-rdw_background_second", () => true);

    await Promise.all([
      expect(first.unrestrict("https://rapidgator.net/file/background-first"))
        .rejects.toThrow("Login erforderlich"),
      expect(second.unrestrict("https://rapidgator.net/file/background-second"))
        .rejects.toThrow("Login erforderlich")
    ]);

    expect(mockBrowserWindowCtor.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mockBrowserWindowCtor.mock.calls.every((call) => (call[0] as any).show === false)).toBe(true);
    expect(mockShow).not.toHaveBeenCalled();
    expect(mockFocus).not.toHaveBeenCalled();
  });

  it("does not open a login window for an authenticated account with a fair-use error", async () => {
    mockExecuteJavaScript.mockResolvedValue({
      kind: "page_error",
      error: "https://rapidgator.net/file/limited: fair_usage_limit"
    });
    const fallback = new RealDebridWebFallback("persist:realdebrid-web-rdw_limited", () => true);

    await expect(fallback.unrestrict("https://rapidgator.net/file/limited"))
      .rejects.toThrow("Real-Debrid Web HTTP 429");

    expect(mockBrowserWindowCtor).toHaveBeenCalledTimes(1);
    expect(mockBrowserWindowCtor.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ show: false }));
    expect(mockShow).not.toHaveBeenCalled();
    expect(mockFocus).not.toHaveBeenCalled();
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
    mockExecuteJavaScript.mockResolvedValueOnce("").mockResolvedValue({ kind: "login_required" });
    const fallback = new RealDebridWebFallback("persist:realdebrid-web-rdw_dismissed", () => true);

    await fallback.openLoginWindow();
    mockBrowserWindows[0]?.close();

    await expect(fallback.unrestrict("https://rapidgator.net/file/first")).rejects.toThrow("Login erforderlich");
    await expect(fallback.unrestrict("https://rapidgator.net/file/second")).rejects.toThrow("Login erforderlich");
    expect(mockBrowserWindowCtor).toHaveBeenCalledTimes(3);
    expect(mockShow).toHaveBeenCalledTimes(1);
    expect(mockFocus).toHaveBeenCalledTimes(1);
  });

  it("allows an explicitly requested login after the user closed the previous window", async () => {
    mockExecuteJavaScript.mockResolvedValue("");
    const fallback = new RealDebridWebFallback("persist:realdebrid-web-rdw_reopen", () => true);

    await fallback.openLoginWindow();
    mockBrowserWindows[0]?.close();
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
      closeLoginWindow: vi.fn(),
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
    expect(controller.realDebridWebFallbacks.get("rdw_reserved")).toBe(fallback);
    expect(fallback.closeLoginWindow).toHaveBeenCalledTimes(1);
    expect(fallback.dispose).not.toHaveBeenCalled();
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

  it("disposes the hidden worker when a configured web account is disabled without clearing its partition", () => {
    const controller = Object.create(AppController.prototype) as any;
    const fallback = { dispose: vi.fn(), clearSessions: vi.fn() };
    const previous = defaultSettings();
    previous.realDebridWebAccountIds = ["rdw_disabled"];
    const current = {
      ...previous,
      realDebridDisabledAccountIds: ["rdw_disabled"]
    };
    controller.realDebridWebFallbacks = new Map([["rdw_disabled", fallback]]);

    controller.pruneRealDebridWebFallbacks(previous, current);

    expect(fallback.dispose).toHaveBeenCalledTimes(1);
    expect(fallback.clearSessions).not.toHaveBeenCalled();
    expect(controller.realDebridWebFallbacks.has("rdw_disabled")).toBe(false);
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
    expect(mockBrowserWindows[0]?.close).toHaveBeenCalled();
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
    mockBrowserWindows[0]?.close();
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
    mockBrowserWindows[0]?.close();
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
