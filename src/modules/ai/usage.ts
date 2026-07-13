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
