import fs from "node:fs";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnMock, unrefMock, onceMock } = vi.hoisted(() => {
  const unref = vi.fn();
  const child: { once: ReturnType<typeof vi.fn>; unref: ReturnType<typeof vi.fn> } = {
    once: vi.fn(),
    unref
  };
  const once = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    if (event === "spawn") {
      queueMicrotask(() => handler());
    }
    return child;
  });
  child.once = once;
  const spawn = vi.fn(() => child);
  return {
    spawnMock: spawn,
    unrefMock: unref,
    onceMock: once
  };
});

vi.mock("node:child_process", () => ({
  spawn: spawnMock
}));

import { abortActiveUpdateDownload, buildInstallerLaunchArgs, checkGitHubUpdate, installLatestUpdate, isRemoteNewer, normalizeUpdateRepo, parseVersionParts } from "../src/main/update";
import { APP_VERSION } from "../src/main/constants";
import { UpdateCheckResult, UpdateInstallProgress } from "../src/shared/types";

const originalFetch = globalThis.fetch;

function sha256Hex(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function sha512Hex(buffer: Buffer): string {
  return crypto.createHash("sha512").update(buffer).digest("hex");
}

function createExecutablePayload() {
  const payload = Buffer.alloc(128 * 1024);
  payload.write("MZ");
  return payload;
}

afterEach(() => {
  abortActiveUpdateDownload();
  globalThis.fetch = originalFetch;
  spawnMock.mockClear();
  unrefMock.mockClear();
  onceMock.mockClear();
  vi.restoreAllMocks();
});

describe("update", () => {
  it("settles a backpressured update write when the target stream errors", async () => {
    class FailingWriteStream extends EventEmitter {
      private markWriteStarted!: () => void;
      readonly writeStarted = new Promise<void>((resolve) => {
        this.markWriteStarted = resolve;
      });

      write(): boolean {
        this.markWriteStarted();
        return false;
      }

      end(callback?: () => void): this {
        callback?.();
        return this;
      }

      destroy(): this {
        return this;
      }
    }

    const stream = new FailingWriteStream();
    vi.spyOn(fs, "createWriteStream").mockReturnValue(stream as unknown as ReturnType<typeof fs.createWriteStream>);
    globalThis.fetch = (async (): Promise<Response> => new Response(Buffer.alloc(160 * 1024, 1), {
      status: 200,
      headers: { "Content-Length": String(160 * 1024) }
    })) as typeof fetch;

    const pending = installLatestUpdate("owner/repo", {
      updateAvailable: true,
      currentVersion: APP_VERSION,
      latestVersion: "9.9.9",
      latestTag: "",
      releaseUrl: "https://example.invalid/release",
      setupAssetUrl: "https://example.invalid/",
      setupAssetName: "",
      setupAssetDigest: `sha256:${"a".repeat(64)}`
    });

    await stream.writeStarted;
    const writeError = Object.assign(new Error("disk full"), { code: "ENOSPC" });
    stream.emit("error", writeError);
    const timeout = Symbol("timeout");
    const outcome = await Promise.race([
      pending,
      new Promise<typeof timeout>((resolve) => setTimeout(() => resolve(timeout), 100))
    ]);

    if (outcome === timeout) {
      stream.emit("drain");
      await pending;
    }

    expect(outcome).not.toBe(timeout);
    expect(outcome).toEqual(expect.objectContaining({ started: false }));
    expect((outcome as { message: string }).message).toMatch(/disk full|ENOSPC/i);

    const next = await installLatestUpdate("owner/repo", {
      updateAvailable: false,
      currentVersion: APP_VERSION,
      latestVersion: APP_VERSION,
      latestTag: `v${APP_VERSION}`,
      releaseUrl: "https://example.invalid/release"
    });
    expect(next.message).not.toBe("Update-Download läuft bereits");
  });

  it("settles shutdown abort while an update write waits for drain", async () => {
    class BackpressuredWriteStream extends EventEmitter {
      private markWriteStarted!: () => void;
      private wasDestroyed = false;
      readonly writeStarted = new Promise<void>((resolve) => {
        this.markWriteStarted = resolve;
      });

      write(): boolean {
        this.markWriteStarted();
        return false;
      }

      end(callback?: () => void): this {
        callback?.();
        return this;
      }

      destroy(): this {
        this.wasDestroyed = true;
        return this;
      }

      emitLateDestroyError(error: Error): boolean {
        if (!this.wasDestroyed) {
          throw new Error("stream was not destroyed");
        }
        const handled = this.listenerCount("error") > 0;
        if (handled) {
          this.emit("error", error);
        }
        this.emit("close");
        return handled;
      }
    }

    const stream = new BackpressuredWriteStream();
    vi.spyOn(fs, "createWriteStream").mockReturnValue(stream as unknown as ReturnType<typeof fs.createWriteStream>);
    globalThis.fetch = (async (): Promise<Response> => new Response(Buffer.alloc(160 * 1024, 1), {
      status: 200,
      headers: { "Content-Length": String(160 * 1024) }
    })) as typeof fetch;

    const pending = installLatestUpdate("owner/repo", {
      updateAvailable: true,
      currentVersion: APP_VERSION,
      latestVersion: "9.9.9",
      latestTag: "",
      releaseUrl: "https://example.invalid/release",
      setupAssetUrl: "https://example.invalid/",
      setupAssetName: "",
      setupAssetDigest: `sha256:${"a".repeat(64)}`
    });

    await stream.writeStarted;
    abortActiveUpdateDownload();
    const timeout = Symbol("timeout");
    const outcome = await Promise.race([
      pending,
      new Promise<typeof timeout>((resolve) => setTimeout(() => resolve(timeout), 100))
    ]);

    if (outcome === timeout) {
      stream.emit("drain");
      await pending;
    }

    expect(outcome).not.toBe(timeout);
    expect(outcome).toEqual(expect.objectContaining({ started: false }));
    expect((outcome as { message: string }).message).toMatch(/aborted:update_shutdown/i);
    expect(stream.emitLateDestroyError(new Error("late destroy failure"))).toBe(true);
    expect(stream.listenerCount("error")).toBe(0);

    const next = await installLatestUpdate("owner/repo", {
      updateAvailable: false,
      currentVersion: APP_VERSION,
      latestVersion: APP_VERSION,
      latestTag: `v${APP_VERSION}`,
      releaseUrl: "https://example.invalid/release"
    });
    expect(next.message).not.toBe("Update-Download läuft bereits");
  });

  it("does not wait for a stalled body cancellation during shutdown", async () => {
    class BackpressuredWriteStream extends EventEmitter {
      private markWriteStarted!: () => void;
      private markDestroyed!: () => void;
      readonly writeStarted = new Promise<void>((resolve) => {
        this.markWriteStarted = resolve;
      });
      readonly destroyed = new Promise<void>((resolve) => {
        this.markDestroyed = resolve;
      });

      write(): boolean {
        this.markWriteStarted();
        return false;
      }

      end(callback?: () => void): this {
        callback?.();
        return this;
      }

      destroy(): this {
        this.markDestroyed();
        this.emit("close");
        return this;
      }
    }

    const stream = new BackpressuredWriteStream();
    const cancelState: { release?: () => void } = {};
    let markCancellationRequested!: () => void;
    const cancellationRequested = new Promise<void>((resolve) => {
      markCancellationRequested = resolve;
    });
    const responseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(160 * 1024));
      },
      cancel() {
        markCancellationRequested();
        return new Promise<void>((resolve) => {
          cancelState.release = resolve;
        });
      }
    });
    vi.spyOn(fs, "createWriteStream").mockReturnValue(stream as unknown as ReturnType<typeof fs.createWriteStream>);
    globalThis.fetch = (async (): Promise<Response> => new Response(responseBody, {
      status: 200,
      headers: { "Content-Length": String(160 * 1024) }
    })) as typeof fetch;

    const pending = installLatestUpdate("owner/repo", {
      updateAvailable: true,
      currentVersion: APP_VERSION,
      latestVersion: "9.9.9",
      latestTag: "",
      releaseUrl: "https://example.invalid/release",
      setupAssetUrl: "https://example.invalid/",
      setupAssetName: "",
      setupAssetDigest: `sha256:${"a".repeat(64)}`
    });

    await stream.writeStarted;
    abortActiveUpdateDownload();
    const timeout = Symbol("timeout");
    const outcome = await Promise.race([
      pending,
      new Promise<typeof timeout>((resolve) => setTimeout(() => resolve(timeout), 100))
    ]);
    const cancellationOutcome = await Promise.race([
      cancellationRequested.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 100))
    ]);

    if (outcome === timeout) {
      cancelState.release?.();
      await pending;
    }
    cancelState.release?.();

    expect(outcome).not.toBe(timeout);
    expect(cancellationOutcome).toBe(true);
    expect(outcome).toEqual(expect.objectContaining({ started: false }));
    expect((outcome as { message: string }).message).toMatch(/aborted:update_shutdown/i);
    await expect(stream.destroyed).resolves.toBeUndefined();
  });

  it("propagates the original write error from the end callback", async () => {
    const finalWriteError = Object.assign(new Error("final disk failure"), { code: "EIO" });

    class FinalizingWriteStream extends EventEmitter {
      write(): boolean {
        return true;
      }

      end(callback?: (error?: Error) => void): this {
        callback?.(finalWriteError);
        this.emit("error", finalWriteError);
        this.emit("close");
        return this;
      }

      destroy(): this {
        this.emit("close");
        return this;
      }
    }

    const stream = new FinalizingWriteStream();
    vi.spyOn(fs, "createWriteStream").mockReturnValue(stream as unknown as ReturnType<typeof fs.createWriteStream>);
    globalThis.fetch = (async (): Promise<Response> => new Response(Buffer.alloc(160 * 1024, 1), {
      status: 200,
      headers: { "Content-Length": String(160 * 1024) }
    })) as typeof fetch;

    const outcome = await installLatestUpdate("owner/repo", {
      updateAvailable: true,
      currentVersion: APP_VERSION,
      latestVersion: "9.9.9",
      latestTag: "",
      releaseUrl: "https://example.invalid/release",
      setupAssetUrl: "https://example.invalid/",
      setupAssetName: "",
      setupAssetDigest: `sha256:${"a".repeat(64)}`
    });

    expect(outcome).toEqual(expect.objectContaining({ started: false }));
    expect(outcome.message).toMatch(/final disk failure|EIO/i);
  });

  it("waits for close and propagates a late close error after a successful end callback", async () => {
    const lateCloseError = Object.assign(new Error("late close failure EIO"), { code: "EIO" });

    class LateCloseFailureStream extends EventEmitter {
      private closed = false;

      write(): boolean {
        return true;
      }

      end(callback?: (error?: Error) => void): this {
        callback?.();
        this.emit("finish");
        queueMicrotask(() => {
          this.emit("error", lateCloseError);
          this.closed = true;
          this.emit("close");
        });
        return this;
      }

      destroy(): this {
        if (!this.closed) {
          this.closed = true;
          this.emit("close");
        }
        return this;
      }
    }

    const stream = new LateCloseFailureStream();
    const renameSpy = vi.spyOn(fs.promises, "rename").mockRejectedValue(new Error("rename must not run"));
    vi.spyOn(fs, "createWriteStream").mockReturnValue(stream as unknown as ReturnType<typeof fs.createWriteStream>);
    globalThis.fetch = (async (): Promise<Response> => new Response(Buffer.alloc(160 * 1024, 1), {
      status: 200,
      headers: { "Content-Length": String(160 * 1024) }
    })) as typeof fetch;

    const outcome = await installLatestUpdate("owner/repo", {
      updateAvailable: true,
      currentVersion: APP_VERSION,
      latestVersion: "9.9.9",
      latestTag: "",
      releaseUrl: "https://example.invalid/release",
      setupAssetUrl: "https://example.invalid/",
      setupAssetName: "",
      setupAssetDigest: `sha256:${"a".repeat(64)}`
    });

    expect(outcome).toEqual(expect.objectContaining({ started: false }));
    expect(outcome.message).toMatch(/late close failure|EIO/i);
    expect(renameSpy).not.toHaveBeenCalled();
    expect(stream.listenerCount("error")).toBe(0);
  });

  it("settles an idle timeout while an update write waits for drain", async () => {
    const previousTimeout = process.env.RD_UPDATE_BODY_IDLE_TIMEOUT_MS;
    process.env.RD_UPDATE_BODY_IDLE_TIMEOUT_MS = "1000";

    class BackpressuredWriteStream extends EventEmitter {
      private markWriteStarted!: () => void;
      private markDestroyed!: () => void;
      readonly writeStarted = new Promise<void>((resolve) => {
        this.markWriteStarted = resolve;
      });
      readonly destroyed = new Promise<void>((resolve) => {
        this.markDestroyed = resolve;
      });

      write(): boolean {
        this.markWriteStarted();
        return false;
      }

      end(callback?: () => void): this {
        callback?.();
        return this;
      }

      destroy(): this {
        this.markDestroyed();
        this.emit("close");
        return this;
      }
    }

    const stream = new BackpressuredWriteStream();
    const externalErrorListener = (): void => undefined;
    stream.on("error", externalErrorListener);
    vi.spyOn(fs, "createWriteStream").mockReturnValue(stream as unknown as ReturnType<typeof fs.createWriteStream>);
    globalThis.fetch = (async (): Promise<Response> => new Response(Buffer.alloc(160 * 1024, 1), {
      status: 200,
      headers: { "Content-Length": String(160 * 1024) }
    })) as typeof fetch;

    try {
      const pending = installLatestUpdate("owner/repo", {
        updateAvailable: true,
        currentVersion: APP_VERSION,
        latestVersion: "9.9.9",
        latestTag: "",
        releaseUrl: "https://example.invalid/release",
        setupAssetUrl: "https://example.invalid/",
        setupAssetName: "",
        setupAssetDigest: `sha256:${"a".repeat(64)}`
      });

      await stream.writeStarted;
      const timeout = Symbol("timeout");
      const idleOutcome = await Promise.race([
        stream.destroyed.then(() => "destroyed" as const),
        new Promise<typeof timeout>((resolve) => setTimeout(() => resolve(timeout), 1600))
      ]);
      abortActiveUpdateDownload();
      const outcome = await pending;

      expect(idleOutcome).toBe("destroyed");
      expect(outcome).toEqual(expect.objectContaining({ started: false }));
      expect(stream.listenerCount("drain")).toBe(0);
      expect(stream.listeners("error")).toEqual([externalErrorListener]);
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.RD_UPDATE_BODY_IDLE_TIMEOUT_MS;
      } else {
        process.env.RD_UPDATE_BODY_IDLE_TIMEOUT_MS = previousTimeout;
      }
    }
  });

  it("always refreshes release metadata before installing instead of using the previous check result", () => {
    const controller = fs.readFileSync(new URL("../src/main/app-controller.ts", import.meta.url), "utf8");
    const install = controller.slice(controller.indexOf("public async installUpdate"), controller.indexOf("public addLinks"));

    expect(install).toContain("installLatestUpdate(this.settings.updateRepo, undefined, onProgress)");
    expect(install).not.toContain("cacheAgeMs");
    expect(install).not.toContain("this.lastUpdateCheck &&");
  });

  it("normalizes update repo input", () => {
    expect(normalizeUpdateRepo("")).toBe("Sucukdeluxe/Multi-Debrid-Downloader");
    expect(normalizeUpdateRepo("owner/repo")).toBe("owner/repo");
    expect(normalizeUpdateRepo("https://github.com/owner/repo")).toBe("owner/repo");
    expect(normalizeUpdateRepo("https://www.github.com/owner/repo")).toBe("owner/repo");
    expect(normalizeUpdateRepo("https://github.com/owner/repo/releases/tag/v1.2.3")).toBe("owner/repo");
    expect(normalizeUpdateRepo("github.com/owner/repo.git")).toBe("owner/repo");
    expect(normalizeUpdateRepo("git@github.com:owner/repo.git")).toBe("owner/repo");
  });

  it("uses normalized repo slug for API requests", async () => {
    let requestedUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      requestedUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return new Response(
        JSON.stringify({
          tag_name: `v${APP_VERSION}`,
          html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
          assets: []
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }) as typeof fetch;

    const result = await checkGitHubUpdate("https://github.com/owner/repo/releases");
    expect(requestedUrl).toBe("https://api.github.com/repos/owner/repo/releases/latest");
    expect(result.currentVersion).toBe(APP_VERSION);
    expect(result.latestVersion).toBe(APP_VERSION);
    expect(result.updateAvailable).toBe(false);
  });

  it("picks setup executable asset from release list", async () => {
    globalThis.fetch = (async (): Promise<Response> => new Response(
      JSON.stringify({
        tag_name: "v9.9.9",
        html_url: "https://github.com/owner/repo/releases/tag/v9.9.9",
        assets: [
          {
            name: "Multi-Debrid-Downloader-9.9.9-portable.exe",
            browser_download_url: "https://example.invalid/portable.exe"
          },
          {
            name: "Multi-Debrid-Downloader-Setup-9.9.9.exe",
            browser_download_url: "https://example.invalid/setup.exe",
            digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
          }
        ]
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    )) as typeof fetch;

    const result = await checkGitHubUpdate("owner/repo");
    expect(result.updateAvailable).toBe(true);
    expect(result.setupAssetUrl).toBe("https://example.invalid/setup.exe");
    expect(result.setupAssetName).toBe("Multi-Debrid-Downloader-Setup-9.9.9.exe");
  });

  it("combines every stable release note newer than the installed version", async () => {
    const [major = 2, minor = 0, patch = 0] = parseVersionParts(APP_VERSION);
    const version = (offset: number): string => `${major}.${minor}.${patch + offset}`;
    const requestedUrls: string[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requestedUrls.push(url);
      if (url.endsWith("/releases/latest")) {
        return new Response(JSON.stringify({
          tag_name: `v${version(3)}`,
          html_url: `https://github.com/owner/repo/releases/tag/v${version(3)}`,
          body: "Latest changes",
          assets: []
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      return new Response(JSON.stringify([
        { tag_name: `v${version(3)}`, body: "Latest changes", draft: false, prerelease: false },
        { tag_name: `v${version(2)}`, body: "Middle changes", draft: false, prerelease: false },
        { tag_name: `v${version(1)}`, body: "First missed changes", draft: false, prerelease: false },
        { tag_name: `v${version(4)}`, body: "Draft changes", draft: true, prerelease: false },
        { tag_name: `v${version(5)}`, body: "Prerelease changes", draft: false, prerelease: true },
        { tag_name: `v${version(0)}`, body: "Installed changes", draft: false, prerelease: false },
        { tag_name: `v${version(-1)}`, body: "Older changes", draft: false, prerelease: false }
      ]), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    const result = await checkGitHubUpdate("owner/repo");

    expect(requestedUrls).toEqual([
      "https://api.github.com/repos/owner/repo/releases/latest",
      "https://api.github.com/repos/owner/repo/releases?per_page=100&page=1"
    ]);
    expect(result.releaseNotes).toBe([
      `v${version(3)}`,
      "Latest changes",
      "",
      `v${version(2)}`,
      "Middle changes",
      "",
      `v${version(1)}`,
      "First missed changes"
    ].join("\n"));
  });

  it("uses silent NSIS install flags with auto-run after update", () => {
    expect(buildInstallerLaunchArgs()).toEqual(["/S", "--updated", "--force-run"]);
  });

  it("falls back to alternate download URL when setup asset URL returns 404", async () => {
    const executablePayload = createExecutablePayload();
    const executableDigest = sha256Hex(executablePayload);
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requestedUrls.push(url);

      if (url.includes("stale-setup.exe")) {
        return new Response("missing", { status: 404 });
      }
      if (url.includes("/releases/download/v9.9.9/")) {
        return new Response(executablePayload, {
          status: 200,
          headers: { "Content-Type": "application/octet-stream" }
        });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    const prechecked: UpdateCheckResult = {
      updateAvailable: true,
      currentVersion: APP_VERSION,
      latestVersion: "9.9.9",
      latestTag: "v9.9.9",
      releaseUrl: "https://github.com/owner/repo/releases/tag/v9.9.9",
      setupAssetUrl: "https://example.invalid/stale-setup.exe",
      setupAssetName: "Multi-Debrid-Downloader-Setup-9.9.9.exe",
      setupAssetDigest: `sha256:${executableDigest}`
    };

    const result = await installLatestUpdate("owner/repo", prechecked);
    expect(result.started).toBe(true);
    expect(requestedUrls.some((url) => url.includes("/releases/download/v9.9.9/"))).toBe(true);
    expect(requestedUrls.filter((url) => url.includes("stale-setup.exe"))).toHaveLength(1);
  });

  it("skips draft tag payload and resolves setup asset from stable latest release", async () => {
    const executablePayload = createExecutablePayload();
    const requestedUrls: string[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requestedUrls.push(url);

      if (url.endsWith("/releases/tags/v9.9.9")) {
        return new Response(JSON.stringify({
          tag_name: "v9.9.9",
          draft: true,
          prerelease: false,
          assets: [
            {
              name: "Draft Setup 9.9.9.exe",
              browser_download_url: "https://example.invalid/draft-setup.exe"
            }
          ]
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (url.endsWith("/releases/latest")) {
        const stableDigest = sha256Hex(executablePayload);
        return new Response(JSON.stringify({
          tag_name: "v9.9.9",
          draft: false,
          prerelease: false,
          assets: [
            {
              name: "Stable Setup 9.9.9.exe",
              browser_download_url: "https://example.invalid/stable-setup.exe",
              digest: `sha256:${stableDigest}`
            }
          ]
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (url.includes("stable-setup.exe")) {
        return new Response(executablePayload, {
          status: 200,
          headers: { "Content-Type": "application/octet-stream" }
        });
      }

      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    const prechecked: UpdateCheckResult = {
      updateAvailable: true,
      currentVersion: APP_VERSION,
      latestVersion: "9.9.9",
      latestTag: "v9.9.9",
      releaseUrl: "https://github.com/owner/repo/releases/tag/v9.9.9",
      setupAssetUrl: "",
      setupAssetName: ""
    };

    const result = await installLatestUpdate("owner/repo", prechecked);
    expect(result.started).toBe(true);
    expect(requestedUrls.some((url) => url.endsWith("/releases/tags/v9.9.9"))).toBe(true);
    expect(requestedUrls.some((url) => url.endsWith("/releases/latest"))).toBe(true);
    expect(requestedUrls.some((url) => url.includes("stable-setup.exe"))).toBe(true);
    expect(requestedUrls.some((url) => url.includes("draft-setup.exe"))).toBe(false);
  });

  it("times out hanging release JSON body reads", async () => {
    vi.useFakeTimers();
    try {
      const cancelSpy = vi.fn(async () => undefined);
      globalThis.fetch = (async (): Promise<Response> => ({
        ok: true,
        status: 200,
        headers: new Headers({ "Content-Type": "application/json" }),
        json: () => new Promise(() => undefined),
        body: {
          cancel: cancelSpy
        }
      } as unknown as Response)) as typeof fetch;

      const pending = checkGitHubUpdate("owner/repo");
      await vi.advanceTimersByTimeAsync(13000);
      const result = await pending;
      expect(result.updateAvailable).toBe(false);
      expect(String(result.error || "")).toMatch(/timeout/i);
      expect(cancelSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts hanging update body downloads on idle timeout", async () => {
    const previousTimeout = process.env.RD_UPDATE_BODY_IDLE_TIMEOUT_MS;
    process.env.RD_UPDATE_BODY_IDLE_TIMEOUT_MS = "1000";

    try {
      globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes("hang-setup.exe")) {
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2, 3]));
            }
          });
          return new Response(body, {
            status: 200,
            headers: { "Content-Type": "application/octet-stream" }
          });
        }
        return new Response("missing", { status: 404 });
      }) as typeof fetch;

      const prechecked: UpdateCheckResult = {
        updateAvailable: true,
        currentVersion: APP_VERSION,
        latestVersion: "9.9.9",
        latestTag: "v9.9.9",
        releaseUrl: "https://github.com/owner/repo/releases/tag/v9.9.9",
        setupAssetUrl: "https://example.invalid/hang-setup.exe",
        setupAssetName: "",
        setupAssetDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      };

      const result = await installLatestUpdate("owner/repo", prechecked);
      expect(result.started).toBe(false);
      expect(result.message).toMatch(/timeout/i);
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.RD_UPDATE_BODY_IDLE_TIMEOUT_MS;
      } else {
        process.env.RD_UPDATE_BODY_IDLE_TIMEOUT_MS = previousTimeout;
      }
    }
  }, 20000);

  it("blocks installer start when SHA256 digest mismatches", async () => {
    const executablePayload = createExecutablePayload();
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("mismatch-setup.exe")) {
        return new Response(executablePayload, {
          status: 200,
          headers: { "Content-Type": "application/octet-stream" }
        });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    const prechecked: UpdateCheckResult = {
      updateAvailable: true,
      currentVersion: APP_VERSION,
      latestVersion: "9.9.9",
      latestTag: "v9.9.9",
      releaseUrl: "https://github.com/owner/repo/releases/tag/v9.9.9",
      setupAssetUrl: "https://example.invalid/mismatch-setup.exe",
      setupAssetName: "setup.exe",
      setupAssetDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111"
    };

    const result = await installLatestUpdate("owner/repo", prechecked);
    expect(result.started).toBe(false);
    expect(result.message).toMatch(/integrit|sha256|mismatch/i);
  });

  it("blocks installer start when no digest can be resolved", async () => {
    const executablePayload = createExecutablePayload();
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("unsigned-setup.exe")) {
        return new Response(executablePayload, {
          status: 200,
          headers: { "Content-Type": "application/octet-stream" }
        });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    const prechecked: UpdateCheckResult = {
      updateAvailable: true,
      currentVersion: APP_VERSION,
      latestVersion: "9.9.9",
      latestTag: "",
      releaseUrl: "https://github.com/owner/repo/releases/tag/v9.9.9",
      setupAssetUrl: "https://example.invalid/unsigned-setup.exe",
      setupAssetName: "setup.exe",
      setupAssetDigest: ""
    };

    const result = await installLatestUpdate("owner/repo", prechecked);
    expect(result.started).toBe(false);
    expect(result.message).toMatch(/digest|integrit|sha/i);
  });

  it("uses latest.yml SHA512 digest when API asset digest is missing", async () => {
    const executablePayload = createExecutablePayload();
    const digestSha512Hex = sha512Hex(executablePayload);
    const digestSha512Base64 = Buffer.from(digestSha512Hex, "hex").toString("base64");
    const requestedUrls: string[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requestedUrls.push(url);

      if (url.endsWith("/releases/tags/v9.9.9")) {
        return new Response(JSON.stringify({
          tag_name: "v9.9.9",
          draft: false,
          prerelease: false,
          assets: [
            {
              name: "Multi-Debrid-Downloader-Setup-9.9.9.exe",
              browser_download_url: "https://example.invalid/setup-no-digest.exe"
            },
            {
              name: "latest.yml",
              browser_download_url: "https://example.invalid/latest.yml"
            }
          ]
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (url.includes("latest.yml")) {
        return new Response(
          `version: 9.9.9\npath: Multi-Debrid-Downloader-Setup-9.9.9.exe\nsha512: ${digestSha512Base64}\n`,
          {
            status: 200,
            headers: { "Content-Type": "text/yaml" }
          }
        );
      }

      if (url.includes("setup-no-digest.exe")) {
        return new Response(executablePayload, {
          status: 200,
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": String(executablePayload.length)
          }
        });
      }

      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    const prechecked: UpdateCheckResult = {
      updateAvailable: true,
      currentVersion: APP_VERSION,
      latestVersion: "9.9.9",
      latestTag: "v9.9.9",
      releaseUrl: "https://github.com/owner/repo/releases/tag/v9.9.9",
      setupAssetUrl: "https://example.invalid/setup-no-digest.exe",
      setupAssetName: "Multi-Debrid-Downloader-Setup-9.9.9.exe",
      setupAssetDigest: ""
    };

    const result = await installLatestUpdate("owner/repo", prechecked);
    expect(result.started).toBe(true);
    expect(requestedUrls.some((url) => url.endsWith("/releases/tags/v9.9.9"))).toBe(true);
    expect(requestedUrls.some((url) => url.includes("latest.yml"))).toBe(true);
  });

  it("rejects installer when latest.yml SHA512 digest does not match", async () => {
    const executablePayload = createExecutablePayload();
    const wrongDigestBase64 = Buffer.alloc(64, 0x13).toString("base64");

    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.endsWith("/releases/tags/v9.9.9")) {
        return new Response(JSON.stringify({
          tag_name: "v9.9.9",
          draft: false,
          prerelease: false,
          assets: [
            {
              name: "Multi-Debrid-Downloader-Setup-9.9.9.exe",
              browser_download_url: "https://example.invalid/setup-no-digest.exe"
            },
            {
              name: "latest.yml",
              browser_download_url: "https://example.invalid/latest.yml"
            }
          ]
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (url.includes("latest.yml")) {
        return new Response(
          `version: 9.9.9\npath: Multi-Debrid-Downloader-Setup-9.9.9.exe\nsha512: ${wrongDigestBase64}\n`,
          {
            status: 200,
            headers: { "Content-Type": "text/yaml" }
          }
        );
      }

      if (url.includes("setup-no-digest.exe")) {
        return new Response(executablePayload, {
          status: 200,
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": String(executablePayload.length)
          }
        });
      }

      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    const prechecked: UpdateCheckResult = {
      updateAvailable: true,
      currentVersion: APP_VERSION,
      latestVersion: "9.9.9",
      latestTag: "v9.9.9",
      releaseUrl: "https://github.com/owner/repo/releases/tag/v9.9.9",
      setupAssetUrl: "https://example.invalid/setup-no-digest.exe",
      setupAssetName: "Multi-Debrid-Downloader-Setup-9.9.9.exe",
      setupAssetDigest: ""
    };

    const result = await installLatestUpdate("owner/repo", prechecked);
    expect(result.started).toBe(false);
    expect(result.message).toMatch(/sha512|integrit|mismatch/i);
  });

  it("emits install progress events while downloading and launching update", async () => {
    const executablePayload = createExecutablePayload();
    const digest = sha256Hex(executablePayload);

    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("progress-setup.exe")) {
        return new Response(executablePayload, {
          status: 200,
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": String(executablePayload.length)
          }
        });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    const prechecked: UpdateCheckResult = {
      updateAvailable: true,
      currentVersion: APP_VERSION,
      latestVersion: "9.9.9",
      latestTag: "v9.9.9",
      releaseUrl: "https://github.com/owner/repo/releases/tag/v9.9.9",
      setupAssetUrl: "https://example.invalid/progress-setup.exe",
      setupAssetName: "setup.exe",
      setupAssetDigest: `sha256:${digest}`
    };

    const progressEvents: UpdateInstallProgress[] = [];
    const result = await installLatestUpdate("owner/repo", prechecked, (progress) => {
      progressEvents.push(progress);
    });

    expect(result.started).toBe(true);
    expect(spawnMock).toHaveBeenCalledWith(expect.stringMatching(/rd-update[\\/].*setup\.exe$/i), ["/S", "--updated", "--force-run"], expect.objectContaining({
      detached: true,
      stdio: "ignore",
      windowsHide: true
    }));
    expect(unrefMock).toHaveBeenCalledTimes(1);
    expect(progressEvents.some((entry) => entry.stage === "starting")).toBe(true);
    expect(progressEvents.some((entry) => entry.stage === "downloading")).toBe(true);
    expect(progressEvents.some((entry) => entry.stage === "verifying")).toBe(true);
    expect(progressEvents.some((entry) => entry.stage === "launching")).toBe(true);
    expect(progressEvents.some((entry) => entry.stage === "done")).toBe(true);
  });

  it("keeps the application running when Windows rejects the installer process", async () => {
    const executablePayload = createExecutablePayload();
    const digest = sha256Hex(executablePayload);
    globalThis.fetch = (async (): Promise<Response> => new Response(executablePayload, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(executablePayload.length)
      }
    })) as typeof fetch;

    const child: { once: ReturnType<typeof vi.fn>; unref: ReturnType<typeof vi.fn> } = {
      once: vi.fn(),
      unref: vi.fn()
    };
    child.once.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      if (event === "error") {
        queueMicrotask(() => handler(new Error("spawn EACCES")));
      }
      return child;
    });
    spawnMock.mockReturnValueOnce(child);

    const progressEvents: UpdateInstallProgress[] = [];
    const result = await installLatestUpdate("owner/repo", {
      updateAvailable: true,
      currentVersion: APP_VERSION,
      latestVersion: "9.9.9",
      latestTag: "v9.9.9",
      releaseUrl: "https://github.com/owner/repo/releases/tag/v9.9.9",
      setupAssetUrl: "https://example.invalid/setup.exe",
      setupAssetName: "setup.exe",
      setupAssetDigest: `sha256:${digest}`
    }, (progress) => progressEvents.push(progress));

    expect(result.started).toBe(false);
    expect(result.message).toContain("spawn EACCES");
    expect(child.unref).not.toHaveBeenCalled();
    expect(progressEvents.some((entry) => entry.stage === "done")).toBe(false);
    expect(progressEvents.at(-1)?.stage).toBe("error");
  });
});

describe("normalizeUpdateRepo extended", () => {
  it("handles trailing slashes and extra path segments", () => {
    expect(normalizeUpdateRepo("owner/repo/")).toBe("owner/repo");
    expect(normalizeUpdateRepo("/owner/repo/")).toBe("owner/repo");
    expect(normalizeUpdateRepo("https://github.com/owner/repo/tree/main/src")).toBe("owner/repo");
  });

  it("handles ssh-style git URLs", () => {
    expect(normalizeUpdateRepo("git@github.com:user/project.git")).toBe("user/project");
  });

  it("returns default for malformed inputs", () => {
    expect(normalizeUpdateRepo("just-one-part")).toBe("Sucukdeluxe/Multi-Debrid-Downloader");
    expect(normalizeUpdateRepo("   ")).toBe("Sucukdeluxe/Multi-Debrid-Downloader");
  });

  it("rejects traversal-like owner or repo segments", () => {
    expect(normalizeUpdateRepo("../owner/repo")).toBe("Sucukdeluxe/Multi-Debrid-Downloader");
    expect(normalizeUpdateRepo("owner/../repo")).toBe("Sucukdeluxe/Multi-Debrid-Downloader");
    expect(normalizeUpdateRepo("https://github.com/owner/../../repo")).toBe("Sucukdeluxe/Multi-Debrid-Downloader");
  });

  it("handles www prefix", () => {
    expect(normalizeUpdateRepo("https://www.github.com/owner/repo")).toBe("owner/repo");
    expect(normalizeUpdateRepo("www.github.com/owner/repo")).toBe("owner/repo");
  });
});

describe("isRemoteNewer", () => {
  it("detects newer major version", () => {
    expect(isRemoteNewer("1.0.0", "2.0.0")).toBe(true);
  });

  it("detects newer minor version", () => {
    expect(isRemoteNewer("1.2.0", "1.3.0")).toBe(true);
  });

  it("detects newer patch version", () => {
    expect(isRemoteNewer("1.2.3", "1.2.4")).toBe(true);
  });

  it("returns false for same version", () => {
    expect(isRemoteNewer("1.2.3", "1.2.3")).toBe(false);
  });

  it("returns false for older version", () => {
    expect(isRemoteNewer("2.0.0", "1.0.0")).toBe(false);
    expect(isRemoteNewer("1.3.0", "1.2.0")).toBe(false);
    expect(isRemoteNewer("1.2.4", "1.2.3")).toBe(false);
  });

  it("handles versions with different segment counts", () => {
    expect(isRemoteNewer("1.2", "1.2.1")).toBe(true);
    expect(isRemoteNewer("1.2.1", "1.2")).toBe(false);
    expect(isRemoteNewer("1", "1.0.1")).toBe(true);
  });

  it("handles v-prefix in version strings", () => {
    expect(isRemoteNewer("v1.0.0", "v2.0.0")).toBe(true);
    expect(isRemoteNewer("v1.0.0", "v1.0.0")).toBe(false);
  });
});

describe("parseVersionParts", () => {
  it("parses standard version strings", () => {
    expect(parseVersionParts("1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersionParts("10.20.30")).toEqual([10, 20, 30]);
  });

  it("strips v prefix", () => {
    expect(parseVersionParts("v1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersionParts("V1.2.3")).toEqual([1, 2, 3]);
  });

  it("handles single segment", () => {
    expect(parseVersionParts("5")).toEqual([5]);
  });

  it("handles version with pre-release suffix", () => {
    expect(parseVersionParts("1.2.3-beta")).toEqual([1, 2, 3]);
    expect(parseVersionParts("1.2.3rc1")).toEqual([1, 2, 3]);
  });

  it("handles empty and whitespace", () => {
    expect(parseVersionParts("")).toEqual([0]);
    expect(parseVersionParts("  ")).toEqual([0]);
  });

  it("handles versions with extra dots", () => {
    expect(parseVersionParts("1.2.3.4")).toEqual([1, 2, 3, 4]);
  });
});
