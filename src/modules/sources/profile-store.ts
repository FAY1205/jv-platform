import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";
import { SEED_SOURCE_PROFILES } from "./seed-profiles";
import type { CanonicalField, SourceProfile, Strictness } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Source Profile persistence (ING-07, SET-12, DM-08). Detection reads the tenant's
// SAVED profiles (latest version per name) plus the built-in seeds for any format
// not yet saved. A confirmed drift/mapping inserts a NEW version row — the old one
// is never mutated, so past runs stay pinned to the version they used.
// ─────────────────────────────────────────────────────────────────────────────

type DB = PostgresJsDatabase<typeof schema>;

function rowToProfile(r: typeof schema.sourceProfiles.$inferSelect): SourceProfile {
  return {
    id: r.id,
    name: r.name,
    version: r.version,
    headerSignature: r.headerSignature as string[],
    mapping: r.mapping as Partial<Record<CanonicalField, string>>,
    requiredColumns: r.requiredColumns as CanonicalField[],
    strictness: r.strictness as Strictness,
  };
}

/** Latest saved profile per name, unioned with seeds for names not yet saved. */
export async function loadProfilesForDetection(db: DB, scope: ScopeContext): Promise<SourceProfile[]> {
  const rows = await db.select().from(schema.sourceProfiles).where(tenantWhere(schema.sourceProfiles, scope));
  const latest = new Map<string, typeof schema.sourceProfiles.$inferSelect>();
  for (const r of rows) {
    const cur = latest.get(r.name);
    if (!cur || r.version > cur.version) latest.set(r.name, r);
  }
  const saved = [...latest.values()].map(rowToProfile);
  const savedNames = new Set(latest.keys());
  const seeds = SEED_SOURCE_PROFILES.filter((p) => !savedNames.has(p.name));
  return [...saved, ...seeds];
}

/** Persist a confirmed profile version; returns it with the DB id. Audited (DM-08). */
export async function saveProfileVersion(db: DB, scope: ScopeContext, profile: SourceProfile): Promise<SourceProfile> {
  const [row] = await db
    .insert(schema.sourceProfiles)
    .values({
      tenantId: scope.tenantId,
      name: profile.name,
      version: profile.version,
      headerSignature: profile.headerSignature,
      mapping: profile.mapping,
      requiredColumns: profile.requiredColumns,
      strictness: profile.strictness,
    })
    .returning({ id: schema.sourceProfiles.id });
  await db.insert(schema.auditLog).values({
    tenantId: scope.tenantId,
    actorUserId: scope.userId,
    action: "source_profile.saved",
    entityType: "source_profile",
    entityRef: `${profile.name} v${profile.version}`,
    before: null,
    after: { name: profile.name, version: profile.version, columns: profile.headerSignature.length },
    traceId: globalThis.crypto.randomUUID(),
  });
  return { ...profile, id: row.id };
}

export interface ProfileListItem {
  id: string;
  name: string;
  version: number;
  columns: number;
  strictness: Strictness;
  source: "saved" | "builtin";
}

/** All current formats for the Rules view (SET-12): saved versions + built-ins. */
export async function listProfiles(db: DB, scope: ScopeContext): Promise<ProfileListItem[]> {
  const rows = await db.select().from(schema.sourceProfiles).where(tenantWhere(schema.sourceProfiles, scope));
  const savedNames = new Set(rows.map((r) => r.name));
  const latest = new Map<string, typeof schema.sourceProfiles.$inferSelect>();
  for (const r of rows) {
    const cur = latest.get(r.name);
    if (!cur || r.version > cur.version) latest.set(r.name, r);
  }
  const saved: ProfileListItem[] = [...latest.values()].map((r) => ({
    id: r.id, name: r.name, version: r.version, columns: (r.headerSignature as string[]).length, strictness: r.strictness as Strictness, source: "saved",
  }));
  const builtins: ProfileListItem[] = SEED_SOURCE_PROFILES
    .filter((p) => !savedNames.has(p.name))
    .map((p) => ({ id: p.id, name: p.name, version: p.version, columns: p.headerSignature.length, strictness: p.strictness, source: "builtin" }));
  return [...saved, ...builtins];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Find a profile by id among seeds (slug ids) + saved (uuid ids) — for the confirm base. */
export async function findProfileById(db: DB, scope: ScopeContext, id: string): Promise<SourceProfile | null> {
  const seed = SEED_SOURCE_PROFILES.find((p) => p.id === id);
  if (seed) return seed;
  // Saved profiles use uuid ids; never query the uuid column with a non-uuid slug.
  if (!UUID_RE.test(id)) return null;
  const [row] = await db.select().from(schema.sourceProfiles).where(eq(schema.sourceProfiles.id, id));
  if (row && row.tenantId === scope.tenantId) return rowToProfile(row);
  return null;
}
