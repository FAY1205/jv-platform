import { describe, expect, it } from "vitest";
import { waitingTone, WAITING_WARN_DAYS, WAITING_DANGER_DAYS } from "@/lib/waiting";

// WP-UX-6 (audit U-1): the WAITING value's urgency tone. Pure — `now` injected. The
// number always renders alongside the tone, so colour is never the only carrier (PRN-14).
describe("waitingTone (WP-UX-6)", () => {
  const NOW = Date.UTC(2026, 7, 16); // fixed clock
  const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

  it("UX6-01: neutral below the warn threshold", () => {
    expect(waitingTone(daysAgo(0), NOW)).toBe("");
    expect(waitingTone(daysAgo(WAITING_WARN_DAYS - 1), NOW)).toBe("");
  });

  it("UX6-02: warns from a week, alarms from a month", () => {
    expect(waitingTone(daysAgo(WAITING_WARN_DAYS), NOW)).toBe("warn");
    expect(waitingTone(daysAgo(WAITING_DANGER_DAYS - 1), NOW)).toBe("warn");
    expect(waitingTone(daysAgo(WAITING_DANGER_DAYS), NOW)).toBe("danger");
    expect(waitingTone(daysAgo(645), NOW)).toBe("danger");
  });

  it("UX6-03: a future receipt never goes negative", () => {
    expect(waitingTone(daysAgo(-5), NOW)).toBe("");
  });
});
