import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";
import { DEFAULT_MONTHLY_CAP_USD } from "./budget";

// SET-11: AI assistant tenant settings, rows in the generic `settings` table
// (PRN-08 scoped; same pattern as modules/settings/export-settings). The model is
// NOT a setting (ADR-0027: fixed constant, no selection UI).

export const AI_ENABLED_KEY = "ai_enabled";
export const AI_CAP_KEY = "ai_monthly_cap_usd";

export function coerceAiEnabled(value: unknown): boolean {
  return value === true; // default OFF until the admin flips it (spec §8)
}

export function coerceCapUsd(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : DEFAULT_MONTHLY_CAP_USD;
}

async function readSetting(scope: ScopeContext, key: string): Promise<unknown> {
  const [row] = await getDb()
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(and(tenantWhere(schema.settings, scope), eq(schema.settings.key, key)));
  return row?.value;
}

export async function loadAiSettings(scope: ScopeContext): Promise<{ enabled: boolean; capUsd: number }> {
  return {
    enabled: coerceAiEnabled(await readSetting(scope, AI_ENABLED_KEY)),
    capUsd: coerceCapUsd(await readSetting(scope, AI_CAP_KEY)),
  };
}

export async function saveAiSettings(scope: ScopeContext, v: { enabled: boolean; capUsd: number }): Promise<void> {
  const db = getDb();
  for (const [key, value] of [[AI_ENABLED_KEY, v.enabled], [AI_CAP_KEY, v.capUsd]] as const) {
    await db.insert(schema.settings).values({ tenantId: scope.tenantId, key, value })
      .onConflictDoUpdate({ target: [schema.settings.tenantId, schema.settings.key], set: { value, updatedAt: new Date() } });
  }
}
