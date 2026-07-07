# ADR-0007: exceljs for the colored export writer

- **Status:** Accepted
- **Date:** 2026-07-08
- **Phase / WP:** Phase 1 / WP-016

## Context

The weekly deliverable is a partner-grouped, color-coded `.xlsx` with full-row fills in
locked partner colors, a `JV_Color_Legend` sheet, and a `Run_Summary` sheet (EXP-02/03/06).
SheetJS (ADR-0006) reads uploads but its free build does not write cell fills / styling well.
The stack is locked (spec §13): **"exceljs (write)"** — read and write are split deliberately.

## Decision

Add **exceljs** as the export writer, used only in `src/modules/export`. The renderer is a
pure, deterministic transform `(leads, partners, summary, options) → xlsx bytes` — no DB,
fetch, or `Date.now()`. Determinism is asserted **semantically** (reload the workbook and
compare content/fills), never by byte-diff, because the container embeds nondeterministic
metadata — this is exactly the TST-05 "semantic zero-diff" contract.

- **SEC-06:** every user-originated cell is sanitized against formula injection
  (`= + - @`, tab/CR prefixes) before writing.
- **PRN-14:** partner name + `JV-###` ref accompany the color in every row and the legend —
  color is never the sole signal; fills keep AA-contrast text.

## Consequences

- One runtime dependency, server-side only (exports render in an API route / job), so it does
  not affect client bundle budgets (FEP-07). Read (SheetJS) + write (exceljs) = two libraries,
  accepted as the locked-stack split.
- Recorded per the "no new deps without an ADR" rule; exceljs is spec-mandated (§13).
