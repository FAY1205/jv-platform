import { and, count, eq, gte, sum } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";
import { monthStartUtc } from "./budget";

// AIA-06/BIL-04 metering. Counts + cost only — NEVER message content (SEC-05).
type Db = PostgresJsDatabase<typeof schema>;

export async function recordUsage(db: Db, scope: ScopeContext, u: { userId: string; model: string; inputTokens: number; outputTokens: number; costMicroUsd: number }): Promise<void> {
  await db.insert(schema.aiUsage).values({ tenantId: scope.tenantId, ...u });
}

/** AIA-07 (F-1): record the attempt BEFORE the model call so an aborted stream still counts
 *  and a concurrent burst can't slip under a stale pre-write count. Returns the row id;
 *  `finalizeUsage` fills in the token counts when the stream finishes (or aborts). */
export async function recordAttempt(db: Db, scope: ScopeContext, u: { userId: string; model: string }): Promise<string> {
  const [row] = await db
    .insert(schema.aiUsage)
    .values({ tenantId: scope.tenantId, userId: u.userId, model: u.model, inputTokens: 0, outputTokens: 0, costMicroUsd: 0 })
    .returning({ id: schema.aiUsage.id });
  return row.id;
}

/** Fills in the token counts + cost on a pre-inserted attempt row (AIA-07). Tenant-scoped
 *  (PRN-08) and keyed by the attempt id so it updates the one row, never inserts a second. */
export async function finalizeUsage(db: Db, scope: ScopeContext, id: string, u: { inputTokens: number; outputTokens: number; costMicroUsd: number }): Promise<void> {
  await db
    .update(schema.aiUsage)
    .set({ inputTokens: u.inputTokens, outputTokens: u.outputTokens, costMicroUsd: u.costMicroUsd })
    .where(and(tenantWhere(schema.aiUsage, scope), eq(schema.aiUsage.id, id)));
}

export async function monthToDateMicroUsd(db: Db, scope: ScopeContext, now: Date): Promise<number> {
  const [row] = await db.select({ total: sum(schema.aiUsage.costMicroUsd) }).from(schema.aiUsage)
    .where(and(tenantWhere(schema.aiUsage, scope), gte(schema.aiUsage.createdAt, monthStartUtc(now))));
  return Number(row?.total ?? 0);
}

export async function questionsInLastMinute(db: Db, scope: ScopeContext, userId: string, now: Date): Promise<number> {
  const [row] = await db.select({ n: count() }).from(schema.aiUsage)
    .where(and(tenantWhere(schema.aiUsage, scope), eq(schema.aiUsage.userId, userId), gte(schema.aiUsage.createdAt, new Date(now.getTime() - 60_000))));
  return Number(row?.n ?? 0);
}
