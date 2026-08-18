import type { ScreenKey } from "./prompt";

// Contextual suggested questions (owner decision: chips change with the screen).
// PURE static map for V1; ai_memory-driven personalization is a deferred WP.

/** The one chip that is never a data question — it stays LAST in every set, including a
 *  bounded follow-up row (AIS-10), so the row always ends on the same escape hatch. */
export const EXPLAIN_CHIP = "Explain this screen";

const GENERIC = ["How are my partners performing?", "Which states have no coverage?", "What happened in the last import?", EXPLAIN_CHIP];

// Every ScreenKey has an EXPLICIT entry (AIS-07): the GENERIC fallback is only for an
// unknown/undefined screen, never a silent stand-in for a real one (that is what put
// dashboard chips on Rules/Activity/Upload). `Record` not `Partial<Record>` so a future
// ScreenKey fails typecheck instead of inheriting GENERIC — same trick as the exhaustive
// gate switch. Chip rules: question form (the header reads "Try asking"), <= 6 words,
// answerable by an existing tool or by the prompt's HOW_TO/screen catalog, and
// "Explain this screen" stays LAST everywhere.
const BY_SCREEN: Record<ScreenKey, string[]> = {
  dashboard: GENERIC,
  leads: ["How many new leads this week?", "Which leads are still untouched?", "Explain this screen"],
  unmatched: ["Which states have no coverage?", "How many leads are waiting unmatched?", "Explain this screen"],
  imports: ["What happened in the last import?", "How many leads did the MLS filter remove?", "Explain this screen"],
  import_detail: ["Why were leads removed from this import?", "How was this import distributed?", "Explain this screen"],
  partners: ["Who is my top partner this month?", "Which partner is slowest to make contact?", "Explain this screen"],
  partner_detail: ["How is this partner performing?", "What territory does this partner cover?", "Explain this screen"],
  coverage: ["Which states have no coverage?", "Who covers the most states?", "Explain this screen"],
  // C-45b landed the audit-trail tool (get_recent_activity), so this screen finally leads
  // with a NATIVE chip; the other two still ride list_imports / get_dashboard_stats.
  activity: ["What changed recently?", "What happened in the last import?", "How are my partners performing?", EXPLAIN_CHIP],
  rules: ["What makes a lead Hot?", "How does the MLS filter decide?", "Explain this screen"],
  settings: ["How do I connect an AI provider key?", "Explain this screen"],
  upload: ["What happens after I upload a file?", "What happened in the last import?", "Explain this screen"],
};

export function suggestionsFor(screen?: ScreenKey): string[] {
  return screen ? BY_SCREEN[screen] : GENERIC;
}

/** AIS-10 (C-45a): the bounded follow-up row shown under the LAST answer. PURE — the widget
 *  decides *whether* to show a row (idle, non-empty transcript), this decides *what* is in it.
 *  Same screen set as the empty state, minus anything already asked this session
 *  (case-insensitive, so a chip re-typed by hand still counts), capped at `max`.
 *  EXPLAIN_CHIP keeps the last slot when it survives the filter — it is the standing escape
 *  hatch, not a data question competing for room. Returns [] when nothing is left, which is
 *  the widget's signal to render no row at all (an empty row would be a bare heading). */
export function followUpSuggestions(screen: ScreenKey | undefined, asked: Iterable<string>, max = 3): string[] {
  const seen = new Set<string>();
  for (const a of asked) seen.add(a.trim().toLowerCase());
  const remaining = suggestionsFor(screen).filter((q) => !seen.has(q.toLowerCase()));
  if (!remaining.includes(EXPLAIN_CHIP)) return remaining.slice(0, max);
  return [...remaining.filter((q) => q !== EXPLAIN_CHIP).slice(0, max - 1), EXPLAIN_CHIP];
}
