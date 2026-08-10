import { useState, useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import { ContextInfoButton } from "../ui/ContextInfoButton";
import { AppHeader } from "./AppHeader";
import { AppSidebar } from "./AppSidebar";
import {
  getMainViewLabel,
  getResponsiveShellMode,
  type MainView,
  type ResponsiveShellMode
} from "./shell-model";
import "./shell.css";

function subscribeToViewport(callback: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  window.addEventListener("resize", callback);
  return () => window.removeEventListener("resize", callback);
}

function getViewportShellMode(): ResponsiveShellMode {
  return typeof window === "undefined" ? "full" : getResponsiveShellMode(window.innerWidth);
}

function getServerShellMode(): ResponsiveShellMode {
  return "full";
}

export interface AppShellProps {
  activeView: MainView;
  onViewChange: (view: MainView) => void;
  sidebar: ReactNode;
  sidebarStatus: ReactNode;
  headerActions: ReactNode;
  toolbar: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  contextInfo: ReactNode;
  sidebarCollapsed: boolean;
  onSidebarCollapsedChange: (collapsed: boolean) => void;
}

export function AppShell({
  activeView,
  onViewChange,
  sidebar,
  sidebarStatus,
  headerActions,
  toolbar,
  children,
  footer,
  contextInfo,
  sidebarCollapsed,
  onSidebarCollapsedChange
}: AppShellProps): ReactElement {
  const [infoOpen, setInfoOpen] = useState(false);
  const [responsiveSidebarExpanded, setResponsiveSidebarExpanded] = useState(false);
  const responsiveMode = useSyncExternalStore(
    subscribeToViewport,
    getViewportShellMode,
    getServerShellMode
  );
  const hasSidebar = Boolean(sidebar || sidebarStatus);
  const responsiveSidebarCollapsed = responsiveMode !== "full" && !responsiveSidebarExpanded;
  const effectiveSidebarCollapsed = sidebarCollapsed || responsiveSidebarCollapsed;

  const setSidebarCollapsed = (collapsed: boolean): void => {
    if (responsiveMode !== "full") {
      setResponsiveSidebarExpanded(!collapsed);
    }
    onSidebarCollapsedChange(collapsed);
  };

  return (
    <div
      className={`md-shell is-${responsiveMode}${hasSidebar ? " has-sidebar" : ""}${hasSidebar && effectiveSidebarCollapsed ? " has-collapsed-sidebar" : ""}`}
      data-responsive-mode={responsiveMode}
    >
      <AppHeader activeView={activeView} actions={headerActions} onViewChange={onViewChange} />
      <div className="md-shell-workspace">
        {hasSidebar ? (
          <AppSidebar
            collapsed={effectiveSidebarCollapsed}
            onCollapsedChange={setSidebarCollapsed}
            responsiveRail={responsiveSidebarCollapsed}
            status={sidebarStatus}
          >
            {sidebar}
          </AppSidebar>
        ) : null}
        <section className="md-shell-main" data-ui-region="main">
          {toolbar ? <div className="md-shell-toolbar" data-ui-region="toolbar">{toolbar}</div> : null}
          <div className="md-shell-content">{children}</div>
          {footer ? <div className="md-shell-footer" data-ui-region="footer">{footer}</div> : null}
          <ContextInfoButton
            content={contextInfo}
            contextName={getMainViewLabel(activeView)}
            onOpenChange={setInfoOpen}
            open={infoOpen}
          />
        </section>
      </div>
    </div>
  );
}
