import { afterEach, describe, expect, it, vi } from "vitest";
import { MegaWebFallback } from "../src/main/mega-web-fallback";

const originalFetch = globalThis.fetch;

describe("mega-web-fallback", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("MegaWebFallback class", () => {
    it("returns null when credentials are empty", async () => {
      const fallback = new MegaWebFallback(() => ({ login: "", password: "" }));
      const result = await fallback.unrestrict("https://mega.debrid/test");
      expect(result).toBeNull();
    });

    it("does not restore an invalidated session when an older login finishes later", async () => {
      let finishLogin: (cookie: string) => void = () => {};
      const loginResult = new Promise<string>((resolve) => {
        finishLogin = resolve;
      });
      const fallback = new MegaWebFallback(() => ({ login: "old-user", password: "old-pass" }));
      const internals = fallback as unknown as {
        ensureSession: (key: string, login: string, password: string) => Promise<string>;
        login: (login: string, password: string) => Promise<string>;
        sessions: Map<string, { cookie: string; setAt: number }>;
      };
      vi.spyOn(internals, "login").mockReturnValue(loginResult);

      const pending = internals.ensureSession("old-user", "old-user", "old-pass");
      await Promise.resolve();
      fallback.invalidateSession();
      finishLogin("stale-old-cookie");

      await expect(pending).resolves.toBe("stale-old-cookie");
      expect(internals.sessions.size).toBe(0);
    });

    it("does not cache an old session when an invalidated request retries login", async () => {
      const fallback = new MegaWebFallback(() => ({ login: "old-user", password: "old-pass" }));
      const internals = fallback as unknown as {
        login: (login: string, password: string) => Promise<string>;
        generate: (link: string, cookie: string) => Promise<{ directUrl: string; fileName: string } | null>;
        sessions: Map<string, { cookie: string; setAt: number }>;
      };
      vi.spyOn(internals, "login")
        .mockResolvedValueOnce("first-stale-cookie")
        .mockResolvedValueOnce("second-stale-cookie");
      vi.spyOn(internals, "generate")
        .mockImplementationOnce(async () => {
          fallback.invalidateSession();
          return null;
        })
        .mockResolvedValueOnce({ directUrl: "https://mega.direct/retry", fileName: "retry.bin" });

      const result = await fallback.unrestrict("https://mega.debrid/retry", undefined, { login: "old-user", password: "old-pass" });

      expect(result?.directUrl).toBe("https://mega.direct/retry");
      expect(internals.sessions.size).toBe(0);
    });

    it("does not cache old credentials from a queued request after invalidation", async () => {
      let releaseFirstLogin: () => void = () => {};
      let markFirstLoginStarted: () => void = () => {};
      const firstLoginGate = new Promise<void>((resolve) => {
        releaseFirstLogin = resolve;
      });
      const firstLoginStarted = new Promise<void>((resolve) => {
        markFirstLoginStarted = resolve;
      });
      const fallback = new MegaWebFallback(() => ({ login: "old-user", password: "old-pass" }));
      const internals = fallback as unknown as {
        login: (login: string, password: string) => Promise<string>;
        generate: (link: string, cookie: string) => Promise<{ directUrl: string; fileName: string }>;
        sessions: Map<string, { cookie: string; setAt: number }>;
      };
      let loginCount = 0;
      vi.spyOn(internals, "login").mockImplementation(async () => {
        loginCount += 1;
        if (loginCount === 1) {
          markFirstLoginStarted();
          await firstLoginGate;
        }
        return `old-cookie-${loginCount}`;
      });
      vi.spyOn(internals, "generate").mockResolvedValue({ directUrl: "https://mega.direct/queued", fileName: "queued.bin" });

      const first = fallback.unrestrict("https://mega.debrid/first", undefined, { login: "old-user", password: "old-pass" });
      await firstLoginStarted;
      const queued = fallback.unrestrict("https://mega.debrid/queued", undefined, { login: "old-user", password: "old-pass" });
      fallback.invalidateSession();
      releaseFirstLogin();

      await expect(Promise.all([first, queued])).resolves.toHaveLength(2);
      expect(loginCount).toBe(2);
      expect(internals.sessions.size).toBe(0);
    });

    it("logs in, fetches HTML, parses code, and polls AJAX for direct url", async () => {
      let fetchCallCount = 0;
      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = String(url);
        fetchCallCount += 1;

        if (urlStr.includes("form=login")) {
          const headers = new Headers();
          headers.append("set-cookie", "session=goodcookie; path=/");
          return new Response("", { headers, status: 200 });
        }

        if (urlStr.includes("page=debrideur")) {
          return new Response('<form id="debridForm"></form>', { status: 200 });
        }

        if (urlStr.includes("form=debrid")) {
          return new Response(`
            <div class="acp-box">
              <h3>Link: https://mega.debrid/link1</h3>
              <a href="javascript:processDebrid(1,'secretcode123',0)">Download</a>
            </div>
          `, { status: 200 });
        }

        if (urlStr.includes("ajax=debrid")) {
          return new Response(JSON.stringify({ link: "https://mega.direct/123" }), { status: 200 });
        }

        return new Response("Not found", { status: 404 });
      }) as unknown as typeof fetch;

      const fallback = new MegaWebFallback(() => ({ login: "user", password: "pwd" }));

      const result = await fallback.unrestrict("https://mega.debrid/link1");
      expect(result).not.toBeNull();
      expect(result?.directUrl).toBe("https://mega.direct/123");
      expect(result?.fileName).toBe("link1");
      expect(fetchCallCount).toBe(4);
    });

    it("fails fast on 'Kein Server für diesen Hoster' (account hoster quota) instead of re-login + re-poll", async () => {
      let ajaxCalls = 0;
      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = String(url);
        if (urlStr.includes("form=login")) {
          const headers = new Headers();
          headers.append("set-cookie", "session=goodcookie; path=/");
          return new Response("", { headers, status: 200 });
        }
        if (urlStr.includes("page=debrideur")) {
          return new Response('<form id="debridForm"></form>', { status: 200 });
        }
        if (urlStr.includes("form=debrid")) {
          return new Response(`<div class="acp-box"><h3>Link: https://mega.debrid/l1</h3><a href="javascript:processDebrid(1,'code1',0)">d</a></div>`, { status: 200 });
        }
        if (urlStr.includes("ajax=debrid")) {
          ajaxCalls += 1;
          return new Response(JSON.stringify({ link: "", text: "Erreur : Kein Server für diesen Hoster verfügbar. Bitte versuchen Sie es später noch einmal." }), { status: 200 });
        }
        return new Response("Not found", { status: 404 });
      }) as unknown as typeof fetch;

      const fallback = new MegaWebFallback(() => ({ login: "user", password: "pwd" }));
      await expect(fallback.unrestrict("https://mega.debrid/l1")).rejects.toThrow(/kein server für diesen hoster/i);
      expect(ajaxCalls).toBe(1);
    });

    it("surfaces 'Kein Server für diesen Hoster' from the debrid PAGE (daily limit, no debrid code) instead of empty", async () => {
      let ajaxCalls = 0;
      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = String(url);
        if (urlStr.includes("form=login")) {
          const headers = new Headers();
          headers.append("set-cookie", "session=goodcookie; path=/");
          return new Response("", { headers, status: 200 });
        }
        if (urlStr.includes("page=debrideur")) {
          return new Response('<form id="debridForm"></form>', { status: 200 });
        }
        if (urlStr.includes("form=debrid")) {
          return new Response('<div class="error">Erreur : Kein Server für diesen Hoster verfügbar. Bitte versuchen Sie es später noch einmal.</div>', { status: 200 });
        }
        if (urlStr.includes("ajax=debrid")) {
          ajaxCalls += 1;
          return new Response(JSON.stringify({ link: "https://should.not/happen" }), { status: 200 });
        }
        return new Response("Not found", { status: 404 });
      }) as unknown as typeof fetch;

      const fallback = new MegaWebFallback(() => ({ login: "user", password: "pwd" }));
      await expect(fallback.unrestrict("https://mega.debrid/l1")).rejects.toThrow(/kein server für diesen hoster/i);
      expect(ajaxCalls).toBe(0);
    });

    it("logs in with the per-account credentials passed to unrestrict, not the default", async () => {
      const loginsUsed: string[] = [];
      globalThis.fetch = vi.fn(async (url: string | URL | Request, opts?: { body?: unknown }) => {
        const urlStr = String(url);
        if (urlStr.includes("form=login")) {
          const params = new URLSearchParams(String(opts?.body ?? ""));
          loginsUsed.push(params.get("login") || "");
          const headers = new Headers();
          headers.append("set-cookie", "session=goodcookie; path=/");
          return new Response("", { headers, status: 200 });
        }
        if (urlStr.includes("page=debrideur")) {
          return new Response('<form id="debridForm"></form>', { status: 200 });
        }
        if (urlStr.includes("form=debrid")) {
          return new Response(`<div class="acp-box"><h3>Link: https://mega.debrid/l1</h3><a href="javascript:processDebrid(1,'code1',0)">d</a></div>`, { status: 200 });
        }
        if (urlStr.includes("ajax=debrid")) {
          return new Response(JSON.stringify({ link: "https://mega.direct/ok" }), { status: 200 });
        }
        return new Response("Not found", { status: 404 });
      }) as unknown as typeof fetch;

      const fallback = new MegaWebFallback(() => ({ login: "defaultacc", password: "defpw" }));
      const result = await fallback.unrestrict("https://mega.debrid/l1", undefined, { login: "account2", password: "pw2" });
      expect(result?.directUrl).toBe("https://mega.direct/ok");
      expect(loginsUsed).toContain("account2");
      expect(loginsUsed).not.toContain("defaultacc");
    });

    it("throws if login fails to set cookie", async () => {
      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = String(url);
        if (urlStr.includes("form=login")) {
          const headers = new Headers();
          return new Response("", { headers, status: 200 });
        }
        return new Response("Not found", { status: 404 });
      }) as unknown as typeof fetch;

      const fallback = new MegaWebFallback(() => ({ login: "bad", password: "bad" }));

      await expect(fallback.unrestrict("http://mega.debrid/file"))
        .rejects.toThrow("Mega-Web Login liefert kein Session-Cookie");
    });

    it("throws if login verify check fails (no form found)", async () => {
      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = String(url);
        if (urlStr.includes("form=login")) {
          const headers = new Headers();
          headers.append("set-cookie", "session=goodcookie; path=/");
          return new Response("", { headers, status: 200 });
        }
        if (urlStr.includes("page=debrideur")) {
          return new Response('<html><body>Nothing here</body></html>', { status: 200 });
        }
        return new Response("Not found", { status: 404 });
      }) as unknown as typeof fetch;

      const fallback = new MegaWebFallback(() => ({ login: "a", password: "b" }));

      await expect(fallback.unrestrict("http://mega.debrid/file"))
        .rejects.toThrow("Mega-Web Login ungültig oder Session blockiert");
    });

    it("returns null if generation fails to find a code", async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = String(url);
        callCount++;
        if (urlStr.includes("form=login")) {
          const headers = new Headers();
          headers.append("set-cookie", "session=goodcookie; path=/");
          return new Response("", { headers, status: 200 });
        }
        if (urlStr.includes("page=debrideur")) {
          return new Response('<form id="debridForm"></form>', { status: 200 });
        }
        if (urlStr.includes("form=debrid")) {
          return new Response(`<div>No links here</div>`, { status: 200 });
        }
        return new Response("Not found", { status: 404 });
      }) as unknown as typeof fetch;

      const fallback = new MegaWebFallback(() => ({ login: "a", password: "b" }));
      const result = await fallback.unrestrict("http://mega.debrid/file");

      expect(result).toBeNull();
    });

    it("serialisiert gleichzeitige Umwandlungen auf DEMSELBEN Account (kein Doppel-Login)", async () => {
      let loginCount = 0;
      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const u = String(url);
        if (u.includes("form=login")) {
          loginCount += 1;
          await new Promise((r) => setTimeout(r, 15));
          const headers = new Headers();
          headers.append("set-cookie", "session=c; path=/");
          return new Response("", { headers, status: 200 });
        }
        if (u.includes("page=debrideur")) return new Response('<form id="debridForm"></form>', { status: 200 });
        if (u.includes("form=debrid")) return new Response(`<div class="acp-box"><h3>Link: https://mega.debrid/l</h3><a href="javascript:processDebrid(1,'code',0)">d</a></div>`, { status: 200 });
        if (u.includes("ajax=debrid")) return new Response(JSON.stringify({ link: "https://mega.direct/ok" }), { status: 200 });
        return new Response("Not found", { status: 404 });
      }) as unknown as typeof fetch;

      const fallback = new MegaWebFallback(() => ({ login: "same", password: "pw" }));
      const [r1, r2] = await Promise.all([
        fallback.unrestrict("https://mega.debrid/a", undefined, { login: "same", password: "pw" }),
        fallback.unrestrict("https://mega.debrid/b", undefined, { login: "same", password: "pw" })
      ]);
      expect(r1?.directUrl).toBe("https://mega.direct/ok");
      expect(r2?.directUrl).toBe("https://mega.direct/ok");
      // Serialisiert auf demselben Account → der zweite nutzt die gecachte Session, kein zweiter Login.
      expect(loginCount).toBe(1);
    });

    it("wandelt auf VERSCHIEDENEN Accounts parallel um (Logins laufen gleichzeitig)", async () => {
      let activeLogins = 0;
      let maxActiveLogins = 0;
      const bothInFlight = new Promise<void>((resolve) => {
        const check = setInterval(() => { if (activeLogins >= 2) { clearInterval(check); resolve(); } }, 5);
      });
      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const u = String(url);
        if (u.includes("form=login")) {
          activeLogins += 1;
          maxActiveLogins = Math.max(maxActiveLogins, activeLogins);
          await bothInFlight;
          activeLogins -= 1;
          const headers = new Headers();
          headers.append("set-cookie", "session=c; path=/");
          return new Response("", { headers, status: 200 });
        }
        if (u.includes("page=debrideur")) return new Response('<form id="debridForm"></form>', { status: 200 });
        if (u.includes("form=debrid")) return new Response(`<div class="acp-box"><h3>Link: https://mega.debrid/l</h3><a href="javascript:processDebrid(1,'code',0)">d</a></div>`, { status: 200 });
        if (u.includes("ajax=debrid")) return new Response(JSON.stringify({ link: "https://mega.direct/ok" }), { status: 200 });
        return new Response("Not found", { status: 404 });
      }) as unknown as typeof fetch;

      const fallback = new MegaWebFallback(() => ({ login: "d", password: "p" }));
      const [r1, r2] = await Promise.all([
        fallback.unrestrict("https://mega.debrid/a", undefined, { login: "acc1", password: "p" }),
        fallback.unrestrict("https://mega.debrid/b", undefined, { login: "acc2", password: "p" })
      ]);
      expect(r1?.directUrl).toBe("https://mega.direct/ok");
      expect(r2?.directUrl).toBe("https://mega.direct/ok");
      // Verschiedene Accounts → beide Logins gleichzeitig in-flight (sonst haengt es am bothInFlight-Barrier).
      expect(maxActiveLogins).toBe(2);
    }, 10000);

    it("aborts pending Mega-Web polling when signal is cancelled", async () => {
      globalThis.fetch = vi.fn((url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const urlStr = String(url);

        if (urlStr.includes("form=login")) {
          const headers = new Headers();
          headers.append("set-cookie", "session=goodcookie; path=/");
          return Promise.resolve(new Response("", { headers, status: 200 }));
        }

        if (urlStr.includes("page=debrideur")) {
          return Promise.resolve(new Response('<form id="debridForm"></form>', { status: 200 }));
        }

        if (urlStr.includes("form=debrid")) {
          return Promise.resolve(new Response(`
            <div class="acp-box">
              <h3>Link: https://mega.debrid/link2</h3>
              <a href="javascript:processDebrid(1,'secretcode456',0)">Download</a>
            </div>
          `, { status: 200 }));
        }

        if (urlStr.includes("ajax=debrid")) {
          return new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            const onAbort = (): void => reject(new Error("aborted:ajax"));
            if (signal?.aborted) {
              onAbort();
              return;
            }
            signal?.addEventListener("abort", onAbort, { once: true });
          });
        }

        return Promise.resolve(new Response("Not found", { status: 404 }));
      }) as unknown as typeof fetch;

      const fallback = new MegaWebFallback(() => ({ login: "user", password: "pwd" }));
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort("test");
      }, 200);

      try {
        await expect(fallback.unrestrict("https://mega.debrid/link2", controller.signal)).rejects.toThrow(/aborted/i);
      } finally {
        clearTimeout(timer);
      }
    });

    it("starts an already queued account job after caller abort even when the old raw job ignores its signal", async () => {
      let releaseFirstLogin: () => void = () => {};
      let markFirstLoginStarted: () => void = () => {};
      const firstLoginGate = new Promise<void>((resolve) => {
        releaseFirstLogin = resolve;
      });
      const firstLoginStarted = new Promise<void>((resolve) => {
        markFirstLoginStarted = resolve;
      });
      const fallback = new MegaWebFallback(() => ({ login: "same", password: "pw" }));
      const internals = fallback as unknown as {
        login: (login: string, password: string) => Promise<string>;
        generate: (link: string, cookie: string) => Promise<{ directUrl: string; fileName: string }>;
        sessions: Map<string, { cookie: string; setAt: number }>;
      };
      let loginCount = 0;
      vi.spyOn(internals, "login").mockImplementation(async () => {
        loginCount += 1;
        if (loginCount === 1) {
          markFirstLoginStarted();
          await firstLoginGate;
          return "stale-cookie";
        }
        return "fresh-cookie";
      });
      vi.spyOn(internals, "generate").mockImplementation(async (link, cookie) => ({
        directUrl: `https://mega.direct/${cookie}/${link.endsWith("second") ? "second" : "first"}`,
        fileName: "result.bin"
      }));
      const firstController = new AbortController();
      const first = fallback.unrestrict("https://mega.debrid/first", firstController.signal, { login: "same", password: "pw" });
      await firstLoginStarted;
      const second = fallback.unrestrict("https://mega.debrid/second", undefined, { login: "same", password: "pw" });
      firstController.abort("stop");
      await expect(first).rejects.toThrow(/aborted/i);

      try {
        const outcome = await Promise.race([
          second.then((result) => result?.directUrl || "missing"),
          new Promise<string>((resolve) => setTimeout(() => resolve("blocked"), 150))
        ]);
        expect(outcome).toBe("https://mega.direct/fresh-cookie/second");
      } finally {
        releaseFirstLogin();
      }

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(internals.sessions.get("same")?.cookie).toBe("fresh-cookie");
    });

    it("klassifiziert einen Abbruch WAEHREND in der Queue als Queue-Timeout (nicht harter Abbruch), damit der belegte Account nicht bestraft wird", async () => {
      let releaseLogin: () => void = () => {};
      const loginGate = new Promise<void>((resolve) => { releaseLogin = resolve; });
      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const u = String(url);
        if (u.includes("form=login")) {
          await loginGate;
          const headers = new Headers();
          headers.append("set-cookie", "session=c; path=/");
          return new Response("", { headers, status: 200 });
        }
        if (u.includes("page=debrideur")) return new Response('<form id="debridForm"></form>', { status: 200 });
        if (u.includes("form=debrid")) return new Response(`<div class="acp-box"><h3>Link: https://mega.debrid/l</h3><a href="javascript:processDebrid(1,'code',0)">d</a></div>`, { status: 200 });
        if (u.includes("ajax=debrid")) return new Response(JSON.stringify({ link: "https://mega.direct/ok" }), { status: 200 });
        return new Response("Not found", { status: 404 });
      }) as unknown as typeof fetch;

      const fallback = new MegaWebFallback(() => ({ login: "same", password: "pw" }));
      const firstCtrl = new AbortController();
      const first = fallback.unrestrict("https://mega.debrid/a", firstCtrl.signal, { login: "same", password: "pw" });

      await new Promise((r) => setTimeout(r, 25));

      const secondCtrl = new AbortController();
      const second = fallback.unrestrict("https://mega.debrid/b", secondCtrl.signal, { login: "same", password: "pw" });

      await new Promise((r) => setTimeout(r, 25));
      secondCtrl.abort("caller-timeout");

      await expect(second).rejects.toThrow(/queue.?timeout/i);

      releaseLogin();
      await first.catch(() => null);
      await new Promise((r) => setTimeout(r, 20));
    }, 10000);
  });
});
