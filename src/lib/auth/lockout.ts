// AUT-04: progressive delays after repeated failures — never a silent permanent
// lock; the owner is notified on lockout; admin can unlock. Pure function over the
// failed-attempt count, so it is deterministic and testable.

const FREE_ATTEMPTS = 4; // first failures incur no lock
const BASE_MS = 30_000; // 30s at first lockout
const CAP_MS = 3_600_000; // 1h ceiling — always finite (never permanent)

export interface LockoutState {
  locked: boolean;
  retryAfterMs: number;
  /** True exactly at the first lockout — the trigger to email the account owner. */
  shouldNotify: boolean;
}

export function lockoutState(failedCount: number): LockoutState {
  if (failedCount <= FREE_ATTEMPTS) {
    return { locked: false, retryAfterMs: 0, shouldNotify: false };
  }
  const over = failedCount - FREE_ATTEMPTS; // 1, 2, 3, …
  const retryAfterMs = Math.min(BASE_MS * 2 ** (over - 1), CAP_MS);
  return { locked: true, retryAfterMs, shouldNotify: over === 1 };
}

/**
 * Pre-attempt gate: is the account currently locked, given its recent failed
 * count and the time since the last failure? Composes lockoutState's progressive
 * delay with elapsed time so the lock lifts automatically once the delay passes.
 */
export function lockoutGate(
  failedCount: number,
  msSinceLastFailure: number,
): { locked: boolean; retryAfterMs: number } {
  const state = lockoutState(failedCount);
  if (!state.locked) return { locked: false, retryAfterMs: 0 };
  const remaining = state.retryAfterMs - msSinceLastFailure;
  if (remaining <= 0) return { locked: false, retryAfterMs: 0 };
  return { locked: true, retryAfterMs: remaining };
}
