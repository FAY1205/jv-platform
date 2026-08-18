import type { ScreenKey } from "./prompt";

// Contextual suggested questions (owner decision: chips change with the screen).
// PURE static map for V1; ai_memory-driven personalization is a deferred WP.

const GENERIC = ["How are my partners performing?", "Which states have no coverage?", "What happened in the last import?", "Explain this screen"];

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
  // No audit-trail chip until an activity tool exists (WP-AI-TOOL-ACTIVITY); both of these
  // ride list_imports / get_dashboard_stats.
  activity: ["What happened in the last import?", "How are my partners performing?", "Explain this screen"],
  rules: ["What makes a lead Hot?", "How does the MLS filter decide?", "Explain this screen"],
  settings: ["How do I connect an AI provider key?", "Explain this screen"],
  upload: ["What happens after I upload a file?", "What happened in the last import?", "Explain this screen"],
};

export function suggestionsFor(screen?: ScreenKey): string[] {
  return screen ? BY_SCREEN[screen] : GENERIC;
}
