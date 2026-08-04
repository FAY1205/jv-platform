// AI rate decision + month-window helper (AIA-06/SET-11). PURE — callers inject the
// numbers; no Date.now()/DB in here (PRN-01 discipline). The monthly spend CAP was
// removed (ADR-0036 follow-up): each tenant runs on their own provider key and caps
// spend in their provider's own dashboard, so an in-app dollar ceiling was a
// misleading estimate. Usage is still metered for the read-only "usage this month".
export const RATE_LIMIT_PER_MINUTE = 15;

export function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function rateDecision(i: { questionsLastMinute: number }): { allowed: boolean } {
  return { allowed: i.questionsLastMinute < RATE_LIMIT_PER_MINUTE };
}
