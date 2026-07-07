// AUT-05: login, invite, OTP, and reset endpoints return uniform messages and
// uniform timing whether or not the account exists. Callers MUST use the same
// response for both branches, and wrap the work in withUniformTiming.

export const UNIFORM_AUTH_MESSAGE = "If an account exists, we've sent a code.";

export interface UniformAuthResponse {
  code: "AUTH_UNIFORM";
  message: string;
}

/** The one response shape used for BOTH the account-exists and not-exists paths. */
export function uniformAuthResponse(): UniformAuthResponse {
  return { code: "AUTH_UNIFORM", message: UNIFORM_AUTH_MESSAGE };
}

/**
 * Run work but never return before `minMs` has elapsed, so response timing does
 * not reveal whether an account existed (AUT-05). Errors are swallowed into the
 * uniform timing floor; the caller returns the uniform response regardless.
 */
export async function withUniformTiming<T>(
  minMs: number,
  work: () => Promise<T>,
  sleep: (ms: number) => Promise<void>,
  elapsed: () => number,
): Promise<T | undefined> {
  const start = elapsed();
  let result: T | undefined;
  try {
    result = await work();
  } catch {
    result = undefined;
  }
  const remaining = minMs - (elapsed() - start);
  if (remaining > 0) await sleep(remaining);
  return result;
}
