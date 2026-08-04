import { describe, expect, it } from "vitest";
import { gateStateFromCode } from "@/modules/ai/gate-error";

describe("WP-AI-2 gateStateFromCode", () => {
  it("AIA-06: maps budget/rate/disabled envelope codes", () => {
    expect(gateStateFromCode("ai_budget_reached")).toBe("budget");
    expect(gateStateFromCode("ai_rate_limited")).toBe("rate");
    expect(gateStateFromCode("ai_disabled")).toBe("disabled");
  });
  it("returns null for unrelated / missing codes", () => {
    expect(gateStateFromCode("ai_chat_failed")).toBeNull();
    expect(gateStateFromCode("csrf_rejected")).toBeNull();
    expect(gateStateFromCode(undefined)).toBeNull();
    expect(gateStateFromCode(null)).toBeNull();
  });
});
