// Map a chat-route error envelope `code` (src/lib/http.ts { code,message,traceId })
// to the widget's blocking state. Only these three disable the composer; every other
// error is a transient failure surfaced via useChat.error, not a persistent block.
export type AssistantGate = "budget" | "rate" | "disabled";

export function gateStateFromCode(code: string | undefined | null): AssistantGate | null {
  switch (code) {
    case "ai_budget_reached": return "budget";
    case "ai_rate_limited": return "rate";
    case "ai_disabled": return "disabled";
    default: return null;
  }
}
