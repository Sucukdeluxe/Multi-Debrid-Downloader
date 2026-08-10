import type { HTMLAttributes, ReactElement, ReactNode } from "react";

export interface DataTableProps extends HTMLAttributes<HTMLDivElement> {
  label?: string;
}

export type DataTableSectionProps = HTMLAttributes<HTMLDivElement>;

export interface DataTableEmptyProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  illustration?: ReactNode;
}

export interface DataTableFooterProps extends HTMLAttributes<HTMLDivElement> {
  pageSize: number;
  rangeLabel: string;
  paginationVisible: boolean;
}

export function DataTable({ label = "Datentabelle", className, children, ...props }: DataTableProps): ReactElement {
  return (
    <div
      {...props}
      aria-label={label}
      className={["ui-data-table", className].filter(Boolean).join(" ")}
      role="table"
    >
      {children}
    </div>
  );
}

export function DataTableHeader({ className, children, ...props }: DataTableSectionProps): ReactElement {
  return (
    <div
      {...props}
      className={["ui-data-table-header", className].filter(Boolean).join(" ")}
      data-ui-region="table-header"
      role="rowgroup"
    >
      {children}
    </div>
  );
}

export function DataTableBody({ className, children, ...props }: DataTableSectionProps): ReactElement {
  return (
    <div
      {...props}
      className={["ui-data-table-body", className].filter(Boolean).join(" ")}
      data-ui-region="table-body"
      role="rowgroup"
    >
      {children}
    </div>
  );
}

export function DataTableEmpty({
  title,
  description,
  illustration,
  className,
  ...props
}: DataTableEmptyProps): ReactElement {
  return (
    <div
      {...props}
      className={["ui-data-table-empty", className].filter(Boolean).join(" ")}
      role="row"
    >
      <div className="ui-data-table-empty-cell" role="cell">
        {illustration ? <div className="ui-data-table-empty-illustration">{illustration}</div> : null}
        <strong className="ui-data-table-empty-title">{title}</strong>
        {description ? <span className="ui-data-table-empty-description">{description}</span> : null}
      </div>
    </div>
  );
}

export function DataTableFooter({
  pageSize,
  rangeLabel,
  paginationVisible,
  className,
  ...props
}: DataTableFooterProps): ReactElement | null {
  if (!paginationVisible) {
    return null;
  }

  return (
    <div
      {...props}
      aria-label="Seitennavigation"
      className={["ui-data-table-footer", className].filter(Boolean).join(" ")}
      role="navigation"
    >
      <span className="ui-data-table-page-size">{pageSize} pro Seite</span>
      <span className="ui-data-table-range" aria-live="polite">{rangeLabel}</span>
    </div>
  );
}
