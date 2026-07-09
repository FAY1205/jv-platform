# WS-1 — Foundation — execution design

**Program:** REDESIGN-R3 · **Branch:** phase-2/distribution · **Baseline:** WS-0 head
**Authority:** `docs/backlog/REDESIGN-R3.md` §4 WS-1 + D1–D4. Refines the locked WS-1
list into a concrete plan. No locked decision reopened.

Everything the page reworks (WS-2+) consume. Additive where possible; the two
behavior-changing pieces (recode removal, ref-ID v2) are migrations with a single
deliberate golden re-pin.

## Locked inputs / bounds
- **D1 Radix**, **D2 Recharts** → ADR-0016/0017 authorize the new deps. Registry
  reachable (verified: `@radix-ui/react-dialog` 1.1.19, `recharts` 3.9.2).
- **D3** remove campaign recodes ENTIRELY (pipeline step, table, rules UI/routes,
  tests). `leads.campaign` (as-imported) stays. → ADR-0018 + migration 0011.
- **D4** ref-ID v2 TRUE migration: `UP-2026-### → IM-26-###`, `LD-2026-##### →
  LD-26-#####`; `JV-###` unchanged. → ADR-0019 + migration 0012.
- **No** `Delivered → Distributed` here (WS-2). Contrast/type only in tokens.
- **Modal** is NOT deleted in WS-1 — `Dialog` is added alongside; call sites migrate
  per page; `Modal` deleted at end of WS-8.

## A. ADRs (write first — they authorize deps + migrations)
- **ADR-0016** Radix UI primitives (headless; styled with existing Tailwind tokens).
  Deps: `@radix-ui/react-{select,dropdown-menu,dialog,checkbox,tooltip,popover}`
  (+ `react-day-picker` for the calendar, or a Radix Popover + a small month grid —
  decide in plan: **use `react-day-picker`** for the date calendar, wrapped in a
  Radix Popover trigger; it is the boring, well-tested choice and avoids hand-rolling
  a calendar). Rationale: solves the audit focus-trap/keyboard findings structurally.
- **ADR-0017** Recharts for all charts (line, donut). Dep: `recharts`.
- **ADR-0018** Remove campaign recodes. Records the rules-hash change + one-time
  golden re-pin rationale; `leads.campaign` becomes the sole campaign value.
- **ADR-0019** Ref-ID v2 true migration (now-or-never, no prod data). Records the
  2-digit-year + `IM-` scheme and the columns migrated.

## B. Design tokens v2 (contrast pass) + test
`src/lib/tokens/tokens.ts` + `src/app/globals.css` (kept in sync). Targets (audit
F-17/F-18):
- `text3` (light `#97a1b0` ≈2.6:1) → darken to **≥4.5:1** on both `surface` (#fff)
  and `bg` (#f8fafc). Candidate `#5c6773`-ish; exact value chosen so the test passes.
- Badge `warn`/`success`/`danger` text on their `*Soft` fills → **≥4.5:1** in light.
  Darken the `warn`/`danger`/`success` (brand) text tokens as used by `Badge`.
  Re-vet through the EXP-06 palette lens (the `PARTNER_SWATCHES` pool already targets
  AA when used as a fill).
- Type-ramp readability review (owner: "some fonts hard to read") — bump the smallest
  UI sizes/line-heights if they read poorly; no token-name changes.
- **`tokens.test.ts`**: add a pure WCAG contrast helper (relative luminance → ratio)
  and assert every required pair (`text`/`text2`/`text3` on `bg`/`surface`, each Badge
  status pair) ≥ its floor (4.5:1 body, 3:1 large) in BOTH themes. This is the
  regression gate so a future token edit cannot silently drop below AA.
- Dark theme re-vet too (F-18 says `text3` fails in both). Keep the CSS var block and
  the TS object byte-aligned (the existing test already checks sync — extend it).

## C. Migration 0011 — remove campaign recodes (ADR-0018)
Footprint (grepped): `pipeline/recode.ts` (delete), `run/plan.ts` (drop the recode
step + `campaignCode` field → downstream uses raw `campaign`), `run/rules.ts` (drop
recode load), `run/snapshot.ts` (drop `recodes` from snapshot/hash),
`run/export-data.ts` (Campaign column reads `campaign`), `run/queries.ts`,
`portal/queries.ts`, `rules/{commands,queries,schema}.ts`, `activity/categorize.ts`
(drop recode activity actions), `app/rules/page.tsx` (remove recodes section),
`app/api/admin/rules/recodes/**` (delete routes), `db/schema.ts` (drop
`campaignRecodes` table), `db/seed.ts` (drop recode seed). Migration `0011_drop_campaign_recodes.sql`
drops the table (+ its RLS policy from 0001). **Golden re-pin (semantic, the once):**
`campaignCode` disappears; golden `campaign` becomes the raw as-imported value; the
snapshot loses `recodes` → `rulesHash` changes. Regenerate `gen-golden.ts` (remove
RECODES) + the golden fixture; update every recode-referencing test. Commit records
this is THE program's single semantic re-pin.

> PRN-04 note: the audit TR-3 ordering fix (WS-0) already pinned MLS order; with
> recodes gone, rule ordering concerns are MLS-only, as the spec states.

## D. Migration 0012 — ref-ID v2 (ADR-0019)
- `src/db/ref-ids.ts`: `formatLeadRef(year,n)` → `LD-${twoDigit(year)}-${pad5}`;
  rename `formatUploadRef` → `formatImportRef` → `IM-${twoDigit(year)}-${pad3}`;
  `JV-###` unchanged. `RefEntity` "upload" keeps its DB entity key (the counter table
  is unaffected) — only the FORMAT changes.
- All `RefSchema` regexes → lead `/^LD-\d{2}-\d{5,}$/`, import `/^IM-\d{2}-\d{3,}$/`.
  Sites: `api/leads/[ref]/*`, `api/portal/leads/[ref]/*`, `api/runs/[ref]/*`, plus
  any client-side ref parsing. (WS-0 added v1 lead regexes — bump them here.)
- Migration `0012_ref_id_v2.sql`: `regexp_replace` stored refs on `uploads.ref_id`
  (`^UP-20(\d\d)-` → `IM-\1-`), `leads.ref_id` (`^LD-20(\d\d)-` → `LD-\1-`),
  `audit_log.entity_ref` (both patterns), `notifications.deep_link` (the `/imports/UP-…`
  and any `/leads/LD-…` deep links). Applied to the dev DB.
- Demo-derived text (email_outbox bodies embed refs): refreshed by re-running the demo
  seeder after the migration (the seeder now emits v2 refs via the updated formatters).
- Fixtures/tests: `investorfuse-week-golden.json` keys are dedupe keys (not refs) — no
  change; integration tests that hardcode `UP-2026-###`/`LD-2026-#####` literals →
  update to v2. `ref-ids` unit test → v2 expectations.

## E. Migration 0013 — leads indexes (F-09)
`0013_leads_indexes.sql`: `create index` on `leads(tenant_id, created_at)`,
`(tenant_id, state)`, `(tenant_id, campaign)`. Mirror in `schema.ts` `(t) => [...]`
so drizzle stays in sync. Additive; applied to dev DB.

## F. Radix primitives (each in `/gallery`, all states)
Styled with existing tokens (PRN-12). Match current component conventions (variant
props, `focus-visible:ring-2`).
- **`Select`** — Radix `react-select`. **Correction (code reality):** the existing
  `Select` is a native `<select>` extending `SelectHTMLAttributes` (event-based
  `onChange`); a Radix listbox cannot preserve that event contract. So the Radix
  Select is a NEW **controlled-API** component (`value: string; onValueChange:
  (v:string)=>void; options: SelectOption[]; label/error/hint`). The current native
  select is retained as `NativeSelect` (its handful of call sites re-import that name)
  and removed at end of WS-8 alongside `Modal`, as pages migrate to the Radix one.
- **`DatePicker`** / **`DateRangePicker`** — Radix Popover trigger + `react-day-picker`
  calendar; emit ISO `yyyy-mm-dd` (range: `{from,to}`); tokened styling.
- **`DropdownMenu`** — Radix `react-dropdown-menu` (for the profile menu, row actions).
- **`Checkbox`** — Radix `react-checkbox` (replaces the 5 ad-hoc checkboxes over WS-6/7).
- **`Dialog`** — Radix `react-dialog`: focus trap + return-focus built in (F-15).
  New component; `Modal` stays until WS-8.
- **`Tooltip`** — make the existing one actually usable app-wide (Radix `react-tooltip`
  Provider at the shell; keyboard/focus accessible). (F-64 depends on this.)
- **`Pagination`** — page controls + rows-per-page `Select`, whitelist {10,20,50},
  default 20. Pure controlled component (`page`, `pageSize`, `total`, `onPageChange`,
  `onPageSizeChange`).
- **Field focus ring (F-16)**: restore `focus-visible:ring-2` on `Input`/`Textarea`/
  `Select` (the WS-0-adjacent a11y fix — remove the `focus-visible:outline-none`
  suppression, add a token ring).
- **Leads-row keyboard pattern (F-14)**: a reusable pattern/prop so the ref-id cell
  renders as a real `<button aria-haspopup="dialog">` — provide it as part of the
  Table/row toolkit for WS-3 to consume (the primitive/pattern lands here; the Leads
  page adopts it in WS-3).

## G. Recharts wrappers (PRN-14: every series labeled by name, never color alone)
- **`ChartContainer`** — sizing/responsive wrapper, app-token theming, tooltip/legend
  styling shared by both charts.
- **`LineChart`** — multi-series line (used by WS-2 trend: Leads in / Distributed /
  Unmatched); tokened axes, styled tooltip, legend with series names, enter transition.
- **`DonutChart`** — center total, labeled legend with counts+percentages (WS-2 source
  donut). Every series/segment carries its NAME in legend + tooltip (PRN-14).

## H. Plumbing
- **`apiMutate`** in `src/lib/api.ts` (F-82): one helper attaching the CSRF header and
  returning the uniform `{code,message,traceId}` envelope (throws a typed error on
  non-ok). Call sites migrate per-page (WS-2+), not wholesale here.
- **`error.tsx` / `global-error.tsx` / `not-found.tsx`** (F-67): app-root, styled with
  tokens, showing a trace id; reset action. Server-render safe.

## Acceptance (WS-1 gate)
- `/gallery` shows every new primitive in default/hover/focus-visible/active/disabled/
  loading states.
- `tokens.test.ts` contrast assertions green (both themes).
- Golden re-pinned exactly ONCE (recodes removed + — refs are dedupe-key-based so the
  golden fixture itself only changes for the recode removal); `pnpm test:unit` +
  `pnpm test:integration` green against the dev DB after 0011/0012/0013 applied.
- `pnpm run typecheck` + `pnpm run lint` green. No `Delivered` text changed.

## Out of scope (WP candidates)
Per-page call-site migration to Dialog/apiMutate/new Select (that happens in each page
WS-2+). `Modal` deletion (end of WS-8). EXP-06 roster-growth distance warning (F-60,
Phase 5). First-login tours. Theme toggle persistence UI (WS-7 Appearance).

## Sequencing (risk-first)
ADRs → deps install → tokens+test → 0011 recode removal (+semantic golden re-pin) →
0012 ref-ID v2 (+data migration, reseed demo) → 0013 indexes → apiMutate + error pages
→ Radix primitives → Recharts wrappers → gallery. Migrations land + green before the
additive primitives, so the suite churn is front-loaded.
