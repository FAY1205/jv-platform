// AI budget + rate decisions (AIA-06/SET-11). PURE — callers inject the numbers;
// no Date.now()/DB in here (PRN-01 discipline). Cap is a HARD stop (owner call).

export const DEFAULT_MONTHLY_CAP_USD = 10;
export const RATE_LIMIT_PER_MINUTE = 15;

export function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function budgetDecision(i: { spentMicroUsd: number; capUsd: number }): { allowed: boolean } {
  if (!(i.capUsd > 0)) return { allowed: false };
  return { allowed: i.spentMicroUsd < i.capUsd * 1_000_000 };
}

export function rateDecision(i: { questionsLastMinute: number }): { allowed: boolean } {
  return { allowed: i.questionsLastMinute < RATE_LIMIT_PER_MINUTE };
}
