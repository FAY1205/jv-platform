import type { ScreenKey } from "./prompt";

// Contextual suggested questions (owner decision: chips change with the screen).
// PURE static map for V1; ai_memory-driven personalization is a deferred WP.

const GENERIC = ["How are my partners performing?", "Which states have no coverage?", "What happened in the last import?", "Explain this screen"];

const BY_SCREEN: Partial<Record<ScreenKey, string[]>> = {
  dashboard: GENERIC,
  leads: ["How many new leads this week?", "Which leads are still untouched?", "Explain this screen"],
  unmatched: ["Which states have no coverage?", "How many leads are waiting unmatched?", "Explain this screen"],
  imports: ["What happened in the last import?", "How many leads were removed by the MLS filter?", "Explain this screen"],
  import_detail: ["Why were leads removed from this import?", "How was this import distributed?", "Explain this screen"],
  partners: ["Who is my top partner this month?", "Which partner is slowest to make contact?", "Explain this screen"],
  partner_detail: ["How is this partner performing?", "What territory does this partner cover?", "Explain this screen"],
  coverage: ["Which states have no coverage?", "Who covers the most states?", "Explain this screen"],
  settings: ["What does the monthly AI allowance do?", "Explain this screen"],
};

export function suggestionsFor(screen?: ScreenKey): string[] {
  return (screen && BY_SCREEN[screen]) || GENERIC;
}
