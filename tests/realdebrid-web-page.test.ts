import { describe, expect, it } from "vitest";
import {
  buildRealDebridWebGenerationScript,
  normalizeRealDebridWebGenerationResult
} from "../src/main/realdebrid-web-page";

type PageHarnessOptions = {
  forbidden?: boolean;
  form?: boolean;
  pageReady?: boolean;
  outcome?: "generated" | "error";
  download?: string;
  text?: string;
  error?: string;
};

async function executePageScript(link: string, options: PageHarnessOptions = {}) {
  let observerCallback: (() => void) | null = null;
  let submitted = 0;
  let outcomeReady = false;
  const links = { value: "" };
  const password = { value: "retained-password" };
  const remote = { checked: true };
  const showLinks = { checked: true };
  const anchor = {
    href: options.download || "https://20-4.download.real-debrid.com/d/example/archive.rar",
    textContent: options.text || "DOWNLOAD: archive.rar (500MB)",
    getAttribute: () => options.download || "https://20-4.download.real-debrid.com/d/example/archive.rar"
  };
  const error = { textContent: options.error || "hoster_unavailable" };
  const container = {
    innerHTML: "",
    querySelector(selector: string) {
      if (!outcomeReady) return null;
      if (selector === ".link-generated a[href]" && (options.outcome || "generated") === "generated") return anchor;
      if (selector === ".link-error" && options.outcome === "error") return error;
      return null;
    }
  };
  const form = {
    requestSubmit() {
      submitted += 1;
      outcomeReady = true;
      observerCallback?.();
    }
  };
  const area = { onsubmit: options.pageReady === false ? null : () => undefined };
  const pageDocument = {
    querySelector(selector: string) {
      if (selector === "#forbidden") return options.forbidden ? {} : null;
      if (selector === "#unrestrictArea") return options.form === false ? null : area;
      if (selector === "#unrestrictArea #debform") return options.form === false ? null : form;
      if (selector === "#unrestrictArea #links") return options.form === false ? null : links;
      if (selector === "#unrestrictArea #password") return options.form === false ? null : password;
      if (selector === '#unrestrictArea input[name="remoteupload"]') return remote;
      if (selector === '#unrestrictArea input[name="showlinks"]') return showLinks;
      if (selector === "#unrestrictArea #links-container") return options.form === false ? null : container;
      return null;
    }
  };
  class MutationObserverMock {
    public constructor(callback: () => void) {
      observerCallback = callback;
    }
    public observe(): void {}
    public disconnect(): void {}
  }
  const script = buildRealDebridWebGenerationScript(link);
  const run = new Function(
    "window",
    "document",
    "MutationObserver",
    `return ${script};`
  ) as (
    pageWindow: Record<string, unknown>,
    pageDocument: Record<string, unknown>,
    mutationObserver: typeof MutationObserverMock
  ) => Promise<unknown>;

  const result = await run({}, pageDocument, MutationObserverMock);
  return { result, submitted, links, password, remote, showLinks };
}

describe("realdebrid-web-page", () => {
  it("submits the real downloader form and does not reimplement its network request", () => {
    const script = buildRealDebridWebGenerationScript("https://rapidgator.net/file/form-flow");

    expect(script).toContain("#unrestrictArea #debform");
    expect(script).toContain("#unrestrictArea #links");
    expect(script).toContain("#unrestrictArea #password");
    expect(script).toContain("#links-container");
    expect(script).toContain("requestSubmit()");
    expect(script).not.toContain("fetch(");
    expect(script).not.toContain("api.real-debrid.com");
    expect(script).not.toContain("app.real-debrid.com");
  });

  it("normalizes the generated anchor returned by the real website DOM", () => {
    const result = normalizeRealDebridWebGenerationResult({
      kind: "generated",
      download: "https://20-4.download.real-debrid.com/d/MSLNTUMB364GU/AHS.720.BDS01E01.part1.rar",
      text: "DOWNLOAD: AHS.720.BDS01E01.part1.rar (500MB)"
    }, "https://rapidgator.net/file/source");

    expect(result).toEqual({
      kind: "success",
      value: {
        directUrl: "https://20-4.download.real-debrid.com/d/MSLNTUMB364GU/AHS.720.BDS01E01.part1.rar",
        fileName: "AHS.720.BDS01E01.part1.rar",
        fileSize: 500 * 1024 * 1024,
        retriesUsed: 0
      }
    });
  });

  it.each([
    "https://rapidgator.net/folder/abc123",
    "https://1fichier.com/dir/example",
    "https://mega.nz/folder/example#key",
    "https://protected.to/f-example",
    "https://ncrypt.in/folder-example",
    "https://adf.ly/example",
    "https://4shared.com/folder/example",
    "https://filefactory.com/f/example",
    "https://linksave.in/example",
    "https://soundcloud.com/example/set",
    "https://go4up.com/dl/example",
    "https://uploaded.to/f/example",
    "https://turbobit.net/download/folder/example",
    "https://safelinking.net/p/example",
    "https://ed-protect.org/example",
    "https://drive.google.com/drive/folders/example",
    "https://mediafire.com/?sharekey=example",
    "https://mediafire.com/folder/example"
  ])("rejects multi-file folder links instead of silently returning only their first child: %s", async (link) => {
    const state = await executePageScript(link);

    expect(state.submitted).toBe(0);
    expect(state.result).toEqual({ kind: "page_error", error: "folder_link_not_supported" });
  });

  it("prefers the validated direct URL filename over the website label quality suffix", () => {
    const result = normalizeRealDebridWebGenerationResult({
      kind: "generated",
      download: "https://20-4.download.real-debrid.com/d/example/movie.mkv",
      text: "DOWNLOAD: movie.mkv (720p) (1.2GB)"
    }, "https://rapidgator.net/file/source");

    expect(result).toEqual({
      kind: "success",
      value: {
        directUrl: "https://20-4.download.real-debrid.com/d/example/movie.mkv",
        fileName: "movie.mkv",
        fileSize: Math.floor(1.2 * 1024 ** 3),
        retriesUsed: 0
      }
    });
  });

  it("submits the exact source link through the real form and returns only the generated anchor", async () => {
    const originalLink = "https://rapidgator.net/file/a'b</script>";
    const state = await executePageScript(originalLink, {
      outcome: "generated",
      download: "https://20-4.download.real-debrid.com/d/example/archive.rar",
      text: "DOWNLOAD: archive.rar (500MB)"
    });

    expect(state.submitted).toBe(1);
    expect(state.links.value).toBe(originalLink);
    expect(state.password.value).toBe("");
    expect(state.remote.checked).toBe(false);
    expect(state.showLinks.checked).toBe(false);
    expect(state.result).toEqual({
      kind: "generated",
      download: "https://20-4.download.real-debrid.com/d/example/archive.rar",
      text: "DOWNLOAD: archive.rar (500MB)"
    });
  });

  it.each([
    { name: "forbidden marker", options: { forbidden: true } },
    { name: "missing downloader form", options: { form: false } },
    { name: "website script not ready", options: { pageReady: false } }
  ])("does not submit the website form for $name", async ({ options }) => {
    const { result, submitted } = await executePageScript("https://rapidgator.net/file/login", options);

    expect(submitted).toBe(0);
    if (options.pageReady === false) {
      expect(result).toEqual({ kind: "request_error", error: "page_not_ready" });
    } else {
      expect(result).toEqual({ kind: "login_required" });
    }
  });

  it("normalizes an allowed Real-Debrid download result", () => {
    const result = normalizeRealDebridWebGenerationResult({
      kind: "response",
      status: 200,
      payload: {
        download: "https://20-4.download.real-debrid.com/d/MSLNTUMB364GU/AHS.720.BDS01E01.part1.rar",
        filename: "AHS.720.BDS01E01.part1.rar",
        filesize: 524_288_000
      }
    }, "https://rapidgator.net/file/source");

    expect(result).toEqual({
      kind: "success",
      value: {
        directUrl: "https://20-4.download.real-debrid.com/d/MSLNTUMB364GU/AHS.720.BDS01E01.part1.rar",
        fileName: "AHS.720.BDS01E01.part1.rar",
        fileSize: 524_288_000,
        retriesUsed: 0
      }
    });
  });

  it("accepts the exact download host and derives a safe filename while treating unclear size as unknown", () => {
    const result = normalizeRealDebridWebGenerationResult({
      kind: "response",
      status: 200,
      payload: {
        link: "https://download.real-debrid.com/d/example/encoded%20file.bin",
        filename: "",
        filesize: "unknown"
      }
    }, "https://1fichier.com/?source");

    expect(result).toEqual({
      kind: "success",
      value: {
        directUrl: "https://download.real-debrid.com/d/example/encoded%20file.bin",
        fileName: "encoded file.bin",
        fileSize: null,
        retriesUsed: 0
      }
    });
  });

  it.each([
    { value: { kind: "login_required" }, label: "page marker" },
    { value: { kind: "response", status: 401, payload: {} }, label: "HTTP 401" },
    { value: { kind: "response", status: 403, payload: {} }, label: "HTTP 403" },
    {
      value: { kind: "response", status: 400, payload: { error: "bad_token", error_code: 8 } },
      label: "token error"
    }
  ])("normalizes $label as login_required", ({ value }) => {
    expect(normalizeRealDebridWebGenerationResult(value, "https://hoster.example/file"))
      .toEqual({ kind: "login_required" });
  });

  it("preserves a bounded typed provider error", () => {
    const result = normalizeRealDebridWebGenerationResult({
      kind: "response",
      status: 503,
      payload: {
        error: "hoster_unavailable",
        error_code: 19,
        response_body: "must not escape"
      }
    }, "https://rapidgator.net/file/unavailable");

    expect(result).toEqual({
      kind: "error",
      status: 503,
      error: "hoster_unavailable",
      errorCode: 19,
      retryAfterMs: 0
    });
  });

  it("maps the real website error node to the matching provider error", async () => {
    const { result } = await executePageScript("https://rapidgator.net/file/unavailable", {
      outcome: "error",
      error: "https://rapidgator.net/file/unavailable: hoster_unavailable"
    });

    expect(normalizeRealDebridWebGenerationResult(result, "https://rapidgator.net/file/unavailable"))
      .toEqual({
        kind: "error",
        status: 503,
        error: "hoster_unavailable",
        errorCode: 19,
        retryAfterMs: 0
      });
  });

  it("strips a long source URL before classifying the trailing website error", async () => {
    const link = `https://rapidgator.net/file/traffic_exhausted-${"x".repeat(700)}`;
    const { result } = await executePageScript(link, {
      outcome: "error",
      error: `${link}: hoster_unavailable`
    });

    expect(normalizeRealDebridWebGenerationResult(result, link)).toEqual({
      kind: "error",
      status: 503,
      error: "hoster_unavailable",
      errorCode: 19,
      retryAfterMs: 0
    });
  });

  it("normalizes a bounded Retry-After value when a typed page response provides one", () => {
    const result = {
      kind: "response",
      status: 429,
      retryAfter: "12",
      payload: {
        error: "too_many_requests",
        error_code: 34
      }
    };
    expect(normalizeRealDebridWebGenerationResult(result, "https://rapidgator.net/file/rate-limit"))
      .toEqual({
        kind: "error",
        status: 429,
        error: "too_many_requests",
        errorCode: 34,
        retryAfterMs: 12_000
      });
  });

  it.each([
    "http://20-4.download.real-debrid.com/d/file.bin",
    "javascript:alert(1)",
    "https://real-debrid.com.evil.test/d/file.bin",
    "https://download.real-debrid.com.evil.test/d/file.bin",
    "https://evil.test/d/file.bin"
  ])("rejects hostile or foreign download URL %s", (download) => {
    const result = normalizeRealDebridWebGenerationResult({
      kind: "response",
      status: 200,
      payload: { download, filename: "file.bin", filesize: 1 }
    }, "https://hoster.example/file");

    expect(result).toEqual({
      kind: "error",
      status: 200,
      error: "invalid_download_url",
      errorCode: null,
      retryAfterMs: 0
    });
  });

  it("returns a typed parser error for malformed page results", () => {
    expect(normalizeRealDebridWebGenerationResult({ payload: "<html>private</html>" }, "https://hoster.example/file"))
      .toEqual({
        kind: "error",
        status: 0,
        error: "invalid_response",
        errorCode: null,
        retryAfterMs: 0
      });
  });
});
