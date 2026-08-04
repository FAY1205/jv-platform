import { describe, it, expect } from "vitest";
import { evaluateSignupSurge } from "@/lib/auth/signup-surge";
import { SIGNUP_GLOBAL_CEILING, SIGNUP_SURGE_THRESHOLD } from "@/lib/auth/throttle";

// WP-SU-9: `observed` INCLUDES the request being judged — the route reserves its attempt before
// counting, which is what closes the ceiling's read-then-decide race. So `observed === LIMIT` is
// the LIMITth admission, not an overflow.
const verdict = (observed: number) => evaluateSignupSurge(observed, SIGNUP_GLOBAL_CEILING, SIGNUP_SURGE_THRESHOLD);
const LIMIT = SIGNUP_GLOBAL_CEILING.limit;

describe("AUT-03 (WP-SU-8): global signup surge verdict", () => {
  it("AUT-03: allows a normal request with no alert", () => {
    expect(verdict(0)).toEqual({ blocked: false, alert: null });
    expect(verdict(5)).toEqual({ blocked: false, alert: null });
    expect(verdict(SIGNUP_SURGE_THRESHOLD - 1)).toEqual({ blocked: false, alert: null });
  });

  it("AUT-03: raises the surge alert at the threshold WITHOUT refusing", () => {
    expect(verdict(SIGNUP_SURGE_THRESHOLD)).toEqual({
      blocked: false,
      alert: `signup surge: ${SIGNUP_SURGE_THRESHOLD} in the last hour (ceiling ${LIMIT})`,
    });
  });

  // The verdict reports a CONDITION, not an edge. This is the property that replaced an
  // equality check: the old `=== threshold` form went silent one request later, which meant a
  // pair of concurrent requests stepping over the exact value lost the alert entirely. Keeping
  // it true while volume is high moves the "send only once" duty to an explicit cooldown
  // (allowSignupAlert), where it can be enforced regardless of how the count moves.
  it("AUT-03: the alert PERSISTS above the threshold, and reports the live count", () => {
    expect(verdict(SIGNUP_SURGE_THRESHOLD + 1).alert).toBe(
      `signup surge: ${SIGNUP_SURGE_THRESHOLD + 1} in the last hour (ceiling ${LIMIT})`,
    );
    expect(verdict(LIMIT).alert).toContain("signup surge");
    expect(verdict(LIMIT).blocked).toBe(false);
  });

  it("AUT-03 (WP-SU-9): admits exactly the configured ceiling, not one fewer", () => {
    // The LIMITth request: with its own reservation counted, `observed` is LIMIT. Refusing here
    // would silently tighten the ceiling by one.
    expect(verdict(LIMIT).blocked).toBe(false);
  });

  it("AUT-03: blocks the request that would EXCEED the ceiling, and escalates the alert", () => {
    expect(verdict(LIMIT + 1)).toEqual({
      blocked: true,
      alert: `signup ceiling reached: ${LIMIT + 1} in the last hour (ceiling ${LIMIT}) — new signups are being refused`,
    });
  });

  // Regression pin. The original implementation returned `{blocked:true, alert:null}` above
  // the limit, on the theory that the alert had already fired exactly at it. It had not: a
  // refused request returns 429 before the route records an attempt, so the count FROZE at the
  // limit and the equality branch re-fired on every refused request instead (measured: 3
  // alerts for 3 refused requests). Above the ceiling the condition must still be reported.
  it("AUT-03: still reports the alert ABOVE the ceiling — silence there hid the flood bug", () => {
    const above = verdict(LIMIT + 9);
    expect(above.blocked).toBe(true);
    expect(above.alert).toBe(
      `signup ceiling reached: ${LIMIT + 9} in the last hour (ceiling ${LIMIT}) — new signups are being refused`,
    );
  });

  it("SEC-05 (WP-SU-8): the alert string carries no identifier, email or IP", () => {
    const alerts = [verdict(SIGNUP_SURGE_THRESHOLD).alert, verdict(LIMIT + 1).alert, verdict(LIMIT + 9).alert];
    for (const a of alerts) expect(a).not.toMatch(/@|\d+\.\d+\.\d+\.\d+/);
  });
});
