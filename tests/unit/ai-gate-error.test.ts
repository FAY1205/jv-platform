import { describe, expect, it } from "vitest";
import { gateStateFromCode } from "@/modules/ai/gate-error";

describe("WP-AI-2 gateStateFromCode", () => {
  it("AIS-08: ai_disabled splits on the HTTP status — 503 is no key, 403 is switched off", () => {
    expect(gateStateFromCode("ai_disabled", 503)).toBe("no_key");
    expect(gateStateFromCode("ai_disabled", 403)).toBe("disabled");
  });
  it("AIA-06: maps the rate envelope code", () => {
    expect(gateStateFromCode("ai_rate_limited", 429)).toBe("rate");
  });
  it("AIS-08: the removed monthly cap (ADR-0036) no longer maps to a gate", () => {
    expect(gateStateFromCode("ai_budget_reached", 402)).toBeNull();
    expect(gateStateFromCode("ai_budget_reached")).toBeNull();
  });
  it("AIS-08: an ai_disabled with no/unknown status still blocks (defaults to switched off)", () => {
    expect(gateStateFromCode("ai_disabled")).toBe("disabled");
    expect(gateStateFromCode("ai_disabled", 500)).toBe("disabled");
  });
  it("returns null for unrelated / missing codes", () => {
    expect(gateStateFromCode("ai_chat_failed", 500)).toBeNull();
    expect(gateStateFromCode("csrf_rejected", 403)).toBeNull();
    expect(gateStateFromCode(undefined)).toBeNull();
    expect(gateStateFromCode(null)).toBeNull();
  });
});
