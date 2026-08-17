import { describe, it, expect } from "vitest";
import {
  RETENTION_GRACE_DAYS,
  RETENTION_GRACE_MS,
  retentionCutoff,
  isPastRetention,
  redactionPatch,
  REDACTED_RAW_JSON,
  REDACTED_DEDUPE_KEY,
} from "@/modules/retention/purge";

// WP-GL-B / DM-09 / LGL-02: a voided lead's seller PII is redacted. The default grace window is
// 0 — purge is immediate on void (owner decision 2026-07-13). Pure — `now`/`graceMs` are injected,
// so the policy is deterministic and the (still-supported) custom-grace behavior stays testable.
describe("retention purge (DM-09 / LGL-02)", () => {
  const deletedAt = new Date("2026-06-01T00:00:00.000Z");
  const DAY = 24 * 60 * 60 * 1000;
  const after = (ms: number) => new Date(deletedAt.getTime() + ms);

  it("DM-09: the default grace window is 0 (purge immediately on void)", () => {
    expect(RETENTION_GRACE_DAYS).toBe(0);
    expect(RETENTION_GRACE_MS).toBe(0);
  });

  it("LGL-02: a live lead (deletedAt null) is never eligible for purge", () => {
    expect(isPastRetention(null, after(999 * DAY))).toBe(false);
  });

  it("DM-09: with the default (immediate) grace, any soft-deleted lead is eligible at once", () => {
    expect(isPastRetention(deletedAt, deletedAt)).toBe(true); // deleted this instant ⇒ eligible
    expect(isPastRetention(deletedAt, after(1))).toBe(true);
  });

  it("DM-09: a custom grace window is respected — within it not eligible, at/past it eligible", () => {
    const week = 7 * DAY;
    expect(isPastRetention(deletedAt, after(0), week)).toBe(false);
    expect(isPastRetention(deletedAt, after(week - 1), week)).toBe(false);
    expect(isPastRetention(deletedAt, after(week), week)).toBe(true); // boundary inclusive
    expect(isPastRetention(deletedAt, after(week + 1), week)).toBe(true);
  });

  it("DM-09: retentionCutoff is now minus the grace window (= now for the default 0 grace)", () => {
    const now = new Date("2026-07-13T00:00:00.000Z");
    expect(retentionCutoff(now).getTime()).toBe(now.getTime());
    expect(retentionCutoff(now, 1000).getTime()).toBe(now.getTime() - 1000);
  });

  it("SEC-05: redactionPatch nulls seller PII + street address, and sentinels raw_json + dedupe_key", () => {
    const patch = redactionPatch();
    for (const k of [
      "sellerFirst",
      "sellerLast",
      "phone",
      "phoneNorm",
      "email",
      "reasonForSelling",
      "motivation",
      "timeToSell",
      "notes",
      "address",
      "addressNormalized",
      // C-40 / WP-RET-4: mlsMatchSpan.text is a verbatim fragment of `notes` — nulled too.
      "mlsMatchSpan",
    ] as const) {
      expect(patch[k]).toBeNull();
    }
    // NOT NULL columns get sentinels instead of null
    expect(patch.rawJson).toEqual(REDACTED_RAW_JSON);
    expect(patch.rawJson).toEqual({ _redacted: true });
    expect(patch.dedupeKey).toBe(REDACTED_DEDUPE_KEY);
  });

  it("SEC-05: redactionPatch keeps coarse location and decision/identity columns", () => {
    const patch = redactionPatch() as unknown as Record<string, unknown>;
    // coarse geography kept (a ZIP/state is not personally identifying on its own)
    for (const kept of ["city", "state", "zip"]) {
      expect(kept in patch).toBe(false);
    }
    // decision / identity columns kept (audit trail DM-04, ref-id DM-07, history)
    for (const kept of ["refId", "partnerId", "mlsStatus", "matchMethod", "deletedAt"]) {
      expect(kept in patch).toBe(false);
    }
  });
});
