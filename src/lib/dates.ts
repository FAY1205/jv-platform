// The one date-format surface (VCF-2.5 / audit F-5). Before this, seven ad-hoc formatters
// across nine sites disagreed — the same server timestamp rendered "Jul 10, 2026" on the
// admin Imports table but "7/10/2026" in the partner portal. The app is US-facing (ZIPs, US
// states, en-US copy), so display locale is pinned to en-US HERE, once. Timestamps format in
// the viewer's local time zone; fmtBucket is the deliberate exception (UTC-pinned) so trend
// chart buckets align to the server's day/month boundaries regardless of viewer offset.
//
// Note: these take a full ISO timestamp. Date-only calendar values (the DatePicker /
// DateRangePicker) stay on isoToDate — parsing "2026-07-10" through `new Date` here would
// shift a day for west-of-UTC viewers.

const LOCALE = "en-US";

/** A date only, e.g. "Jul 10, 2026". */
export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, { month: "short", day: "numeric", year: "numeric" });
}

/** A date + time, e.g. "Jul 10, 2026, 3:04 PM". */
export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(LOCALE, { dateStyle: "medium", timeStyle: "short" });
}

/** A trend-chart axis label, UTC-pinned so buckets align to server day/month boundaries:
 *  "Jul 3" for a daily bucket, "Jul 2026" for a monthly one. */
export function fmtBucket(iso: string, bucket: "day" | "month"): string {
  const dt = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return bucket === "month"
    ? dt.toLocaleDateString(LOCALE, { month: "short", year: "numeric", timeZone: "UTC" })
    : dt.toLocaleDateString(LOCALE, { month: "short", day: "numeric", timeZone: "UTC" });
}
