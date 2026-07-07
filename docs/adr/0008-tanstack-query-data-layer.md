# ADR-0008: TanStack Query as the client data layer

- **Status:** Accepted
- **Date:** 2026-07-08
- **Phase / WP:** Phase 1 / WP-019–021

## Context

The frontend rules (spec §6.17, FEP-01) require: server data via **TanStack Query only**;
components never copy server data into local state. The stack is locked (§13): "TanStack
Query (FEP-01)". The run views (summary + leads/unmatched) are the first data-backed screens.

## Decision

Add **@tanstack/react-query**. A single `QueryClient` is provided at the root
(`src/app/providers.tsx`); pages read exclusively from the query cache via `useQuery`.
API routes are scoped (PRN-08) and return the uniform envelope `{ code, message, traceId }`
on error (`src/lib/http.ts`); the client fetch helper (`src/lib/api.ts`) surfaces that message.

- Defaults: `staleTime: 30s`, `refetchOnWindowFocus: false`, `retry: 1`.
- Scope in Phase 1 comes from a dev resolver (`src/lib/scope-context.ts`) that maps to the
  dev tenant as admin; Phase 2 (PTL-01) swaps it for the authenticated session — the scope
  guard and RLS are unchanged.

## Consequences

- One runtime dependency; the canonical FEP-01 pattern. List virtualization
  (`@tanstack/react-virtual`) and server-side pagination are added with the global leads view
  (a run's leads are bounded per week, so the per-run view fetches them in one request).
- Recorded per the "no new deps without an ADR" rule; TanStack Query is spec-mandated (§13).
