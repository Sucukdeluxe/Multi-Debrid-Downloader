import type { IconName } from "../ui/Icon";

export type MainView = "downloads" | "collector" | "settings" | "history" | "statistics";
export type ResponsiveShellMode = "full" | "compact" | "minimum";

export interface NavigationItem {
  id: MainView;
  label: string;
  icon: IconName;
  active: boolean;
}

const MAIN_NAVIGATION = [
  { id: "downloads", label: "Downloads", icon: "download" },
  { id: "collector", label: "Linksammler", icon: "collector" },
  { id: "settings", label: "Einstellungen", icon: "settings" },
  { id: "history", label: "Verlauf", icon: "history" },
  { id: "statistics", label: "Statistiken", icon: "statistics" }
] as const;

export function buildMainNavigation(active: MainView): NavigationItem[] {
  return MAIN_NAVIGATION.map((item) => ({ ...item, active: item.id === active }));
}

export function getMainViewLabel(view: MainView): string {
  return MAIN_NAVIGATION.find((item) => item.id === view)?.label ?? view;
}

export function getResponsiveShellMode(width: number): ResponsiveShellMode {
  if (width <= 1120) {
    return "minimum";
  }

  if (width <= 1366) {
    return "compact";
  }

  return "full";
}
