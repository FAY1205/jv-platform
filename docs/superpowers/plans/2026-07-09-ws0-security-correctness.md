# WS-0 Security & Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every WS-0 audit finding (the "Now" security/correctness bucket) so the dev-DB unit + integration suites are green, including the cross-partner leak divergence case, before WS-1 foundation work begins.

**Architecture:** Small independent diffs, one logical fix per commit, TDD where a test seam exists. The anchor is the effective-owner fix (app-layer `scope.ts` + DB-layer RLS migration 0010) that closes the re-route PII leak. Test-net repair lands first so every later change is verified against the running dev DB.

**Tech Stack:** Next.js 16 (App Router), Drizzle ORM + Postgres (Supabase dev, EU), Vitest (node env), ExcelJS export, Zod validation.

## Global Constraints

- **No `Delivered → Distributed` change in WS-0** — export text, digests, run-summary, notifications keep "Delivered" (D5 is WS-2). Copy verbatim rule from spec §4 WS-0 acceptance: "no `Delivered` behavior changes yet."
- **Ref format stays v1** — `LD-2026-#####`, `UP-2026-###`. All new `RefSchema` guards use `/^LD-\d{4}-\d{3,}$/`. (v2 migration is WS-1.)
- **PRN-01** pipeline purity: no DB/fetch/Date.now in `src/modules/pipeline`. **PRN-05**: never rewrite `partnerId`/`matchMethod` (the import snapshot). **PRN-08**: every query through `lib/scope.ts`. **PRN-12**: tokens only. **PRN-13**: note-stream separation. **ASN-02**: no per-partner special-casing.
- **Migrations forward-only**; custom RLS SQL registered in `_journal.json`. Node ≥ 22 (`process.loadEnvFile` available).
- **No new dependencies** (nothing in WS-0 needs one).
- **Requirement-ID test names**: `it("F-01: …")`, `it("TST-01: …")`.
- Run the relevant suite before each commit. Commit format ends with the Co-Authored-By trailer.

**Suite commands:** `pnpm test:unit` · `pnpm test:integration` · `pnpm run typecheck` · `pnpm run lint` · `pnpm check` (typecheck+lint+test).

**Env loading for integration/migrate (git bash):**
```bash
export DATABASE_URL=$(grep -E '^DATABASE_URL=' .env.local | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//')
```

---

### Task 1: Test infrastructure — green the integration suite

**Files:**
- Modify: `tests/setup.ts`
- Modify: `tests/integration/notifications.test.ts:77`
- Modify: `tests/integration/auth-otp.test.ts` (cleanup function)

**Interfaces:**
- Produces: integration tests auto-load `.env.local` (so `DATABASE_URL` is set without a wrapper), enabling every later task's dev-DB verification.

- [ ] **Step 1: Auto-load `.env.local` in the shared setup**

Append to `tests/setup.ts`:
```ts
// Integration tests read DATABASE_URL from .env.local (Node 22 loadEnvFile).
// Guarded so the unit suite (no DB) and CI (env already set) are unaffected.
import { existsSync } from "node:fs";
if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}
```

- [ ] **Step 2: Fix the stale deep-link assertion**

`tests/integration/notifications.test.ts:77` — the admin run-summary deep link moved to `/imports/` (verified in `outbox.ts:201`):
```ts
expect(adminNotifs.some((n) => n.type === "run_summary" && n.deepLink === "/imports/UP-2026-020")).toBe(true);
```

- [ ] **Step 3: Make `auth-otp.test.ts` cleanup cascade-safe**

Open `tests/integration/auth-otp.test.ts`; its `cleanup()` deletes the tenant (and/or user) without first deleting FK-child rows, so an interrupted run wedges the suite and left the orphan `test-otp-iso` tenant. Rewrite `cleanup()` to resolve the tenant id(s) by slug, then delete children before parents in FK order (mirror the ordering in `isolation.test.ts` / `notifications.test.ts`: notifications, email_outbox, otp/auth child tables, settings, leads, uploads, users, partners, then tenants). Delete by `tenantId IN (...)` and no-op when the slug is absent.

- [ ] **Step 4: Run the integration suite — establish the green baseline**

```bash
export DATABASE_URL=$(grep -E '^DATABASE_URL=' .env.local | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//')
pnpm test:integration
```
Expected: all files pass (the orphan tenant is cleared on first run; notifications passes). If any *other* file is red, investigate before proceeding — the baseline must be green.

- [ ] **Step 5: Commit**

```bash
git add tests/setup.ts tests/integration/notifications.test.ts tests/integration/auth-otp.test.ts
git commit -m "test(ws-0): auto-load .env.local; fix /imports deep-link + cascade cleanup (F-02, F-50)"
```

---

### Task 2: Effective-owner app layer + isolation divergence (TDD anchor, F-01/TR-1)

**Files:**
- Modify: `src/lib/scope.ts:41-43`
- Modify: `tests/integration/isolation.test.ts`

**Interfaces:**
- Produces: `partnerOwnsLead(me)` now returns the **effective owner** predicate (`manualPartnerId = me OR (manualPartnerId IS NULL AND partnerId = me)`), consumed unchanged by `leadWhere`, `noteWhere`, `leadChildWhere`.

- [ ] **Step 1: Write the failing divergence test**

In `tests/integration/isolation.test.ts` `beforeAll`, after the existing seeds, add a re-routed lead (pipeline X, manual overlay Y):
```ts
const [lr] = await db
  .insert(schema.leads)
  .values({ tenantId: ta.id, refId: "LD-2026-00010", uploadId: ua.id, dedupeKey: "r|00010", rawJson: {}, partnerId: px.id, matchMethod: "zip", manualPartnerId: py.id, manualAssignedAt: new Date(), manualAssignedBy: id.adminUser })
  .returning({ id: schema.leads.id });
id.leadReroutedXtoY = lr.id;
```
Add the divergence assertions:
```ts
it("F-01/TST-01: a re-routed lead (partnerId=X, manualPartnerId=Y) leaves X's scope", async () => {
  const xRows = await db.select({ id: schema.leads.id }).from(schema.leads).where(leadWhere(partnerX()));
  expect(xRows.map((r) => r.id)).not.toContain(id.leadReroutedXtoY);
  const yRows = await db.select({ id: schema.leads.id }).from(schema.leads).where(leadWhere(partnerY()));
  expect(yRows.map((r) => r.id)).toContain(id.leadReroutedXtoY);
});
```
Update the existing exact-set assertion "admin sees all of their tenant's leads" to include the new lead:
```ts
expect(got).toEqual([id.leadX, id.leadY, id.leadManualToY, id.leadReroutedXtoY].sort());
```
(The `partnerX` exact-set test still expects `[id.leadX]` — the re-routed lead must be excluded, which is the point.)

- [ ] **Step 2: Run — verify it FAILS on the current OR union**

```bash
export DATABASE_URL=$(grep -E '^DATABASE_URL=' .env.local | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//')
pnpm vitest run tests/integration/isolation.test.ts
```
Expected: FAIL — partner X still sees the re-routed lead (the leak), and the admin exact-set now mismatches.

- [ ] **Step 3: Implement the effective-owner predicate**

`src/lib/scope.ts` — add `isNull` to the import and rewrite `partnerOwnsLead`:
```ts
import { and, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
```
```ts
/** A partner "owns" a lead if it is their EFFECTIVE owner: the manual overlay if
 *  present, else the pipeline snapshot. Re-routing a matched lead to another partner
 *  (editLead "set") REVOKES the original partner's access — the predicates overlap
 *  once a matched lead is re-routed, so this is not a plain union (audit F-01/ASN-04).
 *  The one place partner lead-ownership is defined; every partner-scoped read uses it. */
export function partnerOwnsLead(me: string): SQL {
  return or(eq(leads.manualPartnerId, me), and(isNull(leads.manualPartnerId), eq(leads.partnerId, me)))!;
}
```

- [ ] **Step 4: Run — verify the isolation suite PASSES**

```bash
pnpm vitest run tests/integration/isolation.test.ts
```
Expected: PASS (divergence + all existing cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/scope.ts tests/integration/isolation.test.ts
git commit -m "fix(ws-0): partnerOwnsLead = effective owner; close re-route PII leak (F-01)"
```

---

### Task 3: Migration 0010 — RLS effective-owner backstop (F-01 DB layer)

**Files:**
- Create: `src/db/migrations/0010_effective_owner_rls.sql`
- Modify: `src/db/migrations/meta/_journal.json` (+ snapshot, via `--custom`)

**Interfaces:**
- Produces: the four leads-family RLS policies key on `coalesce(manual_partner_id, partner_id) = app_current_partner()`, matching the app layer.

- [ ] **Step 1: Scaffold the custom migration**

```bash
pnpm exec drizzle-kit generate --custom --name=effective_owner_rls
```
This creates `src/db/migrations/0010_effective_owner_rls.sql` (empty) and registers it in `_journal.json` + a snapshot. If the tool prompts or errors, hand-add the journal entry (`idx:10`, `tag:"0010_effective_owner_rls"`, `when:<epoch-ms>`) and copy `0009_snapshot.json` → `0010_snapshot.json` with a fresh `id`/`prevId`.

- [ ] **Step 2: Write the policy swap SQL**

Postgres has no `create or replace policy`; drop + recreate each. Content of `0010_effective_owner_rls.sql`:
```sql
-- Effective-owner RLS backstop (audit F-01 / ASN-04). The pipeline-only partner_id
-- predicate leaked a re-routed lead back to the original partner. Switch the four
-- leads-family policies to the effective owner: coalesce(manual_partner_id, partner_id).
-- Matches lib/scope.ts partnerOwnsLead exactly. NOTE: the executive-roadmap "OR
-- manual_partner_id = ..." shorthand is the leaky form; the effective-owner form is
-- the one that revokes the prior partner's access (raw audit-tenancy F-1).

drop policy if exists leads_scope on leads;
create policy leads_scope on leads for all
  using (
    tenant_id = app_current_tenant()
    and (app_current_role() = 'admin'
         or coalesce(manual_partner_id, partner_id) = app_current_partner())
  )
  with check (tenant_id = app_current_tenant());
--> statement-breakpoint
drop policy if exists lead_notes_scope on lead_notes;
create policy lead_notes_scope on lead_notes for all
  using (
    tenant_id = app_current_tenant()
    and (
      (app_current_role() = 'admin' and author_role = 'admin')
      or (
        app_current_role() = 'partner' and author_role = 'partner'
        and lead_id in (select id from leads where coalesce(manual_partner_id, partner_id) = app_current_partner())
      )
    )
  )
  with check (tenant_id = app_current_tenant());
--> statement-breakpoint
drop policy if exists lead_status_history_scope on lead_status_history;
create policy lead_status_history_scope on lead_status_history for all
  using (
    tenant_id = app_current_tenant()
    and (
      app_current_role() = 'admin'
      or lead_id in (select id from leads where coalesce(manual_partner_id, partner_id) = app_current_partner())
    )
  )
  with check (tenant_id = app_current_tenant());
--> statement-breakpoint
drop policy if exists listing_checks_scope on listing_checks;
create policy listing_checks_scope on listing_checks for all
  using (
    tenant_id = app_current_tenant()
    and (
      app_current_role() = 'admin'
      or lead_id in (select id from leads where coalesce(manual_partner_id, partner_id) = app_current_partner())
    )
  )
  with check (tenant_id = app_current_tenant());
```

- [ ] **Step 3: Apply to the dev DB**

```bash
export DATABASE_URL=$(grep -E '^DATABASE_URL=' .env.local | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//')
pnpm db:migrate
```
Expected: migration 0010 applies cleanly.

- [ ] **Step 4: Verify the policies were replaced**

```bash
node -e "const p=require('postgres')(process.env.DATABASE_URL,{prepare:false,max:1});p\`select policyname, qual from pg_policies where tablename='leads' and policyname='leads_scope'\`.then(r=>{console.log(r[0].qual);return p.end()})"
```
Expected: the `qual` text contains `COALESCE(manual_partner_id, partner_id)`.

- [ ] **Step 5: Re-run isolation (the RLS-enabled count test still holds) and commit**

```bash
pnpm vitest run tests/integration/isolation.test.ts
git add src/db/migrations/0010_effective_owner_rls.sql src/db/migrations/meta/
git commit -m "feat(ws-0): migration 0010 — effective-owner RLS backstop (F-01)"
```

---

### Task 4: `editLead` recomputes dedupeKey + addressNormalized (F-01 data facet)

**Files:**
- Modify: `src/modules/leads/commands.ts`
- Modify: `tests/integration/isolation.test.ts` (PRN-05 overlay + recompute assertions)

**Interfaces:**
- Consumes: `computeDedupeKey`, `normalizeAddress` from `@/modules/pipeline/normalize`.
- Produces: after an address/zip edit, `leads.dedupe_key` and `leads.address_normalized` reflect the new values; `partnerId`/`matchMethod` remain untouched (PRN-05).

- [ ] **Step 1: Write the failing test (recompute + PRN-05 overlay)**

Add to `isolation.test.ts` (uses the existing seeded `leadX`, partner X pipeline-owned):
```ts
it("F-01: editLead recomputes dedupeKey/addressNormalized and never rewrites partnerId/matchMethod (PRN-05)", async () => {
  const { editLead } = await import("@/modules/leads/commands");
  await editLead(adminA(), { ref: "LD-2026-00001", fields: { address: "42 New Rd", zip: "75201" }, partner: { action: "set", partnerId: id.partnerY } });
  const [row] = await db
    .select({ dedupeKey: schema.leads.dedupeKey, addrNorm: schema.leads.addressNormalized, partnerId: schema.leads.partnerId, matchMethod: schema.leads.matchMethod, manualPartnerId: schema.leads.manualPartnerId })
    .from(schema.leads).where(eq(schema.leads.id, id.leadX));
  expect(row.dedupeKey).toBe("42 new rd|75201");
  expect(row.addrNorm).toBe("42 new rd");
  expect(row.partnerId).toBe(id.partnerX);      // snapshot untouched
  expect(row.matchMethod).toBe("zip");          // snapshot untouched
  expect(row.manualPartnerId).toBe(id.partnerY); // overlay moved
});
```
Add `import { eq } from "drizzle-orm"` if not already imported (it is — `inArray, sql`; add `eq`).

- [ ] **Step 2: Run — verify it FAILS (dedupeKey unchanged)**

```bash
pnpm vitest run tests/integration/isolation.test.ts -t "recomputes"
```
Expected: FAIL — `dedupeKey` is still the seeded `x|00001`.

- [ ] **Step 3: Implement the recompute in `editLead`**

In `src/modules/leads/commands.ts`, add the import:
```ts
import { computeDedupeKey, normalizeAddress } from "@/modules/pipeline/normalize";
```
After the `EDITABLE_COLUMNS` loop builds `patch` (before the partner block), insert:
```ts
// Address/zip drive the dedupe key + normalized address (DM-01). Recompute both when
// either changes so future dedupe / PRN-05 "revert to original" stay consistent
// (audit F-01 data facet). The snapshot columns (partnerId/matchMethod) are untouched.
if ("address" in patch || "zip" in patch) {
  const nextAddress = "address" in patch ? patch.address : lead.address;
  const nextZip = "zip" in patch ? patch.zip : lead.zip;
  patch.addressNormalized = normalizeAddress(nextAddress);
  patch.dedupeKey = computeDedupeKey(nextAddress, nextZip);
}
```

- [ ] **Step 4: Run — verify PASS**

```bash
pnpm vitest run tests/integration/isolation.test.ts
```
Expected: PASS. (Note: recompute can collide with the `leads_tenant_dedupe_idx` unique index if the new address matches another lead — acceptable; the transaction rolls back and the route surfaces an error. Boring + correct.)

- [ ] **Step 5: Commit**

```bash
git add src/modules/leads/commands.ts tests/integration/isolation.test.ts
git commit -m "fix(ws-0): editLead recomputes dedupeKey/addressNormalized on address edit (F-01)"
```

---

### Task 5: Idempotent status update (F-12)

**Files:**
- Modify: `src/modules/portal/status-update.ts`
- Modify: `tests/integration/portal-scope.test.ts`

**Interfaces:**
- Produces: `updateLeadStatus` is a no-op (no history row, no event, no notification) when the requested status equals the lead's current status.

- [ ] **Step 1: Write the failing test**

Read `tests/integration/portal-scope.test.ts` to reuse its seed. Add:
```ts
it("F-12: setting the same status again inserts no new history row or event", async () => {
  // set once, capture counts, set the SAME status again → counts unchanged
  await updateLeadStatus(<scope>, <ownedRef>, "Contacted");
  const h1 = await db.select({ id: schema.leadStatusHistory.id }).from(schema.leadStatusHistory).where(eq(schema.leadStatusHistory.leadId, <leadId>));
  const e1 = await db.select({ id: schema.events.id }).from(schema.events).where(eq(schema.events.tenantId, <tenantId>));
  await updateLeadStatus(<scope>, <ownedRef>, "Contacted");
  const h2 = await db.select({ id: schema.leadStatusHistory.id }).from(schema.leadStatusHistory).where(eq(schema.leadStatusHistory.leadId, <leadId>));
  const e2 = await db.select({ id: schema.events.id }).from(schema.events).where(eq(schema.events.tenantId, <tenantId>));
  expect(h2.length).toBe(h1.length);
  expect(e2.length).toBe(e1.length);
});
```
Fill `<scope>/<ownedRef>/<leadId>/<tenantId>` from the file's existing fixtures.

- [ ] **Step 2: Run — verify FAIL (a second row/event is inserted)**

```bash
pnpm vitest run tests/integration/portal-scope.test.ts -t "F-12"
```
Expected: FAIL — `h2.length === h1.length + 1`.

- [ ] **Step 3: Implement idempotency**

In `src/modules/portal/status-update.ts`, inside the transaction after the removed-lead guard, load the current status and early-return when unchanged. Import `desc` and use the latest history row:
```ts
import { and, desc, eq } from "drizzle-orm";
import { currentStatus, isValidStatus } from "./statuses";
```
```ts
// F-12: idempotent — if the lead is already at this status, do nothing (no dup
// history row, no dup event, no dup admin notification). PRN-05: nothing rewritten.
const latest = await tx
  .select({ status: schema.leadStatusHistory.status, createdAt: schema.leadStatusHistory.createdAt })
  .from(schema.leadStatusHistory)
  .where(eq(schema.leadStatusHistory.leadId, lead.id))
  .orderBy(desc(schema.leadStatusHistory.createdAt))
  .limit(1);
const current = latest.length ? latest[0].status : "New";
if (current === status) return { refId, status };
```
(Place this before the two `tx.insert` calls.)

- [ ] **Step 4: Run — verify PASS**

```bash
pnpm vitest run tests/integration/portal-scope.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/portal/status-update.ts tests/integration/portal-scope.test.ts
git commit -m "fix(ws-0): idempotent lead status update — skip no-op writes/notify (F-12)"
```

---

### Task 6: `RefSchema` on the new leads routes (F-13)

**Files:**
- Modify: `src/app/api/leads/[ref]/route.ts` (GET + PATCH)
- Modify: `src/app/api/leads/[ref]/assign/route.ts` (POST)

**Interfaces:**
- Produces: all three handlers reject a malformed ref with `400 invalid_ref` before touching the DB, matching the sibling `status/route.ts`.

- [ ] **Step 1: Add the guard to `[ref]/route.ts`**

At the top add the v1 schema and validate `ref` in both handlers right after `const { ref } = await params;`:
```ts
const RefSchema = z.string().regex(/^LD-\d{4}-\d{3,}$/);
```
GET and PATCH:
```ts
const { ref } = await params;
if (!RefSchema.safeParse(ref).success) return jsonError("invalid_ref", "Invalid lead reference.", 400);
```
(In GET the `params` await currently sits after the query; move it up so the guard runs first.)

- [ ] **Step 2: Add the guard to `assign/route.ts`**

Same `RefSchema` const; after `const { ref } = await params;`:
```ts
if (!RefSchema.safeParse(ref).success) return jsonError("invalid_ref", "Invalid lead reference.", 400);
```

- [ ] **Step 3: Typecheck + lint**

```bash
pnpm run typecheck && pnpm run lint
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/leads/[ref]/route.ts" "src/app/api/leads/[ref]/assign/route.ts"
git commit -m "fix(ws-0): validate lead ref format on GET/PATCH/assign routes (F-13)"
```

---

### Task 7: `sanitizeCell` on the 3 export paths (F-26)

**Files:**
- Modify: `src/modules/export/render.ts`
- Test: `tests/unit/export-render.test.ts` (create or extend if present)

**Interfaces:**
- Produces: partner-name cells in the group header, legend, and summary sheets are formula-sanitized (`'`-prefixed when starting with `= + - @ tab CR`).

- [ ] **Step 1: Write the failing unit test**

Check for an existing export test (`ls tests/unit | grep -i export`). Create `tests/unit/export-render.test.ts` (or extend), rendering with a malicious partner name and reloading via ExcelJS:
```ts
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { renderExport, type ExportLead, type PartnerInfo } from "@/modules/export/render";

const partners = new Map<string, PartnerInfo>([["p1", { id: "p1", name: "=cmd()|Acme", refId: "JV-001", color: "#f4c95d" }]]);
const lead: ExportLead = { leadRefId: "LD-2026-00001", campaign: "", dateCreated: "", notes: "", address: "", city: "", state: "", zip: "", sellerFirst: "", sellerLast: "", phone: "", email: "", reasonForSelling: "", motivation: "", timeToSell: "", partnerId: "p1", previouslyMatched: false, possibleMlsListing: "unknown" };
const summary = { total: 1, kept: 1, removed: 0, unmatched: 0, previouslyMatched: 0, perPartner: [{ partnerId: "p1", count: 1 }] };

async function cells(colorCoding: boolean) {
  const bytes = await renderExport([lead], partners, summary as never, { colorCoding });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes));
  return wb;
}

describe("F-26: partner-name export cells are formula-sanitized", () => {
  it("F-26: legend + summary partner names are neutralized", async () => {
    const wb = await cells(true);
    const legend = wb.getWorksheet("JV_Color_Legend")!;
    expect(String(legend.getRow(2).getCell(1).value)).toBe("'=cmd()|Acme");
    const sum = wb.getWorksheet("Run_Summary")!;
    const partnerRow = sum.getRow(sum.rowCount).getCell(1).value;
    expect(String(partnerRow)).toContain("'=cmd()|Acme");
  });
  it("F-26: color-OFF group header partner name is neutralized", async () => {
    const wb = await cells(false);
    const ws = wb.getWorksheet("Leads")!;
    // the group-header row (bold) holds the partner label
    const found = [...Array(ws.rowCount)].some((_, i) => String(ws.getRow(i + 1).getCell(1).value).startsWith("'=cmd()"));
    expect(found).toBe(true);
  });
});
```

- [ ] **Step 2: Run — verify FAIL**

```bash
pnpm vitest run tests/unit/export-render.test.ts
```
Expected: FAIL — names appear unsanitized.

- [ ] **Step 3: Sanitize the three paths in `render.ts`**

- Group header (color-OFF, ~line 165): `const hdr = ws.addRow([sanitizeCell(label)]);`
- Legend row (~line 194): `const row = legend.addRow([sanitizeCell(p.name), p.refId, p.color]);`
- Summary per-partner (~line 210): `sum.addRow([sanitizeCell(p ? \`${p.name} (${p.refId})\` : pp.partnerId), pp.count]);`

- [ ] **Step 4: Run — verify PASS + no regression**

```bash
pnpm vitest run tests/unit/export-render.test.ts
pnpm test:unit
```
Expected: PASS (the existing export/golden tests still green; no "Delivered" text touched).

- [ ] **Step 5: Commit**

```bash
git add src/modules/export/render.ts tests/unit/export-render.test.ts
git commit -m "fix(ws-0): sanitize partner-name cells in export header/legend/summary (F-26)"
```

---

### Task 8: Pin MLS load order + golden reason fields (F-03/TR-3)

**Files:**
- Modify: `src/modules/run/rules.ts:28`
- Modify: `tests/unit/golden.test.ts`
- Modify: `tests/fixtures/investorfuse-week-golden.json` (additive re-pin)

**Interfaces:**
- Produces: `loadRunRules` returns MLS patterns ordered by `patternKey` (deterministic first-match); the golden semantic diff now includes `patternKey` + `span`.

- [ ] **Step 1: Pin the MLS pattern load order**

`src/modules/run/rules.ts` line 28 — add `.orderBy` to the patterns select:
```ts
db.select().from(schema.mlsPatterns).where(and(tenantWhere(schema.mlsPatterns, scope), eq(schema.mlsPatterns.enabled, true))).orderBy(schema.mlsPatterns.patternKey),
```

- [ ] **Step 2: Extend the golden projection**

`tests/unit/golden.test.ts` — add the reason fields to `actual`:
```ts
const actual = leads
  .map((l) => ({ key: l.dedupeKey, campaign: l.campaignCode, mls: l.mlsStatus, match: l.matchMethod, partner: l.partnerId, prev: l.previouslyMatched, patternKey: l.mlsPatternKey, span: l.mlsMatchSpan }))
  .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
```

- [ ] **Step 3: Run — verify FAIL (golden lacks the new fields)**

```bash
pnpm vitest run tests/unit/golden.test.ts
```
Expected: FAIL — `actual` has `patternKey`/`span`, `golden.outcomes` does not.

- [ ] **Step 4: Regenerate the golden (additive re-pin)**

Inspect `scripts/gen-golden.ts` (referenced in the test header). Run it to regenerate the fixture, OR write the new `actual` to the fixture's `outcomes` while leaving `rulesHash` unchanged (the rule set is identical, so only the captured fields expand):
```bash
pnpm exec tsx scripts/gen-golden.ts   # if it exists and writes the fixture
```
If no script writes it, regenerate by dumping `actual` from a one-off tsx and replacing `outcomes` in `tests/fixtures/investorfuse-week-golden.json` (keep `rulesHash`). Confirm the existing non-additive values (`key/campaign/mls/match/partner/prev`) are **byte-identical** to before — this re-pin only ADDS `patternKey`/`span`.

- [ ] **Step 5: Run — verify PASS and commit**

```bash
pnpm vitest run tests/unit/golden.test.ts
git add src/modules/run/rules.ts tests/unit/golden.test.ts tests/fixtures/investorfuse-week-golden.json
git commit -m "fix(ws-0): pin MLS load order; add mlsPatternKey/span to golden diff (F-03)

Additive golden re-pin (existing decision values unchanged). The semantic
re-pin for recode removal + ref-ID v2 happens once in WS-1."
```

---

### Task 9: Audit-trail completeness (F-05 partial / TR-5)

**Files:**
- Modify: partner invite path — `src/app/api/admin/partners/[id]/invite/route.ts` and/or `src/modules/**/provision.ts`
- Modify: admin session revoke — `src/app/api/admin/partners/[id]/sessions/[familyId]/revoke/route.ts` and/or `src/modules/**/trusted-device.ts`
- Modify: `scripts/seed-demo-dataset.mjs` (stop deleting `audit_log`)

**Interfaces:**
- Produces: an `audit_log` row on partner invite (`action:"partner.invited"`) and admin session revoke (`action:"partner.session_revoked"`); the demo seeder no longer deletes `audit_log`.

- [ ] **Step 1: Read the three sites**

Read the invite route + `provision.ts`, the revoke route + `trusted-device.ts`, and `scripts/seed-demo-dataset.mjs` around line 43 to locate the tenant/actor/entity values and the existing `auditLog` insert shape (mirror `commands.ts:82`).

- [ ] **Step 2: Add the invite audit insert**

In the invite path, after the invite succeeds (inside the same tx/scope where partner + tenant + actor are known):
```ts
await <tx-or-db>.insert(schema.auditLog).values({
  tenantId: scope.tenantId,
  actorUserId: scope.userId,
  action: "partner.invited",
  entityType: "partner",
  entityRef: <partner.refId>,
  before: null,
  after: { email: <invitedEmail>, partnerId: <partner.id> },
  traceId: globalThis.crypto.randomUUID(),
});
```

- [ ] **Step 3: Add the revoke audit insert**

In the admin revoke path, after the session/device family is revoked:
```ts
await <tx-or-db>.insert(schema.auditLog).values({
  tenantId: scope.tenantId,
  actorUserId: scope.userId,
  action: "partner.session_revoked",
  entityType: "partner",
  entityRef: <partner.refId ?? familyId>,
  before: null,
  after: { familyId: <familyId> },
  traceId: globalThis.crypto.randomUUID(),
});
```

- [ ] **Step 4: Stop the seeder deleting `audit_log`**

In `scripts/seed-demo-dataset.mjs`, remove the `audit_log` delete at ~line 43 (leave the other resets). Add a comment: `// audit_log is append-only evidence — the seeder never deletes it (F-05).`

- [ ] **Step 5: Verify + commit**

```bash
pnpm run typecheck
export DATABASE_URL=$(grep -E '^DATABASE_URL=' .env.local | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//')
pnpm vitest run tests/integration/partners.test.ts   # invite path coverage, if present
git add "src/app/api/admin/partners" src/modules scripts/seed-demo-dataset.mjs
git commit -m "feat(ws-0): audit-log partner invite + admin session revoke; seeder keeps audit_log (F-05)"
```

---

### Task 10: `/dev/emails` production guard (F-48)

**Files:**
- Modify: `src/app/dev/emails/page.tsx`

- [ ] **Step 1: Guard the page**

At the top of the server component:
```ts
import { notFound } from "next/navigation";
import { isProduction } from "@/lib/env";
// ...
if (isProduction) notFound();
```
(Match the existing `isProduction` import path used elsewhere, e.g. `@/lib/env`.)

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm run typecheck
git add src/app/dev/emails/page.tsx
git commit -m "fix(ws-0): 404 the /dev/emails page in production (F-48)"
```

---

### Task 11: Scope-builder sweeps (F-31/F-32/F-33)

**Files:**
- Modify: `src/modules/sources/profile-store.ts:105`
- Modify: `src/modules/activity/queries.ts` (`listPartnerActivity`)
- Modify: `src/modules/notify/outbox.ts:269` (`drainOutbox` signature)
- Modify: `tests/integration/activity.test.ts` (under-report guard, if seam exists)

**Interfaces:**
- Produces: `findProfileById` filters tenant in the WHERE; `listPartnerActivity` scopes by effective owner (counts manually-assigned leads); `drainOutbox` requires `tenantId`.

- [ ] **Step 1: `findProfileById` — tenant predicate into WHERE**

`src/modules/sources/profile-store.ts` — replace the fetch-then-filter with:
```ts
const [row] = await db.select().from(schema.sourceProfiles)
  .where(and(eq(schema.sourceProfiles.id, id), tenantWhere(schema.sourceProfiles, scope)));
return row ? rowToProfile(row) : null;
```
Add `and` / `tenantWhere` imports if missing.

- [ ] **Step 2: `listPartnerActivity` — effective-owner scoping**

Read `src/modules/activity/queries.ts` around the `listPartnerActivity` join (hand-rolled `eq(leads.partnerId, partnerId)`). Replace the ownership predicate with `partnerOwnsLead(partnerId)` (import from `@/lib/scope`) so activity on manually-assigned leads (where `partnerId IS NULL`) is included. Keep the existing `changedByUserId/authorUserId = scope.userId` bound.

- [ ] **Step 3: `drainOutbox` — require `tenantId`**

`src/modules/notify/outbox.ts:269` — change the options type from `tenantId?: string` to `tenantId: string`:
```ts
export async function drainOutbox(
  db: DB,
  opts: { tenantId: string; transport?: EmailTransport; now?: Date; limit?: number },
): Promise<DrainResult> {
```
All three live callers already pass `tenantId` (verified: `run-upload.ts:90`, `outbox/drain/route.ts:17`, `portal/.../status/route.ts:32`, and `outbox.test.ts`). The `opts.tenantId ? ... : undefined` line in the `where` can stay (always truthy now) or simplify to `eq(schema.emailOutbox.tenantId, opts.tenantId)`.

- [ ] **Step 4: Verify + commit**

```bash
pnpm run typecheck
export DATABASE_URL=$(grep -E '^DATABASE_URL=' .env.local | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//')
pnpm vitest run tests/integration/activity.test.ts
git add src/modules/sources/profile-store.ts src/modules/activity/queries.ts src/modules/notify/outbox.ts tests/integration/activity.test.ts
git commit -m "fix(ws-0): scope sweeps — findProfileById WHERE, listPartnerActivity effective-owner, drainOutbox requires tenantId (F-31/32/33)"
```

---

### Task 12: Client cleanups (F-79/F-68/F-23)

**Files:**
- Modify: `src/app/settings/notifications/page.tsx:38` (invalidate)
- Modify: `src/app/reset/page.tsx:70` (missing-token link)
- Modify: `src/app/partners/page.tsx:312` (reactivate)

**Interfaces:**
- Produces: notif-prefs save invalidates its query; `/reset` missing-token offers a link; deactivated partners get a "Reactivate" action.

- [ ] **Step 1: Notif-prefs invalidate**

In the save mutation's `onSuccess`, call `queryClient.invalidateQueries({ queryKey: <the prefs query key> })` (read the file for the exact key + whether `useQueryClient` is already in scope).

- [ ] **Step 2: `/reset` missing-token link**

Replace the plain "request a new one" text with a link/`<Button asChild>` to the reset-request route (read the file to match its routing + component conventions).

- [ ] **Step 3: Reactivate action**

`partners/page.tsx` — set `canInvite = status !== "active"` and label the button "Reactivate" when the partner is deactivated (keep "Invite" for never-onboarded). Read the surrounding JSX to place it correctly.

- [ ] **Step 4: Verify + commit**

```bash
pnpm run typecheck && pnpm run lint
git add src/app/settings/notifications/page.tsx src/app/reset/page.tsx src/app/partners/page.tsx
git commit -m "fix(ws-0): notif-prefs invalidate; /reset new-token link; partner reactivate (F-79/68/23)"
```

---

### Task 13: Dependency bump (F-46)

**Files:**
- Modify: `pnpm-lock.yaml` (+ `package.json` only if `overrides` needed)

- [ ] **Step 1: Update the two transitive vulns**

```bash
pnpm update postcss exceljs
pnpm audit --prod
```
If `uuid` (via exceljs) is still flagged, add a `pnpm.overrides` entry pinning `uuid` `>=11.1.1` in `package.json`, then `pnpm install`.

- [ ] **Step 2: Sanity build check + commit**

```bash
pnpm run typecheck && pnpm test:unit
git add package.json pnpm-lock.yaml
git commit -m "chore(ws-0): bump postcss/exceljs (uuid override) for 2 moderate vulns (F-46)"
```

---

### Task 14: WS-0 verification + self-audit

- [ ] **Step 1: Full suites green against the dev DB**

```bash
export DATABASE_URL=$(grep -E '^DATABASE_URL=' .env.local | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//')
pnpm test:unit && pnpm test:integration && pnpm run typecheck && pnpm run lint
```
Expected: all green, including the isolation divergence + PRN-05 + idempotency + F-26 cases.

- [ ] **Step 2: pr-reviewer on the WS-0 diff**

Dispatch the `pr-reviewer` agent against `git diff 74277f5..HEAD`; fix any findings; re-run suites.

- [ ] **Step 3: PLAYBOOK §6 self-audit**

Fill the checklist from `docs/PLAYBOOK.md` §6 and include it in the WS-0 summary.

## Self-Review notes (author)
- **Spec coverage:** every WS-0 table row maps to a task — F-01 (T2/T3/T4), F-12 (T5), F-13 (T6), F-26 (T7), F-03 (T8), F-02/F-50 (T1), F-05 (T9), F-48 (T10), F-46 (T13), F-31/32/33 (T11), F-79/68/23 (T12). Acceptance = T14.
- **Ordering:** T1 greens the suite first so T2+ verify against a live DB; the effective-owner app fix (T2) precedes the RLS migration (T3) so the failing→passing TDD cycle is observable at the app layer (RLS is bypassed by the service role).
- **Risk:** T8 golden re-pin must be additive-only (assert existing values unchanged). T4 dedupe recompute can hit the unique index — accepted, documented. T3 uses the coalesce form, not the roadmap's OR shorthand (design-doc reconciliation).
