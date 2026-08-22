import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VISUAL_SCENARIOS } from "./visual/fixtures";
import {
  prepareVisualCapture,
  validateVisualCaptureManifest,
  type VisualCapture
} from "./visual/ui-driver";

const validCapture: VisualCapture = {
  name: "region-contract",
  scenario: "dense",
  viewport: { width: 2560, height: 1369 },
  activeView: "downloads",
  interactions: [],
  assertions: [{ type: "visible", region: "downloads-table-body" }]
};

interface FakeElementOptions {
  role?: string;
  name?: string;
  region?: string;
  className?: string;
  visible?: boolean;
  current?: boolean;
}

class FakeElement {
  readonly nodeType = 1;
  readonly tagName = "DIV";
  readonly dataset: Record<string, string> = {};
  readonly style = { display: "", visibility: "", opacity: "", zIndex: "auto" };
  readonly className: string;
  readonly role?: string;
  readonly name?: string;
  readonly region?: string;
  readonly visible: boolean;
  readonly current: boolean;
  textContent = "content";
  hidden = false;
  readonly classList: { contains: (name: string) => boolean };

  constructor(options: FakeElementOptions) {
    this.role = options.role;
    this.name = options.name;
    this.region = options.region;
    this.className = options.className ?? "";
    this.visible = options.visible ?? true;
    this.current = options.current ?? false;
    this.classList = {
      contains: (name: string): boolean => this.className.split(/\s+/).includes(name)
    };
    if (this.region) {
      this.dataset.visualRegion = this.region;
    }
  }

  getAttribute(name: string): string | null {
    if (name === "role") return this.role ?? null;
    if (name === "aria-label") return this.name ?? null;
    if (name === "data-visual-region") return this.region ?? null;
    if (name === "aria-hidden") return this.visible ? null : "true";
    if (name === "aria-current" && this.current) return "page";
    return null;
  }

  hasAttribute(name: string): boolean {
    return name === "hidden" ? this.hidden : this.getAttribute(name) !== null;
  }

  getClientRects(): { length: number } {
    return { length: this.visible ? 1 : 0 };
  }

  querySelectorAll(): FakeElement[] {
    return [];
  }
}

function createFakeDocument(
  elements: FakeElement[],
  navigationName = "Downloads"
): Document {
  const navigation = new FakeElement({
    role: "button",
    name: navigationName,
    className: "tab",
    current: true
  });
  Object.assign(navigation, {
    tagName: "BUTTON",
    click(): void {
      return undefined;
    },
    focus(): void {
      return undefined;
    },
    dispatchEvent(): boolean {
      return true;
    }
  });
  const all = [navigation, ...elements];
  class FakeEvent {
    constructor(readonly type: string) {}
  }
  return {
    defaultView: {
      Event: FakeEvent,
      MouseEvent: FakeEvent,
      KeyboardEvent: FakeEvent,
      requestAnimationFrame(callback: FrameRequestCallback): number {
        callback(0);
        return 1;
      },
      getComputedStyle(element: FakeElement) {
        return {
          display: element.visible ? "block" : "none",
          visibility: element.visible ? "visible" : "hidden",
          opacity: element.visible ? "1" : "0",
          zIndex: element.style.zIndex
        };
      }
    },
    querySelectorAll(selector: string): FakeElement[] {
      if (selector === "[data-visual-region]") {
        return all.filter((element) => element.region !== undefined);
      }
      return all;
    },
    querySelector(): FakeElement | null {
      return null;
    }
  } as unknown as Document;
}

describe("reference capture manifest", () => {
  const manifest = JSON.parse(readFileSync(new URL("./visual/capture-manifest.json", import.meta.url), "utf8"));

  it("defines executable dense, collector, avatar, context and info captures", () => {
    expect(VISUAL_SCENARIOS).toEqual(["empty", "dense", "update"]);
    expect(validateVisualCaptureManifest(manifest)).toEqual([]);
    expect(manifest.map((entry: { name: string }) => entry.name)).toEqual(expect.arrayContaining([
      "downloads-dense",
      "app-navigation-current",
      "collector-dense",
      "settings-dense",
      "history-dense",
      "statistics-dense",
      "avatar-menu",
      "avatar-update-tooltip",
      "context-downloads",
      "context-collector",
      "context-settings",
      "context-history",
      "context-statistics",
      "info-closed",
      "info-open",
      "info-closed-after-leave",
      "info-open-focus",
      "info-closed-after-blur",
      "info-open-focus-inside",
      "info-absent"
    ]));
    const collector = manifest.find((entry: { name: string }) => entry.name === "collector-dense");
    expect(collector.interactions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "fill", role: "textbox", name: "Links" })
    ]));
    expect(collector.assertions).toContainEqual(expect.objectContaining({
      type: "minimum-row-count",
      region: "collector-table-body",
      value: 2
    }));
    const avatarUpdate = manifest.find((entry: { name: string }) => entry.name === "avatar-update-tooltip");
    expect(avatarUpdate.assertions).toContainEqual({
      type: "visible",
      role: "button",
      name: "Update verfügbar"
    });
    const infoOpen = manifest.find((entry: { name: string }) => entry.name === "info-open");
    expect(infoOpen.interactions).toEqual([
      { type: "hover", role: "button", name: "Informationen" },
      { type: "wait-visible", role: "region", name: "Informationen zu Downloads" }
    ]);
    const infoClosedAfterLeave = manifest.find((entry: { name: string }) => entry.name === "info-closed-after-leave");
    expect(infoClosedAfterLeave.interactions).toEqual([
      { type: "hover", role: "button", name: "Informationen" },
      { type: "wait-visible", role: "region", name: "Informationen zu Downloads" },
      { type: "leave", role: "button", name: "Informationen" },
      { type: "wait-absent", role: "region", name: "Informationen zu Downloads" }
    ]);
    const infoOpenFocus = manifest.find((entry: { name: string }) => entry.name === "info-open-focus");
    expect(infoOpenFocus.interactions).toEqual([
      { type: "focus", role: "button", name: "Informationen" },
      { type: "wait-visible", role: "region", name: "Informationen zu Downloads" }
    ]);
    const infoClosedAfterBlur = manifest.find((entry: { name: string }) => entry.name === "info-closed-after-blur");
    expect(infoClosedAfterBlur.interactions).toEqual([
      { type: "focus", role: "button", name: "Informationen" },
      { type: "wait-visible", role: "region", name: "Informationen zu Downloads" },
      { type: "blur", role: "button", name: "Informationen" },
      { type: "wait-absent", role: "region", name: "Informationen zu Downloads" }
    ]);
    const infoOpenFocusInside = manifest.find((entry: { name: string }) => entry.name === "info-open-focus-inside");
    expect(infoOpenFocusInside.interactions).toEqual([
      { type: "focus", role: "button", name: "Informationen" },
      { type: "wait-visible", role: "region", name: "Informationen zu Downloads" },
      { type: "focus", role: "button", name: "Kontextaktion" },
      { type: "wait-visible", role: "region", name: "Informationen zu Downloads" }
    ]);
  });

  it("accepts explicit leave, focus and blur interactions", () => {
    expect(validateVisualCaptureManifest([{
      ...validCapture,
      interactions: [
        { type: "leave", role: "button", name: "Informationen" },
        { type: "focus", role: "button", name: "Informationen" },
        { type: "blur", role: "button", name: "Informationen" }
      ]
    }])).toEqual([]);
  });

  it("defines representative responsive captures before the final matrix", () => {
    expect(manifest).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "responsive-downloads-1920",
        viewport: { width: 1920, height: 1080 }
      }),
      expect.objectContaining({
        name: "responsive-collector-1366",
        viewport: { width: 1366, height: 768 }
      }),
      expect.objectContaining({
        name: "responsive-settings-1120",
        viewport: { width: 1120, height: 760 }
      })
    ]));
    const minimumSettings = manifest.find((entry: { name: string }) => entry.name === "responsive-settings-1120");
    expect(minimumSettings.interactions.slice(0, 2)).toEqual([
      { type: "click", role: "button", name: "Seitenleiste ausklappen" },
      { type: "click", role: "button", name: "Accounts" }
    ]);
  });

  it("covers every primary view at every supported viewport exactly once", () => {
    const primaryViews = ["downloads", "collector", "settings", "history", "statistics"];
    const supportedViewports = [
      { width: 2560, height: 1369 },
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 1120, height: 760 }
    ];
    const expectedCells = primaryViews.flatMap((activeView) =>
      supportedViewports.map((viewport) => `${activeView}@${viewport.width}x${viewport.height}`)
    );
    const matrixEntries = manifest.filter((entry: {
      name: string;
      activeView: string;
      viewport: { width: number; height: number };
    }) => primaryViews.includes(entry.activeView) && supportedViewports.some((viewport) =>
      viewport.width === entry.viewport.width && viewport.height === entry.viewport.height
    ) && (
      entry.name.endsWith("-dense") ||
      entry.name.startsWith("responsive-")
    ));
    const actualCells = matrixEntries.map((entry: {
      activeView: string;
      viewport: { width: number; height: number };
    }) => `${entry.activeView}@${entry.viewport.width}x${entry.viewport.height}`);

    expect(matrixEntries).toHaveLength(20);
    expect(new Set(matrixEntries.map((entry: { name: string }) => entry.name)).size).toBe(20);
    expect([...actualCells].sort()).toEqual([...expectedCells].sort());
  });

  it("reports every invalid required field with its manifest path", () => {
    expect(validateVisualCaptureManifest([{}])).toEqual([
      "$[0].name must be a nonempty string",
      "$[0].scenario must be one of empty, dense, update",
      "$[0].viewport must be an object",
      "$[0].activeView must be one of downloads, collector, settings, history, statistics",
      "$[0].interactions must be an array",
      "$[0].assertions must be an array"
    ]);
  });

  it("rejects region values outside the exact marker-name pattern", () => {
    expect(validateVisualCaptureManifest([{
      ...validCapture,
      assertions: [{ type: "visible", region: "Downloads_Table" }]
    }])).toContain('$[0].assertions[0].region must match ^[a-z0-9]+(?:-[a-z0-9]+)*$');
  });

  it("does not use a same-named CSS class as a region fallback", async () => {
    const document = createFakeDocument([
      new FakeElement({ className: "downloads-table-body" })
    ]);

    await expect(prepareVisualCapture(validCapture, document)).rejects.toThrow(
      'region marker "downloads-table-body" is missing'
    );
  });

  it("resolves one visible exact region marker", async () => {
    const document = createFakeDocument([
      new FakeElement({ region: "downloads-table-body" }),
      new FakeElement({ region: "downloads-table" })
    ]);

    await expect(prepareVisualCapture(validCapture, document)).resolves.toBeUndefined();
  });

  it("rejects duplicate visible exact region markers as ambiguous", async () => {
    const document = createFakeDocument([
      new FakeElement({ region: "downloads-table-body" }),
      new FakeElement({ region: "downloads-table-body" })
    ]);

    await expect(prepareVisualCapture(validCapture, document)).rejects.toThrow(
      'region marker "downloads-table-body" is ambiguous'
    );
  });

  it("rejects duplicate region markers before evaluating absence", async () => {
    const document = createFakeDocument([
      new FakeElement({ region: "downloads-table-body" }),
      new FakeElement({ region: "downloads-table-body" })
    ]);
    const capture: VisualCapture = {
      ...validCapture,
      assertions: [{ type: "absent", region: "downloads-table-body" }]
    };

    await expect(prepareVisualCapture(capture, document)).rejects.toThrow(
      'region marker "downloads-table-body" is ambiguous'
    );
  });

  it("selects the view tab when another button has the same accessible name", async () => {
    const document = createFakeDocument([
      new FakeElement({ role: "button", name: "Einstellungen", className: "menu-bar-trigger" })
    ], "Einstellungen");
    const capture: VisualCapture = {
      ...validCapture,
      activeView: "settings",
      assertions: [{ type: "active-view", value: "settings" }]
    };

    await expect(prepareVisualCapture(capture, document)).resolves.toBeUndefined();
  });
});
