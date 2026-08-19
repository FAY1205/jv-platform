// ─────────────────────────────────────────────────────────────────────────────
// FEP-03 / NTF-12 — the opaque keyset cursor for the notification feed.
//
// PURE (no DB, no clock): a codec over `"{createdAt}|{id}"`, base64url-wrapped so the
// value reads as an opaque token at the API boundary and nobody is tempted to build one
// by hand or to page by offset.
//
// Two decisions the tests pin:
//
//  • The cursor carries the row ID as well as the timestamp. `created_at` is NOT unique —
//    a fan-out inserts every recipient's row inside ONE transaction, so `now()` is byte-
//    identical across the whole batch. A timestamp-only cursor either skips the rest of a
//    tie group (gap) or replays it (duplicate). The ID is the tie-break leg (C-97).
//
//  • The timestamp is carried at MICROSECOND precision, not as a JS `Date.toISOString()`
//    (milliseconds). Postgres stores `timestamptz` to the microsecond, and postgres-js
//    hands back a JS Date that has already truncated it. Re-encoding that truncated value
//    into a `(created_at, id) < (…)` predicate compares `…123` against a stored `…123456`
//    and every row in the tie group tests GREATER — i.e. the whole group vanishes from
//    page two. So the query selects the full-precision text alongside the row and the
//    cursor round-trips THAT, while the API's own `createdAt` field stays the millisecond
//    ISO the bell has always rendered.
// ─────────────────────────────────────────────────────────────────────────────

export interface NotificationCursor {
  /** UTC ISO-8601 instant with 3–6 fractional digits, as emitted by the feed query. */
  createdAt: string;
  /** The uuid of the last row on the page just served. */
  id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Canonical UTC ISO only — the exact shape the feed query emits. Anything else is a
 *  hand-rolled or tampered cursor and is refused rather than coerced. */
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/;

/** Longest cursor we will even attempt to decode (a canonical one is ~60 chars). */
export const CURSOR_MAX_LENGTH = 256;

export function encodeNotificationCursor(cursor: NotificationCursor): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`, "utf8").toString("base64url");
}

/**
 * Decode an opaque cursor, or `null` when it is malformed — the caller turns that into a
 * 400 `invalid_input` rather than silently serving page one, which would look to a client
 * like "the feed ended and then restarted".
 */
export function decodeNotificationCursor(raw: string): NotificationCursor | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > CURSOR_MAX_LENGTH) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return null;
  }
  // Split on the FIRST separator: the timestamp half can never contain one, and a uuid
  // cannot either, so a second `|` means the payload is not ours.
  const sep = decoded.indexOf("|");
  if (sep <= 0) return null;
  const createdAt = decoded.slice(0, sep);
  const id = decoded.slice(sep + 1);
  if (!ISO_UTC_RE.test(createdAt)) return null;
  // SHAPE and RANGE. The regex alone admits instants JS parses happily but Postgres'
  // `::timestamptz` cast can refuse outright — `0000-01-01T00:00:00.000Z` is the reachable one
  // (year zero does not exist in the proleptic Gregorian calendar Postgres speaks). Letting one
  // through turns a hostile query parameter into a database error, i.e. a 500 and a Sentry page
  // for what is plainly a 400. The floor is the epoch: a notification predating 1970 is not a
  // thing this app can have written.
  const at = new Date(createdAt).getTime();
  if (Number.isNaN(at) || at < 0) return null;
  if (!UUID_RE.test(id)) return null;
  return { createdAt, id };
}
