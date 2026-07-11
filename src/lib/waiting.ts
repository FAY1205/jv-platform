// ASN-03: how long an unmatched lead has waited. PURE — `now` is injected, never read
// (mirrors the analytics discipline). Hours under 2 days, otherwise days, one decimal.
export function formatWaiting(receivedISO: string, nowMs: number): string {
  const hours = Math.max(0, (nowMs - new Date(receivedISO).getTime()) / 3_600_000);
  if (hours < 48) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round((hours / 24) * 10) / 10}d`;
}
