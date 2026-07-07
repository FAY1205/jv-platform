// ─────────────────────────────────────────────────────────────────────────────
// Campaign recode (EXP-01). PURE — no I/O (PRN-01). Recodes are DATA from the
// campaign_recodes table (PRN-07); this maps a source campaign to its short code
// (e.g. "Lead Zolo 1.0" → "Z", "Real Estate Bees" → "B"). A trailing "*" is a
// prefix match; otherwise the pattern is matched exactly (case-insensitive). The
// first matching rule wins; an unmatched campaign passes through unchanged.
// ─────────────────────────────────────────────────────────────────────────────

export interface CampaignRecode {
  matchPattern: string;
  code: string;
}

export function recode(campaign: string | null | undefined, rules: readonly CampaignRecode[]): string {
  const value = (campaign ?? "").trim();
  if (value === "") return "";
  const lower = value.toLowerCase();

  for (const rule of rules) {
    const pattern = rule.matchPattern.trim();
    if (pattern.endsWith("*")) {
      if (lower.startsWith(pattern.slice(0, -1).toLowerCase())) return rule.code;
    } else if (lower === pattern.toLowerCase()) {
      return rule.code;
    }
  }
  return value;
}
