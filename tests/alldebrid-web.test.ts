import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFromPartition,
  mockSession,
  mockFetch,
  mockBrowserWindowCtor,
  mockBrowserWindow,
  mockLoadURL,
  mockShow,
  mockFocus,
  mockClose,
  mockSetWindowOpenHandler,
  mockSetPermissionRequestHandler
} = vi.hoisted(() => {
  const fetch = vi.fn();
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
      fetch,
      clearStorageData,
      clearCache
    },
    mockFetch: fetch,
    mockBrowserWindowCtor: BrowserWindowCtor,
    mockBrowserWindow: browserWindow,
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

describe("alldebrid-web", () => {
  beforeEach(() => {
    mockFromPartition.mockReturnValue(mockSession);
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockFromPartition.mockReturnValue(mockSession);
  });

  it("opens the AllDebrid login window with the shared restrictive browser boundary", async () => {
    const fallback = new AllDebridWebFallback(() => true);

    await fallback.openLoginWindow();

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
    expect(mockLoadURL).toHaveBeenCalledWith("https://alldebrid.com/register/?from=de");
    expect(mockShow).toHaveBeenCalled();
    expect(mockFocus).toHaveBeenCalled();
  });

  it("replaces a login window after its renderer process crashes", async () => {
    const fallback = new AllDebridWebFallback(() => true);

    await fallback.openLoginWindow();
    const crashHandler = mockBrowserWindow.webContents.on.mock.calls.find(([event]) => event === "render-process-gone")?.[1];

    expect(crashHandler).toBeTypeOf("function");
    crashHandler?.();
    await fallback.openLoginWindow();

    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(mockBrowserWindowCtor).toHaveBeenCalledTimes(2);
    expect(mockLoadURL).toHaveBeenCalledTimes(2);
  });

  it("uses an existing AllDebrid Web session to unrestrict without opening a login window", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      link: "https://alldebrid.direct/session-file.bin",
      filename: "session-file.bin",
      filesize: 9876
    }), { status: 200 }));
    const fallback = new AllDebridWebFallback(() => true);

    const result = await fallback.unrestrict("https://rapidgator.net/file/session");

    expect(result).toEqual({
      directUrl: "https://alldebrid.direct/session-file.bin",
      fileName: "session-file.bin",
      fileSize: 9876,
      retriesUsed: 0
    });
    expect(mockBrowserWindowCtor).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]?.[0]).toBe("https://alldebrid.com/service.php");
    expect(mockFetch.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      method: "POST",
      body: "link=https%3A%2F%2Frapidgator.net%2Ffile%2Fsession&nb=0&json=true&pw="
    }));
  });

  it("opens the login window after login_required and retries generation with the same session partition", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response("login", { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        link: "https://alldebrid.direct/retry-file.bin",
        filename: "retry-file.bin",
        filesize: 12345
      }), { status: 200 }));
    const fallback = new AllDebridWebFallback(() => true);

    const result = await fallback.unrestrict("https://rapidgator.net/file/retry");

    expect(result).toEqual({
      directUrl: "https://alldebrid.direct/retry-file.bin",
      fileName: "retry-file.bin",
      fileSize: 12345,
      retriesUsed: 0
    });
    expect(mockBrowserWindowCtor).toHaveBeenCalledTimes(1);
    expect(mockLoadURL).toHaveBeenCalledWith("https://alldebrid.com/register/?from=de");
    expect(mockShow).toHaveBeenCalled();
    expect(mockFocus).toHaveBeenCalled();
    expect(mockSetWindowOpenHandler).toHaveBeenCalledTimes(1);
    expect(mockSetPermissionRequestHandler).toHaveBeenCalledTimes(1);
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(mockFromPartition).toHaveBeenCalledWith("persist:alldebrid-web");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
