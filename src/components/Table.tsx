import * as React from "react";
import { cn } from "@/lib/cn";

/** Table — scroll container + table element with sticky-capable headers (DSN-07). */
export function Table({
  className,
  children,
  maxHeight,
  ...rest
}: React.HTMLAttributes<HTMLTableElement> & { maxHeight?: number }) {
  return (
    <div className="overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
      <table className={cn("w-full border-collapse text-sm", className)} {...rest}>
        {children}
      </table>
    </div>
  );
}

export function THead({ className, ...rest }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={className} {...rest} />;
}

export function TBody({ className, ...rest }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={className} {...rest} />;
}

export type SortDir = "asc" | "desc" | null;

export interface ThProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  sortable?: boolean;
  sortDir?: SortDir;
  onSort?: () => void;
  align?: "left" | "right";
}

export function Th({ sortable, sortDir = null, onSort, align = "left", className, children, ...rest }: ThProps) {
  const base = cn(
    "text-step-1 uppercase tracking-wider text-text-3 font-semibold px-3.5 py-2.5",
    "border-b border-border-strong bg-surface-2 whitespace-nowrap sticky top-0 z-[2]",
    align === "right" ? "text-right" : "text-left",
    sortable && "cursor-pointer select-none hover:text-text",
    className,
  );
  return (
    <th
      scope="col"
      className={base}
      aria-sort={sortDir === "asc" ? "ascending" : sortDir === "desc" ? "descending" : undefined}
      {...rest}
    >
      {sortable ? (
        <button
          type="button"
          onClick={onSort}
          className="inline-flex items-center gap-1 uppercase tracking-wider text-inherit"
        >
          {children}
          <span aria-hidden="true" className="text-text-3">
            {sortDir === "asc" ? "↑" : sortDir === "desc" ? "↓" : "↕"}
          </span>
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export interface TrProps extends React.HTMLAttributes<HTMLTableRowElement> {
  /** Partner accent color — applies the signature left-border + tinted fill (PRN-14). */
  accent?: string;
}

export function Tr({ accent, className, style, children, ...rest }: TrProps) {
  const accentStyle: React.CSSProperties | undefined = accent
    ? { background: `color-mix(in srgb, ${accent} 7%, var(--surface))`, ...style }
    : style;
  return (
    <tr
      className={cn("border-b border-border-soft transition-colors", className)}
      style={accentStyle}
      data-accent={accent ?? undefined}
      {...rest}
    >
      {children}
    </tr>
  );
}

export interface TdProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  align?: "left" | "right";
  /** When set on the first cell of an accented row, draws the color rail. */
  rail?: string;
}

export function Td({ align = "left", rail, className, style, ...rest }: TdProps) {
  return (
    <td
      className={cn("px-3.5 py-2.5 align-middle", align === "right" && "text-right", className)}
      style={rail ? { borderLeft: `3px solid ${rail}`, ...style } : style}
      {...rest}
    />
  );
}
