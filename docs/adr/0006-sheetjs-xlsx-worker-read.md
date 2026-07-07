# ADR-0006: SheetJS (`xlsx`) for reading uploaded files, in a Web Worker

- **Status:** Accepted
- **Date:** 2026-07-07
- **Phase / WP:** Phase 1 / WP-013

## Context

Ingestion (ING-01) accepts `.xlsx`/`.csv` uploads. The stack is locked (spec §13):
**"SheetJS (read, in a Web Worker client-side)"** and **exceljs (write)** — read and
write are deliberately split across two libraries. Phase 1 needs the read half: turn an
uploaded workbook into `{ headers, rows }` for source detection (ING-02) and preview,
off the main thread (FEP-06 — heavy client work must not block the UI > 50 ms).

Uploaded files are **untrusted, user-originated DATA** (PRN-10). The parser must never
be handed authority to execute anything, and must be isolated from the main thread.

## Decision

Add **SheetJS `xlsx`** as the read parser, used **only** inside `src/workers` and pure
parse helpers — never on the render thread. The worker returns plain
`{ headers: string[], rows: Record<string, string>[] }`; all pipeline logic stays in the
existing pure modules.

- Parse with `{ raw: false, defval: "" }` so cells arrive as **formatted strings** —
  this preserves leading-zero ZIPs (`06404`) and avoids date-serial surprises; canonical
  normalization (NRM-01/02) still runs downstream.
- Read-only: we never call SheetJS write APIs (that is exceljs's job, WP-016).
- The full source row is preserved verbatim into `raw_json` (DM-02); nothing the parser
  emits is treated as an instruction (PRN-10).

**Distribution:** SheetJS's maintained releases are published from their own registry, not
the npm mirror (which is pinned at an older line). We install the current pinned tarball
from the official SheetJS CDN. If that source is unreachable at install time, the fallback
is the npm `xlsx` package pinned to a known version; either way the version is committed to
the lockfile so builds are reproducible.

## Consequences

- One runtime dependency, loaded lazily in a worker chunk — it does not enter the main
  route bundle (FEP-07). CSV read comes free (same library), satisfying ING-01's `.csv` path.
- Read/write split means two libraries in the tree; accepted because each is best-in-class
  for its direction and the write path (exceljs) needs cell fills/grouping SheetJS's free
  build does not do well.
- Recorded here per the "no new deps without an ADR" rule; SheetJS read is spec-mandated (§13).
