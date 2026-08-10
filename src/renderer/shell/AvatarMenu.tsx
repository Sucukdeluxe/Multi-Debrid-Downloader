import { useEffect, useRef, type ReactElement } from "react";
import { restoreFocus } from "../ui/focus";

export interface AvatarMenuAction {
  id: string;
  label: string;
  danger?: boolean;
  onSelect: () => void;
}

export interface AvatarMenuProps {
  open: boolean;
  accountLabel: string;
  actions: AvatarMenuAction[];
  onClose: () => void;
}

export type AvatarMenuKeyboardAction =
  | { type: "close" }
  | { type: "focus"; index: number };

export function getAvatarMenuKeyboardAction(
  key: string,
  currentIndex: number,
  itemCount: number
): AvatarMenuKeyboardAction | null {
  if (key === "Escape") {
    return { type: "close" };
  }
  if (itemCount <= 0) {
    return null;
  }
  if (key === "Home") {
    return { type: "focus", index: 0 };
  }
  if (key === "End") {
    return { type: "focus", index: itemCount - 1 };
  }
  if (key === "ArrowDown") {
    return { type: "focus", index: (Math.max(currentIndex, -1) + 1) % itemCount };
  }
  if (key === "ArrowUp") {
    return { type: "focus", index: currentIndex <= 0 ? itemCount - 1 : currentIndex - 1 };
  }
  return null;
}

export function AvatarMenu({ open, accountLabel, actions, onClose }: AvatarMenuProps): ReactElement | null {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const closeAndRestoreFocus = (): void => {
    const trigger = menuRef.current?.parentElement?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
    onClose();
    restoreFocus(trigger ?? null);
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent): void => {
      if (!menuRef.current?.parentElement?.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      aria-label="Kontomenü"
      className="md-avatar-menu"
      onKeyDown={(event) => {
        const currentIndex = itemRefs.current.findIndex((item) => item === document.activeElement);
        const action = getAvatarMenuKeyboardAction(event.key, currentIndex, actions.length);
        if (!action) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (action.type === "close") {
          closeAndRestoreFocus();
          return;
        }
        itemRefs.current[action.index]?.focus();
      }}
      ref={menuRef}
      role="menu"
    >
      <div className="md-avatar-menu-account">{accountLabel}</div>
      {actions.map((action, index) => (
        <button
          autoFocus={index === 0}
          className={`md-avatar-menu-action${action.danger ? " is-danger" : ""}`}
          key={action.id}
          onClick={() => {
            action.onSelect();
            closeAndRestoreFocus();
          }}
          ref={(element) => {
            itemRefs.current[index] = element;
          }}
          role="menuitem"
          type="button"
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
