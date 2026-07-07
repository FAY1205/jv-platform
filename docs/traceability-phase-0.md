# Phase 0 traceability audit

End-of-phase audit (Playbook §7): every Phase 0 requirement → implementing code + test → status.
**Legend:** ✅ done · 🟡 partial (baseline done, rest scoped to a later phase) · ⏳ owner deliverable.

## Exit gate (spec §11)
- **TST-01** isolation ✅ (`tests/integration/isolation.test.ts`, live) · **TST-02** MLS ✅ (`tests/unit/mls.test.ts`) · **TST-12** auth ✅ (`tests/unit/auth.test.ts`)
- Real files parse ⏳ — running on synthetic fixtures (`tests/fixtures/synthetic-week.ts`); real files are an owner critical-path item.

## Requirement → implementation

| Req | What | Where | Test | Status |
|-----|------|-------|------|--------|
| SCP-01 / SEAM-01 | tenant_id on every table | `src/db/schema.ts` | isolation | ✅ |
| DSN-01/02, SEAM-08 | Design tokens, single source | `src/lib/tokens`, `globals.css` | `tokens.test.ts` | ✅ |
| DSN-03..10 | Component library, all states | `src/components/*` | `components.test.tsx` | ✅ |
| PRN-12 | No hardcoded brand values | tokens + components | tokens drift-guard | ✅ |
| SEC-07 | Env separation + email sink | `src/lib/env.ts`, `modules/notify/email.ts` | `env`, `email-sink` | ✅ |
| MLS-01..05, PRN-04 | MLS filter engine | `src/modules/pipeline/mls*.ts` | `mls.test.ts` (30) | ✅ |
| NRM-01/02, DM-01 | Normalization + dedupe key | `src/modules/pipeline/normalize.ts` | `normalize.test.ts` | ✅ |
| ING-01..08, SEAM-05, DM-08 | Source Profiles + drift | `src/modules/sources/*` | `sources.test.ts` (TST-11) | ✅ |
| DM-01..11 | Data model, indexes | `src/db/schema.ts` | migration applied | ✅ |
| DM-07 | Reference IDs | `src/db/ref-ids.ts` | `ref-ids.test.ts` | ✅ |
| SEC-01, PRN-08 | RLS + scoping guard | `migrations/0001*`, `src/lib/scope.ts` | isolation (TST-01) | ✅ |
| PRN-13 | Note visibility boundary | `scope.ts` + RLS | isolation | ✅ |
| AUT-02..14 | Auth hardening primitives | `src/lib/auth/*` | `auth.test.ts` (TST-12) | 🟡 (routes → Phase 2) |
| ING-06, API-03 | Processing lock + idempotency | `pipeline/lock.ts`, `lib/idempotency.ts` | `processing.test.ts` | 🟡 (advisory lock → Phase 1) |
| API-04 | migration+seed+RLS+index together | `src/db/migrations/*`, `seed.ts` | applied live | ✅ |
| TST-05 | Golden file | `fixtures/synthetic-week.ts` | `pipeline-fixtures.test.ts` | 🟡 provisional (assign/dedupe → Phase 1) |

## Scope-creep check
No code was found that maps to **no** requirement. Deferrals are explicit in each WP's "Out of scope"
and re-listed here (🟡). ADRs 0001–0005 record every dependency/decision beyond spec §13.

## Carried into later phases (not Phase 0 gaps)
- Supabase Auth routes + JWT app_metadata claims + auth tables (Phase 2, PTL-01)
- Advisory-lock serialization inside the upload transaction (Phase 1)
- Real sample files + hand-verified week → real TST-05 golden (owner ⏳)
- Lighthouse CI against real routes (Phase 3, FEP-08)
