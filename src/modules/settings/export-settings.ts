import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";

// WS-7g: tenant Data & Export settings, stored as rows in the generic `settings` table
// (PRN-08 scoped, like modules/notify/prefs). F-39: color coding was seeded (SET-01) but
// never read — export call sites hardcoded it. retention_days (SET-07) is read-only here.

export const COLOR_CODING_KEY = "color_coding";
export const RETENTION_DAYS_KEY = "retention_days";
export const VOID_NOTIFIES_PARTNERS_KEY = "void_notifies_partners";
const DEFAULT_RETENTION_DAYS = 365;

/** SET-01 default ON — only an explicit stored `false` disables color coding. */
export function coerceColorCoding(value: unknown): boolean {
  return value !== false;
}

/** WP-J2 (ING-09) default ON (PRN-11) — only an explicit stored `false` silences the in-app
 *  recall notice partners get when a run they received leads from is voided. */
export function coerceVoidNotifiesPartners(value: unknown): boolean {
  return value !== false;
}

/** SET-07 — a positive integer number of days, else the 365-day default. */
export function coerceRetentionDays(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : DEFAULT_RETENTION_DAYS;
}

async function readSetting(scope: ScopeContext, key: string): Promise<unknown> {
  const [row] = await getDb()
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(and(tenantWhere(schema.settings, scope), eq(schema.settings.key, key)));
  return row?.value;
}

/** Whether exports for this tenant use color coding (F-39 / EXP-06). */
export async function loadColorCoding(scope: ScopeContext): Promise<boolean> {
  return coerceColorCoding(await readSetting(scope, COLOR_CODING_KEY));
}

/** Persist the color-coding toggle (admin Data & Export). One row per tenant+key. */
export async function saveColorCoding(scope: ScopeContext, value: boolean): Promise<void> {
  await getDb()
    .insert(schema.settings)
    .values({ tenantId: scope.tenantId, key: COLOR_CODING_KEY, value })
    .onConflictDoUpdate({
      target: [schema.settings.tenantId, schema.settings.key],
      set: { value, updatedAt: new Date() },
    });
}

/** Days original upload files are retained (SET-07). Read-only surface for now. */
export async function loadRetentionDays(scope: ScopeContext): Promise<number> {
  return coerceRetentionDays(await readSetting(scope, RETENTION_DAYS_KEY));
}

/** WP-J2 (ING-09): whether voiding a run sends affected partners an in-app recall notice. */
export async function loadVoidNotifiesPartners(scope: ScopeContext): Promise<boolean> {
  return coerceVoidNotifiesPartners(await readSetting(scope, VOID_NOTIFIES_PARTNERS_KEY));
}

/** Persist the void-notify toggle (admin Settings). One row per tenant+key. */
export async function saveVoidNotifiesPartners(scope: ScopeContext, value: boolean): Promise<void> {
  await getDb()
    .insert(schema.settings)
    .values({ tenantId: scope.tenantId, key: VOID_NOTIFIES_PARTNERS_KEY, value })
    .onConflictDoUpdate({
      target: [schema.settings.tenantId, schema.settings.key],
      set: { value, updatedAt: new Date() },
    });
}
