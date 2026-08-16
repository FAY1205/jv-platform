import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";

// SET-11: AI assistant tenant settings, rows in the generic `settings` table
// (PRN-08 scoped; same pattern as modules/settings/export-settings). The model is
// NOT a setting (ADR-0027: fixed constant, no selection UI). The monthly spend cap
// was removed (ADR-0036 follow-up) — the only setting now is the enable switch.

export const AI_ENABLED_KEY = "ai_enabled";

export function coerceAiEnabled(value: unknown): boolean {
  return value === true; // default OFF until the admin flips it (spec §8)
}

async function readSetting(scope: ScopeContext, key: string): Promise<unknown> {
  const [row] = await getDb()
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(and(tenantWhere(schema.settings, scope), eq(schema.settings.key, key)));
  return row?.value;
}

export async function loadAiSettings(scope: ScopeContext): Promise<{ enabled: boolean }> {
  return { enabled: coerceAiEnabled(await readSetting(scope, AI_ENABLED_KEY)) };
}

export async function saveAiSettings(scope: ScopeContext, v: { enabled: boolean }): Promise<void> {
  await getDb().insert(schema.settings).values({ tenantId: scope.tenantId, key: AI_ENABLED_KEY, value: v.enabled })
    .onConflictDoUpdate({ target: [schema.settings.tenantId, schema.settings.key], set: { value: v.enabled, updatedAt: sql`now()` } });
}
