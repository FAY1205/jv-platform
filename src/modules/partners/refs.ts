// Pure PR-### numbering (DM-07). New partners get the next monotonic number derived
// from the current maximum — never the count (a deactivated partner's number is never
// reused). Accepts BOTH prefixes: PR- is current (owner rename, 2026-07-15, migration
// 0022); JV- rows may survive in un-migrated environments/fixtures, and their numbers
// must still advance the sequence so a rename can never mint a colliding number.

const REF_RE = /^(?:PR|JV)-(\d+)$/;

/** The next PR-### number: max existing number + 1 (1 when there are none). */
export function nextPartnerNumber(existingRefIds: readonly string[]): number {
  let max = 0;
  for (const ref of existingRefIds) {
    const m = REF_RE.exec(ref.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}
