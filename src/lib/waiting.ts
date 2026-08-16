// ASN-03: how long an unmatched lead has waited. PURE — `now` is injected, never read
// (mirrors the analytics discipline). Hours under 2 days, otherwise days, one decimal.
export function formatWaiting(receivedISO: string, nowMs: number): string {
  const hours = Math.max(0, (nowMs - new Date(receivedISO).getTime()) / 3_600_000);
  if (hours < 48) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round((hours / 24) * 10) / 10}d`;
}

// WP-UX-6 (audit U-1): let the WAITING value carry urgency so the eye is drawn by the
// SIGNAL (a lead waiting weeks) rather than the row's Assign chrome. Two-step, pure: past
// a week it warns, past a month it alarms. The number always renders alongside, so colour
// is never the only carrier (PRN-14).
export const WAITING_WARN_DAYS = 7;
export const WAITING_DANGER_DAYS = 30;
export function waitingTone(receivedISO: string, nowMs: number): "" | "warn" | "danger" {
  const days = Math.max(0, (nowMs - new Date(receivedISO).getTime()) / 86_400_000);
  if (days >= WAITING_DANGER_DAYS) return "danger";
  if (days >= WAITING_WARN_DAYS) return "warn";
  return "";
}
