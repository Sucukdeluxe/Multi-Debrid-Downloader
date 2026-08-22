import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCookiesSet,
  mockFetch,
  mockClearStorageData,
  mockClearCache,
  mockFromPartition,
  mockSession
} = vi.hoisted(() => {
  const cookiesSet = vi.fn();
  const fetch = vi.fn();
  const clearStorageData = vi.fn();
  const clearCache = vi.fn();
  const fromPartition = vi.fn();
  return {
    mockCookiesSet: cookiesSet,
    mockFetch: fetch,
    mockClearStorageData: clearStorageData,
    mockClearCache: clearCache,
    mockFromPartition: fromPartition,
    mockSession: {
      cookies: {
        set: cookiesSet
      },
      fetch,
      clearStorageData,
      clearCache
    }
  };
});

vi.mock("electron", () => ({
  session: {
    fromPartition: mockFromPartition
  }
}));

vi.mock("../src/main/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

import { BestDebridWebFallback } from "../src/main/bestdebrid-web";

function createCookieFile(contents: string): string {
  const filePath = path.join(os.tmpdir(), `bestdebrid-cookies-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
  fs.writeFileSync(filePath, contents, "utf8");
  return filePath;
}

describe("bestdebrid-web", () => {
  const tempFiles: string[] = [];

  beforeEach(() => {
    mockFromPartition.mockReturnValue(mockSession);
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockFromPartition.mockReturnValue(mockSession);
    while (tempFiles.length > 0) {
      const filePath = tempFiles.pop();
      if (!filePath) {
        continue;
      }
      try {
        fs.rmSync(filePath, { force: true });
      } catch {
      }
    }
  });

  it("imports HttpOnly Netscape cookies instead of skipping them as comments", async () => {
    const filePath = createCookieFile([
      "# Netscape HTTP Cookie File",
      "#HttpOnly_.bestdebrid.com\tTRUE\t/\tTRUE\t1803585385\tPHPSESSID\tsecret-session",
      ".bestdebrid.com\tTRUE\t/\tFALSE\t1806720721\t_ga\ttracking"
    ].join("\n"));
    tempFiles.push(filePath);

    const fallback = new BestDebridWebFallback(() => true);
    const count = await fallback.importCookiesFromFile(filePath);

    expect(count).toBe(2);
    expect(mockClearStorageData).toHaveBeenCalledTimes(1);
    expect(mockClearStorageData).toHaveBeenCalledWith({
      storages: ["cookies", "indexdb", "localstorage", "serviceworkers", "cachestorage"]
    });
    expect(mockCookiesSet).toHaveBeenCalledTimes(2);
    expect(mockCookiesSet).toHaveBeenCalledWith(expect.objectContaining({
      name: "PHPSESSID",
      domain: ".bestdebrid.com",
      httpOnly: true,
      secure: true
    }));
  });

  it("deduplicates conflicting session cookies and prefers the HttpOnly variant", async () => {
    const filePath = createCookieFile([
      "# Netscape HTTP Cookie File",
      "bestdebrid.com\tFALSE\t/\tTRUE\t1803585384\tPHPSESSID\tnon-http-only",
      "#HttpOnly_.bestdebrid.com\tTRUE\t/\tTRUE\t1803585385\tPHPSESSID\thttp-only"
    ].join("\n"));
    tempFiles.push(filePath);

    const fallback = new BestDebridWebFallback(() => true);
    const count = await fallback.importCookiesFromFile(filePath);

    expect(count).toBe(1);
    expect(mockCookiesSet).toHaveBeenCalledTimes(1);
    expect(mockCookiesSet).toHaveBeenCalledWith(expect.objectContaining({
      name: "PHPSESSID",
      value: "http-only",
      httpOnly: true,
      domain: ".bestdebrid.com"
    }));
  });

  it("rejects cookie files that only contain tracking cookies", async () => {
    const filePath = createCookieFile([
      "# Netscape HTTP Cookie File",
      ".bestdebrid.com\tTRUE\t/\tTRUE\t1803585385\t__stripe_mid\tstripe",
      ".bestdebrid.com\tTRUE\t/\tFALSE\t1806720721\t_ga\ttracking"
    ].join("\n"));
    tempFiles.push(filePath);

    const fallback = new BestDebridWebFallback(() => true);

    await expect(fallback.importCookiesFromFile(filePath))
      .rejects.toThrow("Login-Cookie");
    expect(mockCookiesSet).not.toHaveBeenCalled();
  });

  it("treats BestDebrid free-user errors as logged-out sessions when the account page is guest-only", async () => {
    const filePath = createCookieFile([
      "# Netscape HTTP Cookie File",
      "bestdebrid.com\tFALSE\t/\tTRUE\t1803585385\tPHPSESSID\tsecret-session"
    ].join("\n"));
    tempFiles.push(filePath);

    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: 1,
        message: "Free users are not allowed to download using a VPN or proxy. Please purchase a premium plan."
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response("<div class=\"font-medium\">Guest</div>", { status: 200 }));

    const fallback = new BestDebridWebFallback(() => true);
    await fallback.importCookiesFromFile(filePath);

    await expect(fallback.unrestrict("https://1fichier.com/?abc"))
      .rejects.toThrow("Nicht eingeloggt");
    await expect(fallback.unrestrict("https://1fichier.com/?abc"))
      .rejects.toThrow("Keine Cookies importiert");

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0]?.[0]).toBe("https://bestdebrid.com/api/v1/generateLink");
    expect(mockFetch.mock.calls[1]?.[0]).toBe("https://bestdebrid.com/en/downloader/");
  });

  it("releases an aborted caller while the active web request ignores its signal", async () => {
    const filePath = createCookieFile([
      "# Netscape HTTP Cookie File",
      "bestdebrid.com\tFALSE\t/\tTRUE\t1803585385\tPHPSESSID\tsecret-session"
    ].join("\n"));
    tempFiles.push(filePath);
    const fallback = new BestDebridWebFallback(() => true);
    await fallback.importCookiesFromFile(filePath);
    let rejectRequest!: (error: Error) => void;
    mockFetch
      .mockReturnValueOnce(new Promise<Response>((_resolve, reject) => {
        rejectRequest = reject;
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: 0,
        link: "https://bestdebrid.direct/second.bin",
        filename: "second.bin",
        size: "444 B"
      }), { status: 200 }));
    const controller = new AbortController();
    const running = fallback.unrestrict("https://1fichier.com/?abort-race", controller.signal)
      .then(() => "resolved" as const, (error) => String(error));

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    controller.abort("test-stop");
    const outcome = await Promise.race([
      running,
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 200))
    ]);

    expect(outcome).toContain("aborted:bestdebrid-web");
    const secondOutcome = await Promise.race([
      fallback.unrestrict("https://1fichier.com/?second"),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 200))
    ]);
    expect(secondOutcome).toEqual({
      directUrl: "https://bestdebrid.direct/second.bin",
      fileName: "second.bin",
      fileSize: 444,
      retriesUsed: 0
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    rejectRequest(new Error("late bestdebrid rejection"));
    await Promise.resolve();
  });
});
