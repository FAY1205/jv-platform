import { describe, it, expect } from "vitest";
import {
  CURSOR_MAX_LENGTH,
  decodeNotificationCursor,
  encodeNotificationCursor,
} from "@/modules/notify/feed-cursor";
import { timeAgo, absoluteTime } from "@/lib/notification-time";

// WP-NF2 PR C (NTF-12 / FEP-03): the pure halves of the notifications page — the opaque feed
// cursor and the row timestamp formatting. The keyset WALK itself is proved against a live
// database in tests/integration/notification-feed-pagination.test.ts; this file pins the codec's
// contract, which is what turns a tampered token into a 400 instead of a silent restart at page
// one.

const ID = "11111111-1111-4111-8111-111111111111";
const AT = "2026-08-19T09:30:00.123456Z";

describe("NTF-12: the notification feed cursor codec", () => {
  it("NTF-12: round-trips the timestamp and the id tie-break leg", () => {
    const token = encodeNotificationCursor({ createdAt: AT, id: ID });
    expect(token).not.toContain("|"); // opaque: no raw payload on the wire
    expect(decodeNotificationCursor(token)).toEqual({ createdAt: AT, id: ID });
  });

  it("NTF-12: preserves MICROSECOND precision — a millisecond cursor would skip a tie group", () => {
    // A fan-out inserts every recipient's row in ONE transaction, so `now()` is identical
    // across the batch down to the microsecond. Truncating to a JS Date's milliseconds makes
    // the keyset predicate test GREATER for the whole tie group, and page two loses it.
    const decoded = decodeNotificationCursor(encodeNotificationCursor({ createdAt: AT, id: ID }));
    expect(decoded?.createdAt).toBe(AT);
    expect(decoded?.createdAt).not.toBe(new Date(AT).toISOString()); // …which is only ms
  });

  it("NTF-12: still accepts a millisecond-precision instant (3 fractional digits)", () => {
    const at = "2026-08-19T09:30:00.123Z";
    expect(decodeNotificationCursor(encodeNotificationCursor({ createdAt: at, id: ID }))?.createdAt).toBe(at);
  });

  it("NTF-12: malformed cursors decode to null, never to a silent page one", () => {
    const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
    expect(decodeNotificationCursor("")).toBeNull();
    expect(decodeNotificationCursor("not-base64-at-all!!!")).toBeNull();
    expect(decodeNotificationCursor(b64("no-separator"))).toBeNull();
    expect(decodeNotificationCursor(b64(`|${ID}`))).toBeNull(); // empty timestamp half
    expect(decodeNotificationCursor(b64(`${AT}|not-a-uuid`))).toBeNull();
    expect(decodeNotificationCursor(b64(`${AT}|`))).toBeNull();
    // A non-canonical instant: local-time or offset forms are never emitted by the feed, so
    // accepting them would mean silently reinterpreting somebody's hand-built token.
    expect(decodeNotificationCursor(b64(`2026-08-19T09:30:00+02:00|${ID}`))).toBeNull();
    expect(decodeNotificationCursor(b64(`2026-08-19T09:30:00Z|${ID}`))).toBeNull(); // no fraction
    expect(decodeNotificationCursor(b64(`not-a-date.000Z|${ID}`))).toBeNull();
    // A calendar-impossible instant that still matches the shape.
    expect(decodeNotificationCursor(b64(`2026-13-45T09:30:00.000Z|${ID}`))).toBeNull();
  });

  it("NTF-12: refuses an oversized token rather than decoding megabytes of attacker input", () => {
    expect(decodeNotificationCursor("A".repeat(CURSOR_MAX_LENGTH + 1))).toBeNull();
  });

  it("NTF-12: a tampered id half is refused (the token is not a place to smuggle a filter)", () => {
    const token = encodeNotificationCursor({ createdAt: AT, id: ID });
    const tampered = Buffer.from(`${AT}|${ID}' or true--`, "utf8").toString("base64url");
    expect(decodeNotificationCursor(token)).not.toBeNull();
    expect(decodeNotificationCursor(tampered)).toBeNull();
  });
});

describe("NTF-12: notification row timestamps", () => {
  const base = Date.parse("2026-08-19T12:00:00.000Z");
  const ago = (ms: number) => timeAgo(new Date(base - ms).toISOString(), base);

  it("NTF-12: timeAgo is PURE over the passed-in now (no hidden Date.now)", () => {
    expect(ago(5_000)).toBe("just now");
    expect(ago(12 * 60_000)).toBe("12m ago");
    expect(ago(3 * 3_600_000)).toBe("3h ago");
    expect(ago(5 * 86_400_000)).toBe("5d ago");
    // A clock that has drifted behind the row clamps to "just now" rather than "-1m ago".
    expect(timeAgo(new Date(base + 60_000).toISOString(), base)).toBe("just now");
  });

  it("NTF-12: absoluteTime renders the instant, and passes an unparseable value through", () => {
    const iso = "2026-08-19T09:30:00.000Z";
    expect(absoluteTime(iso)).toBe(new Date(iso).toLocaleString());
    expect(absoluteTime(iso)).not.toBe(iso); // an actual rendering, not the raw ISO
    expect(absoluteTime("garbage")).toBe("garbage"); // never the string "Invalid Date"
  });
});
