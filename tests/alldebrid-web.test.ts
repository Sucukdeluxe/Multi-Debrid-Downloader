import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFromPartition,
  mockSession,
  mockBrowserWindowCtor,
  mockLoadURL,
  mockShow,
  mockFocus,
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
    mockBrowserWindowCtor: BrowserWindowCtor,
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
});
