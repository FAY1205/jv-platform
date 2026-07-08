// Pure JV-### numbering (DM-07). The dev seed hardcodes JV-001..009 without
// touching ref_counters, so the next partner number is derived from the current
// maximum — never the count (a deactivated partner's number is never reused).

const JV_RE = /^JV-(\d+)$/;

/** The next JV-### number: max existing number + 1 (1 when there are none). */
export function nextPartnerNumber(existingRefIds: readonly string[]): number {
  let max = 0;
  for (const ref of existingRefIds) {
    const m = JV_RE.exec(ref.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}
