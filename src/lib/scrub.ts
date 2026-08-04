// ─────────────────────────────────────────────────────────────────────────────
// SEC-05 redaction (WP-SU-3). Pure and dependency-free ON PURPOSE: it is applied at
// BOTH log sinks — the console line in `observability.ts` and Sentry's `beforeSend` in
// `instrumentation.ts` — and the latter must not import the server-only observability
// module. No I/O, no env, no SDK.
//
// Why this exists at all: 29 of the 40 `logError` call sites pass `{ message: e.message }`,
// a string this codebase does NOT author. Drizzle wraps every failed query as
// `Failed query: <sql>\nparams: <every bound parameter>` — for the batched lead insert
// that is every seller name, phone, address and raw row — and providers echo recipient
// addresses. Caller discipline cannot fix that; only redaction at the sink can.
// ─────────────────────────────────────────────────────────────────────────────

// A Drizzle query error carries the full parameter list. Nothing in it is safe to keep,
// and the SQL alone is not worth the risk of a partial scrub, so the whole string goes.
const DRIZZLE_QUERY_ERROR = "Failed query:";

// Hard clamp BEFORE any regex runs. The Drizzle message above can reach megabytes (the
// upload cap is 50,000 rows), and an unbounded scan of that on the request path is a DoS
// (CWE-1333). A Sentry `extra` string longer than this is useless for triage anyway.
const MAX_SCRUB_STRING = 2_000;

// Alternation order is load-bearing: UUID is tried FIRST at each position and returned
// unchanged, so no later pattern can consume a traceId / tenantId / userId — including an
// all-digit UUID, which would otherwise look like a phone number.
// Every quantifier is bounded: an unbounded `[class]+` before a required literal backtracks
// once per start position, which measured 1.7s on a 50KB string and 78s on 200KB.
const SCRUB_RE = new RegExp(
  [
    // Boundaried: the exemption is for a STANDALONE correlation id. Unanchored, a
    // UUID-shaped prefix would shield the tail of a longer opaque run from the token rule.
    "(?<uuid>(?<![A-Za-z0-9_-])[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?![A-Za-z0-9_-]))",
    "(?<email>[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\\.[A-Za-z0-9-]{1,63}){0,8}\\.[A-Za-z]{2,24})",
    // NANP, optionally country-coded. The separator after `1` is OPTIONAL so bare E.164
    // (15551234567 / +15551234567) is caught — the likeliest CRM storage format, and one
    // an 11-digit run would otherwise slip past the token threshold with. The digit
    // boundaries stop it eating row counts and year runs.
    // Token BEFORE phone, deliberately: at a run that opens with 10+ digits the phone
    // branch would win and consume only those 10 characters, leaving the tail of the
    // secret in clear — a 32-hex CSRF token became "[redacted-phone]abcdef[redacted-phone]abcdef".
    // Secrets we mint are 43-char base64url (randomBytes(32)) or 32-64 hex.
    "(?<token>[A-Za-z0-9_-]{24,})",
    "(?<phone>(?<!\\d)(?:\\+?1[\\s.-]?)?\\(?\\d{3}\\)?[\\s.-]?\\d{3}[\\s.-]?\\d{4}(?!\\d))",
  ].join("|"),
  "g",
);

// A long run is NOT a secret when it is a structured identifier: alphabetic words joined
// by _ or -. Length alone matched 17 of this repo's own `logError` codes, which would have
// collapsed every cron and signup alert into one untriageable Sentry issue (ADR-0032).
// Real secrets carry digits mixed into the run and never take this shape.
// Case-CONSISTENT words only. Our codes are snake_case or SCREAMING_SNAKE. The mixed-case
// form of this rule exempted 1 in ~2,160 real 43-char base64url tokens (a token that
// happens to draw no digits is still mixed-case), and a reset token is an
// account-takeover credential — so the looser shape was a measurable hole, not a theory.
const IDENTIFIER_RE = /^(?:[a-z]+(?:[_-][a-z]+)+|[A-Z]+(?:[_-][A-Z]+)+)$/;

const MARKERS: Record<string, string> = {
  email: "[redacted-email]",
  phone: "[redacted-phone]",
  token: "[redacted-token]",
};

/** Redact secrets and consumer PII from a single string. Pure; never throws. */
export function scrubString(value: string): string {
  // `includes`, not `startsWith`: one wrap layer — "Error: Failed query: …", or a caller's
  // own `new Error(\`import failed: ${e.message}\`)`, a pattern this repo already uses —
  // would otherwise fall through to the pattern scrub, which leaves the seller's name and
  // street address intact. Checked BEFORE the clamp so a megabyte message is never scanned.
  if (value.includes(DRIZZLE_QUERY_ERROR)) return "[redacted-query]";
  let clamped = value;
  if (value.length > MAX_SCRUB_STRING) {
    // Back off any trailing partial word: cutting mid-match would emit a fragment of the
    // very address/token the next pass would have redacted.
    clamped = `${value.slice(0, MAX_SCRUB_STRING).replace(/[A-Za-z0-9._%+@-]+$/, "")}…[clamped]`;
  }
  return clamped.replace(SCRUB_RE, (match, ...args) => {
    const groups = args[args.length - 1] as Record<string, string | undefined>;
    if (groups.uuid) return match; // correlation ids survive by design
    if (groups.token && IDENTIFIER_RE.test(groups.token)) return match; // our own codes
    for (const [name, marker] of Object.entries(MARKERS)) if (groups[name]) return marker;
    return match;
  });
}

// Sentry normalizes object depth to 3 by default, so matching it keeps the two in step and
// bounds the traversal's fan-out.
const MAX_SCRUB_DEPTH = 3;

function scrubValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") return scrubString(value); // strings scrub at ANY depth
  // A phone number is precisely a 10-digit NUMBER, and SEC-05 names seller phone.
  if (typeof value === "number" || typeof value === "bigint") {
    const asText = String(value);
    const scrubbed = scrubString(asText);
    // A bigint must not pass through: JSON.stringify throws on it, which would silently
    // drop the WHOLE console line (logError's catch swallows the failure).
    if (scrubbed === asText) return typeof value === "bigint" ? asText : value;
    return scrubbed;
  }
  if (value === null || typeof value !== "object") return value;
  // Object.entries() returns [] for these, which would silently empty them — data loss
  // that also makes an unscrubbable payload look clean.
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, message: scrubString(value.message) };
  if (value instanceof Map) return scrubValue(Object.fromEntries(value), depth);
  if (value instanceof Set) return scrubValue([...value], depth);
  // A Buffer/TypedArray would otherwise fan out to one numbered key per byte.
  if (ArrayBuffer.isView(value)) return `[binary ${value.byteLength}b]`;
  // Past the cap we stop descending — so return a marker, NOT the raw object: handing back
  // an unvisited subtree would ship exactly the strings this function exists to redact.
  if (depth >= MAX_SCRUB_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1));
  // Null-prototype: a `__proto__` own key would otherwise hit the Object.prototype setter
  // instead of becoming a property (CWE-1321 adjacent).
  const out = Object.create(null) as Record<string, unknown>;
  // Keys are scrubbed too — a per-recipient result map would key by the address itself.
  // Per-key counter rather than re-probing `unique in out`, which is O(n²) — measured 7.4s
  // at 5,000 identical scrubbed keys, the same CWE-1333 class the clamp above prevents.
  const seen = new Map<string, number>();
  for (const [key, val] of Object.entries(value)) {
    // Redaction must never REDUCE the payload: N recipients all scrub to the same marker,
    // and a plain assignment would silently drop every entry but the last.
    const safeKey = scrubString(key);
    const n = (seen.get(safeKey) ?? 0) + 1;
    seen.set(safeKey, n);
    out[n === 1 ? safeKey : `${safeKey}#${n}`] = scrubValue(val, depth + 1);
  }
  return { ...out };
}

/**
 * Redact a log/event payload. Fails CLOSED: if traversal throws (a throwing getter, a
 * revoked Proxy) the entire payload is replaced with a marker rather than risking a
 * partially-scrubbed object. Never throws.
 */
export function scrubDetail(detail: Record<string, unknown>): Record<string, unknown> {
  try {
    return scrubValue(detail, 0) as Record<string, unknown>;
  } catch {
    return { scrub_failed: true };
  }
}
