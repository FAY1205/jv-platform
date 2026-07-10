# WS-5 Partners Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Companion to `docs/superpowers/specs/2026-07-10-ws5-partners-design.md` (full detail). Steps use `- [ ]`.

**Goal:** Make the partner roster a pure management table (drop the F-10 health scan) and give the profile a per-partner, SQL-scoped performance section (stat cards + Recharts history + Avg Contact tooltip), opening leads in the dialog.

## Global Constraints
- PRN-08 scope; PRN-12 tokens; PRN-13 (admin notes admin-only; partner-note first-touch filters `author_role='partner'`); PRN-14; PRN-15 (analytics single home). No raw select/input/Modal/NativeSelect on either page. Requirement-ID tests; small commits; no new deps. Gate: `pnpm test:unit` + `pnpm test:integration --no-file-parallelism`, `typecheck`, `lint` (ignore `.claude/worktrees/*` lint noise).

---

## Task 1: Roster backend — drop the health scan (F-10)
**Files:** modify `src/modules/partners/queries.ts`; delete `src/modules/partners/health.ts`, `tests/unit/partner-health.test.ts`.

- [ ] Remove from `PartnerRow`: `leadCount`, `untouched`, `oldestUntouchedDays`, `avgFirstTouchHours`.
- [ ] Delete the `healthByPartner` function and the `import { computePartnerHealth, type PartnerHealth } from "./health";` line. Also drop `currentStatus, DEFAULT_STATUS` import if now unused (grep after).
- [ ] In `listPartners`: delete the effective-partner `counts` query + `countBy`, and the `const health = await healthByPartner(scope);`. Drop the four removed fields from the returned object.
- [ ] Rewrite `getPartner` to fetch the single partner directly (no `listPartners`):
```ts
export async function getPartner(scope: ScopeContext, partnerId: string): Promise<(PartnerRow & { territory: Territory }) | null> {
  const db = getDb();
  const [p] = await db.select().from(schema.partners)
    .where(and(tenantWhere(schema.partners, scope), eq(schema.partners.id, partnerId), isNull(schema.partners.deletedAt))).limit(1);
  if (!p) return null;
  const [zipCount, stateCount, territory] = await Promise.all([
    db.select({ n: count() }).from(schema.coverageZips).where(and(tenantWhere(schema.coverageZips, scope), eq(schema.coverageZips.partnerId, partnerId), isNull(schema.coverageZips.effectiveTo))),
    db.select({ n: count() }).from(schema.stateRules).where(and(tenantWhere(schema.stateRules, scope), eq(schema.stateRules.partnerId, partnerId))),
    territoryOf(scope, partnerId),
  ]);
  return {
    id: p.id, refId: p.refId, name: p.name, email: p.email, phone: p.phone, color: p.color,
    dealTerms: p.dealTerms, adminNotes: p.adminNotes, status: p.status,
    invitedAt: iso(p.invitedAt), activatedAt: iso(p.activatedAt), lastPortalLoginAt: iso(p.lastPortalLoginAt),
    zipCount: Number(zipCount[0]?.n ?? 0), stateCount: Number(stateCount[0]?.n ?? 0), territory,
  };
}
```
- [ ] `pnpm run typecheck` — will fail in the two partner pages (they read the removed fields); fixed in Tasks 3/4. Commit Tasks 1–4 order can keep tree broken between; **commit Task 1 together with Task 3** (roster UI) so the tree compiles. Do Task 2 (independent, compiles) before if preferred.

## Task 2: `partner-performance.ts` (pure + async) + route + tests
**Files:** create `src/modules/analytics/partner-performance.ts`, `src/app/api/admin/partners/[id]/performance/route.ts`, `tests/unit/partner-performance.test.ts`, `tests/integration/partner-performance.test.ts`.

- [ ] **Pure module + unit test first.** `buildPartnerPerformance(range, now, facts)` per the design. Unit test (`tests/unit/partner-performance.test.ts`):
```ts
import { describe, it, expect } from "vitest";
import { buildPartnerPerformance, type PartnerLeadFact } from "@/modules/analytics/partner-performance";

const NOW = new Date("2026-07-10T12:00:00Z");
const f = (receivedAt: string, firstTouchAt: string | null, closedAt: string | null): PartnerLeadFact => ({ receivedAt, firstTouchAt, closedAt });

describe("buildPartnerPerformance (ANA-02/03)", () => {
  it("ANA-02: given/contacted/closed are range-bounded by their own event date", () => {
    const r = buildPartnerPerformance("30d", NOW, [
      f("2026-07-05T00:00:00Z", "2026-07-05T02:00:00Z", "2026-07-08T00:00:00Z"), // all in 30d
      f("2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", null),                    // received out of 30d
    ]);
    expect(r.stats.given).toBe(1);
    expect(r.stats.contacted).toBe(1);
    expect(r.stats.closed).toBe(1);
  });
  it("ANA-03: Avg Contact averages contacted leads only; null when none", () => {
    const r = buildPartnerPerformance("30d", NOW, [f("2026-07-05T00:00:00Z", "2026-07-05T02:00:00Z", null)]);
    expect(r.stats.avgContactHours).toBeGreaterThan(1.5);
    expect(r.stats.avgContactHours).toBeLessThan(2.5);
    const none = buildPartnerPerformance("30d", NOW, [f("2026-07-05T00:00:00Z", null, null)]);
    expect(none.stats.avgContactHours).toBeNull();
    expect(none.stats.given).toBe(1);
  });
  it("ANA-01: history zero-fills daily buckets for 30d and totals given", () => {
    const r = buildPartnerPerformance("30d", NOW, [f("2026-07-05T00:00:00Z", null, null), f("2026-07-06T00:00:00Z", null, null)]);
    expect(r.range.bucket).toBe("day");
    expect(r.history.length).toBeGreaterThanOrEqual(28);
    expect(r.history.reduce((s, b) => s + b.given, 0)).toBe(2);
  });
});
```
- [ ] Implement `buildPartnerPerformance` (pure): use `rangeWindow(range, now)`; count given/contacted/closed by each fact's own date in `[start,end)`; `avgContactHours` = mean hours(firstTouch−received) over contacted, rounded to 1 dp; `history` = for each bucket from `date_trunc(bucket, seriesStart)` to end (daily/monthly), count events whose truncated date matches. Reuse a `bucketKey(iso, bucket)` helper. Seed the series across the full fixed window (mirror WS-2 dashboard trend: fixed ranges span the whole window; `all` uses the data span). `now` injected (PRN-01 style).
- [ ] **Async fetch** in the same file: `partnerPerformanceDetail(scope, partnerId, range)` — SQL-scoped per-lead facts (effective owner = partnerId, kept, not deleted) with `firstTouchAt = least(min(status<>'New'), min partner-note)` and `closedAt = max(status='Closed')` via `db.execute(sql\`…\`)` (embed `tenantWhere(schema.leads,scope)`/`(schema.leadStatusHistory,scope)`/`(schema.leadNotes,scope)`, no alias; filter `coalesce(manual_partner_id,partner_id) = ${partnerId}`), then `buildPartnerPerformance(range, new Date(), facts)`. Return the `PartnerPerformance` object.
- [ ] **Route** `src/app/api/admin/partners/[id]/performance/route.ts`: admin-gated, `IdSchema.uuid()` on the param, `RangeSchema` (from `@/modules/analytics/ranges` `RANGE_KEYS`, `.catch("12mo")`), returns `partnerPerformanceDetail`.
- [ ] **Integration test** (`tests/integration/partner-performance.test.ts`, coverage.test.ts harness): seed a partner + leads (one contacted via status, one via partner note only, one re-routed to this partner via manualPartnerId, one owned by another partner); assert `partnerPerformanceDetail` counts only this partner's effective-owned kept leads and the note-only lead is contacted. Requirement-ID names.
- [ ] Run unit + integration + typecheck; commit Task 2 (compiles independently).

## Task 3: Roster UI (`/partners/page.tsx`)
- [ ] Trim the client `Partner` interface (remove `leadCount`/`untouched`/`oldestUntouchedDays`/`avgFirstTouchHours`).
- [ ] Table header: drop `<Th align="right">Leads</Th>` and `<Th>Untouched</Th>`; drop their two `<Td>` cells in the row. Keep Partner/Contact/Status/Coverage/Actions.
- [ ] `Modal` → `Dialog` (both `PartnerForm` and `DeactivateModal`); update the `@/components` import (drop `Modal`, add `Dialog`; drop `NativeSelect`, add `Select`).
- [ ] `DeactivateModal` reassign target: `NativeSelect` → `Select` (`value={toPartnerId}`, `onValueChange={setToPartnerId}`, `options={others.map(p => ({value:p.id, label:`${p.name} (${p.refId})`}))}`). The mode radios stay.
- [ ] `pnpm run typecheck && pnpm run lint`. Commit Tasks 1+3 together.

## Task 4: Profile UI (`/partners/[id]/page.tsx`)
- [ ] Trim the client `Partner` interface (remove the four health fields).
- [ ] Replace the current Stats grid (`Leads distributed`/`Untouched`/`Avg first touch`/`Coverage`) with a **Performance section**: a range `Select` (options from a local `RANGES` = 7d/30d/12mo/All, default `12mo`) driving `useQuery(["partner", id, "perf", range], () => apiGet(`/api/admin/partners/${id}/performance?range=${range}`))`; stat cards Given · Contacted · Closed · Avg Contact (Avg Contact = `formatContactTime(perf.stats.avgContactHours)` wrapped in a `Tooltip` with `AVG_CONTACT_DEFINITION` from `@/modules/analytics/ranges`); a `LineChart` of `perf.history` (series Given/Contacted/Closed, x = bucketStart formatted, colors `var(--text-2)`/`var(--brand)`/`var(--success)`). Keep a "Coverage: N states · M ZIPs" line from `partner.stateCount`/`zipCount`.
- [ ] Keep the Territory `CoverageMap` section + Admin notes (PRN-13) unchanged.
- [ ] Recent leads: ref-id `<Link href={`/leads/${refId}`}>` → `<RowOpenButton onClick={() => setOpenRef(l.refId)}>` (F-55); add `openRef` state + code-split `const LeadDialog = dynamic(() => import("../../leads/lead-dialog").then(m => m.LeadDialog), { ssr:false })`; render `{openRef && <LeadDialog refId={openRef} onClose={() => setOpenRef(null)} />}`. Match badge: use `matchMethodLabel` for zip/state_fallback/none; keep "manual" local. Import `RowOpenButton`, `Select`, `LineChart`, `Tooltip` from `@/components`.
- [ ] `pnpm run typecheck && pnpm run lint`; verify `/partners` compiles via the dev server (build-level, as prior WSs). Commit Task 4.

## Self-Review
- F-10 → Task 1 ✓ · per-partner SQL-scoped perf + Recharts + Avg Contact tooltip → Tasks 2+4 ✓ · roster pure table → Tasks 1+3 ✓ · Modal→Dialog/Select → Tasks 3+4 ✓ · F-55 profile → Task 4 ✓ · PRN-15 (analytics home) → Task 2 ✓.
- Types: `PartnerPerformance`/`PartnerLeadFact` consistent Task 2↔4; trimmed `PartnerRow` consistent Task 1↔3↔4.

## Execution Handoff
Inline. Order: Task 2 (independent, compiles) → Task 1 → Task 3 (commit 1+3) → Task 4.
