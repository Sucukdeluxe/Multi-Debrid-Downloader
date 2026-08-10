import type { ReactElement, ReactNode } from "react";
import { Icon } from "../ui/Icon";

export interface AppSidebarProps {
  children: ReactNode;
  status: ReactNode;
  collapsed: boolean;
  responsiveRail?: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

export function AppSidebar({
  children,
  status,
  collapsed,
  responsiveRail = false,
  onCollapsedChange
}: AppSidebarProps): ReactElement {
  return (
    <aside
      className={`md-shell-sidebar${collapsed ? " is-collapsed" : ""}${responsiveRail ? " is-responsive-rail" : ""}`}
      data-ui-region="sidebar"
    >
      {children ? <div className="md-shell-sidebar-scroll">{children}</div> : null}
      {status ? <div className="md-shell-sidebar-status" data-ui-region="sidebar-status">{status}</div> : null}
      <button
        aria-label={collapsed ? "Seitenleiste ausklappen" : "Seitenleiste einklappen"}
        className="md-shell-sidebar-toggle"
        onClick={() => onCollapsedChange(!collapsed)}
        title={collapsed ? "Seitenleiste ausklappen" : "Seitenleiste einklappen"}
        type="button"
      >
        <Icon name={collapsed ? "chevron-right" : "chevron-left"} size={14} />
      </button>
    </aside>
  );
}
