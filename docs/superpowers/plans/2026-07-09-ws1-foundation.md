# WS-1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Land the design-system + data foundation every page rework (WS-2+) consumes: 4 ADRs, a token contrast pass with a WCAG test gate, migrations 0011 (recode removal) / 0012 (ref-ID v2) / 0013 (leads indexes), Radix primitives, Recharts wrappers, `apiMutate`, and error/not-found pages — all green against the dev DB.

**Architecture:** Risk-first: ADRs+deps, then the token gate, then the three migrations (front-load the suite churn incl. the single semantic golden re-pin), then additive primitives/wrappers/plumbing. Radix primitives are headless + tokened; Recharts wrappers enforce PRN-14 (series named, never color alone).

**Tech Stack:** Next 16 App Router, Drizzle+Postgres (Supabase dev), Vitest, Tailwind v4 tokens, Radix UI, react-day-picker, Recharts, ExcelJS.

## Global Constraints
- **No `Delivered → Distributed`** (WS-2). **PRN-12** tokens only — no hex/font/product literals in components. **PRN-14** every chart series named in legend+tooltip. **PRN-01** pipeline purity. **DM-08** rules snapshot changes → new golden (the ONE semantic re-pin).
- **Modal + native Select are retained** (removed at WS-8); Dialog + Radix Select are added alongside.
- New deps authorized ONLY by ADR-0016/0017 (D1/D2). No other deps.
- Requirement-ID test names. Run relevant suite before each commit. Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Env for integration/migrate: `export DATABASE_URL=$(grep -E '^DATABASE_URL=' .env.local | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//')`. Integration runs `--no-file-parallelism` (already wired).

---

### Task 1: ADRs 0016–0019 + install deps

**Files:** Create `docs/adr/0016-radix-ui.md`, `0017-recharts.md`, `0018-remove-campaign-recodes.md`, `0019-ref-id-v2.md`; Modify `package.json`/`pnpm-lock.yaml`.

- [ ] **Step 1: Read an existing ADR for the house format**: `ls docs/adr && sed -n '1,40p' docs/adr/0015-*.md` (or the latest). Match its front-matter/section shape.
- [ ] **Step 2: Write the four ADRs** — each: Context (the D-decision + audit findings it closes), Decision, Consequences, Alternatives. 0016 lists the Radix packages + react-day-picker and states "solves focus-trap/keyboard findings structurally"; 0017 Recharts; 0018 recode removal (rules-hash change + one golden re-pin; `leads.campaign` becomes sole campaign value); 0019 ref-ID v2 columns + scheme.
- [ ] **Step 3: Install deps**
```bash
pnpm add @radix-ui/react-select @radix-ui/react-dropdown-menu @radix-ui/react-dialog @radix-ui/react-checkbox @radix-ui/react-tooltip @radix-ui/react-popover react-day-picker recharts
```
Expected: resolves + installs (registry reachable). If offline, STOP and report.
- [ ] **Step 4: Sanity** `pnpm run typecheck` (still green — nothing imports them yet). Commit.
```bash
git add docs/adr package.json pnpm-lock.yaml && git commit -m "docs(ws-1): ADR-0016..0019; add Radix + react-day-picker + Recharts (D1/D2)"
```

---

### Task 2: Token contrast pass + `tokens.test.ts` WCAG gate

**Files:** Modify `src/lib/tokens/tokens.ts`, `src/app/globals.css`, `tests/unit/tokens.test.ts`.

**Interfaces:** Produces darker `text3` + Badge status text tokens meeting AA; a pure `contrastRatio(hex,hex)` test helper gating future edits.

- [ ] **Step 1: Add the failing contrast assertions first (TDD).** In `tests/unit/tokens.test.ts` add a pure WCAG helper + assertions:
```ts
function luminance(hex: string): number {
  const c = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
import { lightColors, darkColors } from "@/lib/tokens/tokens";
describe("F-17/F-18: token contrast meets WCAG AA", () => {
  for (const [name, t] of [["light", lightColors], ["dark", darkColors]] as const) {
    it(`F-18: ${name} text3 >= 4.5:1 on surface and bg`, () => {
      expect(ratio(t.text3, t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t.text3, t.bg)).toBeGreaterThanOrEqual(4.5);
    });
    it(`F-17: ${name} badge warn/danger/success text >= 4.5:1 on their soft fill`, () => {
      expect(ratio(t.warn, t.warnSoft)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t.danger, t.dangerSoft)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t.success, t.successSoft)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${name} text/text2 >= 4.5:1 on surface`, () => {
      expect(ratio(t.text, t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t.text2, t.surface)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
```
- [ ] **Step 2: Run — see which pairs fail** `pnpm vitest run tests/unit/tokens.test.ts`. Expected: `text3` (both themes) + badge warn/danger/success fail.
- [ ] **Step 3: Darken the failing tokens in `tokens.ts`** to pass. Pick values by iterating against the helper (aim ≥4.6 for margin). Likely: light `text3 #97a1b0 → ~#5f6a78`; `warn #bf7d2a → ~#9a6410` (on `warnSoft`); `danger #cb4d43 → ~#b23a30`; `success/brand #3f9d7d → ~#2f7d62` (only where Badge uses it as text on `successSoft`). Dark: `text3 #6b7688 → ~#8b95a5`. **Check the Badge actually pairs these tokens** (`src/components/Badge.tsx`) — if Badge uses a different text token per variant, darken the one it uses.
- [ ] **Step 4: Mirror every changed hex into `globals.css`** CSS vars (the existing sync test enforces this). Run `pnpm vitest run tests/unit/tokens.test.ts` → all green.
- [ ] **Step 5: Type-ramp readability** — if any `text-xs`/line-height reads poorly, bump minimally (no token renames). Re-run full `pnpm test:unit`. Commit.
```bash
git commit -am "feat(ws-1): token contrast pass to AA + WCAG contrast test gate (F-17/F-18)"
```

---

### Task 3: Migration 0011 — remove campaign recodes (ADR-0018) + semantic golden re-pin

**Files:** Delete `src/modules/pipeline/recode.ts`, `src/app/api/admin/rules/recodes/**`; Modify `src/modules/run/{plan,rules,snapshot,export-data,queries}.ts`, `src/modules/portal/queries.ts`, `src/modules/rules/{commands,queries,schema}.ts`, `src/modules/activity/categorize.ts`, `src/app/rules/page.tsx`, `src/db/schema.ts`, `src/db/seed.ts`, `scripts/gen-golden.ts`, `tests/unit/golden.test.ts`, `tests/fixtures/investorfuse-week-golden.json`; Create `src/db/migrations/0011_drop_campaign_recodes.sql`.

- [ ] **Step 1: Map exact usages** `grep -rn "campaignCode\|campaignRecodes\|CampaignRecode\|recode\|Recode" src scripts tests` — enumerate every reference before deleting, so nothing dangles.
- [ ] **Step 2: Pipeline** — remove the recode step. In `plan.ts` drop `recode` import + `campaignCode` field from `PlannedLead` and its population (downstream reads raw `campaign`). In `run/rules.ts` drop the recode SELECT + `recodes` from `RunRulesBundle`. In `run/snapshot.ts` drop `recodes` from `RulesSnapshotInput`/`Shape`/hash. In `plan.ts` `RunRules`, drop `recodes`.
- [ ] **Step 3: Consumers** — `export-data.ts` Campaign column reads `campaign`; `run/queries.ts`, `portal/queries.ts` drop `campaignCode`; `activity/categorize.ts` drop any `recode.*` action mapping; `rules/{commands,queries,schema}.ts` remove recode CRUD; `app/rules/page.tsx` remove the recodes section; delete the recodes API routes.
- [ ] **Step 4: Schema + migration** — remove `campaignRecodes` from `schema.ts` (table + any relations). Create `0011_drop_campaign_recodes.sql`:
```sql
drop policy if exists campaign_recodes_scope on campaign_recodes;--> statement-breakpoint
drop table if exists campaign_recodes;
```
Register via `pnpm exec drizzle-kit generate --custom --name=drop_campaign_recodes` then paste the SQL (or let generate produce the drop from the schema diff — prefer the custom file for the policy drop). Remove recode seeds from `seed.ts`.
- [ ] **Step 5: Golden re-pin (the ONE semantic re-pin).** In `gen-golden.ts` delete the `RECODES` const + its use; `outcomes.campaign` now reads `l.campaign`. In `golden.test.ts` remove `RECODES` and change the `actual` projection `campaign: l.campaign`; the snapshot call drops `recodes`. Regenerate: `pnpm exec tsx scripts/gen-golden.ts`. The `rulesHash` WILL change and `campaign` values WILL change — expected. 
- [ ] **Step 6: typecheck + unit** `pnpm run typecheck && pnpm test:unit`. Fix any recode-referencing test. Apply migration to dev DB (`pnpm db:migrate` with DATABASE_URL). Run `pnpm test:integration` (rules/run tests updated). 
- [ ] **Step 7: Commit**
```bash
git commit -am "feat(ws-1): remove campaign recodes entirely; semantic golden re-pin (ADR-0018, 0011)"
```

---

### Task 4: Migration 0012 — ref-ID v2 (ADR-0019)

**Files:** Modify `src/db/ref-ids.ts`, all `RefSchema` sites (`api/leads/[ref]/*`, `api/portal/leads/[ref]/*`, `api/runs/[ref]/*`, any client ref regex), `tests/unit/ref-ids*.test.ts`, integration tests hardcoding v1 refs; Create `src/db/migrations/0012_ref_id_v2.sql`.

- [ ] **Step 1: Formatters (TDD).** Update `tests/unit/ref-ids.test.ts` (read it first) to expect `LD-26-00042`, `IM-26-011`, `JV-007`. Run → fail.
- [ ] **Step 2: `ref-ids.ts`** — `const yy = (y:number)=>String(y%100).padStart(2,"0")`. `formatLeadRef` → `` `LD-${yy(year)}-${String(n).padStart(5,"0")}` ``. Rename `formatUploadRef`→`formatImportRef` → `` `IM-${yy(year)}-${String(n).padStart(3,"0")}` `` and update `allocateRef`'s `case "upload"` to call it. `formatPartnerRef` unchanged. Update importers of `formatUploadRef`. Run unit → green.
- [ ] **Step 3: RefSchema regexes** — bump every lead ref to `/^LD-\d{2}-\d{5,}$/`; every upload/import ref to `/^IM-\d{2}-\d{3,}$/`. Grep `grep -rn "LD-\\\\d\|UP-\\\\d\|IM-\\\\d" src` to catch all; update client-side parsing too.
- [ ] **Step 4: Data migration** `0012_ref_id_v2.sql` (custom):
```sql
update uploads       set ref_id      = regexp_replace(ref_id,      '^UP-20(\d\d)-', 'IM-\1-') where ref_id like 'UP-20%';--> statement-breakpoint
update leads         set ref_id      = regexp_replace(ref_id,      '^LD-20(\d\d)-', 'LD-\1-') where ref_id like 'LD-20%';--> statement-breakpoint
update audit_log     set entity_ref  = regexp_replace(entity_ref,  '^UP-20(\d\d)-', 'IM-\1-') where entity_ref like 'UP-20%';--> statement-breakpoint
update audit_log     set entity_ref  = regexp_replace(entity_ref,  '^LD-20(\d\d)-', 'LD-\1-') where entity_ref like 'LD-20%';--> statement-breakpoint
update notifications set deep_link    = regexp_replace(deep_link,   '/imports/UP-20(\d\d)-', '/imports/IM-\1-') where deep_link like '/imports/UP-20%';--> statement-breakpoint
update notifications set deep_link    = regexp_replace(deep_link,   '/leads/LD-20(\d\d)-',   '/leads/LD-\1-')   where deep_link like '/leads/LD-20%';
```
Register via `drizzle-kit generate --custom --name=ref_id_v2`, paste SQL, `pnpm db:migrate`.
- [ ] **Step 5: Reseed demo + fixtures** — re-run the demo seeder so outbox bodies embed v2 refs (`node scripts/seed-demo-dataset.mjs` with env, if that is its run form — check the script header). Update integration tests hardcoding `UP-2026-###`/`LD-2026-#####` literals → v2 (`notifications.test.ts`, `isolation.test.ts`, `portal-scope.test.ts`, `auth-otp.test.ts` uploads, etc.).
- [ ] **Step 6: Verify** `pnpm run typecheck && pnpm test:unit && pnpm test:integration`. Commit.
```bash
git commit -am "feat(ws-1): ref-ID v2 (LD-26-#####, IM-26-###) + data migration (ADR-0019, 0012)"
```

---

### Task 5: Migration 0013 — leads indexes (F-09)

**Files:** Modify `src/db/schema.ts` (leads index list); Create `src/db/migrations/0013_leads_indexes.sql`.

- [ ] **Step 1: Add indexes to schema** in the leads `(t) => [...]`: `index("leads_tenant_created_idx").on(t.tenantId, t.createdAt)`, `index("leads_tenant_state_idx").on(t.tenantId, t.state)`, `index("leads_tenant_campaign_idx").on(t.tenantId, t.campaign)`.
- [ ] **Step 2: Generate + apply** `pnpm exec drizzle-kit generate --name=leads_indexes` (schema diff produces the CREATE INDEXes) → inspect the SQL → `pnpm db:migrate`.
- [ ] **Step 3: Verify + commit** `pnpm test:integration` (isolation still green). `git commit -am "feat(ws-1): leads (tenant,created)/(tenant,state)/(tenant,campaign) indexes (F-09, 0013)"`.

---

### Task 6: `apiMutate` + error/not-found pages

**Files:** Modify `src/lib/api.ts`; Create `src/app/error.tsx`, `src/app/global-error.tsx`, `src/app/not-found.tsx`.

- [ ] **Step 1: `apiMutate`** in `src/lib/api.ts` (read the existing `apiGet`/`csrfHeaders` to match style):
```ts
export async function apiMutate<T>(path: string, method: "POST"|"PUT"|"PATCH"|"DELETE", body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok) { const e = new Error(json?.message ?? "Request failed") as Error & { code?: string; traceId?: string }; e.code = json?.code; e.traceId = json?.traceId; throw e; }
  return json as T;
}
```
- [ ] **Step 2: error/not-found pages** — token-styled Cards, a trace id line, and a reset/home action. `error.tsx` is a client component (`"use client"`, `{ error, reset }` props, shows `error.digest` as the trace id). `global-error.tsx` wraps `<html><body>`. `not-found.tsx` static.
- [ ] **Step 3: typecheck + commit** `git commit -am "feat(ws-1): apiMutate helper + error/global-error/not-found pages (F-82, F-67)"`.

---

### Task 7: Field focus ring (F-16) + Dialog + app-wide Tooltip

**Files:** Modify `src/components/Input.tsx`, `Textarea.tsx`, `Select.tsx` (native, being kept); Create `src/components/Dialog.tsx`; Modify `src/components/Tooltip.tsx` + `src/components/AppShell.tsx` (Tooltip.Provider) + `src/components/index.ts`.

- [ ] **Step 1: Restore focus ring (F-16)** — in the three field primitives replace `focus:outline-none`/`focus-visible:outline-none` with a token ring: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:border-brand`. (These are kept components — the native Select stays until WS-8.)
- [ ] **Step 2: `Dialog`** (Radix `react-dialog`) — `Dialog`, `DialogContent` (overlay scrim from `--scrim`, focus trap + return-focus built in, Esc close), `DialogTitle`, `DialogDescription`, `DialogClose`. Tokened, `elevation.lg`, radius `md`. Props mirror the app's modal usage (open/onOpenChange/title/children/footer). Export from index.
- [ ] **Step 3: Tooltip app-wide** — wrap the app in `Tooltip.Provider` (Radix `react-tooltip`) at `AppShell`; make `Tooltip` a thin styled wrapper (trigger + content, tokened, keyboard/focus reachable). Export.
- [ ] **Step 4: typecheck + commit** `git commit -am "feat(ws-1): field focus rings (F-16); Radix Dialog (F-15); app-wide Tooltip"`.

---

### Task 8: Radix Select (controlled API) + NativeSelect retention

**Files:** Create `src/components/Select.tsx` (Radix) after renaming the native one to `src/components/NativeSelect.tsx`; Modify current `Select` importers; `index.ts`.

- [ ] **Step 1:** `git mv src/components/Select.tsx src/components/NativeSelect.tsx`; rename its export `Select`→`NativeSelect` (+ `SelectProps`→`NativeSelectProps`). Update its importers (`grep -rn "\bSelect\b" src/app src/components` — likely `leads-view`, `unmatched`, notification settings) to import `NativeSelect` for now. Keep `SelectOption` shared (move to the new file or a tiny types file).
- [ ] **Step 2:** New `src/components/Select.tsx` — Radix `react-select`: controlled `value: string; onValueChange:(v:string)=>void; options: SelectOption[]; placeholder?; label?; error?; hint?; disabled?`. Tokened trigger (focus-visible ring), portal content, item indicators, all states.
- [ ] **Step 3:** Export both from `index.ts`. `pnpm run typecheck` green. Commit `feat(ws-1): Radix Select (controlled); keep NativeSelect until WS-8`.

---

### Task 9: DatePicker + DateRangePicker

**Files:** Create `src/components/DatePicker.tsx`, `src/components/DateRangePicker.tsx`; import `react-day-picker/style.css` (or token overrides) — verify no PRN-12 hex leaks (style the calendar via token classes). `index.ts`.

- [ ] **Step 1: `DatePicker`** — Radix Popover trigger (tokened button showing the value) + `react-day-picker` single mode; `value: string|null` (ISO `yyyy-mm-dd`), `onChange:(v:string|null)=>void`. Convert Date↔ISO purely.
- [ ] **Step 2: `DateRangePicker`** — same, `mode="range"`; `value: {from:string|null;to:string|null}`, `onChange`. Preset chips optional (Last 7/30/12mo/All) — WS-2 supplies presets; the primitive just does the calendar + range.
- [ ] **Step 3:** Style day-picker with token classes (`--brand` selected, `--surface` bg); ensure keyboard nav works (day-picker is accessible by default). Export. typecheck + commit.

---

### Task 10: DropdownMenu + Checkbox

**Files:** Create `src/components/DropdownMenu.tsx`, `src/components/Checkbox.tsx`; `index.ts`.

- [ ] **Step 1: `DropdownMenu`** — Radix `react-dropdown-menu`: `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuSeparator`, `DropdownMenuLabel`. Tokened, elevation, focus states. (Profile menu + row actions consume it in WS-5/WS-7.)
- [ ] **Step 2: `Checkbox`** — Radix `react-checkbox`: `checked`, `onCheckedChange`, `label?`, `disabled?`; tokened box + check indicator, focus-visible ring. (Replaces the 5 ad-hoc checkboxes in WS-6/WS-7.)
- [ ] **Step 3:** Export; typecheck; commit `feat(ws-1): Radix DropdownMenu + Checkbox primitives`.

---

### Task 11: Pagination + leads-row keyboard button pattern

**Files:** Create `src/components/Pagination.tsx`; Modify `src/components/Table.tsx` (add `Th` `scope` if trivial + a row-button helper) OR create a small `RowButton`; `index.ts`.

- [ ] **Step 1: `Pagination`** — controlled: `page`, `pageSize`, `total`, `onPageChange`, `onPageSizeChange`; rows-per-page `Select` whitelist `{10,20,50}` default 20; prev/next + page count; disabled states at bounds; all built from tokens.
- [ ] **Step 2: Row keyboard pattern (F-14)** — provide the pattern the Leads table will use: a ref-id cell rendered as a real `<button aria-haspopup="dialog">` with focus-visible ring. Ship it as a documented example in the gallery + (optionally) a `RowActionButton` helper. WS-3 consumes it.
- [ ] **Step 3:** Export; typecheck; commit `feat(ws-1): Pagination (10/20/50) + keyboard row-open pattern (F-14)`.

---

### Task 12: Recharts wrappers — ChartContainer + LineChart + DonutChart

**Files:** Create `src/components/ChartContainer.tsx`, `src/components/LineChart.tsx`, `src/components/DonutChart.tsx`; `index.ts`.

- [ ] **Step 1: `ChartContainer`** — `ResponsiveContainer` wrapper + shared token theming (axis/grid/tooltip colors from CSS vars via a small `useTokens`/computed-style read or passing token class names), height prop.
- [ ] **Step 2: `LineChart`** — props `data`, `series: {key,name,color}[]`, `xKey`; renders Recharts `LineChart` with a legend showing each series NAME, a styled tooltip listing name+value per series (PRN-14 — never color alone), tokened axes, enter animation.
- [ ] **Step 3: `DonutChart`** — props `data: {name,value,color}[]`, `centerLabel`; Recharts `PieChart` donut, center total, labeled legend with counts + percentages, tooltip with name. PRN-14.
- [ ] **Step 4:** typecheck; commit `feat(ws-1): Recharts ChartContainer/LineChart/DonutChart wrappers (D2, PRN-14)`.

---

### Task 13: Gallery — every new primitive in all states

**Files:** Modify `src/app/gallery/page.tsx`.

- [ ] **Step 1:** Add sections for Select, DatePicker, DateRangePicker, DropdownMenu, Checkbox, Dialog, Tooltip, Pagination, LineChart, DonutChart, and the keyboard row-open button — each showing default/hover/focus-visible/active/disabled/loading (where applicable). Also close F-61 partially (add the shipped WS-1 primitives; the maps stay for their own WS).
- [ ] **Step 2:** Run the dev server via preview tooling; verify each renders + is keyboard operable; screenshot. Commit `feat(ws-1): gallery — all WS-1 primitives in every state (F-61 partial)`.

---

### Task 14: WS-1 verification + self-audit

- [ ] **Step 1: Full gate** `pnpm run typecheck && pnpm run lint && pnpm test:unit && pnpm test:integration` (dev DB, migrations applied). All green.
- [ ] **Step 2: pr-reviewer** on `git diff <WS-1 base>..HEAD`; fix findings; re-run.
- [ ] **Step 3: PLAYBOOK §6 self-audit** filled; include in the WS-1 summary. Then STOP for the owner walkthrough (both WS-0 + WS-1).

## Self-Review notes (author)
- **Coverage:** ADRs (T1), tokens+test (T2, F-17/18), 0011 recode removal + golden (T3), 0012 ref-ID (T4, D4), 0013 indexes (T5, F-09), apiMutate+error pages (T6, F-82/F-67), focus ring/Dialog/Tooltip (T7, F-16/F-15), Radix Select (T8), Date pickers (T9), DropdownMenu/Checkbox (T10, F-62), Pagination + row keyboard (T11, F-14), Recharts (T12, D2), gallery (T13, F-61). Acceptance = T14.
- **Ordering/risk:** migrations (T3–T5) front-load the semantic golden re-pin + fixture churn before additive primitives; deps (T1) precede everything that imports them.
- **Risks:** T3 golden re-pin is semantic — confirm the ONLY value changes are `campaign` (recoded→raw) and `rulesHash`; T4 data migration is one-way on synthetic dev data (acceptable, no prod); Radix Select is a new controlled component (native retained) — call-site migration is per-page WS-2+, not here; react-day-picker CSS must not introduce PRN-12 hex leaks (style via tokens).
