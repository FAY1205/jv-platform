import * as React from "react";
import { cn } from "@/lib/cn";

/** Table — scroll container + table element with sticky-capable headers (DSN-07).
 *  The scroll container is keyboard-focusable (D2, SC 2.1.1): a wide table's
 *  horizontal overflow must be scrollable without a pointer, and browsers don't
 *  auto-focus scrollers that contain focusable children (the sortable Th buttons).
 *  tabIndex + role="region" + an accessible name is the canonical pattern; the
 *  global :focus-visible outline provides the visible focus state. Pass `ariaLabel`
 *  to name the region for pages with several tables (defaults to "Table"). */
export function Table({
  className,
  children,
  maxHeight,
  ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ...rest
}: React.HTMLAttributes<HTMLTableElement> & { maxHeight?: number; ariaLabel?: string }) {
  return (
    <div
      className="overflow-auto"
      style={maxHeight ? { maxHeight } : undefined}
      tabIndex={0}
      role="region"
      // A caller's aria-labelledby names the REGION too (it would otherwise be shadowed
      // by the generic default — the mls-phrases WCAG 1.3.1 pattern); ariaLabel is the
      // explicit name for pages with several tables. Default keeps single-table pages cheap.
      aria-labelledby={ariaLabelledBy}
      aria-label={ariaLabelledBy ? undefined : ariaLabel ?? "Table"}
    >
      <table className={cn("w-full border-collapse text-sm", className)} aria-labelledby={ariaLabelledBy} {...rest}>
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

// ── Column sizing vocabulary (WP-UX-1) ───────────────────────────────────────
// The audit's T1 finding: auto-layout tables mis-budget width — starved columns
// wrap (dates, names) while others hoard dead gutters. The shared recipe:
//   • `fit` on a column's Th + Td → `w-px` + nowrap: the column takes exactly its
//     content width (IDs, dates, status pills, counts, action clusters).
//   • `clamp` on a Td → `max-w-0` + an inner `truncate` block: the column absorbs
//     the leftover width and ellipsizes instead of wrapping (names, addresses,
//     filenames). Pass `clampTitle` so the full value survives as a tooltip.
// Content columns never wrap; flexible columns never push the table wide. The
// Unmatched table's density/behavior is the reference this generalizes.

export interface ThProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  sortable?: boolean;
  sortDir?: SortDir;
  onSort?: () => void;
  align?: "left" | "right";
  /** Content-sized column: header contributes no width beyond its label. */
  fit?: boolean;
}

export function Th({ sortable, sortDir = null, onSort, align = "left", fit, className, children, ...rest }: ThProps) {
  const base = cn(
    "text-step-1 uppercase tracking-wider text-text-3 font-semibold px-3.5 py-2.5",
    "border-b border-border-strong bg-surface-2 whitespace-nowrap sticky top-0 z-[2]",
    align === "right" ? "text-right" : "text-left",
    sortable && "cursor-pointer select-none hover:text-text",
    fit && "w-px",
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
  /** Content-sized cell (pair with the column's `fit` Th): never wraps, never hoards. */
  fit?: boolean;
  /** Flexible cell: absorbs leftover width and ellipsizes instead of wrapping. */
  clamp?: boolean;
  /** Full value for the clamped cell's tooltip (title attribute). */
  clampTitle?: string;
}

export function Td({ align = "left", rail, fit, clamp, clampTitle, className, style, children, ...rest }: TdProps) {
  return (
    <td
      className={cn(
        "px-3.5 py-2.5 align-middle",
        align === "right" && "text-right",
        fit && "w-px whitespace-nowrap",
        clamp && "max-w-0",
        className,
      )}
      style={rail ? { borderLeft: `3px solid ${rail}`, ...style } : style}
      {...rest}
    >
      {clamp ? (
        <div className="truncate" title={clampTitle}>
          {children}
        </div>
      ) : (
        children
      )}
    </td>
  );
}
