import type { ReactElement, ReactNode } from "react";
import { Icon } from "../ui/Icon";
import { buildMainNavigation, type MainView } from "./shell-model";

export interface AppHeaderProps {
  activeView: MainView;
  onViewChange: (view: MainView) => void;
  actions: ReactNode;
}

export function AppHeader({ activeView, onViewChange, actions }: AppHeaderProps): ReactElement {
  const navigation = buildMainNavigation(activeView);

  return (
    <header className="md-shell-header" data-ui-region="header">
      <div className="md-shell-brand">Multi-Debrid-Downloader</div>
      <nav aria-label="Hauptnavigation" className="md-shell-navigation" role="tablist">
        {navigation.map((item) => (
          <button
            aria-current={item.active ? "page" : undefined}
            aria-selected={item.active}
            className={`md-shell-navigation-item${item.active ? " is-active" : ""}`}
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
