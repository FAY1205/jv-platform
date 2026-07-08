import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { tenantWhere, type ScopeContext } from "@/lib/scope";
import type { RecodeInput, MlsPatternUpdateInput } from "./schema";

// CVG-02 write side. Every rules change is audited (DM-08 — the run captures the
// live rules into an immutable snapshot; these edits change future runs only).
// MLS pattern regex is NEVER written here (PRN-04) — only label + enabled.

export class RuleNotFoundError extends Error {
  constructor() {
    super("Rule not found.");
    this.name = "RuleNotFoundError";
  }
}

function audit(scope: ScopeContext, action: string, entityRef: string | null, before: unknown, after: unknown) {
  return getDb()
    .insert(schema.auditLog)
    .values({
      tenantId: scope.tenantId,
      actorUserId: scope.userId,
      action,
      entityType: "rule",
      entityRef,
      before: before as Record<string, unknown>,
      after: after as Record<string, unknown>,
      traceId: globalThis.crypto.randomUUID(),
    });
}

export async function createRecode(scope: ScopeContext, input: RecodeInput): Promise<{ id: string }> {
  const [row] = await getDb()
    .insert(schema.campaignRecodes)
    .values({ tenantId: scope.tenantId, matchPattern: input.matchPattern, code: input.code })
    .returning({ id: schema.campaignRecodes.id });
  await audit(scope, "recode.created", input.matchPattern, null, input);
  return { id: row.id };
}

export async function updateRecode(scope: ScopeContext, id: string, input: RecodeInput): Promise<void> {
  const [before] = await getDb()
    .select()
    .from(schema.campaignRecodes)
    .where(and(tenantWhere(schema.campaignRecodes, scope), eq(schema.campaignRecodes.id, id)));
  if (!before) throw new RuleNotFoundError();
  await getDb()
    .update(schema.campaignRecodes)
    .set({ matchPattern: input.matchPattern, code: input.code })
    .where(and(tenantWhere(schema.campaignRecodes, scope), eq(schema.campaignRecodes.id, id)));
  await audit(scope, "recode.updated", input.matchPattern, { matchPattern: before.matchPattern, code: before.code }, input);
}

export async function deleteRecode(scope: ScopeContext, id: string): Promise<void> {
  const [before] = await getDb()
    .select()
    .from(schema.campaignRecodes)
    .where(and(tenantWhere(schema.campaignRecodes, scope), eq(schema.campaignRecodes.id, id)));
  if (!before) throw new RuleNotFoundError();
  await getDb()
    .delete(schema.campaignRecodes)
    .where(and(tenantWhere(schema.campaignRecodes, scope), eq(schema.campaignRecodes.id, id)));
  await audit(scope, "recode.deleted", before.matchPattern, { matchPattern: before.matchPattern, code: before.code }, null);
}

export async function updateMlsPattern(scope: ScopeContext, id: string, patch: MlsPatternUpdateInput): Promise<void> {
  const [before] = await getDb()
    .select()
    .from(schema.mlsPatterns)
    .where(and(tenantWhere(schema.mlsPatterns, scope), eq(schema.mlsPatterns.id, id)));
  if (!before) throw new RuleNotFoundError();

  const set: Partial<typeof schema.mlsPatterns.$inferInsert> = {};
  if (patch.label !== undefined) set.label = patch.label;
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (Object.keys(set).length === 0) return;

  await getDb()
    .update(schema.mlsPatterns)
    .set(set)
    .where(and(tenantWhere(schema.mlsPatterns, scope), eq(schema.mlsPatterns.id, id)));
  await audit(
    scope,
    "mls_pattern.updated",
    before.patternKey,
    { label: before.label, enabled: before.enabled },
    { ...set },
  );
}
