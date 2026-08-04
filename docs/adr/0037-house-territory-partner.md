# ADR-0037: The tenant's own "house" territory as an is_house partner

- **Status:** Accepted
- **Date:** 2026-08-03
- **Phase / WP:** Post-go-live (owner testing round 3, note #7 — WP-D)

## Context

The owner wants to manage some ZIPs/states themselves — territory that isn't handed
to a JV partner but is worked in-house — and wants that territory to (a) route leads
to them, (b) be distinguishable from partners by color, and (c) show on the
dashboard, coverage, and portal maps like any other coverage.

Today all coverage (`coverage_zips`, `state_rules`) points at a `partners.id` via a
NOT NULL FK, and the assignment pipeline (`src/modules/pipeline/assign.ts`) resolves
a lead to a partner by ZIP → state fallback → unmatched. There is no representation
of "the tenant owns this territory directly."

Two shapes were considered:

1. **A separate house-coverage mechanism** (new tables / a null-partner "house"
   sentinel). This would require the pipeline, the coverage commands, and every map
   to special-case a second kind of owner — exactly the regional-exception branching
   ASN-02 forbids ("no special-case partner logic; exceptions emerge from the data").

2. **A house *partner*** — a normal `partners` row flagged `is_house`. Coverage,
   routing, conflict detection, the maps, and the coverage editor all treat it as a
   partner; the only differences are presentational (name/color/label) and a few
   lifecycle guards.

## Decision

Model the house territory as **a partner row with `is_house = true`.**

- **Schema (migration 0031):** add `partners.is_house boolean NOT NULL DEFAULT false`
  and a **partial unique index** `WHERE is_house AND deleted_at IS NULL` — at most one
  active house per tenant. The partial index is raw SQL in the migration (mirroring the
  `coverage_zips` current-owner index in 0001); drizzle's schema tracking does not own it.

- **Fixed identity.** The house row uses a reserved ref `HOUSE` (not a `PR-###`;
  `nextPartnerNumber`'s `^(?:PR|JV)-(\d+)$` regex ignores it, so it never perturbs
  partner numbering), a fixed name `My Territory`, no email/phone, and a reserved
  graphite color `HOUSE_COLOR = #3A3F4B` deliberately outside the partner swatch pool
  so it reads as "yours, not a partner's" on every map.

- **Lazy creation.** `ensureHousePartner(scope)` creates the row on first use (behind
  the per-tenant advisory lock, idempotent via the partial index), rather than seeding
  it. Existing (prod) tenants and new signups get it the same way — the first time the
  admin clicks "Set up my territory" on the Partners page. No migration backfill, no
  change to the delicate provisioning path.

- **Lifecycle guards.** The house row is never invited (invite route returns
  `house_no_invite`) and never deactivated (`deactivatePartner` throws
  `HouseNotAllowedError`). It is edited coverage-only (no contact fields, so the WP-C
  required-email rule doesn't apply), through the same conflict-aware coverage endpoint
  — so house and partners can never silently overlap each other, in either direction.

- **Zero pipeline / map change.** Because the house is a partner, `assign.ts` routes
  to it and `buildStateCoverage` colors its states with no new code. The distinction is
  purely presentational: the roster pulls the house row into its own "My Territory"
  section, and the tag shows the house color + `HOUSE` ref.

## Consequences

- **Pro:** ASN-02 preserved — no exception branching. Leads in house territory appear
  in the admin's normal lead views (they are "matched" to the house partner), and every
  map shows house coverage automatically.
- **Pro:** Bidirectional conflict safety comes for free from WP-C — a partner can't take
  house territory and the house can't take a partner's, each surfaced by name.
- **Con:** The house appears as a partner row in the database and in any raw
  partner-count query. Callers that mean "real partners" must filter `is_house = false`
  (the roster UI and reassign-target list already do). This is the accepted cost of the
  no-special-case model.
- **Con:** House territory is not offered as a reassignment target when deactivating a
  partner (the roster excludes it). Acceptable for now — the admin can add the freed
  territory to the house manually. Revisit if it becomes a common flow.
