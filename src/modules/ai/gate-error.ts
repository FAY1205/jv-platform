// Map a chat-route error envelope `code` (src/lib/http.ts { code,message,traceId })
// to the widget's blocking state. Only these disable the composer; every other error is
// a transient failure surfaced via useChat.error, not a persistent block.
//
// `ai_disabled` carries TWO server truths (chat.ts:41-43 vs 50-52), separable only by the
// HTTP status, so the status is part of the mapping:
//   503 = no provider credential stored yet (first-run: nothing was ever switched off)
//   403 = the assistant switch is off in Settings
// `ai_budget_reached` is gone: the monthly spend cap was removed (ADR-0036) and nothing
// server-side emits it, so it maps to null like any other unrelated code.
export type AssistantGate = "no_key" | "disabled" | "rate";

export function gateStateFromCode(code: string | undefined | null, status?: number): AssistantGate | null {
  switch (code) {
    case "ai_disabled": return status === 503 ? "no_key" : "disabled";
    case "ai_rate_limited": return "rate";
    default: return null;
  }
}
