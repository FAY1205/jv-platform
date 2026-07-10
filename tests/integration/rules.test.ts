import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "@/db/schema";
import { purgeAuditLog } from "../helpers/audit";
import { updateMlsPattern } from "@/modules/rules/commands";
import { listMlsPatterns } from "@/modules/rules/queries";
import type { ScopeContext } from "@/lib/scope";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-rules-wp032a";

suite("WP-032a: rules area (CVG-02, DM-08)", () => {
  let client: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let scope: ScopeContext;
  let mlsId: string;

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
    const [m] = await db.insert(schema.mlsPatterns).values({ tenantId: t.id, patternKey: "dq_is_listed_yes", type: "disqualify", regex: "listed\\?\\s*:?\\s*yes", flags: "i", label: "Is it Listed?: Yes", enabled: true }).returning({ id: schema.mlsPatterns.id });
    mlsId = m.id;
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  it("CVG-02/PRN-04: MLS toggle changes enabled + label but never the regex, audited", async () => {
    const before = (await listMlsPatterns(scope)).find((m) => m.id === mlsId)!;
    await updateMlsPattern(scope, mlsId, { enabled: false, label: "Listed = Yes" });
    const after = (await listMlsPatterns(scope)).find((m) => m.id === mlsId)!;
    expect(after.enabled).toBe(false);
    expect(after.label).toBe("Listed = Yes");
    expect(after.regex).toBe(before.regex); // regex untouched (PRN-04)
    const audits = await db.select().from(schema.auditLog).where(eq(schema.auditLog.tenantId, scope.tenantId));
    expect(audits.some((a) => a.action === "mls_pattern.updated")).toBe(true);
  });
});
