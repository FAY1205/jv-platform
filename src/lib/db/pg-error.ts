// Postgres driver-error inspection, shared so there is ONE unwrap strategy.
//
// drizzle (0.45) wraps the postgres-js error in a DrizzleQueryError with the driver error on
// `.cause`, and a caller may wrap again — so reading `.code` off the top-level error misses.
// WP-SU-2 learned this the hard way on an FK violation; WP-SU-7 then re-implemented a
// shallower two-level version of the same check before review caught the drift. Both now
// call this.
const MAX_CAUSE_DEPTH = 5;

export interface PgErrorInfo {
  code?: string;
  /** The violated constraint, when the driver reports one (23505/23503). */
  constraint?: string;
}

/** Walk the cause chain for the first frame that carries a Postgres error code. */
export function pgErrorInfo(e: unknown): PgErrorInfo {
  let cur: unknown = e;
  for (let depth = 0; cur && depth < MAX_CAUSE_DEPTH; depth++) {
    const frame = cur as { code?: unknown; constraint_name?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof frame.code === "string") {
      const constraint =
        typeof frame.constraint_name === "string"
          ? frame.constraint_name
          : typeof frame.constraint === "string"
            ? frame.constraint
            : undefined;
      return { code: frame.code, constraint };
    }
    cur = frame.cause;
  }
  return {};
}

/** Convenience for the common "is this a specific pg error?" check. */
export function pgErrorCode(e: unknown): string | undefined {
  return pgErrorInfo(e).code;
}
