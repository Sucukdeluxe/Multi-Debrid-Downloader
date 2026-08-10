import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject
} from "react";
import { getConnectedFocusTarget, restoreFocus } from "./focus";

const useImmediateEffect = typeof document === "undefined" ? useEffect : useLayoutEffect;
const focusableSelector = "button:not([disabled]), summary, [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

let activeDialogCount = 0;
let blockedShells: Map<HTMLElement, { inert: boolean; ariaHidden: string | null }> | null = null;

export type DialogSize = "default" | "account" | "update" | "wide";

export interface DialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  size?: DialogSize;
  danger?: boolean;
  initialFocusRef?: RefObject<HTMLElement>;
  restoreFocusTarget?: HTMLElement | null;
  restoreFocusFallback?: () => HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
  actions: ReactNode;
  closable?: boolean;
  showCloseButton?: boolean;
  className?: string;
  backdropClassName?: string;
  headerClassName?: string;
  bodyClassName?: string;
  actionsClassName?: string;
}

export type DialogKeyboardAction = { type: "focus"; index: number } | { type: "close" };

export function getDialogFocusTarget(shiftKey: boolean, currentIndex: number, itemCount: number): number | null {
  if (itemCount <= 0) {
    return null;
  }
  if (currentIndex < 0) {
    return shiftKey ? itemCount - 1 : 0;
  }
  if (shiftKey && currentIndex === 0) {
    return itemCount - 1;
  }
  if (!shiftKey && currentIndex === itemCount - 1) {
    return 0;
  }
  return null;
}

export function getDialogInitialFocusTarget(
  dialog: HTMLElement | null,
  explicitTarget: HTMLElement | null,
  activeTarget: HTMLElement | null = null
): HTMLElement | null {
  if (explicitTarget) {
    return explicitTarget;
  }
  if (activeTarget && dialog?.contains(activeTarget)) {
    return activeTarget;
  }
  return dialog?.querySelector<HTMLElement>("[autofocus]") ?? dialog;
}

export function getDialogRestoreFocusTarget(
  dialog: HTMLElement | null,
  activeTarget: HTMLElement | null
): HTMLElement | null {
  if (!activeTarget || dialog?.contains(activeTarget)) {
    return null;
  }
  return activeTarget;
}

export function getConnectedDialogRestoreTarget(
  previousTarget: HTMLElement | null,
  fallbackTarget: HTMLElement | null
): HTMLElement | null {
  return getConnectedFocusTarget(previousTarget, fallbackTarget);
}

export function getDialogKeyboardAction(
  key: string,
  shiftKey: boolean,
  currentIndex: number,
  itemCount: number,
  closable: boolean
): DialogKeyboardAction | null {
  if (key === "Escape") {
    return closable ? { type: "close" } : null;
  }
  if (key !== "Tab" || itemCount <= 0) {
    return null;
  }
  const target = getDialogFocusTarget(shiftKey, currentIndex, itemCount);
  return target === null ? null : { type: "focus", index: target };
}

function blockShell(): () => void {
  if (activeDialogCount === 0) {
    blockedShells = new Map();
    document.querySelectorAll<HTMLElement>(".md-shell").forEach((shell) => {
      blockedShells?.set(shell, {
        inert: shell.hasAttribute("inert"),
        ariaHidden: shell.getAttribute("aria-hidden")
      });
      shell.setAttribute("inert", "");
      shell.setAttribute("aria-hidden", "true");
    });
  }
  activeDialogCount += 1;
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    activeDialogCount = Math.max(0, activeDialogCount - 1);
    if (activeDialogCount !== 0 || !blockedShells) {
      return;
    }
    for (const [shell, state] of blockedShells) {
      if (!state.inert) {
        shell.removeAttribute("inert");
      }
      if (state.ariaHidden === null) {
        shell.removeAttribute("aria-hidden");
      } else {
        shell.setAttribute("aria-hidden", state.ariaHidden);
      }
    }
    blockedShells = null;
  };
}

export function Dialog({
  open,
  title,
  description,
  size = "default",
  danger = false,
  initialFocusRef,
  restoreFocusTarget,
  restoreFocusFallback,
  onClose,
  children,
  actions,
  closable = true,
  showCloseButton = false,
  className = "",
  backdropClassName = "",
  headerClassName = "",
  bodyClassName = "",
  actionsClassName = ""
}: DialogProps): ReactElement | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const backdropAttachedRef = useRef(false);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const restoreFocusFallbackRef = useRef<() => HTMLElement | null>(() => null);
  const titleId = useId();
  const descriptionId = useId();
  restoreFocusFallbackRef.current = restoreFocusFallback ?? (() => null);

  if (open && !previousFocusRef.current && restoreFocusTarget) {
    previousFocusRef.current = getDialogRestoreFocusTarget(dialogRef.current, restoreFocusTarget);
  }

  const captureBackdropRef = useCallback((node: HTMLDivElement | null): void => {
    if (node && !backdropAttachedRef.current && !previousFocusRef.current) {
      const activeTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      previousFocusRef.current = getDialogRestoreFocusTarget(dialogRef.current, activeTarget);
    }
    backdropAttachedRef.current = Boolean(node);
  }, []);

  useImmediateEffect(() => {
    if (!open) {
      return;
    }
    const releaseShell = blockShell();
    const activeTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTarget = getDialogInitialFocusTarget(dialogRef.current, initialFocusRef?.current ?? null, activeTarget);
    focusTarget?.focus();
    return () => {
      releaseShell();
      const previousFocus = previousFocusRef.current;
      const fallbackFocus = restoreFocusFallbackRef.current();
      previousFocusRef.current = null;
      restoreFocus(previousFocus, fallbackFocus);
    };
  }, [initialFocusRef, open]);

  if (!open) {
    return null;
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
    const currentIndex = focusable.findIndex((element) => element === document.activeElement);
    const action = getDialogKeyboardAction(event.key, event.shiftKey, currentIndex, focusable.length, closable);
    if (!action) {
      if (event.key === "Tab" && focusable.length === 0) {
        event.preventDefault();
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (action.type === "close") {
      onClose();
      return;
    }
    focusable[action.index]?.focus();
  };

  const dialogClasses = [
    "modal-card",
    "md-dialog",
    `md-dialog-size-${size}`,
    danger ? "is-danger" : "",
    className
  ].filter(Boolean).join(" ");

  return (
    <div
      className={["modal-backdrop", "md-dialog-backdrop", backdropClassName].filter(Boolean).join(" ")}
      onClick={() => {
        if (closable) {
          onClose();
        }
      }}
      ref={captureBackdropRef}
    >
      <div
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={dialogClasses}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className={["md-dialog-header", headerClassName].filter(Boolean).join(" ")}>
          <h2 id={titleId}>{title}</h2>
          {showCloseButton && closable ? (
            <button aria-label="Schließen" className="md-dialog-close" onClick={onClose} type="button">×</button>
          ) : null}
        </div>
        <div className={["md-dialog-body", bodyClassName].filter(Boolean).join(" ")}>
          {description ? <p className="md-dialog-description" id={descriptionId}>{description}</p> : null}
          {children}
        </div>
        {actions ? (
          <div className={["modal-actions", "md-dialog-actions", actionsClassName].filter(Boolean).join(" ")}>{actions}</div>
        ) : null}
      </div>
    </div>
  );
}
