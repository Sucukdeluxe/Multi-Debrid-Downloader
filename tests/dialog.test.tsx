import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Dialog,
  getConnectedDialogRestoreTarget,
  getDialogInitialFocusTarget,
  getDialogKeyboardAction,
  getDialogRestoreFocusTarget
} from "../src/renderer/ui/Dialog";

describe("Dialog", () => {
  it("renders labelled modal semantics only while open", () => {
    const closed = renderToStaticMarkup(
      <Dialog actions={null} onClose={() => {}} open={false} title="Test">Body</Dialog>
    );
    const open = renderToStaticMarkup(
      <Dialog actions={<button>OK</button>} description="Beschreibung" onClose={() => {}} open title="Test">Body</Dialog>
    );

    expect(closed).toBe("");
    expect(open).toContain("role=\"dialog\"");
    expect(open).toContain("aria-modal=\"true\"");
    expect(open).toMatch(/aria-labelledby=\"[^\"]+\"/);
    expect(open).toMatch(/aria-describedby=\"[^\"]+\"/);
    expect(open).toContain("Beschreibung");
    expect(open).toContain("Body");
    expect(open).toContain("OK");
  });

  it("applies bounded account and update surfaces without changing the dialog contract", () => {
    const account = renderToStaticMarkup(
      <Dialog actions={null} initialFocusRef={createRef<HTMLButtonElement>()} onClose={() => {}} open size="account" title="Account">Body</Dialog>
    );
    const update = renderToStaticMarkup(
      <Dialog actions={null} danger onClose={() => {}} open size="update" title="Update">Body</Dialog>
    );

    expect(account).toContain("md-dialog-size-account");
    expect(update).toContain("md-dialog-size-update");
    expect(update).toContain("is-danger");
  });

  it("traps forward and reverse tabbing and honors closable Escape", () => {
    expect(getDialogKeyboardAction("Tab", false, -1, 4, true)).toEqual({ type: "focus", index: 0 });
    expect(getDialogKeyboardAction("Tab", true, -1, 4, true)).toEqual({ type: "focus", index: 3 });
    expect(getDialogKeyboardAction("Tab", false, 3, 4, true)).toEqual({ type: "focus", index: 0 });
    expect(getDialogKeyboardAction("Tab", true, 0, 4, true)).toEqual({ type: "focus", index: 3 });
    expect(getDialogKeyboardAction("Tab", false, 1, 4, true)).toBeNull();
    expect(getDialogKeyboardAction("Escape", false, 0, 4, true)).toEqual({ type: "close" });
    expect(getDialogKeyboardAction("Escape", false, 0, 4, false)).toBeNull();
  });

  it("keeps existing autofocus targets before falling back to the dialog surface", () => {
    const explicitTarget = {} as HTMLElement;
    const autofocusTarget = {} as HTMLElement;
    const activeAutofocusTarget = {} as HTMLElement;
    const dialog = {
      contains: (target: HTMLElement) => target === activeAutofocusTarget,
      querySelector: (selector: string) => selector === "[autofocus]" ? autofocusTarget : null
    } as unknown as HTMLElement;
    const fallbackDialog = { querySelector: () => null } as unknown as HTMLElement;

    expect(getDialogInitialFocusTarget(dialog, explicitTarget)).toBe(explicitTarget);
    expect(getDialogInitialFocusTarget(dialog, null, activeAutofocusTarget)).toBe(activeAutofocusTarget);
    expect(getDialogInitialFocusTarget(dialog, null)).toBe(autofocusTarget);
    expect(getDialogInitialFocusTarget(fallbackDialog, null)).toBe(fallbackDialog);
  });

  it("captures the opener before autofocus moves into the mounted dialog", () => {
    const opener = { isConnected: true } as HTMLElement;
    const dialogTarget = { isConnected: true } as HTMLElement;
    const dialog = {
      contains: (target: HTMLElement) => target === dialogTarget
    } as unknown as HTMLElement;

    expect(getDialogRestoreFocusTarget(dialog, opener)).toBe(opener);
    expect(getDialogRestoreFocusTarget(dialog, dialogTarget)).toBeNull();
  });

  it("uses a stable caller fallback when a transient opener unmounts", () => {
    const transientOpener = { isConnected: false } as HTMLElement;
    const stableFallback = { isConnected: true } as HTMLElement;

    expect(getConnectedDialogRestoreTarget(transientOpener, stableFallback)).toBe(stableFallback);
    expect(getConnectedDialogRestoreTarget(stableFallback, null)).toBe(stableFallback);
  });
});
