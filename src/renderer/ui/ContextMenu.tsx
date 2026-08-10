import {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject
} from "react";
import { restoreFocus } from "./focus";

const useImmediateEffect = typeof document === "undefined" ? useEffect : useLayoutEffect;

export interface ContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
  ariaLabel?: string;
  className?: string;
  ignoreOutsideRefs?: Array<RefObject<HTMLElement>>;
}

export type ContextMenuKeyboardAction =
  | { type: "focus"; index: number }
  | { type: "activate"; index: number }
  | { type: "close" };

export type ContextMenuSubmenuKeyboardAction = "open" | "close";

export function clampContextMenuPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(x, Math.max(0, viewportWidth - width))),
    y: Math.max(0, Math.min(y, Math.max(0, viewportHeight - height)))
  };
}

export function getContextSubmenuPosition(
  trigger: { left: number; right: number; top: number },
  submenu: { width: number; height: number },
  viewport: { width: number; height: number }
): { x: number; y: number } {
  const opensRight = trigger.right + submenu.width <= viewport.width || trigger.left - submenu.width < 0;
  return clampContextMenuPosition(
    opensRight ? trigger.right : trigger.left - submenu.width,
    trigger.top,
    submenu.width,
    submenu.height,
    viewport.width,
    viewport.height
  );
}

export function getContextMenuKeyboardAction(
  key: string,
  currentIndex: number,
  enabled: boolean[]
): ContextMenuKeyboardAction | null {
  const indexes = enabled.flatMap((value, index) => value ? [index] : []);
  if (key === "Escape") {
    return { type: "close" };
  }
  if (indexes.length === 0) {
    return null;
  }
  if (key === "Enter" || key === " ") {
    return { type: "activate", index: enabled[currentIndex] ? currentIndex : indexes[0] };
  }
  if (key === "Home") {
    return { type: "focus", index: indexes[0] };
  }
  if (key === "End") {
    return { type: "focus", index: indexes[indexes.length - 1] };
  }
  if (key !== "ArrowDown" && key !== "ArrowUp") {
    return null;
  }
  const enabledPosition = indexes.indexOf(currentIndex);
  if (enabledPosition < 0) {
    return { type: "focus", index: key === "ArrowDown" ? indexes[0] : indexes[indexes.length - 1] };
  }
  const direction = key === "ArrowDown" ? 1 : -1;
  const nextPosition = (enabledPosition + direction + indexes.length) % indexes.length;
  return { type: "focus", index: indexes[nextPosition] };
}

export function getContextMenuSubmenuKeyboardAction(
  key: string,
  hasSubmenu: boolean,
  insideSubmenu: boolean
): ContextMenuSubmenuKeyboardAction | null {
  if (hasSubmenu && (key === "Enter" || key === "ArrowRight")) {
    return "open";
  }
  if (insideSubmenu && (key === "ArrowLeft" || key === "Escape")) {
    return "close";
  }
  return null;
}

function applyMenuItemSemantics(node: ReactNode): ReactNode {
  return Children.map(node, (child) => {
    if (!isValidElement(child)) {
      return child;
    }
    const element = child as ReactElement<{
      children?: ReactNode;
      disabled?: boolean;
      role?: string;
      tabIndex?: number;
    }>;
    if (typeof element.type === "string" && element.type === "button") {
      return cloneElement(element, { role: "menuitem", tabIndex: -1 });
    }
    if (element.props.children === undefined) {
      return element;
    }
    return cloneElement(element, { children: applyMenuItemSemantics(element.props.children) });
  });
}

function getMenuItems(menu: HTMLElement | null): HTMLElement[] {
  return Array.from(menu?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? []).filter((item) => {
    if (item.matches(":disabled") || item.getAttribute("aria-disabled") === "true") {
      return false;
    }
    return item.getClientRects().length > 0;
  });
}

function getTopLevelMenuItems(menu: HTMLElement | null): HTMLElement[] {
  return getMenuItems(menu).filter((item) => !item.closest(".ctx-menu-sub-items"));
}

function getSubmenuParts(item: HTMLElement | null): {
  container: HTMLElement;
  trigger: HTMLElement;
  items: HTMLElement;
} | null {
  const container = item?.closest<HTMLElement>(".ctx-menu-sub") ?? null;
  if (!container) {
    return null;
  }
  const trigger = Array.from(container.children).find((child) => child.matches("[role='menuitem']"));
  const items = Array.from(container.children).find((child) => child.matches(".ctx-menu-sub-items"));
  if (!(trigger instanceof HTMLElement) || !(items instanceof HTMLElement)) {
    return null;
  }
  return { container, trigger, items };
}

function openSubmenu(parts: ReturnType<typeof getSubmenuParts>): void {
  if (!parts) {
    return;
  }
  parts.container.classList.add("is-keyboard-open");
  parts.trigger.setAttribute("aria-expanded", "true");
  positionSubmenu(parts);
  getMenuItems(parts.items)[0]?.focus();
}

function positionSubmenu(parts: NonNullable<ReturnType<typeof getSubmenuParts>>): void {
  const triggerRect = parts.trigger.getBoundingClientRect();
  const submenuRect = parts.items.getBoundingClientRect();
  const position = getContextSubmenuPosition(
    triggerRect,
    submenuRect,
    { width: window.innerWidth, height: window.innerHeight }
  );
  parts.items.style.position = "fixed";
  parts.items.style.left = `${position.x}px`;
  parts.items.style.top = `${position.y}px`;
}

function closeSubmenu(parts: ReturnType<typeof getSubmenuParts>): void {
  if (!parts) {
    return;
  }
  parts.container.classList.remove("is-keyboard-open");
  parts.trigger.setAttribute("aria-expanded", "false");
  parts.trigger.focus();
}

export const ContextMenu = forwardRef<HTMLDivElement, ContextMenuProps>(function ContextMenu({
  open,
  x,
  y,
  onClose,
  children,
  ariaLabel = "Kontextmenü",
  className = "",
  ignoreOutsideRefs = []
}, forwardedRef): ReactElement | null {
  const menuRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const ignoreOutsideRefsRef = useRef(ignoreOutsideRefs);
  const [position, setPosition] = useState({ x, y });
  onCloseRef.current = onClose;
  ignoreOutsideRefsRef.current = ignoreOutsideRefs;
  useImperativeHandle(forwardedRef, () => menuRef.current as HTMLDivElement);

  useImmediateEffect(() => {
    if (!open || !menuRef.current) {
      return;
    }
    if (!previousFocusRef.current) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    const rect = menuRef.current.getBoundingClientRect();
    const next = clampContextMenuPosition(x, y, rect.width, rect.height, window.innerWidth, window.innerHeight);
    setPosition((current) => current.x === next.x && current.y === next.y ? current : next);
    getTopLevelMenuItems(menuRef.current)[0]?.focus();
  }, [open, x, y]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onOutside = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Node) || menuRef.current?.contains(target)) {
        return;
      }
      if (ignoreOutsideRefsRef.current.some((ref) => ref.current?.contains(target))) {
        return;
      }
      onCloseRef.current();
    };
    window.addEventListener("mousedown", onOutside);
    window.addEventListener("contextmenu", onOutside);
    return () => {
      window.removeEventListener("mousedown", onOutside);
      window.removeEventListener("contextmenu", onOutside);
      const previousFocus = previousFocusRef.current;
      previousFocusRef.current = null;
      restoreFocus(previousFocus);
    };
  }, [open]);

  if (!open) {
    return null;
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const activeItem = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const submenu = getSubmenuParts(activeItem);
    const insideSubmenu = Boolean(activeItem?.closest(".ctx-menu-sub-items"));
    const hasSubmenu = submenu?.trigger === activeItem;
    const submenuAction = getContextMenuSubmenuKeyboardAction(event.key, hasSubmenu, insideSubmenu);
    if (submenuAction) {
      event.preventDefault();
      event.stopPropagation();
      if (submenuAction === "open") {
        openSubmenu(submenu);
      } else {
        closeSubmenu(submenu);
      }
      return;
    }
    const submenuItems = insideSubmenu ? activeItem?.closest<HTMLElement>(".ctx-menu-sub-items") ?? null : null;
    const items = submenuItems ? getMenuItems(submenuItems) : getTopLevelMenuItems(menuRef.current);
    const currentIndex = items.findIndex((item) => item === document.activeElement);
    const action = getContextMenuKeyboardAction(event.key, currentIndex, items.map(() => true));
    if (!action) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (action.type === "close") {
      onClose();
      return;
    }
    if (action.type === "activate") {
      items[action.index]?.click();
      return;
    }
    items[action.index]?.focus();
  };

  return (
    <div
      aria-label={ariaLabel}
      className={["ctx-menu", "md-context-menu", className].filter(Boolean).join(" ")}
      onClick={(event) => {
        event.stopPropagation();
        const item = event.target instanceof Element ? event.target.closest<HTMLElement>("[role='menuitem']") : null;
        const submenu = getSubmenuParts(item);
        if (submenu?.trigger === item) {
          event.preventDefault();
          openSubmenu(submenu);
        }
      }}
      onKeyDown={onKeyDown}
      onMouseOver={(event) => {
        const item = event.target instanceof Element ? event.target.closest<HTMLElement>("[role='menuitem']") : null;
        const submenu = getSubmenuParts(item);
        if (submenu?.trigger === item) {
          positionSubmenu(submenu);
        }
      }}
      ref={menuRef}
      role="menu"
      style={{ left: position.x, top: position.y }}
    >
      {applyMenuItemSemantics(children)}
    </div>
  );
});
