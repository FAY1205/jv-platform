import { and, desc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";

// LGL-01: read/write ToS acceptances (one row per user+version).
type DB = PostgresJsDatabase<typeof schema>;

export async function latestTosVersion(db: DB, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ version: schema.tosAcceptances.version })
    .from(schema.tosAcceptances)
    .where(eq(schema.tosAcceptances.userId, userId))
    .orderBy(desc(schema.tosAcceptances.acceptedAt))
    .limit(1);
  return row?.version ?? null;
}

export async function recordTosAcceptance(db: DB, userId: string, version: string): Promise<void> {
  await db
    .insert(schema.tosAcceptances)
    .values({ userId, version })
    .onConflictDoNothing({ target: [schema.tosAcceptances.userId, schema.tosAcceptances.version] });
}

export async function hasAcceptedTos(db: DB, userId: string, version: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.tosAcceptances.id })
    .from(schema.tosAcceptances)
    .where(and(eq(schema.tosAcceptances.userId, userId), eq(schema.tosAcceptances.version, version)))
    .limit(1);
  return Boolean(row);
}
