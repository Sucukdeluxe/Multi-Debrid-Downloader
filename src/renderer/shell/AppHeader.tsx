import { useEffect, useLayoutEffect, useRef, type ReactElement, type ReactNode } from "react";
import appIconUrl from "../../../assets/app_icon.png";
import { Icon } from "../ui/Icon";
import { buildMainNavigation, type MainView } from "./shell-model";

export interface AppHeaderProps {
  activeView: MainView;
  onViewChange: (view: MainView) => void;
  actions: ReactNode;
}

const useHeaderLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function AppHeader({ activeView, onViewChange, actions }: AppHeaderProps): ReactElement {
  const navigation = buildMainNavigation(activeView);
  const navigationRef = useRef<HTMLElement>(null);

  useHeaderLayoutEffect(() => {
    const element = navigationRef.current;
    if (!element) return;
    let frame = 0;
    const sync = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const activeItem = element.querySelector<HTMLElement>(`.md-shell-navigation-item[data-main-view="${activeView}"]`);
        if (!activeItem) return;
        const navigationRect = element.getBoundingClientRect();
        const itemRect = activeItem.getBoundingClientRect();
        element.style.setProperty("--md-navigation-active-x", `${itemRect.left - navigationRect.left}px`);
        element.style.setProperty("--md-navigation-active-y", `${itemRect.top - navigationRect.top}px`);
        element.style.setProperty("--md-navigation-active-width", `${itemRect.width}px`);
        element.style.setProperty("--md-navigation-active-height", `${itemRect.height}px`);
        element.classList.add("has-active-indicator");
      });
    };
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    element.querySelectorAll<HTMLElement>(".md-shell-navigation-item").forEach((item) => observer.observe(item));
    sync();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [activeView]);

  return (
    <header className="md-shell-header" data-ui-region="header">
      <div className="md-shell-brand"><img alt="" className="md-shell-brand-mark" src={appIconUrl} /><span>Multi-Debrid Downloader</span></div>
      <nav aria-label="Hauptnavigation" className="md-shell-navigation" ref={navigationRef} role="tablist">
        {navigation.map((item) => (
          <button
            aria-current={item.active ? "page" : undefined}
            aria-selected={item.active}
            className={`md-shell-navigation-item${item.active ? " is-active" : ""}`}
            data-main-view={item.id}
            data-visual-active-view={item.active ? item.id : undefined}
            key={item.id}
            onClick={() => onViewChange(item.id)}
            role="tab"
            title={item.label}
            type="button"
          >
            <Icon name={item.icon} size={18} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      {actions ? <div aria-label="Globale Aktionen" className="md-shell-header-actions" role="group">{actions}</div> : null}
    </header>
  );
}
