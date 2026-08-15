import { cn } from "@/lib/cn";

// The lead-status pill vocabulary (WP-Q). Extracted from the StatusSelect client
// component so both the interactive trigger and static display pills (portal + admin)
// share one source. Colors are semantic tokens only (PRN-12); shape/size is PILL_BASE.

export const STATUS_PILL: Record<string, string> = {
  New: "bg-surface-3 text-text-2",
  Contacted: "bg-brand-soft text-brand-ink",
  Appointment: "bg-warn-soft text-warn",
  "Under contract": "bg-prev-soft text-prev",
  Closed: "bg-success-soft text-success",
  Dead: "bg-danger-soft text-danger",
};

/** Shared status-pill base (shape + size); color comes from STATUS_PILL. UI font, not
 *  `.num` — status labels are words, not ledger numerics (matches the Badge primitive). */
const PILL_BASE = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold";

/** Full className for a status pill: base + the status's color (neutral fallback for an
 *  unknown status) + an optional caller extra (e.g. `ml-auto`, cursor/focus for a trigger). */
export function statusPillClass(status: string, extra?: string): string {
  return cn(PILL_BASE, STATUS_PILL[status] ?? "bg-surface-3 text-text-2", extra);
}

// KAN-01: the board's column dot + the "Move to…" menu bullets. Same vocabulary as the
// pills above (one status → one hue everywhere), just the solid fill instead of the
// soft pair. Decorative ONLY — every dot sits beside its status word (PRN-14).
const STATUS_DOT: Record<string, string> = {
  New: "bg-text-3",
  Contacted: "bg-brand",
  Appointment: "bg-warn",
  "Under contract": "bg-prev",
  Closed: "bg-success",
  Dead: "bg-danger",
};

/** Tailwind background utility for a status's dot (neutral fallback for an unknown status). */
export function statusDotClass(status: string): string {
  return STATUS_DOT[status] ?? "bg-text-3";
}
