# ADR-0012: Coverage is managed per-partner; bulk file import + rollback deferred

- **Status:** Accepted (owner decision)
- **Date:** 2026-07-08
- **Phase / WP:** Phase 2 / WP-031 (031a shipped; 031b descoped)

## Context

Spec CVG-01 describes coverage entry as a "**import from spreadsheet** with a diff
preview," and CVG-03 adds "coverage versions revertible with confirmation." While
planning WP-031 the owner steered the model: coverage should be entered **on the
partner** — "when adding a partner, they mention the ZIP codes they handle." WP-031a
delivered that (per-partner ZIP/state entry, versioned + audited). The per-partner
ZIP field accepts a **pasted list**, so a partner with hundreds of ZIPs can be
populated by pasting a spreadsheet column — i.e. bulk entry is already covered
per-partner.

The owner then reviewed the remaining WP-031b options (a tenant-wide spreadsheet
file that maps ZIP→partner across all partners; plus version history + rollback) and
chose to **skip them** for V1.

## Decision

- **Coverage is managed per-partner** (WP-031a) as the V1 interface. Bulk entry =
  paste a column of ZIPs into a partner's coverage field.
- **Defer** the tenant-wide coverage **spreadsheet-file import** (CVG-01's file path)
  and **version rollback** (CVG-03). Neither is a development blocker; the owner does
  not keep a single master coverage file and prefers the per-partner workflow.
- Coverage changes remain **versioned** at the row level (DM-06: close current +
  open new) and **audited** (`partner.coverage_updated`), so history exists in data
  even without a rollback UI.

## Consequences

- If the owner later maintains a master coverage spreadsheet (or wants one-click
  rollback), revisit as a fresh WP: add a `coverage_imports` version-log table
  (with a per-import snapshot) + the import→diff-preview→apply→revert flow. The pure
  diff engine (`src/modules/coverage/diff.ts`) already generalizes to the tenant-wide
  case, so most of the logic is reusable.
- The Phase-1 §11 gate (process one real week) is **unblocked** by 031a alone: the
  owner enters real ZIP coverage per partner, then uploads a real week.
- Traceability note: CVG-01 (file import) and CVG-03 (rollback) are **owner-deferred
  for V1**, not implemented — recorded here rather than silently skipped.
