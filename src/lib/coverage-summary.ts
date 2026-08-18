// UXF-10.2 (Scope-E audit §10.2) — the one-line coverage summary shown beside a partner.
//
// It used to hard-print the ZIP segment: a state-only partner read "0 ZIPs · 2 states",
// which scans as a defect ("why is a number zero?") rather than as a fact. A count of
// zero is not information here — it is the ABSENCE of a coverage kind — so the segment
// is simply omitted. A partner with no coverage at all gets an em dash, the same
// no-value glyph the rest of the tables use, never "0 ZIPs · 0 states".
//
// Pure and display-only (no tokens, no markup): the caller owns the styling.
export function coverageSummary(zipCount: number, stateCount: number): string {
  const parts: string[] = [];
  if (zipCount > 0) parts.push(`${zipCount} ZIP${zipCount === 1 ? "" : "s"}`);
  if (stateCount > 0) parts.push(`${stateCount} state${stateCount === 1 ? "" : "s"}`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}
