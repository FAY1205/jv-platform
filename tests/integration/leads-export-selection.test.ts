import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import type { ScopeContext } from "@/lib/scope";
import type * as ScopeContextModule from "@/lib/scope-context";
import { EXPORT_COLUMNS, SELECTION_EXPORT_SCOPE_NOTE } from "@/modules/export/render";
import { jsonRequest, scopeContextMock, setRouteScope } from "./_route-harness";
import { purgeAuditLog } from "../helpers/audit";

// ─────────────────────────────────────────────────────────────────────────────
// WP-N6 PR B — POST /api/leads/export driven over HTTP, so the CSRF check, the `data.export`
// gate, the strict selection contract, the scoped loader and the renderer all run for real
// (N6-40..44, T-1 export leg, T-7).
//
// TST-01d: the tenant leg is LOAD-BEARING. A second tenant carries a lead that every filter
// here matches and a ref the refs-mode test names explicitly; the assertions read the WORKBOOK
// for that lead's data, so dropping the scope conjunct from `selectionConds`/`leadsFilterConds`
// makes them fail. Mutation-verified during development by doing exactly that.
// ─────────────────────────────────────────────────────────────────────────────
vi.mock("@/lib/scope-context", async (orig) => scopeContextMock(await orig<typeof ScopeContextModule>()));

import { POST as exportPost } from "@/app/api/leads/export/route";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const SLUG = "test-leads-export-n6";
const OTHER_SLUG = "test-leads-export-n6-other";

/** The whole tenant, as the selection bar's escalation would serialize it. */
const ALL_FILTER = { mode: "filter" as const, filters: { statuses: [] as string[] } };

suite("WP-N6: export selected leads", () => {
  let db: ReturnType<typeof getDb>;
  let tenantId: string;
  let otherTenantId: string;
  let userId: string;
  let scope: ScopeContext;
  let partnerA: string;
  let partnerB: string;
  let tagX: string;
  let refs: Record<string, string>;
  let otherRef: string;

  async function cleanup() {
    const t = await db
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(inArray(schema.tenants.slug, [SLUG, OTHER_SLUG]));
    const tids = t.map((x) => x.id);
    if (tids.length === 0) return;
    // The route now writes a `leads.exported` row per successful export, and audit_log carries
    // an FK to tenants — without the purge hatch the tenant DELETE below fails.
    await purgeAuditLog(db, inArray(schema.auditLog.tenantId, tids));
    for (const tbl of [schema.leadTags, schema.tags, schema.leads, schema.uploads, schema.partners, schema.settings, schema.users]) {
      await db.delete(tbl).where(inArray(tbl.tenantId, tids));
    }
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, tids));
  }

  async function seed() {
    await cleanup();
    const [t] = await db.insert(schema.tenants).values({ name: "Export N6", slug: SLUG }).returning({ id: schema.tenants.id });
    const [o] = await db.insert(schema.tenants).values({ name: "Other", slug: OTHER_SLUG }).returning({ id: schema.tenants.id });
    tenantId = t.id;
    otherTenantId = o.id;
    scope = { tenantId, role: "admin", userId };
    await db.insert(schema.users).values({ id: userId, tenantId, email: "ops@example.test", role: "admin" });

    const mkPartner = async (tid: string, refId: string, name: string) =>
      (await db.insert(schema.partners).values({ tenantId: tid, refId, name, color: "#f4c95d", status: "active" }).returning({ id: schema.partners.id }))[0].id;
    partnerA = await mkPartner(tenantId, "JV-001", "Alpha");
    partnerB = await mkPartner(tenantId, "JV-002", "Bravo");
    await mkPartner(otherTenantId, "JV-009", "Foreign");

    tagX = (await db.insert(schema.tags).values({ tenantId, name: "Probate", color: "amber" }).returning({ id: schema.tags.id }))[0].id;

    const mkUpload = async (tid: string, refId: string) =>
      (await db.insert(schema.uploads).values({ tenantId: tid, refId, status: "processed", filename: "x.csv" }).returning({ id: schema.uploads.id }))[0].id;
    const upload = await mkUpload(tenantId, "IM-26-901");
    const otherUpload = await mkUpload(otherTenantId, "IM-26-902");

    let n = 0;
    const mk = async (tid: string, uid: string, v: Partial<typeof schema.leads.$inferInsert>) => {
      const refId = `LD-26-7${String(n++).padStart(4, "0")}`;
      await db.insert(schema.leads).values({
        tenantId: tid,
        refId,
        uploadId: uid,
        dedupeKey: randomUUID(),
        rawJson: {},
        mlsStatus: "kept",
        matchMethod: "none",
        state: "TX",
        campaign: "Weekly",
        sellerFirst: "Dana",
        sellerLast: "Reyes",
        phone: "602-555-0100",
        email: "dana@example.test",
        address: "18 Palo Verde Rd",
        city: "Austin",
        zip: "78701",
        ...v,
      });
      return refId;
    };
    refs = {
      unmatched: await mk(tenantId, upload, {}),
      routed: await mk(tenantId, upload, { partnerId: partnerA, matchMethod: "state_fallback", matchedOn: "TX" }),
      // Pipeline-routed to A but manually transferred to B: the workbook must file it under
      // the EFFECTIVE owner, which is what the leads list shows.
      transferred: await mk(tenantId, upload, { partnerId: partnerA, matchMethod: "zip", manualPartnerId: partnerB }),
      // T-7: a seller name Excel would evaluate as a formula.
      hostile: await mk(tenantId, upload, { sellerLast: "=SUM(A1:A9)" }),
    };
    // Same shape, same state, same campaign — every filter in this suite matches it.
    otherRef = await mk(otherTenantId, otherUpload, { sellerLast: "Foreign" });
  }

  const post = (body: unknown) => exportPost(jsonRequest("POST", "/api/leads/export", body));

  /** Parse a successful export response into its workbook. */
  async function workbookOf(res: Response): Promise<ExcelJS.Workbook> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    return wb;
  }

  /** Every cell of every sheet, as strings — what the recipient can actually read. */
  function allCells(wb: ExcelJS.Workbook): string[] {
    const out: string[] = [];
    wb.eachSheet((sheet) => sheet.eachRow((row) => row.eachCell((c) => out.push(String(c.value)))));
    return out;
  }

  function summaryOf(wb: ExcelJS.Workbook): Map<string, string> {
    const sheet = wb.getWorksheet("Selection_Summary")!;
    const out = new Map<string, string>();
    sheet.eachRow((row) => {
      const [k, v] = [row.getCell(1).value, row.getCell(2).value];
      if (k !== null && v !== null && v !== undefined) out.set(String(k), String(v));
    });
    return out;
  }

  beforeAll(() => {
    db = getDb();
    userId = randomUUID();
  });

  beforeEach(async () => {
    await seed();
    setRouteScope(scope);
  });

  afterAll(async () => {
    await cleanup();
    setRouteScope(null);
  });

  // ── N6-40/N6-43: the response contract ──────────────────────────────────────

  it("N6-43: a successful export downloads synchronously as a dated .xlsx that is never cached", async () => {
    const res = await post({ selection: { mode: "refs", leadRefs: [refs.unmatched] } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="leads-selection-\d{4}-\d{2}-\d{2}\.xlsx"$/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(allCells(await workbookOf(res))).toContain(refs.unmatched);
  });

  it("N6-41/EXP-02: the workbook is the fixed 18-column contract with the legend and the summary sheet", async () => {
    const wb = await workbookOf(await post({ selection: ALL_FILTER }));
    const header: string[] = [];
    wb.getWorksheet("Leads")!.getRow(1).eachCell((c) => header.push(String(c.value)));
    expect(header).toEqual([...EXPORT_COLUMNS]);
    expect(wb.getWorksheet("JV_Color_Legend")).toBeDefined();
    expect(wb.getWorksheet("Selection_Summary")).toBeDefined();
    expect(wb.getWorksheet("Run_Summary")).toBeUndefined();
    // `blankCampaign: false` — this is the ADMIN surface, so lead source is present (N6-41).
    expect(allCells(wb)).toContain("Weekly");
  });

  // ── T-1 / TST-01d: the tenant leg ───────────────────────────────────────────

  it("T-1/TST-01d: an escalated export can never contain a same-user OTHER-tenant lead", async () => {
    const wb = await workbookOf(await post({ selection: ALL_FILTER }));
    const cells = allCells(wb);
    // The foreign lead matches this filter in every respect but tenancy — by ref AND by the
    // seller name that only it carries, so a leak cannot hide behind a shared value.
    expect(cells).not.toContain(otherRef);
    expect(cells).not.toContain("Foreign");
    expect(summaryOf(wb).get("Total exported")).toBe("4");
  });

  it("T-1: a foreign ref in a hand-built selection is simply absent — no row, no error", async () => {
    const res = await post({ selection: { mode: "refs", leadRefs: [refs.unmatched, otherRef] } });
    expect(res.status).toBe(200);
    const wb = await workbookOf(res);
    expect(allCells(wb)).not.toContain(otherRef);
    // The summary tells the operator both numbers: what they asked for, and what resolved.
    expect(summaryOf(wb).get("Selection")).toBe("2 selected by hand");
    expect(summaryOf(wb).get("Total exported")).toBe("1");
  });

  it("T-1: a filter naming another tenant's partner or tag exports nothing — never an existence oracle", async () => {
    const [foreignPartner] = await db
      .select({ id: schema.partners.id })
      .from(schema.partners)
      .where(eq(schema.partners.tenantId, otherTenantId));
    for (const filters of [{ partnerId: foreignPartner.id, statuses: [] }, { state: "ZZ", statuses: [] }]) {
      const res = await post({ selection: { mode: "filter", filters } });
      // Zero rows is `empty_selection`, the same answer a cleared selection gets — not a 404
      // that would confirm the id exists somewhere.
      expect(res.status, JSON.stringify(filters)).toBe(400);
      expect(await res.json()).toMatchObject({ code: "empty_selection" });
    }
  });

  // ── N6-42: the Selection_Summary sheet ──────────────────────────────────────

  it("N6-42: filter mode names the filter in words, with the tag's NAME, plus who and when", async () => {
    await db.insert(schema.leadTags).values({
      tenantId,
      leadId: (await db.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.refId, refs.routed)))[0].id,
      tagId: tagX,
      addedByUserId: userId,
    });
    const wb = await workbookOf(await post({ selection: { mode: "filter", filters: { tags: [tagX], state: "TX", statuses: [] } } }));
    const summary = summaryOf(wb);
    expect(summary.get("Selection")).toBe("TX · tagged Probate");
    expect(summary.get("Total exported")).toBe("1");
    expect(summary.get("Exported by")).toBe("ops@example.test");
    expect(summary.get("Exported at")).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/);
  });

  it("N6-42: the per-partner tally files a transferred lead under its EFFECTIVE owner", async () => {
    const summary = summaryOf(await workbookOf(await post({ selection: ALL_FILTER })));
    // `routed` sits with Alpha; `transferred` was routed to Alpha and manually moved to Bravo,
    // and the list shows it under Bravo — so the workbook must too (PRN-05 keeps the snapshot
    // intact underneath, which is exactly why the two can disagree if this is read wrong).
    expect(summary.get("Alpha (JV-001)")).toBe("1");
    expect(summary.get("Bravo (JV-002)")).toBe("1");
    expect(summary.get("Unmatched")).toBe("2");
  });

  it("N6-42/T-7/SEC-06: a formula-prefixed seller name AND a formula-prefixed filter q are both neutralised", async () => {
    const hostile = "=SUM(A1:A9)";
    // `q` matches the hostile lead by its seller name, so the SAME string travels both routes:
    // into a lead cell, and into the filter sentence on the summary sheet.
    const wb = await workbookOf(await post({ selection: { mode: "filter", filters: { q: hostile, statuses: [] } } }));
    const cells = allCells(wb);
    expect(cells).toContain(`'${hostile}`);
    expect(cells).not.toContain(hostile);
    // The sentence wraps `q` in quotes, so it no longer starts with `=` — the assertion is
    // that the operator's raw text arrived and nothing evaluates.
    expect(summaryOf(wb).get("Selection")).toBe(`search “${hostile}”`);
  });

  // ── Boundary + gates ────────────────────────────────────────────────────────

  it("N6-40: an empty hand-built selection is `empty_selection`, and no workbook is produced", async () => {
    const res = await post({ selection: { mode: "refs", leadRefs: [] } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "empty_selection" });
    expect(res.headers.get("content-disposition")).toBeNull();
  });

  it("N6-02: the export takes the same STRICT filter contract as the writes — a bad filter is 400", async () => {
    for (const filters of [{ state: "Arizona" }, { hot: "1" }, { page: 2 }]) {
      const res = await post({ selection: { mode: "filter", filters } });
      expect(res.status, JSON.stringify(filters)).toBe(400);
      expect(await res.json()).toMatchObject({ code: "invalid_filters" });
    }
  });

  it("T-2/N6-40: a seat without `data.export` is refused, and a partner scope with it", async () => {
    setRouteScope({ tenantId, role: "member", userId });
    const member = await post({ selection: ALL_FILTER });
    expect(member.status).toBe(403);
    expect(await member.json()).toMatchObject({ code: "forbidden" });

    // A partner holds no capability by construction (ADR-0047) — the gate, not the loader's
    // scope predicate, is what refuses them.
    setRouteScope({ tenantId, role: "partner", userId, partnerId: randomUUID() });
    const partner = await post({ selection: ALL_FILTER });
    expect(partner.status).toBe(403);
    expect(await partner.json()).toMatchObject({ code: "forbidden" });
  });

  it("F-04/LGL-01: a self-serve seat that has not accepted the current ToS is refused", async () => {
    // Tenants seed with `self_serve = false` (owner-provisioned) and are exempt, so this line
    // of the route never executed in any test until now (tenancy F-5). Flipping the flag with
    // no acceptance row on file is exactly the post-version-bump state the gate exists for.
    // No restore needed: `beforeEach` rebuilds the fixture.
    await db.update(schema.tenants).set({ selfServe: true }).where(eq(schema.tenants.id, tenantId));
    const res = await post({ selection: ALL_FILTER });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "tos_required" });
    expect(res.headers.get("content-disposition")).toBeNull();
  });

  it("AUTHZ-09: a VIEWER whose tenant granted `data.export` gets the workbook", async () => {
    // The positive leg, and the seat the `selectable` widening exists for: a read-only tier
    // that cannot mutate a lead but may take the data out. Capabilities are tenant-CONFIGURED
    // for member/viewer (ADR-0049), so proving the 403 alone would leave the grant path
    // unexercised — a gate that refused everyone would pass that half of the matrix.
    setRouteScope({ tenantId, role: "viewer", userId, capabilities: new Set(["data.export"]) });
    const res = await post({ selection: ALL_FILTER });
    expect(res.status).toBe(200);
    expect(allCells(await workbookOf(res))).toContain(refs.unmatched);
  });

  it("audit: one `leads.exported` row records who/what/how-many — and no lead refs or PII", async () => {
    const res = await post({ selection: { mode: "filter", filters: { state: "TX", statuses: [] } } });
    expect(res.status).toBe(200);
    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.tenantId, tenantId), eq(schema.auditLog.action, "leads.exported")));
    expect(rows.length).toBe(1);
    expect(rows[0].actorUserId).toBe(userId);
    expect(rows[0].entityRef).toBeNull(); // a selection is not one entity
    expect(rows[0].after).toEqual({ mode: "filter", selection: "TX", count: 4 });
    // SEC-05: the trail describes the act, it does not become a second copy of the data. No
    // ref id and no seller field may appear anywhere in the payload.
    const payload = JSON.stringify(rows[0].after);
    for (const leaked of [...Object.values(refs), "Reyes", "dana@example.test", "602-555-0100"]) {
      expect(payload, `audit payload leaked ${leaked}`).not.toContain(leaked);
    }
  });

  it("tenancy F-6: the workbook states it is the INTERNAL copy, not the partner deliverable", async () => {
    // The file is visually identical to what admins forward to partners, but carries the lead
    // source and can carry MLS-removed leads. The marking has to be inside the file.
    const summary = summaryOf(await workbookOf(await post({ selection: ALL_FILTER })));
    expect(summary.get("Scope")).toBe(SELECTION_EXPORT_SCOPE_NOTE);
  });

  it("N6-40: a request without the CSRF pair is refused before anything is read", async () => {
    const res = await exportPost(
      new Request("http://localhost:3000/api/leads/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ selection: ALL_FILTER }),
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "csrf_rejected" });
  });

  it("SET-01: color coding follows the workspace setting, not a hardcoded default", async () => {
    // OFF stores a bold group-header row per partner instead of full-row fills (EXP-06), so
    // the partner label appears as its own cell in the Leads sheet.
    await db.insert(schema.settings).values({ tenantId, key: "color_coding", value: false });
    const off = await workbookOf(await post({ selection: ALL_FILTER }));
    const leadsSheet = off.getWorksheet("Leads")!;
    const firstColumn: string[] = [];
    leadsSheet.eachRow((row) => firstColumn.push(String(row.getCell(1).value)));
    expect(firstColumn).toContain("Alpha (JV-001)");
  });
});
