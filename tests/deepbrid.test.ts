import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEEPBRID_ACCOUNT_ID,
  DeepbridApiError,
  DeepbridClient,
  parseDeepbridSize
} from "../src/main/deepbrid";

const originalFetch = globalThis.fetch;
const apiKey = "synthetic-deepbrid-key";

function jsonResponse(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });
}

function jsonBodyFailure(error: unknown): Response {
  const response = jsonResponse({ unused: true });
  Object.defineProperty(response, "json", {
    value: async () => {
      throw error;
    }
  });
  return response;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

describe("DeepbridClient", () => {
  it("returns validated account information from the documented user endpoint", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      username: "tester",
      email: "tester@example.invalid",
      type: "premium",
      expiration: "2027-01-02",
      maxDownloads: 5,
      maxConnections: 2,
      fidelity_points: 10
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const user = await new DeepbridClient(apiKey).getUser();

    expect(DEEPBRID_ACCOUNT_ID).toBe("svc-deepbrid");
    expect(user).toEqual({
      username: "tester",
      email: "tester@example.invalid",
      type: "premium",
      expiration: "2027-01-02",
      maxDownloads: 5,
      maxConnections: 2
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://www.deepbrid.com/api/v1/user");
    expect(init.method).toBe("GET");
    expect(new Headers(init.headers)).toEqual(new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`
    }));
  });

  it("normalizes the real string host list", async () => {
    const fetchMock = vi.fn(async () => jsonResponse([
      "rapidgator.net",
      "turbobit.net"
    ]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(new DeepbridClient(apiKey).getHosts()).resolves.toEqual([
      { domain: "rapidgator.net", status: "unknown" },
      { domain: "turbobit.net", status: "unknown" }
    ]);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers)).toEqual(new Headers({ Accept: "application/json" }));
  });

  it("loads public hosts without an API key", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(["rapidgator.net"]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(new DeepbridClient("").getHosts()).resolves.toEqual([
      { domain: "rapidgator.net", status: "unknown" }
    ]);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
  });

  it("normalizes the documented domain-to-status host objects", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse([
      { "rapidgator.net": "up" },
      { "ddownload.com": "down (2026-03-01)" }
    ])) as unknown as typeof fetch;

    await expect(new DeepbridClient(apiKey).getHosts()).resolves.toEqual([
      { domain: "rapidgator.net", status: "up" },
      { domain: "ddownload.com", status: "down (2026-03-01)" }
    ]);
  });

  it("generates a link with the exact headers and form fields", async () => {
    const sourceUrl = "https://hoster.example/file/id?token=source-token";
    const directUrl = "https://download.example/files/archive.zip?token=direct-token";
    const fetchMock = vi.fn(async () => jsonResponse({
      error: 0,
      message: "OK",
      original_link: sourceUrl,
      hoster: "hoster",
      filename: "archive.zip",
      link: directUrl,
      stream: "stream-value",
      size: "1.50 GB"
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await new DeepbridClient(apiKey).unrestrictLink(sourceUrl, undefined, "file password");

    expect(result).toEqual({
      fileName: "archive.zip",
      directUrl,
      fileSize: 1610612736,
      retriesUsed: 0
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://www.deepbrid.com/api/v1/generate/link");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers)).toEqual(new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded"
    }));
    expect(String(init.body)).toBe("link=https%3A%2F%2Fhoster.example%2Ffile%2Fid%3Ftoken%3Dsource-token&pass=file+password");
  });

  it("uses the final URL path segment when filename is absent", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({
      error: 0,
      message: "OK",
      link: "https://download.example/files/My%20Archive.bin?signature=synthetic",
      size: "512 KB"
    })) as unknown as typeof fetch;

    await expect(new DeepbridClient(apiKey).unrestrictLink("https://hoster.example/file/fallback")).resolves.toEqual({
      fileName: "My Archive.bin",
      directUrl: "https://download.example/files/My%20Archive.bin?signature=synthetic",
      fileSize: 524288,
      retriesUsed: 0
    });
  });

  it("reduces an API filename to a control-free basename", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({
      error: 0,
      message: "OK",
      filename: "folder/inner\\safe\u0000-name.bin\n",
      link: "https://download.example/files/fallback.bin",
      size: "1 KB"
    })) as unknown as typeof fetch;

    const result = await new DeepbridClient(apiKey).unrestrictLink("https://hoster.example/file/api-filename");

    expect(result.fileName).toBe("safe-name.bin");
  });

  it.each([
    ["CON.txt", "_CON.txt"],
    ["NUL", "_NUL"],
    ["bad<name>?.rar. ", "bad_name__.rar"],
    ["normal release 01.zip", "normal release 01.zip"]
  ])("makes the API filename %j Windows-safe", async (filename, expected) => {
    globalThis.fetch = vi.fn(async () => jsonResponse({
      error: 0,
      message: "OK",
      filename,
      link: "https://download.example/files/fallback.bin",
      size: "1 KB"
    })) as unknown as typeof fetch;

    const result = await new DeepbridClient(apiKey).unrestrictLink("https://hoster.example/file/windows-api-name");

    expect(result.fileName).toBe(expected);
  });

  it.each([
    ["https://download.example/files/COM9.log", "_COM9.log"],
    ["https://download.example/files/bad%3Cname%3E%3F.rar.%20", "bad_name__.rar"],
    ["https://download.example/files/normal-release.zip", "normal-release.zip"],
    ["https://download.example/files/%00%7F", "download.bin"]
  ])("makes the URL fallback from %s Windows-safe", async (directUrl, expected) => {
    globalThis.fetch = vi.fn(async () => jsonResponse({
      error: 0,
      message: "OK",
      link: directUrl,
      size: "1 KB"
    })) as unknown as typeof fetch;

    const result = await new DeepbridClient(apiKey).unrestrictLink("https://hoster.example/file/windows-url-name");

    expect(result.fileName).toBe(expected);
  });

  it("removes decoded path components from a fallback filename", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({
      error: 0,
      message: "OK",
      link: "https://download.example/files/%2E%2E%2Fsafe.bin",
      size: "1 KB"
    })) as unknown as typeof fetch;

    const result = await new DeepbridClient(apiKey).unrestrictLink("https://hoster.example/file/safe-fallback");

    expect(result.fileName).toBe("safe.bin");
  });

  it.each([
    ["HTML", new Response("<html>challenge secret</html>", { status: 200, headers: { "Content-Type": "text/html" } })],
    ["invalid JSON", new Response("{not-json}", { status: 200, headers: { "Content-Type": "application/json" } })],
    ["wrong top-level type", jsonResponse("not-an-object")],
    ["missing link", jsonResponse({ error: 0, filename: "missing.bin", size: "1 KB" })],
    ["credential-bearing link", jsonResponse({ link: "https://user:password@download.example/file.bin", size: "1 KB" })]
  ])("classifies %s success responses as malformed", async (_name, response) => {
    globalThis.fetch = vi.fn(async () => response) as unknown as typeof fetch;

    const error = await new DeepbridClient(apiKey)
      .unrestrictLink("https://hoster.example/file/malformed")
      .then(() => null, (value) => value);

    expect(error).toBeInstanceOf(DeepbridApiError);
    expect(error).toMatchObject({ classification: "malformed" });
  });

  it.each(["text/notjson", "application/jsonp", "text/jsonp"])("rejects the non-JSON media type %s", async (contentType) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      link: "https://download.example/file.bin",
      filename: "file.bin",
      size: "1 KB"
    }), {
      status: 200,
      headers: { "Content-Type": contentType }
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const error = await new DeepbridClient(apiKey)
      .unrestrictLink("https://hoster.example/file/media-type")
      .then(() => null, (value) => value);

    expect(error).toBeInstanceOf(DeepbridApiError);
    expect(error).toMatchObject({ classification: "malformed" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("accepts a standard +json media type", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      username: "problem-json-user",
      email: "problem-json@example.invalid",
      type: "premium",
      expiration: "2027-01-02",
      maxDownloads: 5,
      maxConnections: 1
    }), {
      status: 200,
      headers: { "Content-Type": "application/problem+json; charset=utf-8" }
    })) as unknown as typeof fetch;

    await expect(new DeepbridClient(apiKey).getUser()).resolves.toMatchObject({ username: "problem-json-user" });
  });

  it.each([401, 403])("classifies HTTP %i as auth and does not retry", async (status) => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: status, message: "invalid synthetic key" }, status));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const error = await new DeepbridClient(apiKey).getUser().then(() => null, (value) => value);

    expect(error).toBeInstanceOf(DeepbridApiError);
    expect(error).toMatchObject({ status, code: status, classification: "auth" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a safe auth error for an empty key without making a request", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const error = await new DeepbridClient("  ").getUser().then(() => null, (value) => value);

    expect(error).toBeInstanceOf(DeepbridApiError);
    expect(error).toMatchObject({ status: 401, code: 401, classification: "auth" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("respects and caps Retry-After before retrying a 429 response", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 429, message: "slow down" }, 429, { "Retry-After": "60" }))
      .mockResolvedValueOnce(jsonResponse({
        username: "retry-user",
        email: "retry@example.invalid",
        type: "premium",
        expiration: "2027-01-02",
        maxDownloads: 5,
        maxConnections: 1
      }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const pending = new DeepbridClient(apiKey).getUser();
    await vi.advanceTimersByTimeAsync(29999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toMatchObject({ username: "retry-user" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries immediately when Retry-After is zero", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 429, message: "retry now" }, 429, { "Retry-After": "0" }))
      .mockResolvedValueOnce(jsonResponse({
        username: "immediate-user",
        email: "immediate@example.invalid",
        type: "premium",
        expiration: "2027-01-02",
        maxDownloads: 5,
        maxConnections: 1
      }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const pending = new DeepbridClient(apiKey).getUser();
    await vi.advanceTimersByTimeAsync(0);

    await expect(pending).resolves.toMatchObject({ username: "immediate-user" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["HTTP 500", () => jsonResponse({ error: 500, message: "server failed" }, 500)],
    ["network failure", () => Promise.reject(new TypeError("fetch failed synthetic transport"))],
    ["timeout", () => Promise.reject(new DOMException("synthetic timeout", "TimeoutError"))]
  ])("limits %s retries to three total attempts", async (_name, resultFactory) => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(resultFactory);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const pending = new DeepbridClient(apiKey).getUser();
    const rejection = pending.catch((error) => error);
    await vi.runAllTimersAsync();
    const error = await rejection;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(error).toBeInstanceOf(DeepbridApiError);
    expect(error).toMatchObject({ classification: "temporary" });
  });

  it("retries timeout failures while reading a successful JSON body", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonBodyFailure(new DOMException("body timeout one", "TimeoutError")))
      .mockResolvedValueOnce(jsonBodyFailure(new DOMException("body timeout two", "TimeoutError")))
      .mockResolvedValueOnce(jsonResponse({
        username: "body-retry-user",
        email: "body-retry@example.invalid",
        type: "premium",
        expiration: "2027-01-02",
        maxDownloads: 5,
        maxConnections: 1
      }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const pending = new DeepbridClient(apiKey).getUser();
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toMatchObject({ username: "body-retry-user" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("propagates caller abort immediately without retrying", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const abortReason = new DOMException("caller cancelled", "AbortError");

    const pending = new DeepbridClient(apiKey).getUser(controller.signal);
    controller.abort(abortReason);

    await expect(pending).rejects.toBe(abortReason);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("honors an abort that occurs as fetch resolves", async () => {
    const controller = new AbortController();
    const abortReason = new DOMException("caller cancelled during response", "AbortError");
    const fetchMock = vi.fn(async () => {
      controller.abort(abortReason);
      return jsonResponse({
        username: "too-late",
        email: "too-late@example.invalid",
        type: "premium",
        expiration: "2027-01-02",
        maxDownloads: 5,
        maxConnections: 1
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(new DeepbridClient(apiKey).getUser(controller.signal)).rejects.toBe(abortReason);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("propagates caller abort while reading a successful response body", async () => {
    const controller = new AbortController();
    const abortReason = new DOMException("caller cancelled body", "AbortError");
    let bodyStartedResolve: (() => void) | undefined;
    const bodyStarted = new Promise<void>((resolve) => {
      bodyStartedResolve = resolve;
    });
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const response = jsonResponse({ unused: true });
      Object.defineProperty(response, "json", {
        value: () => new Promise<unknown>((_resolve, reject) => {
          bodyStartedResolve?.();
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        })
      });
      return response;
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const pending = new DeepbridClient(apiKey).getUser(controller.signal);
    await bodyStarted;
    controller.abort(abortReason);

    await expect(pending).rejects.toBe(abortReason);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("propagates caller abort during a retry pause without another request", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const abortReason = new DOMException("caller cancelled retry pause", "AbortError");
    const fetchMock = vi.fn(async () => jsonResponse({ error: 500, message: "temporary" }, 500));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const pending = new DeepbridClient(apiKey).getUser(controller.signal);
    const rejection = pending.catch((error) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    controller.abort(abortReason);
    const error = await rejection;
    await vi.runAllTimersAsync();

    expect(error).toBe(abortReason);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("classifies a numeric HTTP 200 API error as a safe link error", async () => {
    const sourceUrl = "https://hoster.example/file/http-200-secret";
    const directUrl = "https://download.example/http-200-direct-secret";
    globalThis.fetch = vi.fn(async () => jsonResponse({
      error: 17,
      message: `${apiKey} ${sourceUrl} ${directUrl}`,
      link: directUrl
    })) as unknown as typeof fetch;

    const error = await new DeepbridClient(apiKey).unrestrictLink(sourceUrl).then(() => null, (value) => value);

    expect(error).toBeInstanceOf(DeepbridApiError);
    expect(error).toMatchObject({ status: 200, code: 17, classification: "link" });
    expect(error.message).not.toContain(apiKey);
    expect(error.message).not.toContain(sourceUrl);
    expect(error.message).not.toContain(directUrl);
  });

  it("classifies structured generate failures without leaking secrets", async () => {
    const sourceUrl = "https://hoster.example/file/source-secret";
    const directUrl = "https://download.example/direct-secret";
    const fetchMock = vi.fn(async () => jsonResponse({
      error: 422,
      message: `${apiKey} ${sourceUrl} ${directUrl}`,
      link: directUrl
    }, 422));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const error = await new DeepbridClient(apiKey).unrestrictLink(sourceUrl).then(() => null, (value) => value);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(DeepbridApiError);
    expect(error).toMatchObject({ status: 422, code: 422, classification: "link" });
    expect(error.message).not.toContain(apiKey);
    expect(error.message).not.toContain(sourceUrl);
    expect(error.message).not.toContain(directUrl);
    expect(error.message).not.toContain("source-secret");
    expect(error.message).not.toContain("direct-secret");
  });
});

describe("parseDeepbridSize", () => {
  it.each([
    ["0 B", 0],
    ["512 KB", 524288],
    ["1.50 GB", 1610612736],
    ["2 TB", 2199023255552],
    [2048, 2048]
  ])("parses %j as bytes", (value, expected) => {
    expect(parseDeepbridSize(value)).toBe(expected);
  });

  it.each(["", "unknown", "-1 GB", Number.NaN, null, undefined, {}])("returns null for invalid value %j", (value) => {
    expect(parseDeepbridSize(value)).toBeNull();
  });
});
