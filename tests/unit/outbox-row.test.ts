import { describe, expect, it } from "vitest";
import { rowToEmailMessage, backoffMs, jitteredBackoffMs, BACKOFF_JITTER, MAX_OUTBOX_ATTEMPTS } from "@/modules/notify/outbox";

describe("rowToEmailMessage (NTF-03 drain mapping)", () => {
  const base = { toAddress: "p@x.test", subject: "S", body: "text body", kind: "partner_digest" };
  it("includes html when the row has it (multipart)", () => {
    const m = rowToEmailMessage({ ...base, html: "<p>hi</p>" });
    expect(m).toMatchObject({ to: "p@x.test", subject: "S", text: "text body", html: "<p>hi</p>", meta: { kind: "partner_digest" } });
  });
  it("omits html when null (text-only, backward-compatible)", () => {
    expect(rowToEmailMessage({ ...base, html: null }).html).toBeUndefined();
  });
});

// WP-NF1 D7 (NTF-03): retry jitter. Without it, every row that failed in the same drain tick
// comes due in the same millisecond forever — a provider outage turns into a self-inflicted
// thundering herd on recovery. `backoffMs` stays PURE and separately pinned; the randomness is
// injected, so the scheduled instant is assertable rather than merely plausible.
describe("jitteredBackoffMs (NTF-03 retry spread)", () => {
  it("NTF-03: backoffMs itself stays pure and deterministic (jitter never leaked into it)", () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(2)).toBe(120_000);
    expect(backoffMs(3)).toBe(240_000);
    expect(backoffMs(1)).toBe(backoffMs(1)); // same input ⇒ same output, twice
    expect(backoffMs(99)).toBe(6 * 60 * 60_000); // capped
  });

  it("NTF-03: the band is exactly ±25% of the base delay, at both extremes", () => {
    for (const attempts of [1, 2, 3, MAX_OUTBOX_ATTEMPTS]) {
      const base = backoffMs(attempts);
      expect(jitteredBackoffMs(attempts, () => 0)).toBe(Math.round(base * (1 - BACKOFF_JITTER)));
      // Math.random() is [0,1); 1 is the open end, i.e. the supremum of the band.
      expect(jitteredBackoffMs(attempts, () => 1)).toBe(Math.round(base * (1 + BACKOFF_JITTER)));
      expect(jitteredBackoffMs(attempts, () => 0.5)).toBe(base); // the midpoint is the un-jittered delay
    }
  });

  it("NTF-03: every draw across the whole [0,1) range stays inside the band", () => {
    const base = backoffMs(2);
    for (let i = 0; i < 1000; i++) {
      const ms = jitteredBackoffMs(2, () => i / 1000);
      expect(ms).toBeGreaterThanOrEqual(Math.round(base * 0.75));
      expect(ms).toBeLessThanOrEqual(Math.round(base * 1.25));
    }
  });

  it("NTF-03: distinct draws spread — two rows failing in one tick don't land on one instant", () => {
    const draws = [0.1, 0.4, 0.9].map((r) => jitteredBackoffMs(3, () => r));
    expect(new Set(draws).size).toBe(3);
  });
});
