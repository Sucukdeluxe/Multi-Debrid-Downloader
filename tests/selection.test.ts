import { describe, expect, it } from "vitest";
import { pruneSelection, shouldClearDownloadSelection, shouldClearDownloadSelectionOnEscape } from "../src/renderer/selection";
import * as selection from "../src/renderer/selection";
import type { SessionState } from "../src/shared/types";

function session(packageIds: string[], itemIds: string[]): Pick<SessionState, "packages" | "items"> {
  const packages: Record<string, never> = {};
  const items: Record<string, never> = {};
  for (const id of packageIds) packages[id] = {} as never;
  for (const id of itemIds) items[id] = {} as never;
  return { packages, items };
}

describe("pruneSelection", () => {
  it("drops ids whose package/item no longer exists", () => {
    const sel = new Set(["p1", "i1", "ghost-p", "ghost-i"]);
    const next = pruneSelection(sel, session(["p1"], ["i1"]));
    expect([...next].sort()).toEqual(["i1", "p1"]);
  });

  it("returns the SAME set instance when nothing changed (no needless re-render)", () => {
    const sel = new Set(["p1", "i1"]);
    const next = pruneSelection(sel, session(["p1"], ["i1"]));
    expect(next).toBe(sel);
  });

  it("returns the same instance for an empty selection", () => {
    const sel = new Set<string>();
    expect(pruneSelection(sel, session(["p1"], ["i1"]))).toBe(sel);
  });

  it("prunes everything when the whole session was swapped out", () => {
    const sel = new Set(["p1", "i1"]);
    const next = pruneSelection(sel, session([], []));
    expect(next.size).toBe(0);
    expect(next).not.toBe(sel);
  });

  it("keeps a mixed package+item selection when both survive", () => {
    const sel = new Set(["p1", "p2", "i1"]);
    const next = pruneSelection(sel, session(["p1", "p2"], ["i1", "i2"]));
    expect([...next].sort()).toEqual(["i1", "p1", "p2"]);
    expect(next).toBe(sel); // unchanged → same instance
  });
});

describe("download selection clearing", () => {
  const target = (...classes: string[]): Pick<Element, "closest"> => ({
    closest: (selector: string) => selector.split(",").some((entry: string) => classes.includes(entry.trim().slice(1))) ? {} as Element : null
  });

  it("preserves selection while header, package and file selection controls handle their own click", () => {
    expect(shouldClearDownloadSelection(target("downloads-selection-cell"))).toBe(false);
    expect(shouldClearDownloadSelection(target("downloads-package-card"))).toBe(false);
    expect(shouldClearDownloadSelection(target("downloads-item-row"))).toBe(false);
    expect(shouldClearDownloadSelection(target("unrelated-surface"))).toBe(true);
  });

  it("clears checkbox-focused selection on Escape but preserves text editing", () => {
    expect(shouldClearDownloadSelectionOnEscape("INPUT", "checkbox")).toBe(true);
    expect(shouldClearDownloadSelectionOnEscape("DIV")).toBe(true);
    expect(shouldClearDownloadSelectionOnEscape("INPUT", "text")).toBe(false);
    expect(shouldClearDownloadSelectionOnEscape("TEXTAREA")).toBe(false);
  });
});

describe("global Escape selection routing", () => {
  it("routes Escape to the account selection even when focus is outside the account workspace", () => {
    const api = selection as typeof selection & {
      resolveEscapeSelectionScope?: (view: string, settingsSection: string, tagName: string, inputType?: string) => string | null;
    };

    expect(api.resolveEscapeSelectionScope).toBeTypeOf("function");
    expect(api.resolveEscapeSelectionScope?.("settings", "accounts", "BODY")).toBe("accounts");
    expect(api.resolveEscapeSelectionScope?.("settings", "accounts", "INPUT", "text")).toBeNull();
    expect(api.resolveEscapeSelectionScope?.("downloads", "allgemein", "DIV")).toBe("downloads");
    expect(api.resolveEscapeSelectionScope?.("collector", "allgemein", "DIV")).toBe("collector");
    expect(api.resolveEscapeSelectionScope?.("history", "accounts", "DIV")).toBe("history");
  });

  it("releases the focused account row when Escape leaves account selection", () => {
    const api = selection as typeof selection & {
      releaseAccountSelectionFocus?: (activeElement: { closest: (selector: string) => unknown; blur: () => void } | null) => boolean;
    };
    let blurred = false;
    const accountRow = {
      closest: (selector: string) => selector === ".settings-account-row" ? {} : null,
      blur: () => { blurred = true; }
    };

    expect(api.releaseAccountSelectionFocus).toBeTypeOf("function");
    expect(api.releaseAccountSelectionFocus?.(accountRow)).toBe(true);
    expect(blurred).toBe(true);
    expect(api.releaseAccountSelectionFocus?.({ closest: () => null, blur: () => {} })).toBe(false);
    expect(api.releaseAccountSelectionFocus?.(null)).toBe(false);
  });
});

describe("global Ctrl+A selection routing", () => {
  it("routes the account overview to account selection and preserves text editing", () => {
    const api = selection as typeof selection & {
      resolveSelectAllSelectionScope?: (
        view: string,
        settingsSection: string,
        accountPanel: string,
        tagName: string,
        inputType?: string
      ) => string | null;
    };

    expect(api.resolveSelectAllSelectionScope).toBeTypeOf("function");
    expect(api.resolveSelectAllSelectionScope?.("settings", "accounts", "overview", "BODY")).toBe("accounts");
    expect(api.resolveSelectAllSelectionScope?.("settings", "accounts", "overview", "INPUT", "checkbox")).toBe("accounts");
    expect(api.resolveSelectAllSelectionScope?.("settings", "accounts", "rules", "BODY")).toBeNull();
    expect(api.resolveSelectAllSelectionScope?.("settings", "accounts", "runtime", "BODY")).toBeNull();
    expect(api.resolveSelectAllSelectionScope?.("settings", "accounts", "overview", "INPUT", "text")).toBeNull();
    expect(api.resolveSelectAllSelectionScope?.("settings", "accounts", "overview", "TEXTAREA")).toBeNull();
  });

  it("preserves the existing shortcut scopes outside account management", () => {
    expect(selection.resolveSelectAllSelectionScope("downloads", "allgemein", "overview", "BODY")).toBe("downloads");
    expect(selection.resolveSelectAllSelectionScope("collector", "allgemein", "overview", "BODY")).toBe("collector");
    expect(selection.resolveSelectAllSelectionScope("history", "allgemein", "overview", "BODY")).toBe("history");
    expect(selection.resolveSelectAllSelectionScope("downloads", "allgemein", "overview", "INPUT", "checkbox")).toBeNull();
  });
});
