import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkDdownloadOnline,
  checkOneFichierLinks,
  extractDdownloadFilenameFromHtml,
  filenameFromDdownloadUrlPath,
  isDdownloadLink,
  isOneFichierLink,
  parseDdownloadFileSize
} from "../src/main/debrid";
import { extractHosterFromUrl } from "../src/shared/hoster";
import { formatHosterLabel } from "../src/renderer/download-format";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

describe("1Fichier public metadata", () => {
  it("normalizes supported domains and resolves exact metadata in batches of 100", async () => {
    vi.useFakeTimers();
    const links = Array.from({ length: 101 }, (_unused, index) => `https://1fichier.com/?id${String(index).padStart(5, "0")}`);
    const batchSizes: number[] = [];
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body instanceof URLSearchParams ? init.body : new URLSearchParams(String(init?.body || ""));
      const requested = body.getAll("links[]");
      batchSizes.push(requested.length);
      return new Response(requested.map((link, index) => `${link};Archive.${batchSizes.length}.${index}.7z;${1000 + index}`).join("\n"), { status: 200 });
    }) as typeof fetch;

    const pending = checkOneFichierLinks(links);
    await vi.advanceTimersByTimeAsync(1000);
    const results = await pending;

    expect(batchSizes).toEqual([100, 1]);
    expect(results.get(links[0])).toEqual({ online: true, fileName: "Archive.1.0.7z", fileSizeBytes: 1000, accessRestricted: false });
    expect(results.get(links[100])).toEqual({ online: true, fileName: "Archive.2.0.7z", fileSizeBytes: 1000, accessRestricted: false });
    expect(isOneFichierLink("https://desfichiers.net/?abc12345")).toBe(true);
    expect(isOneFichierLink("https://piecejointe.net/?abc12345")).toBe(true);
    expect(extractHosterFromUrl("https://dl4free.com/?abc12345")).toBe("1fichier");
    expect(formatHosterLabel("1fichier")).toEqual({ compact: "1F", title: "1Fichier" });
  });

  it("distinguishes online, missing and private links without inventing metadata", async () => {
    const online = "https://1fichier.com/?online123";
    const missing = "https://1fichier.com/?gone12345";
    const privateLink = "https://1fichier.com/?priv12345";
    globalThis.fetch = vi.fn(async () => new Response([
      `${online};Movie&amp;Bonus.mkv;734003200`,
      `${missing};;;NOT FOUND`,
      `${privateLink};;;PRIVATE`
    ].join("\n"), { status: 200 })) as typeof fetch;

    const results = await checkOneFichierLinks([online, missing, privateLink]);

    expect(results.get(online)).toEqual({ online: true, fileName: "Movie&Bonus.mkv", fileSizeBytes: 734003200, accessRestricted: false });
    expect(results.get(missing)).toEqual({ online: false, fileName: "", fileSizeBytes: null, accessRestricted: false });
    expect(results.get(privateLink)).toEqual({ online: true, fileName: "", fileSizeBytes: null, accessRestricted: true });
  });
});

describe("DDownload public metadata", () => {
  it("normalizes domains and parses public filename and size", () => {
    const html = '<div class="dk-dl-icon" data-fn="Show.S01E02.German.DL.part02.rar"><h2 class="dk-dl-name">Show.S01E02.German.DL.part02.rar</h2><p class="dk-dl-size">502.00 MB</p>';

    expect(isDdownloadLink("https://ddownload.com/ntwscdw62gyb")).toBe(true);
    expect(isDdownloadLink("https://ddl.to/ntwscdw62gyb/Archive.part02.rar")).toBe(true);
    expect(isDdownloadLink("https://ddownload.com/login.html")).toBe(false);
    expect(filenameFromDdownloadUrlPath("https://ddl.to/ntwscdw62gyb/Archive.part02.rar")).toBe("Archive.part02.rar");
    expect(filenameFromDdownloadUrlPath("https://ddownload.com/ntwscdw62gyb")).toBe("");
    expect(extractDdownloadFilenameFromHtml(html)).toBe("Show.S01E02.German.DL.part02.rar");
    expect(parseDdownloadFileSize("502.00 MB")).toBe(526_385_152);
    expect(extractHosterFromUrl("https://ddl.to/ntwscdw62gyb/Archive.part02.rar")).toBe("ddownload");
    expect(formatHosterLabel("ddownload")).toEqual(expect.objectContaining({ compact: "DD", title: "DDownload" }));
    expect(extractDdownloadFilenameFromHtml('<h2 class="dk-dl-name">Release.Notes.pdf</h2>')).toBe("Release.Notes.pdf");
  });

  it("returns online and offline metadata while keeping challenge pages unknown", async () => {
    const responses = [
      new Response('<h2 class="dk-dl-name">Show.S01E02.mkv</h2><p class="dk-dl-size">840.02 MB</p>', { status: 200, headers: { "Content-Type": "text/html" } }),
      new Response("<h1>File Not Found</h1>", { status: 200, headers: { "Content-Type": "text/html" } }),
      new Response("<title>Just a moment...</title>", { status: 200, headers: { "Content-Type": "text/html" } })
    ];
    globalThis.fetch = vi.fn(async () => responses.shift() || new Response("", { status: 500 })) as typeof fetch;

    await expect(checkDdownloadOnline("https://ddownload.com/online1234")).resolves.toEqual({ online: true, fileName: "Show.S01E02.mkv", fileSizeBytes: 880_824_812 });
    await expect(checkDdownloadOnline("https://ddownload.com/missing1234")).resolves.toEqual({ online: false, fileName: "", fileSizeBytes: null });
    await expect(checkDdownloadOnline("https://ddownload.com/unknown1234")).resolves.toBeNull();
  });

  it("does not follow redirects outside the supported DDownload domains", async () => {
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.redirect === "follow") {
        return new Response('<h2 class="dk-dl-name">Internal.Secret.txt</h2><p class="dk-dl-size">1 KB</p>', { status: 200, headers: { "Content-Type": "text/html" } });
      }
      return new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/private" } });
    }) as typeof fetch;

    await expect(checkDdownloadOnline("https://ddownload.com/redirect123")).resolves.toBeNull();
  });

  it("rejects redirects that change the file code or downgrade HTTPS", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://ddownload.com/original123") return new Response(null, { status: 302, headers: { Location: "https://ddl.to/different456/Other.rar" } });
      if (url === "https://ddownload.com/secure123") return new Response(null, { status: 302, headers: { Location: "http://ddownload.com/secure123/File.rar" } });
      return new Response('<h2 class="dk-dl-name">Wrong.Target.rar</h2><p class="dk-dl-size">1 MB</p>', { status: 200, headers: { "Content-Type": "text/html" } });
    }) as typeof fetch;

    await expect(checkDdownloadOnline("https://ddownload.com/original123")).resolves.toBeNull();
    await expect(checkDdownloadOnline("https://ddownload.com/secure123")).resolves.toBeNull();
  });

  it("prefers concrete file markers over unrelated offline text in a valid page", async () => {
    globalThis.fetch = vi.fn(async () => new Response([
      '<h2 class="dk-dl-name">Still.Online.mkv</h2>',
      '<p class="dk-dl-size">10 MB</p>',
      '<script>const translatedFallback = "File Not Found";</script>'
    ].join(""), { status: 200, headers: { "Content-Type": "text/html" } })) as typeof fetch;

    await expect(checkDdownloadOnline("https://ddownload.com/online5678")).resolves.toEqual({
      online: true,
      fileName: "Still.Online.mkv",
      fileSizeBytes: 10_485_760
    });
  });
});
