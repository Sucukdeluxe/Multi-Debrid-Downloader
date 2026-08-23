import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFromPartition,
  mockSession,
  mockBrowserWindowCtor,
  mockLoadURL,
  mockShow,
  mockFocus,
  mockClose,
  mockSetWindowOpenHandler,
  mockSetPermissionRequestHandler
} = vi.hoisted(() => {
  const clearStorageData = vi.fn();
  const clearCache = vi.fn();
  const fromPartition = vi.fn();
  const loadURL = vi.fn(async () => {});
  const show = vi.fn();
  const focus = vi.fn();
  const setWindowOpenHandler = vi.fn();
  const setPermissionRequestHandler = vi.fn();
  const windowEvents: Record<string, (...args: unknown[]) => void> = {};
  let destroyed = false;

  const browserWindow = {
    isDestroyed: vi.fn(() => destroyed),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show,
    focus,
    close: vi.fn(() => {
      if (destroyed) {
        return;
      }
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
      setWindowOpenHandler,
      on: vi.fn(),
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
    mockFromPartition: fromPartition,
    mockSession: {
      clearStorageData,
      clearCache
    },
    mockBrowserWindowCtor: BrowserWindowCtor,
    mockLoadURL: loadURL,
    mockShow: show,
    mockFocus: focus,
    mockClose: browserWindow.close,
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

import { AllDebridWebFallback } from "../src/main/all-debrid-web";

function pinResponse(expiresIn = 600): Response {
  return new Response(JSON.stringify({
    status: "success",
    data: {
      pin: "ABCD",
      check: "check-token",
      expires_in: expiresIn,
      user_url: "https://alldebrid.com/pin/?pin=ABCD",
      base_url: "https://alldebrid.com/pin/"
    }
  }), { status: 200 });
}

function checkResponse(activated: boolean, expiresIn: number, apiKey?: string): Response {
  return new Response(JSON.stringify({
    status: "success",
    data: {
      activated,
      expires_in: expiresIn,
      ...(apiKey ? { apikey: apiKey } : {})
    }
  }), { status: 200 });
}

describe("alldebrid PIN auth", () => {
  beforeEach(() => {
    mockFromPartition.mockReturnValue(mockSession);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    mockFromPartition.mockReturnValue(mockSession);
  });

  it("opens the official PIN URL and reports the API key after activation", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(pinResponse())
      .mockResolvedValueOnce(checkResponse(false, 595))
      .mockResolvedValueOnce(checkResponse(true, 590, "all-debrid-api-key"));
    const authenticated = vi.fn();
    const fallback = new AllDebridWebFallback(() => true, authenticated);

    await fallback.openLoginWindow();

    expect(fetchMock.mock.calls[0]).toEqual([
      "https://api.alldebrid.com/v4.1/pin/get",
      expect.objectContaining({ method: "GET" })
    ]);
    expect(mockBrowserWindowCtor).toHaveBeenCalledTimes(1);
    expect(mockBrowserWindowCtor.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      webPreferences: {
        partition: "persist:alldebrid-web",
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false
      }
    }));
    expect(mockSetWindowOpenHandler).toHaveBeenCalledTimes(1);
    expect(mockSetPermissionRequestHandler).toHaveBeenCalledTimes(1);
    expect(mockLoadURL).toHaveBeenCalledWith("https://alldebrid.com/pin/?pin=ABCD");
    expect(mockShow).toHaveBeenCalledTimes(1);
    expect(mockFocus).toHaveBeenCalledTimes(1);
    expect(authenticated).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => expect(authenticated).toHaveBeenCalledWith({ apiKey: "all-debrid-api-key" }));

    expect(fetchMock.mock.calls[1]).toEqual([
      "https://api.alldebrid.com/v4/pin/check",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: "check=check-token&pin=ABCD"
      })
    ]);
    expect(authenticated).toHaveBeenCalledTimes(1);
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it("returns after opening the window instead of waiting for PIN activation", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(pinResponse())
      .mockReturnValueOnce(new Promise<Response>(() => {}));
    const fallback = new AllDebridWebFallback(() => false, vi.fn());

    await expect(fallback.openLoginWindow()).resolves.toBeUndefined();

    expect(mockLoadURL).toHaveBeenCalledWith("https://alldebrid.com/pin/?pin=ABCD");
    expect(mockShow).toHaveBeenCalledTimes(1);
  });

  it("reuses the active PIN window without creating another flow", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(pinResponse())
      .mockReturnValueOnce(new Promise<Response>(() => {}));
    const fallback = new AllDebridWebFallback(() => true, vi.fn());

    await fallback.openLoginWindow();
    await fallback.openLoginWindow();

    expect(mockBrowserWindowCtor).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.filter(([url]) => url === "https://api.alldebrid.com/v4.1/pin/get")).toHaveLength(1);
    expect(mockShow).toHaveBeenCalledTimes(2);
    expect(mockFocus).toHaveBeenCalledTimes(2);
  });

  it("stops polling after the user closes the window and never reopens it", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(pinResponse())
      .mockResolvedValue(checkResponse(false, 595));
    const authenticated = vi.fn();
    const fallback = new AllDebridWebFallback(() => true, authenticated);

    await fallback.openLoginWindow();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    mockClose();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mockBrowserWindowCtor).toHaveBeenCalledTimes(1);
    expect(authenticated).not.toHaveBeenCalled();
  });

  it("closes the window and stops polling when the caller aborts", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(pinResponse())
      .mockResolvedValue(checkResponse(false, 595));
    const authenticated = vi.fn();
    const fallback = new AllDebridWebFallback(() => true, authenticated);
    const controller = new AbortController();

    await fallback.openLoginWindow(controller.signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    controller.abort();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authenticated).not.toHaveBeenCalled();
  });

  it("times out from the server expiry without reopening the login window", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(pinResponse(1))
      .mockResolvedValueOnce(checkResponse(false, 1));
    const authenticated = vi.fn();
    const failed = vi.fn();
    const fallback = new AllDebridWebFallback(() => true, authenticated, failed);

    await fallback.openLoginWindow();
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => expect(failed).toHaveBeenCalledTimes(1));

    expect(failed.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ message: "AllDebrid PIN-Login Timeout" }));
    expect(authenticated).not.toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(mockBrowserWindowCtor).toHaveBeenCalledTimes(1);
  });
});
