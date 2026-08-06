import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { tenantIdWhere } from "@/lib/scope";

// ─────────────────────────────────────────────────────────────────────────────
// DB-backed idempotency (API-03) for the upload route. A retried POST with the same
// Idempotency-Key never double-processes: the first request claims the key, runs the
// work, and stores the response; a replay returns the stored response; a replay while
// still in progress is rejected. (The Phase-0 in-memory store is sync; routes are async.)
// ─────────────────────────────────────────────────────────────────────────────

export class RequestInProgressError extends Error {
  constructor() {
    super("A request with this idempotency key is already in progress.");
    this.name = "RequestInProgressError";
  }
}

export async function withDbIdempotency<T>(
  db: PostgresJsDatabase<typeof schema>,
  tenantId: string,
  key: string,
  work: () => Promise<T>,
): Promise<{ replayed: boolean; response: T }> {
  const claimed = await db
    .insert(schema.idempotencyKeys)
    .values({ tenantId, key, status: "in_progress" })
    .onConflictDoNothing({ target: [schema.idempotencyKeys.tenantId, schema.idempotencyKeys.key] })
    .returning({ id: schema.idempotencyKeys.id });

  if (claimed.length === 0) {
    const [existing] = await db
      .select()
      .from(schema.idempotencyKeys)
      .where(and(tenantIdWhere(schema.idempotencyKeys, tenantId), eq(schema.idempotencyKeys.key, key)));
    if (existing?.status === "completed") return { replayed: true, response: existing.response as T };
    throw new RequestInProgressError();
  }

  const response = await work();
  await db
    .update(schema.idempotencyKeys)
    .set({ status: "completed", response: response as object })
    .where(and(tenantIdWhere(schema.idempotencyKeys, tenantId), eq(schema.idempotencyKeys.key, key)));
  return { replayed: false, response };
}
