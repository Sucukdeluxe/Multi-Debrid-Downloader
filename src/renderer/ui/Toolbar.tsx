import type { ChangeEventHandler, HTMLAttributes, InputHTMLAttributes, ReactElement } from "react";
import { Icon } from "./Icon";

export interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
}

export interface ToolbarGroupProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
}

export interface ToolbarSearchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "aria-label"> {
  label: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
}

export function Toolbar({ label, className, children, ...props }: ToolbarProps): ReactElement {
  return (
    <div
      {...props}
      aria-label={label}
      className={["ui-toolbar", className].filter(Boolean).join(" ")}
      role="toolbar"
    >
      {children}
    </div>
  );
}

export function ToolbarGroup({ label, className, children, ...props }: ToolbarGroupProps): ReactElement {
  return (
    <div
      {...props}
      aria-label={label}
      className={["ui-toolbar-group", className].filter(Boolean).join(" ")}
      role="group"
    >
      {children}
    </div>
  );
}

export function ToolbarSearch({ label, className, placeholder, ...props }: ToolbarSearchProps): ReactElement {
  return (
    <label className="ui-toolbar-search">
      <Icon className="ui-toolbar-search-icon" name="search" size={16} />
      <input
        {...props}
        aria-label={label}
        className={["ui-input", "ui-toolbar-search-input", className].filter(Boolean).join(" ")}
        placeholder={placeholder ?? label}
        type="search"
      />
    </label>
  );
}
