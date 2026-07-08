// SEAM-06: the lead status vocabulary. Seeded 6; the list is tenant-editable in the
// rules area (SET-04, WP-032). Until then this constant is the source of truth.
export const SEED_LEAD_STATUSES = [
  "New",
  "Contacted",
  "Appointment",
  "Under contract",
  "Closed",
  "Dead",
] as const;

export type LeadStatus = (typeof SEED_LEAD_STATUSES)[number];

export const DEFAULT_STATUS = "New";

export function isValidStatus(status: string): boolean {
  return (SEED_LEAD_STATUSES as readonly string[]).includes(status);
}

/** PTL-03: a lead's current status is its latest history entry (default when none). */
export function currentStatus(history: { status: string; createdAt: string }[]): string {
  if (history.length === 0) return DEFAULT_STATUS;
  return [...history].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0].status;
}
