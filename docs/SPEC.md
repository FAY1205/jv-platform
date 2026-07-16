# JV Lead Matching Platform — V1 Implementation Spec (R0)

**Document type:** implementation guide for the development team. Requirements are numbered and directive (MUST/SHOULD/MAY). Short _Why_ notes appear only where a rule is non-obvious. Companion document: `EXECUTION-PLAYBOOK.md` — the two files travel together and live in the repo root.

**Product decisions (owner, final):** internal tool first, productized as multi-tenant SaaS later · partner distribution via portal + email (no Google Sheets push, no CRM integrations) · ZIP match always beats state-rule overrides · the "allow blanks" MLS rule below is the single source of truth for on-market filtering · previously-matched leads are kept and flagged, original partner retained · lead-source file formats differ and are governed by Source Profiles · ~100 leads/week volume · realistic running cost ~$45–50/mo at launch (see §13) · USA market.

---

## 1. Product definition

A deterministic lead-routing platform for real-estate JV (joint-venture) networks. Weekly seller-lead files are uploaded, filtered (on-market exclusion), matched to JV partners by territory (ZIP-first, state fallback), deduplicated against permanent history, and distributed via colored Excel export, partner portal, and email — with partner-performance analytics and, in a later phase, a read-only AI insights assistant over the same data.

**Strategic rule:** the pipeline is the interface; **the lead-history database and territory rules are the product.** Every upload makes the dedupe database and accuracy telemetry more valuable.

**V1 spine (build and demo priority):** upload → parse/map → normalize → MLS filter → assign → dedupe → recode → colored Excel + run summary, with per-lead audit reasons. Everything else hangs off the spine.

## 2. Scope & constraints

| ID | Constraint |
| -- | ---------- |
| SCP-01 | Single-org operation in V1; `tenant_id` on every table; every query tenant-scoped. Productizing MUST NOT require a migration. |
| SCP-02 | Roles: **admin** (owner — full control) and **partner** (portal: own leads, statuses, own notes, export). No partner self-signup; admin invites. **Public self-serve admin signup is open (ADR-0033): a new customer signs up → their own isolated tenant + admin; partner accounts remain invite-only.** |
| SCP-03 | External dependencies: Supabase (US region — Postgres/Auth/Storage), Vercel, Resend, one pluggable listing-check provider, and (AI phase only) one LLM provider behind a gateway. |
| SCP-04 | **Web only, responsive.** No native app in V1. Partners will primarily use phones: every portal surface MUST be fully usable at 375 px width with ≥ 44 px touch targets. The app SHOULD ship a PWA manifest + icons so it can be installed to a home screen (no offline mode). |
| SCP-05 | Files .xlsx/.csv ≤ 10 MB / 10k rows. ~100 leads/week; optimize for correctness and auditability, never throughput. |

**Out of scope for V1 (all phases):** Google Sheets push · CRM/webhook integrations · interactive map *editing* (a read-only map IS in scope, MAP-01) · partner-to-partner lead trading · SMS · native apps · internationalization (US English only; copy centralized so i18n stays possible).

**Deferred to productization+ :** per-partner API/webhooks (SEAM-04 prepares) · white-label portal theming per tenant (SEAM-08 prepares) · closed-deal revenue attribution · multi-admin roles.

## 3. Design principles (binding rules)

| ID | Principle |
| -- | --------- |
| PRN-01 | **Determinism.** Same input file + same rules snapshot ⇒ semantically identical output (same rows, values, assignments, and fills; file-container metadata like ZIP timestamps may differ). No LLM anywhere in the pipeline. The AI assistant reads results; it never produces them. |
| PRN-02 | **Every number explainable.** Each lead carries machine-readable decision reasons; every dashboard figure and AI answer traces to queryable data; tooltips explain calculations (UXQ-05). |
| PRN-03 | **Nothing silently dropped.** Removed and unmatched leads are stored with reasons and surfaced; only outputs exclude them. |
| PRN-04 | **Anchored patterns, never substrings** for MLS negatives (`no`/`n`/`false` match only in listing-question context). Guarded by TST-02 forever. |
| PRN-05 | **History is immutable.** Assignments are snapshots; coverage changes affect future runs only; previously-matched leads retain original partner + first-matched date. |
| PRN-06 | **Partner colors assigned once and locked.** Changes are explicit, audited admin actions. |
| PRN-07 | **Rules are data.** Coverage, fallbacks, MLS patterns, recodes, Source Profiles, statuses, export columns: tables with seeds, admin-editable. |
| PRN-08 | **Server-side scoping.** Tenant/partner scoping enforced in API code AND Postgres RLS. The client is never trusted. |
| PRN-09 | **Heuristics labeled.** The listing check reads "Possible MLS listing (heuristic)" everywhere; flags never remove leads. |
| PRN-10 | **Uploaded content is data, not instructions** — including for the AI assistant (prompt-injection defense on any content it reads). |
| PRN-11 | **Config over hardcode.** Reasonable-to-change behavior = a setting with a default (§8). Fully usable with zero settings visits. |
| PRN-12 | **Generic, token-driven branding.** All visual identity — colors, logo, product name, typography, icons, radii — lives in the design-token/asset source (DSN-01); components consume semantic tokens only. Rebranding or per-tenant theming is a token/asset swap, never a refactor. No hardcoded hex or product name in component code. |
| PRN-13 | **Note visibility boundary.** Admin notes invisible to partners; partner notes invisible to the admin. Enforced by RLS + API; tested (TST-08). |
| PRN-14 | **Color-independence.** No information conveyed by color alone: partner name + reference ID always accompany color; colored fills keep AA text contrast; color-coding can be disabled (EXP-06). |
| PRN-15 | **Single source of truth.** Postgres is the only source of truth. Client state is a cache of server state (query library), never a second store; derived values (stats, counts, statuses) are computed server-side in exactly one module and never duplicated or dual-written. If two surfaces show the same number, they call the same function. |

## 4. System architecture

**Pattern:** one Next.js (App Router, TypeScript) deployable on Vercel — admin app, partner portal, and API in a single codebase. Supabase for Postgres/Auth/Storage. Background work via Vercel Cron → idempotent job routes.

| Component | Responsibility |
| --------- | -------------- |
| Admin app (`/admin`) | Dashboard, upload, leads, partners, coverage & rules, analytics, map, activity, settings |
| Partner portal (`/portal`) | Scoped leads, statuses, partner notes, export, own activity |
| API layer | Route handlers; all writes; scoping guard; Zod-validated inputs (§6.16) |
| Pipeline engine | Pure TS module — deterministic steps, no I/O inside step functions. _Why:_ pure functions are unit-testable and cannot entangle with the DB. |
| Export renderer | Server-side exceljs: colored/grouped rows, legend, fixed column contract |
| Analytics module | The single home of computed statistics (PRN-15); UI and AI both call it |
| AI gateway (later phase) | LLM behind provider-agnostic interface; read-only typed query tools; metered |
| Job routes | Listing checks, digests, retention sweeps — idempotent, retried with backoff |
| Postgres / Storage | Source of truth + files; RLS everywhere; signed URLs only |

**Extension seams (build the seam now, use it later):**

| ID | Seam |
| -- | ---- |
| SEAM-01 | Multi-tenancy: `tenant_id` everywhere; RLS keyed on it; settings per tenant. |
| SEAM-02 | `ListingCheckProvider` interface; `LinkOnlyProvider` (pre-filled search links) ships in V1; automated providers swap in one file. _Why:_ scraping listing sites breaches their ToS and breaks under bot defenses; the seam contains that risk. |
| SEAM-03 | Export column contract as tenant data (the fixed V1 columns are the seed). |
| SEAM-04 | `events` table (lead.assigned, upload.processed, status.changed, note.added) — digests and the notification center consume it now; webhooks later. |
| SEAM-05 | Source Profiles per lead source (§6.1) — new sources are rows, not code. |
| SEAM-06 | Status list tenant-editable (seed: New / Contacted / Appointment / Under contract / Closed / Dead). |
| SEAM-07 | AI read-tool layer: analytics/query functions are API-shaped so assistant tools call the same functions the dashboard uses — never bespoke SQL. |
| SEAM-08 | Design-token source (PRN-12): one definition feeds the Tailwind theme, email templates, and export legend styling. |
| SEAM-09 | Feature flags: a simple per-tenant flags table gating unfinished/phased features server-side. |

## 5. Data model

Tables: `tenants, users, partners, coverage_zips, state_rules, mls_patterns, campaign_recodes, source_profiles, uploads, leads, lead_notes, lead_status_history, listing_checks, notifications, events, audit_log, settings, feature_flags, ai_memory, ai_feedback`.

| ID | Rule |
| -- | ---- |
| DM-01 | `leads.dedupe_key` = normalized(address)+zip5, unique index per tenant; phone (last 10 digits) is a secondary confirm key, never primary. |
| DM-02 | `leads.raw_json` stores the full source row forever — reprocessing and disputes are always possible. |
| DM-03 | Lead columns: `partner_id, match_method(zip|state_fallback|none), mls_status(kept|removed), mls_reason, previously_matched, original_partner_id, first_matched_at, possible_mls_listing(yes|no|unknown|pending), upload_id`. |
| DM-04 | `audit_log` append-only: every pipeline decision, admin mutation, partner status/note change — actor, before/after, timestamp, trace ID. |
| DM-05 | Timestamps UTC; tenant timezone (SET-08) applied at render. |
| DM-06 | Coverage versioned (`effective_from/to`); history queryable; versions revertible (CVG-03). |
| DM-07 | **Reference IDs**, human-readable, tenant-scoped, immutable: partners `PR-###` (ADR-0028; was `JV-###`), leads `LD-YY-#####`, imports `IM-YY-###` (ADR-0019). Shown on every surface, export, and email; globally searchable. |
| DM-08 | **Rules snapshot:** every run stores a hash + snapshot reference of the rule set used (MLS patterns, coverage version, recodes, Source Profile version). _Why:_ preserves determinism and pins golden-file tests when rules evolve. |
| DM-09 | Soft-delete with restore for partners and leads; hard delete only via retention policy or account deletion. |
| DM-10 | `lead_notes`: lead_id, author_user_id, author_role (admin|partner), body, timestamps; visibility per PRN-13. |
| DM-11 | Indexes exist for every list/query path shipped: `leads(tenant_id, upload_id)`, `leads(tenant_id, partner_id, created_at)`, unique `leads(tenant_id, dedupe_key)`, `coverage_zips(tenant_id, zip5)` unique-current, `events(tenant_id, created_at)`, `lead_notes(lead_id)`. New list endpoints ship with their index in the same migration. |

## 6. Functional requirements

### 6.1 Ingestion, Source Profiles & mapping (ING)

| ID | Requirement |
| -- | ----------- |
| ING-01 | .xlsx/.csv drag-drop; original stored in Storage before any processing. |
| ING-02 | Source detection by header signature against saved **Source Profiles**. Exact match → profile applies automatically. Unknown format → inline mapping screen (source column → canonical field) with a "Save as source profile" option. Profiles are created from the upload flow — never required to be pre-configured in Settings. |
| ING-03 | Canonical fields: Campaign, Date Created, Notes, Address, City, State, Zip, Seller First/Last, Phone, Email, Reason For Selling, Motivation, Time to Sell. Unmapped extra columns preserved in `raw_json`. |
| ING-04 | Row-level errors (missing Zip AND State) reported per row with reference IDs; the file never hard-fails on bad rows. |
| ING-05 | Every upload surface shows the expected format: per-source template rendered **from the Source Profile**, plus a downloadable generic template (.xlsx, header row + one example row). |
| ING-06 | **Processing lock:** one pipeline run at a time per tenant; concurrent uploads queue with visible position. _Why:_ interleaved runs could corrupt dedupe ordering. |
| ING-07 | **Source Profiles:** declared, versioned format contracts — header signature, mapping, required columns, strictness (*flexible*: extra columns allowed; *strict*: any deviation blocks). Managed in Settings (SET-12). Profile version pinned into the run's rules snapshot (DM-08). |
| ING-08 | **Drift handling — never silently re-guess.** Partial signature match → block and show a format-diff (added/removed/renamed columns), propose an updated mapping, require explicit admin confirmation → new profile version. Missing required columns → hard block naming the columns in plain language. |
| ING-09 | **Void a run.** Admin can void a processed upload (wrong file, wrongly confirmed mapping): soft-void with required reason; voided leads are excluded from dedupe, analytics, and exports while remaining visible in history as voided; the action is audited and portal counts update. New imports are **held from partners for a 10-min window (ADR-0026)**, so an in-window void reaches no partner (no recall notice needed) — only the **latest, still-held** import can be voided, and its seller PII is purged immediately on void (ADR-0025). _Why:_ history immutability (PRN-05) must not make honest mistakes permanent — a bad run would otherwise poison "previously matched" results forever. |

### 6.2 Normalization (NRM)

| ID | Requirement |
| -- | ----------- |
| NRM-01 | ZIP: strip non-digits, first 5, left-pad zeros (`6404` → `06404`) — applied to BOTH lead ZIPs and coverage import. _Why:_ Excel drops leading zeros; CT/NJ ZIPs start with 0. |
| NRM-02 | Phone digits-only last-10; state → 2-letter code (full names accepted); address normalized (case/whitespace/punctuation) for `dedupe_key`, display value preserved. |

### 6.3 MLS filter (MLS) — single source of truth

| ID | Requirement |
| -- | ----------- |
| MLS-01 | DISQUALIFY on anchored positive patterns (case-insensitive): `is it listed? : true` · `is it listed? : yes` · `is it listed : y` · `listed on mls ? yes` · `active on mls` · `currently on market` · `mls status: active` · `on market`. |
| MLS-02 | KEEP-OVERRIDE (beats any positive): anchored negatives — `is it listed …(no|false|n)` · `listed on mls ? no` · `not listed` · `off market` · `never listed` · `no mls`. |
| MLS-03 | Blank / missing / incomplete MLS info ⇒ KEEP (treated off-market). |
| MLS-04 | Patterns live in `mls_patterns` (PRN-07), typed `disqualify|keep_override`, admin-editable with regex validation; edits create a new rules snapshot. |
| MLS-05 | Removed leads store the pattern + matched text span (for highlighted display). |

### 6.4 Assignment (ASN)

| ID | Requirement |
| -- | ----------- |
| ASN-01 | Precedence: (1) exact zip5 in coverage → that partner, stop; (2) state fallback (seed: SC→Randy Wolfe, VA→Forrest McGhee, NJ→Josh Ax, CT→Josh Ax); (3) unmatched. |
| ASN-02 | No special-case partner code. Regional exceptions (e.g., Virginia Beach, Philadelphia metro) emerge from ZIP precedence; adding exception code is forbidden. |
| ASN-03 | Unmatched view with ZIP/state so coverage gaps become visible decisions. |

### 6.5 Dedupe & history (DED)

| ID | Requirement |
| -- | ----------- |
| DED-01 | Match on `dedupe_key`; phone as secondary confirm. On hit: `previously_matched = true`, assignment = original partner, `first_matched_at` carried (PRN-05). |
| DED-02 | Previously-matched leads remain in output, flagged. |
| DED-03 | Every processed lead (kept / removed / unmatched) written to history. |

### 6.6 Recode & export (EXP)

| ID | Requirement |
| -- | ----------- |
| EXP-01 | Campaign recodes from data (seed: `Lead Zolo*` → `Z`, `Real Estate Bees` → `B`). |
| EXP-02 | Fixed export column order — Lead ID, Campaign, Date Created, JV Notes (blank), Notes, Address, City, State, Zip, Seller First Name, Seller Last Name, Seller Phone, Seller Email Address, Reason For Selling, Motivation, Time to Sell, JV Partner Name, Previously Matched, Possible MLS Listing — as the SEAM-03 seed. |
| EXP-03 | Rows grouped by partner; `JV_Color_Legend` sheet (Partner → Ref → hex); `Run_Summary` sheet. |
| EXP-04 | Run summary on screen and in export: totals, per-partner counts, removed, unmatched, previously-matched. |
| EXP-05 | Exports stored in Storage; signed-URL download; re-downloadable from upload history. |
| EXP-06 | **Color-coding toggle (SET-01):** ON = full-row fills in locked colors with AA-contrast text; OFF = no fills, partner separation via bold group-header rows. Palette manager enforces minimum perceptual distance and warns when the roster outgrows distinguishability. Partner name + reference ID always present regardless (PRN-14). |

### 6.7 Listing check (LST)

| ID | Requirement |
| -- | ----------- |
| LST-01 | Runs async post-pipeline; leads show `pending` → `yes/no/unknown`; never blocks export. |
| LST-02 | Behind SEAM-02; `LinkOnlyProvider` is the V1 default and always available. |
| LST-03 | Labeled heuristic everywhere; flags never remove leads (PRN-09). |

### 6.8 Partner portal & onboarding (PTL)

| ID | Requirement |
| -- | ----------- |
| PTL-01 | **Onboarding:** admin creates partner (contact details per ADM-03) → Invite → branded email → partner opens link → **6-digit email OTP** completes login (code entry defeats forwarded-link risk) → first login requires ToS/Privacy acceptance (LGL-01) → optional 30-day trusted device (AUT-10). Same email+code flow every login; partners never have passwords. Admin can re-invite/revoke anytime. |
| PTL-02 | Partner sees ONLY their leads, notes, statuses (PRN-08/13; TST-01/08). |
| PTL-03 | Status updates (SEAM-06); every change → `lead_status_history` + event; visible to admin. |
| PTL-04 | Partner notes per lead (NTS); CSV/Excel export of own leads. |
| PTL-05 | Portal mini-stats: leads received, status funnel, response time (ANA-05). |

### 6.9 Notes (NTS)

| ID | Requirement |
| -- | ----------- |
| NTS-01 | Two streams per lead: admin notes and partner notes; cross-visibility blocked both directions (PRN-13). |
| NTS-02 | Append-with-edit (edits audited); author + timestamp shown; drafts save on blur with a visible saved indicator. |
| NTS-03 | The export's "JV Notes" column is blank by default; a setting MAY map it to admin notes. |

### 6.10 Notifications (NTF)

| ID | Requirement |
| -- | ----------- |
| NTF-01 | **Release** (10 min after upload — the distribution hold, ADR-0026) → per-partner digest (only partners with new leads) with counts + reference IDs + portal link. Partners with zero new leads receive nothing. (The admin run-summary is sent at upload completion.) |
| NTF-02 | Admin run-summary email; optional admin alert on partner status changes (SET-03). |
| NTF-03 | All email via Resend through an outbox table (delivery status, retry with backoff), consuming `events`. |
| NTF-04 | In-app notification center for both roles: unread badge, list with deep links, mark-read. |
| NTF-05 | Per-event preferences (SET-03): each role toggles email vs in-app-only per event type. Transactional auth email always on. |

### 6.11 Analytics, dashboard & coverage map (ANA / MAP)

| ID | Requirement |
| -- | ----------- |
| ANA-01 | Admin dashboard: this-run and trailing-8-week KPIs — uploaded, matched, match rate, removed, unmatched, previously-matched; per-partner distribution. One screen, simple and readable; no drill-mazes. |
| ANA-02 | Per-partner statistics: leads over time, status funnel, time-to-first-action, previously-matched share, coverage size, last portal login. |
| ANA-03 | All statistics computed server-side in the analytics module (PRN-15); every figure has a calculation tooltip (UXQ-05). |
| ANA-04 | Every table and chart offers relevant filters (date range, partner, source, status, upload) and column sorting — server-side for lists (API-02). |
| ANA-05 | Partner portal shows the partner their own mini-stats. _Why:_ visible tracking nudges responsiveness. |
| MAP-01 | Read-only US coverage map: county-level choropleth (ZIPs → counties via static crosswalk; Census TopoJSON), locked partner colors, hover = partner + counts, click → partner page. Respects PRN-14. Map-based territory *editing* is out of scope. |

### 6.12 AI insights assistant (AIA) — later phase

| ID | Requirement |
| -- | ----------- |
| AIA-01 | Admin-only chat answering questions over tenant data: performance, trends, coverage gaps, lead lookups. |
| AIA-02 | **Read-only by construction:** typed query tools wrapping the same analytics functions as the UI (SEAM-07). No writes, no raw SQL, no pipeline involvement. |
| AIA-03 | Grounded answers: every figure cited to the tool result that produced it; "I don't have that" over improvisation. |
| AIA-04 | Learning loop, explicit: thumbs feedback in `ai_feedback`; learned preferences as admin-visible, editable `ai_memory` records — never silent adaptation. |
| AIA-05 | Content the assistant reads (notes, lead fields) is untrusted input (PRN-10); injection cases in TST-10. |
| AIA-06 | Provider-agnostic gateway; per-tenant token metering + budget cap from day one; cost visible in admin. |

### 6.13 Design system (DSN)

| ID | Requirement |
| -- | ----------- |
| DSN-01 | **Tokens (single source, SEAM-08):** semantic colors (background, surface tiers, border tiers, text tiers, brand, status: success/warn/danger/info), spacing on a 4/8 px grid, radii scale, elevation levels 0–3 (subtle shadows, no heavy drops), motion durations (120/200/300 ms) + easing. Components consume semantic tokens only (PRN-12). |
| DSN-02 | **Typography:** three roles — display (headings/KPIs), UI/body, monospace (IDs, ZIPs, counts) — with a defined scale and weights. Tabular numerals for all numeric columns. |
| DSN-03 | **One component library**, built once and reused: Button, Input, Select, Table, Card, Badge, Tabs, Modal, Toast, Tooltip, Empty state, Skeleton. Every interactive component defines ALL states: default, hover, focus-visible, active, disabled, loading. No one-off variants outside the library. |
| DSN-04 | **Visual hierarchy:** one primary action per view, consistently placed (top-right of the page header); secondary actions are quiet; destructive actions are never the visual default. Page structure: header → KPIs/summary → detail. |
| DSN-05 | **Iconography:** one line-icon set (e.g., Lucide) at 16/20 px only; never mixed sets; icons always accompany a label for destructive or ambiguous actions — no icon-only destructive buttons. |
| DSN-06 | **Empty states:** icon + one-line explanation + the primary next action ("No uploads yet — process your first file"). Errors name the problem and the fix; an empty screen is an invitation to act. |
| DSN-07 | **Responsive behavior:** breakpoints at 640/1024 px; admin tables scroll horizontally with sticky headers; portal tables collapse to cards below 640 px; nothing depends on hover to be discoverable on touch. |
| DSN-08 | **Motion:** purposeful only — state transitions, panel reveals, toast entry; durations from tokens; `prefers-reduced-motion` disables all non-essential animation. No decorative/ambient motion. |
| DSN-09 | **Spacing & alignment:** all spacing from the token grid; consistent page gutters and max content width; numbers right-aligned, text left-aligned; form labels top-aligned. |
| DSN-10 | Contrast AA everywhere including colored rows (PRN-14); visible keyboard focus on every interactive element; ≥ 44 px touch targets. |

### 6.14 UX quality bar (UXQ)

| ID | Requirement |
| -- | ----------- |
| UXQ-01 | Designed empty, loading, and error states on every surface (DSN-06); every user-visible failure carries a trace ID ("report this ID"). |
| UXQ-02 | **Progress honesty:** upload/processing shows live step progress with counts; long operations never show a dead spinner; queued says queued (ING-06). |
| UXQ-03 | Skeleton loaders on data screens; optimistic UI with rollback on hot paths (status changes, notes). |
| UXQ-04 | Filters + sorting on all tables and charts (ANA-04). |
| UXQ-05 | Tooltips on every computed value, badge, and non-obvious control explaining how it's calculated or what it means. |
| UXQ-06 | **Product tours:** dismissible first-login tour for admin (upload → results → export) and partner (leads → status → notes → export); relaunchable from help; never blocks power users. |
| UXQ-07 | Undo where reversible (soft-deletes, coverage revert); irreversible actions explicitly confirmed (FRM-03). |
| UXQ-08 | **Simplicity discipline:** the weekly job (upload → download/distribute) takes ≤ 3 clicks after file selection and requires zero settings visits. New features must not lengthen this path. |

### 6.15 Forms (FRM)

| ID | Requirement |
| -- | ----------- |
| FRM-01 | Validate inline on blur, re-validate on change after first error, full summary on submit; error text is specific and placed at the field ("ZIP must be 5 digits", not "invalid input"). |
| FRM-02 | User input is never lost: preserved on validation error, navigation guard on dirty forms ("Unsaved changes"). |
| FRM-03 | Destructive confirmations name the object ("Delete partner JV-003 — Michael Pinter?"); high-impact deletes (partner with leads) require typing the reference ID. |
| FRM-04 | Full keyboard support: logical tab order, Enter submits, Esc cancels/closes, labels programmatically bound to inputs. |
| FRM-05 | Server errors map back to fields where possible; otherwise a form-level error with trace ID. Submit buttons show loading state and are disabled during flight (no double-submit). |

### 6.16 Backend & API standards (API)

| ID | Requirement |
| -- | ----------- |
| API-01 | All writes via route handlers; every input Zod-validated at the boundary; uniform error envelope `{ code, message, traceId }`; no stack traces or SQL to clients. |
| API-02 | List endpoints: server-side cursor pagination (default 50), filtering, and sorting. Clients never fetch "everything" to filter locally. |
| API-03 | Idempotency keys on upload and job routes; retried requests never double-process (pairs with ING-06). |
| API-04 | Multi-table writes in transactions; migrations forward-only, reviewed, applied via CI; schema change + seed + RLS policy ship in the same migration. |
| API-05 | Rate limits per route class (auth strictest, then upload/export, then reads) returning 429 + Retry-After. |
| API-06 | No N+1 queries on list paths; every shipped query path has its index (DM-11); slow-query logging on. |
| API-07 | Background jobs: idempotent, retry with exponential backoff, visible status, dead-letter state surfaced in admin activity (ACT). |
| API-08 | Webhook receivers (Stripe, Resend) verify signatures with constant-time comparison (AUT-09) and are idempotent by event ID. |

### 6.17 Frontend engineering & performance (FEP)

| ID | Requirement |
| -- | ----------- |
| FEP-01 | **Client state = server cache.** One query library (e.g., TanStack Query) for all server data; a single small UI store for local preferences only. No duplicated stores, no copying server data into component state (PRN-15). |
| FEP-02 | **Render discipline:** stable callbacks and memoized derived values on hot paths (tables, dashboards); memo boundaries around expensive subtrees; expensive calculations never run in render bodies — compute server-side or memoize. Optimize where measured, not speculatively. |
| FEP-03 | **Long lists:** server pagination by default (API-02); any client list that can exceed ~200 rows is virtualized (leads table, activity log). |
| FEP-04 | **Input-driven work:** search and filter inputs debounced (~250 ms); high-frequency handlers (scroll/resize/drag) throttled or rAF-batched; controlled inputs isolated so keystrokes never re-render tables. |
| FEP-05 | **Batching & optimism:** related state updates batched; mutations use optimistic updates with rollback + toast on failure (UXQ-03). |
| FEP-06 | **Heavy work off the main thread:** client-side XLSX parsing (upload preview) runs in a Web Worker; export generation is server-side; the main thread is never blocked > 50 ms by app code. |
| FEP-07 | **Loading strategy:** route-level code splitting; charts and the map lazy-loaded; skeletons over spinners; initial JS budget ≤ 200 KB gzipped for dashboard and portal routes. |
| FEP-08 | Performance gate: Lighthouse performance ≥ 90 on dashboard and portal in CI (soft gate — regressions require a stated reason in the PR). |

### 6.18 Authentication & session security (AUT)

| ID | Requirement |
| -- | ----------- |
| AUT-01 | **Password storage:** delegated to Supabase Auth (bcrypt, salted). Passwords never appear in application tables, logs, analytics, or error reports. |
| AUT-02 | **Password strength (admin):** minimum length 12, zxcvbn score ≥ 3, checked against known-breach corpus via k-anonymity API at set/change; clear inline strength feedback (FRM-01). |
| AUT-03 | **Login rate limiting:** sliding-window limits keyed on IP + identifier for login, OTP, and reset endpoints (API-05); anomaly alert to admin on sustained abuse. |
| AUT-04 | **Account lockout:** progressive delays after repeated failures (never a silent permanent lock); the account owner is notified by email on lockout; admin can unlock. |
| AUT-05 | **Enumeration resistance:** login, invite, OTP, reset, and public signup endpoints return uniform messages and uniform timing whether or not the account exists ("If an account exists, we've sent a code."). |
| AUT-06 | **Secure password reset:** single-use token, hashed at rest, 30-minute expiry; all sessions revoked on successful reset; notification email sent ("your password was changed"). |
| AUT-07 | **Session fixation protection:** fresh session tokens issued at every authentication event including MFA step-up; session identifiers are never accepted from the client. |
| AUT-08 | **MFA:** TOTP available for admin with recovery codes (SET-10); partner email-OTP login is possession-based by design (PTL-01). Sensitive operations (change email, disable MFA, revoke sessions) require recent re-authentication; email change additionally requires verification of the NEW address and a notification to the OLD address. |
| AUT-09 | **Constant-time comparison** for all secret checks — OTP codes, reset tokens, webhook signatures, API keys — via `timingSafeEqual`; never `===` on secrets. |
| AUT-10 | **Remember-me hardening:** trusted-device = rotating refresh tokens with reuse detection (reuse ⇒ revoke family + notify); 30-day cap; listed and revocable per device (ACC-02). |
| AUT-11 | **Bot & abuse protection:** strict rate limits by default; CAPTCHA challenge (e.g., Turnstile) attachable to auth endpoints via feature flag if abuse is observed; invites are admin-issued so public signup surface is minimal. |
| AUT-12 | **Cookie security:** session cookies are HttpOnly, Secure, SameSite=Lax with `__Host-` prefix; tokens never in localStorage; CSRF protection on state-changing routes (SameSite + token). |
| AUT-13 | **Session expiration:** short-lived access tokens (≤ 1 h); refresh idle timeout 7 days (30 on trusted devices); absolute lifetime 90 days; authed pages served with `Cache-Control: no-store`. |
| AUT-14 | **Logout correctness:** server-side refresh-token revocation (not just cookie deletion); "sign out all devices" available; client cache cleared; back button after logout reveals no authenticated data. |

**Delegation boundary (implementation note):** Supabase Auth supplies the primitives — password hashing, email OTP, refresh-token rotation with reuse detection. The following are **application-layer responsibilities built on top**: progressive lockout + notifications (AUT-04), uniform enumeration responses (AUT-05), password strength + breach checking (AUT-02), CAPTCHA attachment (AUT-11), and the per-device session registry backing ACC-02 (maintain an app-owned sessions table keyed to refresh-token families; do not assume Supabase exposes a session list).

### 6.19 Platform security (SEC / ACC)

| ID | Requirement |
| -- | ----------- |
| SEC-01 | RLS on every table; service-role key server-side only; a scoping guard wraps every query (TST-01). |
| SEC-02 | Signed URLs only for files; no public buckets. |
| SEC-03 | Upload constraints: extension + sniffed content-type (never trusted), 10 MB cap. |
| SEC-04 | Security headers + CSP; secrets server-side only; dependency and secret scanning in CI. |
| SEC-05 | PII posture: seller phone/email treated as consumer PII — encrypted at rest, excluded from logs, masked in AI traces. |
| SEC-06 | **Export injection protection:** all user-originated cell values in CSV/Excel exports are sanitized against formula injection (values beginning with `=`, `+`, `-`, `@` are prefixed/escaped; exceljs cells written as explicit strings). _Why:_ lead-vendor and note text is attacker-controllable and partners open these files in Excel. |
| SEC-07 | **Environment separation:** production, preview, and development use separate Supabase projects and credentials; non-production seeds fake data only; ALL outbound email in non-production is intercepted to a sink/allowlist so real partners can never receive test messages. |
| ACC-01 | Admin auth per AUT; partner auth per PTL-01. |
| ACC-02 | Session management UI: active sessions/devices visible and revocable (admin for self; admin may revoke partner sessions). |
| ACC-03 | Full-org export (leads CSV + files + notes split by visibility) available to admin anytime. |

### 6.20 Activity, logs & observability (ACT)

| ID | Requirement |
| -- | ----------- |
| ACT-01 | Admin activity view: filterable audit surface — actor, action, entity + reference ID, success/failure, before/after where sensible, when. |
| ACT-02 | Partner activity view: the partner's own actions and events on their leads only. |
| ACT-03 | Developer observability: structured server logs with trace IDs + error tracking (Sentry); every user-visible failure surfaces its trace ID (UXQ-01). |
| ACT-04 | Security events (logins, OTP failures, lockouts, invite/revoke, settings and rules changes) highlighted in admin activity. |
| ACT-05 | **Scheduled-job heartbeat + uptime:** every cron job emits a heartbeat; a dead-man's-switch alert fires if a job misses its schedule or a job run fails repeatedly; an external uptime monitor watches the app. _Why:_ without this, a silently dead scheduler stops digests and listing checks with no symptom until a partner complains. |

### 6.21 US legal & privacy (LGL)

| ID | Requirement |
| -- | ----------- |
| LGL-01 | ToS + Privacy Policy, versioned; acceptance at provisioning and partner first login; re-acceptance on material change. |
| LGL-02 | Data rights (CCPA/CPRA-shaped, honored for all users): export, correction, deletion with grace period; published subprocessor list. |
| LGL-03 | Data residency: all providers pinned to US regions. |
| LGL-04 | Compliance boundary stated plainly: leads contain consumer PII; contacting sellers (TCPA/DNC) is the customer's responsibility; the product records provenance and never represents leads as "compliant to contact." Plain-words security page includes: customer data is never used to train AI models. |
| LGL-05 | Breach-response runbook; encrypted backups; restore rehearsed before launch gate. |

### 6.22 Billing (BIL) — final phase (productization)

| ID | Requirement |
| -- | ----------- |
| BIL-01 | Stripe subscriptions: checkout, billing portal, invoices, webhook-driven state (API-08). |
| BIL-02 | Server-side entitlements as one plan matrix; UI shows locked + upgrade; the server refuses regardless of UI. |
| BIL-03 | Dunning → grace → read-only; data never deleted for nonpayment. |
| BIL-04 | AI usage metered per tenant with plan allowances (AIA-06). |

## 7. Functional requirements — administration (ADM / CVG)

| ID | Requirement |
| -- | ----------- |
| ADM-01 | Dashboard per ANA-01, plus unmatched/coverage-gap alert. |
| ADM-02 | Leads: searchable full history; filters per ANA-04; per-lead audit trail view (PRN-02). |
| ADM-03 | Partners: CRUD with contact details (name, email, phone, deal terms, notes), locked color, invite state, per-partner statistics tab (ANA-02). Deactivating a partner who still owns coverage ZIPs or state rules prompts territory reassignment (new coverage version) or explicit routing to Unmatched; historical assignments are untouched (PRN-05). |
| CVG-01 | Coverage import from spreadsheet with a diff preview (adds/removes/reassigns) before apply; versioned (DM-06). |
| CVG-02 | State rules, MLS patterns, campaign recodes, Source Profiles: editable tables with seeds, unified under one Rules area. |
| CVG-03 | Coverage versions revertible with confirmation; reverts are audited. |

## 8. Settings catalog (SET) — every setting has a default; zero settings visits required

| ID | Setting | Default |
| -- | ------- | ------- |
| SET-01 | Color-coding in exports + UI (EXP-06) | On |
| SET-02 | Partner palette (locked colors; contrast-checked changes) | Seeded roster |
| SET-03 | Notification preferences per event/role; admin alert on status change | Digests on; alerts off |
| SET-04 | Status list (SEAM-06) | Seeded 6 |
| SET-05 | Export column order (SEAM-03); JV Notes mapping (NTS-03) | Fixed contract; blank |
| SET-06 | Listing check: LinkOnly on/off; automated provider on/off | On; Off |
| SET-07 | Data retention for original upload files (days; ∞ allowed) | 365 |
| SET-08 | Timezone, date format | Device-derived |
| SET-09 | Branding tokens: name, logo, colors, typography (PRN-12) | Generic theme |
| SET-10 | Security: admin MFA, sessions view/revoke, trusted-device duration | MFA off; 30 days |
| SET-11 | AI assistant: enabled, provider, monthly budget cap | Off until AI phase |
| SET-12 | Source Profiles: view/edit/version; per-profile strictness; per-source template download | Created from uploads; flexible |

## 9. Testing (TST) — CI-gating, written WITH the code

| ID | Requirement |
| -- | ----------- |
| TST-01 | Isolation suite: two seeded tenants + two partners; prove no query path crosses tenant or partner scope. Every merge. |
| TST-02 | MLS corpus incl. canonical cases: `"Is it Listed? : true If Yes, MLS Date Active :"` → removed · `"Listed on MLS ? No … MLS Date Active: 3/2/25"` → kept · blank → kept · `"seller has no mortgage"` → no trigger. Corpus grows with every real-world miss. |
| TST-03 | Precedence suite: covered-ZIP lead in a fallback state → ZIP partner, not the state rule; uncovered → fallback; `6404` ↔ `06404-1234` equivalence. |
| TST-04 | Dedupe suite: repeat address+zip → flagged, original partner retained; phone-only near-miss NOT merged. |
| TST-05 | Golden file: one real anonymized week, hand-verified, pinned to a rules snapshot; **semantic diff** gate for the spine phase — parsed cell values, row order, assignments, fills, and legend must match exactly (not raw file bytes; xlsx containers embed timestamps). |
| TST-06 | Export snapshots: column order, colors ON and OFF modes, legend, summary sheet. |
| TST-07 | Portal E2E (Playwright): invite → OTP login → ToS → scoped leads → status → note → export. |
| TST-08 | Note-visibility suite: admin cannot read partner notes and vice versa — via API and via RLS directly. |
| TST-09 | Analytics correctness: fixtures with known counts; every ANA figure asserted. |
| TST-10 | AI eval suite (AI phase): grounded-answer checks, refusal on unavailable data, injection attempts via notes/lead fields. |
| TST-11 | Format-drift suite: exact signature auto-applies; renamed column → diff screen (never silent re-guess); added column passes flexible / blocks strict; missing Zip hard-blocks; confirmed drift creates profile v+1. |
| TST-12 | Auth security suite: uniform enumeration responses (content + timing tolerance), progressive lockout, reset-token single-use + session revocation, cookie flags asserted, logout revokes server-side, OTP compared constant-time, refresh reuse detection revokes the family. |

## 10. Risk register

| Risk | Mitigation |
| ---- | ---------- |
| MLS false-positive removes a good lead | PRN-04; TST-02 corpus; removed leads visible + restorable (PRN-03) |
| Leading-zero ZIP corruption | NRM-01 both sides; TST-03 |
| Lead source silently changes export format | Source Profiles + explicit drift confirmation (ING-07/08); TST-11; version pinned per run |
| Cross-partner/tenant or note leakage | PRN-08/13; TST-01/08 standing suites |
| Color collisions as roster grows | EXP-06 palette distance + toggle; PRN-14 |
| Rules edits silently change outputs | DM-08 snapshot; golden test pinned; edits audited |
| Auth abuse (credential stuffing, OTP spraying, enumeration) | AUT-03/04/05/11; TST-12 |
| Listing provider breaks / ToS exposure | SEAM-02; LinkOnly always available; degrades to links, never blocks |
| Digests land in spam → portal loop dies | SPF/DKIM/DMARC setup task (§12); outbox delivery status |
| Frontend degrades as data grows | FEP-03/07/08 budgets + virtualization; API-02 server pagination |
| AI assistant hallucinates or is injected | AIA-02/03/05; read-only tools; TST-10; budget cap |
| Concurrent uploads corrupt dedupe order | ING-06 lock + API-03 idempotency |
| Wrong file or mapping processed and pollutes history | ING-09 void-run; drift confirmation (ING-08); audit trail |
| Scheduled jobs die silently (digests/checks stop) | ACT-05 heartbeat + dead-man alert + uptime monitor |
| Test/preview environment emails real partners | SEC-07 environment separation + non-prod email sink |
| Scope creep (including by AI coding tools) | This spec is authoritative; changes via ADR only (see playbook) |

## 11. Build order & phase gates

**Universal gate:** a phase is not done until its deliverable has been exercised with a REAL weekly file (or by a real partner).

| Phase | Deliverable | Exit gate |
| ----- | ----------- | --------- |
| 0 | Foundations: repo/CI, environment separation + non-prod email sink (SEC-07), design tokens + component library core (DSN), schema + RLS + seeds + reference IDs, scoping guard, auth hardening baseline (AUT-01..07, 09, 12–14), MLS engine, Source Profile parser vs real sample files, processing lock | TST-01/02/12 green; real files parse |
| 1 | The spine: pipeline → colored Excel + run summary; void-run (ING-09); leads/unmatched views; template panel; progress UI | TST-05 semantic zero-diff vs a hand-verified baseline week; owner processes one real week end-to-end |
| 2 | Distribution: portal (OTP onboarding + ToS), notes, digests + notification center, partners/coverage/rules screens, listing check (LinkOnly), activity views | ≥ 3 real partners active; one week fully in-app |
| 3 | Insight & polish: analytics, coverage map, tours, tooltips/filters everywhere, settings catalog, session management UI, retention sweep, job heartbeat + uptime alerts (ACT-05), performance gates (FEP-08) | Owner runs 4 consecutive weeks; manual workflow retired |
| 4 | AI insights assistant behind the gateway + TST-10 + metering | Assistant answers the owner's real weekly questions with grounded citations |
| 5 | Productize: tenant onboarding, billing, legal pack finalization, white-label theming via tokens | First external paying tenant |

## 12. Open questions & owner tasks

1. Sample lead files (2+ per source) and one hand-verified week → TST-05 golden fixture. Critical path for Phases 0–1.
2. Partner seed list confirmation: names, emails, phones, locked colors.
3. Sending-domain DNS (SPF/DKIM/DMARC) for Resend — before Phase 2.
4. Historical backfill of past processed files into history (recommended: yes).
5. Automated listing-check provider evaluation (Phase 2); LinkOnly ships regardless.
6. AI provider + budget cap (Phase 4).
7. Working product name + placeholder logo (tokens make it swappable anytime).
8. ToS + Privacy Policy drafting (template service or attorney) — LGL-01 assumes these documents exist; they are an owner deliverable, not a developer one. Needed before Phase 2 partner onboarding.

## 13. Stack (locked)

TypeScript everywhere · Next.js App Router on Vercel · Supabase US (Postgres + Auth incl. email OTP + Storage + RLS) · Drizzle ORM · Zod at every boundary · TanStack Query (FEP-01) · exceljs (write) + SheetJS (read, in a Web Worker client-side) · Resend · Recharts (ANA) + D3/TopoJSON (MAP) · rate-limit store (Upstash Redis free tier or Postgres-based at this volume) · Playwright + Vitest · Sentry · GitHub Actions. LLM via gateway, AI phase only.

**Realistic running cost at launch: ~$45–50/mo** — Vercel Pro ~$20 (the free Hobby tier prohibits commercial use) + Supabase Pro ~$25 (required for reliable backups and no project pausing once real partner data is stored) + Resend/monitoring free tiers. AI and billing phases add usage-based spend under SET-11.
