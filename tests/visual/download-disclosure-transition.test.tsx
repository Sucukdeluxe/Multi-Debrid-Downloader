import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type CdpResponse = {
  id?: number;
  error?: unknown;
  result?: {
    result?: {
      value?: unknown;
    };
    exceptionDetails?: unknown;
  };
};

type DisclosureSample = {
  elapsed: number;
  groupBottom: number;
  followingTop: number;
  cssHeight: number;
  cssTransform: string;
  cssOpacity: number;
};

type ToolbarMeasurement = {
  expanded: string | null;
  clientWidth: number;
  scrollWidth: number;
  scrollLeft: number;
  toolbar: DOMRect;
  tail: DOMRect | null;
  toggle: DOMRect;
  schedule: DOMRect;
};

type ContextInfoMeasurement = {
  afterHover: boolean;
  afterPopover: boolean;
  afterLeave: boolean;
  afterFocus: boolean;
  afterBlur: boolean;
  afterFirstClick: boolean;
  afterSecondClick: boolean;
};

class CdpClient {
  private nextId = 0;
  private readonly pending = new Map<number, {
    resolve: (value: CdpResponse["result"]) => void;
    reject: (error: Error) => void;
  }>();

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const response = JSON.parse(String(event.data)) as CdpResponse;
      if (!response.id) return;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.error) pending.reject(new Error(JSON.stringify(response.error)));
      else pending.resolve(response.result);
    });
  }

  static async connect(url: string): Promise<CdpClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Chrome DevTools connection timed out")), 10_000);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Chrome DevTools connection failed"));
      }, { once: true });
    });
    return new CdpClient(socket);
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<CdpResponse["result"]> {
    const id = ++this.nextId;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  async evaluate<T>(expression: string): Promise<T> {
    const response = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (response?.exceptionDetails) {
      throw new Error(JSON.stringify(response.exceptionDetails));
    }
    return response?.result?.value as T;
  }

  close(): void {
    this.socket.close();
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a local port"));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function waitForJson<T>(url: string, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json() as T;
    } catch (error) {
      lastError = error;
    }
    await delay(50);
  }
  throw new Error(`Endpoint did not become ready: ${url} ${String(lastError ?? "")}`);
}

function resolveChromeExecutable(): string {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe") : undefined,
    process.env["PROGRAMFILES(X86)"] ? path.join(process.env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe") : undefined,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter((candidate): candidate is string => Boolean(candidate));
  const executable = candidates.find(existsSync);
  if (!executable) throw new Error("Chrome or Chromium executable is missing");
  return executable;
}

describe("download disclosure in the headless visual harness", () => {
  let visualPort = 0;
  let chromePort = 0;
  let viteProcess: ChildProcess | null = null;
  let chromeProcess: ChildProcess | null = null;
  let chromeProfile = "";
  let client: CdpClient | null = null;

  beforeAll(async () => {
    visualPort = await reservePort();
    chromePort = await reservePort();
    const viteExecutable = path.join(process.cwd(), "node_modules", "vite", "bin", "vite.js");
    viteProcess = spawn(process.execPath, [
      viteExecutable,
      "--config",
      "tests/visual/vite.config.mts",
      "--host",
      "127.0.0.1",
      "--port",
      String(visualPort),
      "--strictPort"
    ], {
      cwd: process.cwd(),
      stdio: "ignore",
      windowsHide: true
    });
    await waitForJson(`http://127.0.0.1:${visualPort}/capture-manifest.json`);

    chromeProfile = mkdtempSync(path.join(tmpdir(), "mdd-task4-chrome-"));
    chromeProcess = spawn(resolveChromeExecutable(), [
      "--headless=new",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-gpu",
      "--no-default-browser-check",
      "--no-first-run",
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${chromePort}`,
      `--user-data-dir=${chromeProfile}`,
      `http://127.0.0.1:${visualPort}/?scenario=dense&motion=1`
    ], {
      stdio: "ignore",
      windowsHide: true
    });
    const targets = await waitForJson<Array<{ type: string; url: string; webSocketDebuggerUrl: string }>>(
      `http://127.0.0.1:${chromePort}/json`
    );
    const target = targets.find((entry) => entry.type === "page" && entry.url.includes(`127.0.0.1:${visualPort}`));
    if (!target) throw new Error("Visual harness page target is missing");
    client = await CdpClient.connect(target.webSocketDebuggerUrl);
  }, 30_000);

  afterAll(async () => {
    if (client) {
      try {
        await Promise.race([client.send("Browser.close"), delay(1_000)]);
      } catch {
      }
      client.close();
    }
    if (chromeProcess && chromeProcess.exitCode === null) chromeProcess.kill();
    if (viteProcess && viteProcess.exitCode === null) viteProcess.kill();
    await delay(250);
    if (chromeProfile) {
      const resolvedProfile = path.resolve(chromeProfile);
      const resolvedTempRoot = `${path.resolve(tmpdir())}${path.sep}`;
      if (!resolvedProfile.startsWith(resolvedTempRoot)) {
        throw new Error(`Chrome profile escaped the temporary directory: ${resolvedProfile}`);
      }
      rmSync(resolvedProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }, 10_000);

  async function loadDenseDownloads(width: number): Promise<void> {
    if (!client) throw new Error("Chrome DevTools client is missing");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 760,
      deviceScaleFactor: 1,
      mobile: false
    });
    await client.send("Page.navigate", {
      url: `http://127.0.0.1:${visualPort}/?scenario=dense&motion=1&run=${Date.now()}`
    });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      try {
        const ready = await client.evaluate<boolean>("document.documentElement.dataset.visualReady === 'true'");
        if (ready) return;
      } catch {
      }
      await delay(50);
    }
    throw new Error("Visual harness did not reach its ready state");
  }

  async function loadDriverCapture(name: string): Promise<void> {
    if (!client) throw new Error("Chrome DevTools client is missing");
    await client.send("Page.navigate", {
      url: `http://127.0.0.1:${visualPort}/driver-test.html?capture=${encodeURIComponent(name)}&run=${Date.now()}`
    });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const state = await client.evaluate<{ error: string; ready: boolean }>(`({
        error: document.getElementById('root')?.textContent || '',
        ready: document.documentElement.dataset.visualReady === 'true'
      })`);
      if (state.ready) return;
      if (state.error.startsWith("Visual-Harness-Fehler:")) throw new Error(state.error);
      await delay(50);
    }
    throw new Error(`Visual driver capture did not reach its ready state: ${name}`);
  }

  it("sorts package rows through a real captured pointer click", async () => {
    await loadDenseDownloads(1500);
    if (!client) throw new Error("Chrome DevTools client is missing");
    const point = await client.evaluate<{ x: number; y: number }>(`(() => {
      const button = [...document.querySelectorAll('.downloads-column-sort')].find((entry) => entry.textContent?.startsWith('Name'));
      if (!(button instanceof HTMLElement)) throw new Error('Name sort button missing');
      const rect = button.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    const readState = (): Promise<{ ariaSort: string | null; names: string[] }> => client!.evaluate(`(() => ({
      ariaSort: document.querySelector('[data-download-column="name"]')?.getAttribute('aria-sort') || null,
      names: [...document.querySelectorAll('.downloads-package-row .downloads-name-cell strong')].map((entry) => entry.textContent || '')
    }))()`);

    await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await delay(120);
    const descending = await readState();
    await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await delay(120);
    const ascending = await readState();

    expect(descending.ariaSort).toBe("descending");
    expect(ascending.ariaSort).toBe("ascending");
    expect(descending.names.length).toBeGreaterThan(1);
    expect(ascending.names).toEqual([...descending.names].reverse());
  });

  async function measureDisclosure(action: "einklappen" | "ausklappen"): Promise<DisclosureSample[]> {
    if (!client) throw new Error("Chrome DevTools client is missing");
    return client.evaluate<DisclosureSample[]>(`(async () => {
      const button = [...document.querySelectorAll(".downloads-collapse-button")]
        .find((element) => element.getAttribute("aria-label")?.endsWith(" ${action}"));
      if (!(button instanceof HTMLButtonElement)) throw new Error("Disclosure button is missing");
      button.click();
      const samples = [];
      const startedAt = performance.now();
      await new Promise((resolve) => {
        const measure = (now) => {
          const rows = [...document.querySelectorAll(".downloads-virtual-row")];
          const group = rows.find((row) => row.classList.contains("is-disclosure-group"));
          const groupIndex = rows.indexOf(group);
          const following = rows.slice(groupIndex + 1).find((row) => !row.classList.contains("is-disclosure-group"));
          if (group instanceof HTMLElement && following instanceof HTMLElement) {
            const groupRect = group.getBoundingClientRect();
            const followingRect = following.getBoundingClientRect();
            const style = getComputedStyle(group);
            samples.push({
              elapsed: now - startedAt,
              groupBottom: groupRect.bottom,
              followingTop: followingRect.top,
              cssHeight: Number.parseFloat(style.height),
              cssTransform: style.transform,
              cssOpacity: Number.parseFloat(style.opacity)
            });
          }
          if (now - startedAt < 1_650) requestAnimationFrame(measure);
          else resolve();
        };
        requestAnimationFrame(measure);
      });
      return samples;
    })()`);
  }

  it("measures real collapse and expand frames without overlap", async () => {
    await loadDenseDownloads(1120);
    const collapse = await measureDisclosure("einklappen");
    const expand = await measureDisclosure("ausklappen");

    for (const samples of [collapse, expand]) {
      expect(samples.length).toBeGreaterThan(20);
      expect(samples.every((sample) => sample.groupBottom <= sample.followingTop + 1)).toBe(true);
      expect(samples.some((sample) => sample.cssHeight > 1 && sample.cssHeight < 75)).toBe(true);
      expect(samples.some((sample) => sample.cssOpacity > 0.01 && sample.cssOpacity < 0.99)).toBe(true);
      expect(samples.every((sample) => /^matrix/.test(sample.cssTransform))).toBe(true);
    }

    expect(collapse[0].cssHeight).toBeGreaterThan(75);
    expect(collapse[0].cssOpacity).toBeGreaterThan(0.99);
    expect(collapse.at(-1)!.cssHeight).toBeLessThan(1);
    expect(collapse.at(-1)!.cssOpacity).toBeLessThan(0.01);
    expect(expand[0].cssHeight).toBeLessThan(1);
    expect(expand[0].cssOpacity).toBeLessThan(0.01);
    expect(expand.at(-1)!.cssHeight).toBeGreaterThan(75);
    expect(expand.at(-1)!.cssOpacity).toBeGreaterThan(0.99);
  }, 30_000);

  it("keeps the open schedule and toolbar tail visible at 1120 pixels without horizontal scrolling", async () => {
    await loadDenseDownloads(1120);
    if (!client) throw new Error("Chrome DevTools client is missing");
    const measurement = await client.evaluate<ToolbarMeasurement>(`(async () => {
      const toolbar = document.querySelector(".downloads-toolbar");
      const trigger = toolbar?.querySelector("button[aria-expanded]");
      if (!(toolbar instanceof HTMLElement) || !(trigger instanceof HTMLButtonElement)) {
        throw new Error("Download toolbar or schedule trigger is missing");
      }
      trigger.click();
      await new Promise((resolve) => setTimeout(resolve, 260));
      const tail = toolbar.querySelector(".downloads-toolbar-tail");
      const toggle = [...toolbar.querySelectorAll("button")]
        .find((button) => button.textContent === "Alle ein-/ausklappen");
      const schedule = toolbar.querySelector(".downloads-schedule-slot");
      if (!(toggle instanceof HTMLButtonElement) || !(schedule instanceof HTMLElement)) {
        throw new Error("Toolbar toggle or schedule slot is missing");
      }
      toolbar.scrollLeft = 10_000;
      return {
        expanded: trigger.getAttribute("aria-expanded"),
        clientWidth: toolbar.clientWidth,
        scrollWidth: toolbar.scrollWidth,
        scrollLeft: toolbar.scrollLeft,
        toolbar: toolbar.getBoundingClientRect().toJSON(),
        tail: tail?.getBoundingClientRect().toJSON() ?? null,
        toggle: toggle.getBoundingClientRect().toJSON(),
        schedule: schedule.getBoundingClientRect().toJSON()
      };
    })()`);

    expect(measurement.expanded).toBe("true");
    expect(measurement.tail).not.toBeNull();
    expect(measurement.scrollWidth).toBeLessThanOrEqual(measurement.clientWidth + 1);
    expect(measurement.scrollLeft).toBe(0);
    expect(measurement.schedule.width).toBeGreaterThan(0);
    expect(measurement.tail!.left).toBeGreaterThanOrEqual(measurement.toolbar.left - 1);
    expect(measurement.tail!.right).toBeLessThanOrEqual(measurement.toolbar.right + 1);
    expect(measurement.toggle.left).toBeGreaterThanOrEqual(measurement.toolbar.left - 1);
    expect(measurement.toggle.right).toBeLessThanOrEqual(measurement.toolbar.right + 1);
    expect(measurement.toolbar.right - measurement.toggle.right).toBeLessThanOrEqual(12);
  }, 30_000);

  it("opens context info on hover and focus, stays open over the popover and closes outside", async () => {
    await loadDenseDownloads(1120);
    if (!client) throw new Error("Chrome DevTools client is missing");
    const trigger = await client.evaluate<DOMRect>(`(() => {
      const element = document.querySelector('.ui-context-info-trigger');
      if (!(element instanceof HTMLButtonElement)) throw new Error('Context info trigger is missing');
      return element.getBoundingClientRect().toJSON();
    })()`);
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: trigger.left + trigger.width / 2,
      y: trigger.top + trigger.height / 2
    });
    await delay(50);
    const afterHover = await client.evaluate<boolean>("Boolean(document.querySelector('.ui-context-info-region'))");
    const popover = await client.evaluate<DOMRect>(`(() => {
      const element = document.querySelector('.ui-context-info-region');
      if (!(element instanceof HTMLElement)) throw new Error('Context info region is missing after hover');
      return element.getBoundingClientRect().toJSON();
    })()`);
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: popover.left + popover.width / 2,
      y: popover.top + popover.height / 2
    });
    await delay(50);
    const afterPopover = await client.evaluate<boolean>("Boolean(document.querySelector('.ui-context-info-region'))");
    await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1110, y: 10 });
    await delay(50);
    const afterLeave = await client.evaluate<boolean>("Boolean(document.querySelector('.ui-context-info-region'))");
    const focusStates = await client.evaluate<Omit<ContextInfoMeasurement, "afterHover" | "afterPopover" | "afterLeave">>(`(async () => {
      const wait = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const trigger = document.querySelector('.ui-context-info-trigger');
      const outside = document.querySelector('.md-shell-navigation-item');
      if (!(trigger instanceof HTMLButtonElement) || !(outside instanceof HTMLButtonElement)) {
        throw new Error('Context info focus targets are missing');
      }
      trigger.focus();
      await wait();
      const afterFocus = Boolean(document.querySelector('.ui-context-info-region'));
      outside.focus();
      await wait();
      const afterBlur = Boolean(document.querySelector('.ui-context-info-region'));
      trigger.click();
      await wait();
      const afterFirstClick = Boolean(document.querySelector('.ui-context-info-region'));
      trigger.click();
      await wait();
      const afterSecondClick = Boolean(document.querySelector('.ui-context-info-region'));
      return { afterFocus, afterBlur, afterFirstClick, afterSecondClick };
    })()`);
    const measurement: ContextInfoMeasurement = { afterHover, afterPopover, afterLeave, ...focusStates };

    expect(measurement).toEqual({
      afterHover: true,
      afterPopover: true,
      afterLeave: false,
      afterFocus: true,
      afterBlur: false,
      afterFirstClick: true,
      afterSecondClick: true
    });
  }, 30_000);

  it("executes the context info hover, leave, focus and blur manifest captures", async () => {
    for (const name of ["info-open", "info-closed-after-leave", "info-open-focus", "info-closed-after-blur", "info-open-focus-inside"]) {
      await loadDriverCapture(name);
      if (name === "info-open-focus-inside") {
        if (!client) throw new Error("Chrome DevTools client is missing");
        const transitions = await client.evaluate<string>("document.querySelector('[data-context-info-transitions]')?.getAttribute('data-context-info-transitions') || ''");
        expect(transitions.split(",")).not.toContain("closed");
      }
    }
  }, 30_000);
});
