import type { ReactElement, SVGProps } from "react";

export const ICON_NAMES = [
  "download",
  "collector",
  "settings",
  "history",
  "statistics",
  "add",
  "search",
  "play",
  "pause",
  "stop",
  "arrow-up",
  "arrow-down",
  "refresh",
  "check",
  "edit",
  "trash",
  "filter",
  "folder",
  "info",
  "more",
  "chevron-left",
  "chevron-right",
  "chevron-down",
  "close",
  "menu",
  "help",
  "backup",
  "update",
  "account"
] as const;

export type IconName = (typeof ICON_NAMES)[number];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  label?: string;
  size?: number;
}

function IconDrawing({ name }: { name: IconName }): ReactElement {
  switch (name) {
    case "download":
      return <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>;
    case "collector":
      return <><path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" /><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1" /></>;
    case "settings":
      return <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>;
    case "history":
      return <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></>;
    case "statistics":
      return <><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20V7" /></>;
    case "add":
      return <><path d="M12 5v14" /><path d="M5 12h14" /></>;
    case "search":
      return <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>;
    case "play":
      return <path d="m8 5 11 7-11 7Z" />;
    case "pause":
      return <><path d="M9 5v14" /><path d="M15 5v14" /></>;
    case "stop":
      return <rect x="6" y="6" width="12" height="12" rx="1" />;
    case "arrow-up":
      return <><path d="m6 10 6-6 6 6" /><path d="M12 4v16" /></>;
    case "arrow-down":
      return <><path d="m6 14 6 6 6-6" /><path d="M12 20V4" /></>;
    case "refresh":
      return <><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M6.1 9a7 7 0 0 1 11.5-2L20 9" /><path d="m4 15 2.4 2a7 7 0 0 0 11.5-2" /></>;
    case "check":
      return <path d="m5 12 4 4L19 6" />;
    case "edit":
      return <><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m13 7 4 4" /></>;
    case "trash":
      return <><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="m6 7 1 14h10l1-14" /><path d="M10 11v6" /><path d="M14 11v6" /></>;
    case "filter":
      return <path d="M4 5h16l-6 7v6l-4 2v-8Z" />;
    case "folder":
      return <path d="M3 6h7l2 2h9v11H3Z" />;
    case "info":
      return <><circle cx="12" cy="12" r="9" /><path d="M12 11v6" /><path d="M12 7h.01" /></>;
    case "more":
      return <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>;
    case "chevron-left":
      return <path d="m15 18-6-6 6-6" />;
    case "chevron-right":
      return <path d="m9 18 6-6-6-6" />;
    case "chevron-down":
      return <path d="m6 9 6 6 6-6" />;
    case "close":
      return <><path d="m6 6 12 12" /><path d="M18 6 6 18" /></>;
    case "menu":
      return <><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></>;
    case "help":
      return <><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.4 2.4 0 1 1 3.7 2c-1 .6-1.5 1.1-1.5 2" /><path d="M12 17h.01" /></>;
    case "backup":
      return <><path d="M6 4h10l3 3v13H6Z" /><path d="M9 4v6h6V4" /><path d="M9 20v-6h6v6" /></>;
    case "update":
      return <><path d="M12 21a9 9 0 1 0-8.5-6" /><path d="M3 15v6h6" /><path d="M12 7v5l3 2" /></>;
    case "account":
      return <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>;
  }
}

export function Icon({ name, label, size = 18, className, ...props }: IconProps): ReactElement {
  const labelled = typeof label === "string" && label.trim().length > 0;

  return (
    <svg
      {...props}
      aria-hidden={labelled ? undefined : true}
      aria-label={labelled ? label : undefined}
      className={["ui-icon", className].filter(Boolean).join(" ")}
      fill="none"
      focusable="false"
      height={size}
      role={labelled ? "img" : undefined}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
      width={size}
    >
      <IconDrawing name={name} />
    </svg>
  );
}
