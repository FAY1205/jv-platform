import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { purgeAuditLog } from "../helpers/audit";
import { listMlsPatterns } from "@/modules/rules/queries";
import type { ScopeContext } from "@/lib/scope";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-rules-wp032a";

suite("WP-032a: rules area (CVG-02, DM-08)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let scope: ScopeContext;
  let enabledId: string;
  let disabledId: string;

  async function cleanup() {
    const t = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, SLUG));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    await purgeAuditLog(db, inArray(schema.auditLog.tenantId, tids));
    for (const tbl of [schema.mlsPatterns, schema.stateRules, schema.coverageZips, schema.partners]) {
      await db.delete(tbl).where(inArray(tbl.tenantId, tids));
    }
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  beforeAll(async () => {
    client = postgres(url!, { prepare: false, max: 1 });
    db = drizzle(client, { schema });
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Rules", slug: SLUG }).returning({ id: schema.tenants.id });
    scope = { tenantId: t.id, role: "admin", userId: randomUUID() };
    const [enabled] = await db.insert(schema.mlsPatterns).values({ tenantId: t.id, patternKey: "dq_ls1_listed_yes", type: "disqualify", regex: "listed\\?\\s*:?\\s*yes", flags: "i", label: "Is it Listed?: Yes", enabled: true }).returning({ id: schema.mlsPatterns.id });
    enabledId = enabled.id;
    // A retired v1 row (disabled). The read-only Rules page must never surface it, so a
    // migrated tenant can't re-enable the pattern that once false-fired (WP-LS1 / 0023).
    const [disabled] = await db.insert(schema.mlsPatterns).values({ tenantId: t.id, patternKey: "dq_on_market", type: "disqualify", regex: "on market", flags: "i", label: "On market", enabled: false }).returning({ id: schema.mlsPatterns.id });
    disabledId = disabled.id;
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  it("CVG-02: the Rules read model returns only ENABLED phrases (retired rows stay hidden)", async () => {
    const rows = await listMlsPatterns(scope);
    expect(rows.some((m) => m.id === enabledId)).toBe(true);
    expect(rows.some((m) => m.id === disabledId)).toBe(false);
    expect(rows.every((m) => m.enabled)).toBe(true);
  });
});
