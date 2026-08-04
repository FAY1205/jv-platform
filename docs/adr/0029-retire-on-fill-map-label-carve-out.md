# ADR-0029: Retire the on-fill map-label contrast carve-out with the hex CoverageMap (D1)

- **Status:** Accepted (owner-approved dead-code removal, deferred-candidates session, 2026-07-15)
- **Date:** 2026-07-15
- **Phase / WP:** Phase 2 · deferred-candidates slice D1
- **Supersedes:** ADR-0024 (on-fill map label contrast — SC 1.4.3 carve-out)

## Context

ADR-0024 accepted a bounded SC 1.4.3 exception for the 2-letter state codes the hex
`CoverageMap` drew on partner tints (worst ~3.74:1 at 0.9 fill opacity), conditioned on
a contrasting halo plus redundant AA identification (tooltip + companion list).

Since the owner's map-consistency call (testing round 1, T3), the real county choropleth
(`CountyCoverageMap`) is the app's only map. It draws **no on-fill text** — states are
identified via the hover tooltip (`PartnerTag`) and each page's companion list. The hex
`CoverageMap` had zero page consumers left (barrel-only export).

## Decision

Retire the hex `CoverageMap` and everything that existed solely for its on-fill labels:

- `src/components/CoverageMap.tsx` and its barrel export — deleted.
- `src/lib/geo/us-hexgrid.ts` — deleted; its canonical `{code, name}` state list moved
  to `src/lib/us-states.ts` (`US_STATE_DATA`, code order preserved because the coverage
  model's output order depends on it). Geometry (`points`/`cx`/`cy`/`HEX_VIEWBOX`) had
  no other consumer and went with it.
- `contrastText`/`contrastHalo` in `src/lib/contrast.ts` and `tests/unit/contrast.test.ts`
  (all three describes were hex-label policy) — deleted. `relativeLuminance`/
  `contrastRatio` stay (WP-H shared math, pinned by `tests/unit/wcag.test.ts`). The
  export renderer keeps its own separate `contrastText` policy (WP-H: policies distinct).
- The DSN-11 glyph-fit carve-out for the hex map's `fontSize:11` labels lapses; the
  `NotificationBell` badge is now the only glyph-fit exception (FRONTEND_STANDARDS §2).

## Consequences

- `FRONTEND_STANDARDS.md` §7 returns to **"fills keep AA text contrast, no exceptions"**
  — no live surface uses the ADR-0024 carve-out.
- If a future map draws on-fill labels, ADR-0024's analysis (and its opaque
  backing-chip alternative) applies afresh under a new ADR — the carve-out does not
  silently revive.
- `US_STATE_DATA` in `src/lib/us-states.ts` is now the ONE home for state codes/names
  (PRN-15): the coverage model, the portal territory builder, and the pickers all read it.
