import { describe, it, expect } from "vitest";
import { scrubString, scrubDetail } from "@/lib/scrub";

// SEC-05 / WP-SU-3: the pure redaction used at BOTH log sinks — the console line and
// Sentry's beforeSend. Kept dependency-free so instrumentation.ts can import it without
// pulling in the server-only observability module.
describe("SEC-05: scrubString patterns", () => {
  it("SEC-05: redacts email addresses", () => {
    expect(scrubString('duplicate key: "seller@example.com" rejected')).toBe(
      'duplicate key: "[redacted-email]" rejected',
    );
    expect(scrubString("a.b+c%d@sub.co.uk")).toBe("[redacted-email]");
  });

  it("SEC-05: redacts phone numbers in the shapes a CRM export actually carries", () => {
    // SEC-05 names seller phone explicitly, and Drizzle puts bound params in e.message.
    for (const phone of ["5551234567", "555-123-4567", "(555) 123-4567", "+1 555.123.4567"]) {
      expect(scrubString(`seller ${phone} called`)).toContain("[redacted-phone]");
      expect(scrubString(`seller ${phone} called`)).not.toContain("123");
    }
  });

  it("SEC-05: does NOT mistake ref-IDs, counts or years for phones", () => {
    const safe = "import IM-26-014 processed 4111 rows in 2026";
    expect(scrubString(safe)).toBe(safe);
  });

  it("SEC-05: ACCEPTED false positive — a bare 10-digit run is redacted even if it is an epoch", () => {
    // A bare 10-digit epoch (1752691200) is indistinguishable from a bare 10-digit phone
    // (5551234567), and a CRM export carries the latter. Deliberate trade: losing a
    // timestamp costs a little triage context; missing a seller phone is a SEC-05 leak.
    // Log timestamps as ISO strings (scrubDetail renders Date that way) to keep them.
    expect(scrubString("at 1752691200 ms")).toBe("at [redacted-phone] ms");
  });

  it("SEC-05: redacts long token-shaped runs (base64url secrets are 43 chars)", () => {
    expect(scrubString(`token ${"a".repeat(43)} expired`)).toBe("token [redacted-token] expired");
  });

  it("SEC-05: does NOT redact our own snake_case / SCREAMING_SNAKE / kebab identifiers", () => {
    // These are ≥24 chars and would collapse into one untriageable Sentry issue if the
    // token rule were purely length-based — including every cron alert code (ADR-0032).
    for (const id of [
      "cron_drain_tenant_failed",
      "signup_partial_provision_reconciled",
      "TURNSTILE_VERIFICATION_FAILED",
      "partner-hold-release-worker",
    ]) {
      expect(scrubString(id)).toBe(id);
    }
  });

  it("SEC-05: still redacts real high-entropy secrets (base64url and lowercase hex)", () => {
    const base64url = "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZg";
    const hex = "3f2a9b8c1d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8";
    expect(scrubString(base64url)).toBe("[redacted-token]");
    expect(scrubString(hex)).toBe("[redacted-token]");
  });

  it("SEC-05: a digit-leading secret is fully redacted — the phone rule must not eat its head", () => {
    // A 32-hex CSRF token starting with 10 digits previously became
    // "[redacted-phone]abcdef[redacted-phone]abcdef", disclosing 12 chars of the secret.
    expect(scrubString("1234567890abcdef1234567890abcdef")).toBe("[redacted-token]");
  });

  it("SEC-05: a mixed-case all-alpha token is NOT mistaken for one of our identifiers", () => {
    // ~1 in 2,160 real base64url tokens draw no digits; the exemption must key on
    // case-CONSISTENT words (our codes), not merely on word structure.
    expect(scrubString("AbCdEfGhIjKl-MnOpQrStUvWx_YzAbCdEfGhIjKlMno")).toBe("[redacted-token]");
  });

  it("SEC-05: redacts country-coded phones (E.164 is the likeliest CRM storage format)", () => {
    for (const p of ["15551234567", "+15551234567", "+1 555 123 4567"]) {
      expect(scrubString(`seller ${p}`)).toBe("seller [redacted-phone]");
    }
  });

  it("SEC-05: redacts a WRAPPED Drizzle error — one rethrow must not re-open the leak", () => {
    const wrapped = 'Error: Failed query: insert into "leads"\nparams: Jane Doe,12 Elm St';
    expect(scrubString(wrapped)).toBe("[redacted-query]");
  });

  it("SEC-05: a UUID-shaped PREFIX does not shield the tail of a longer opaque run", () => {
    const shielded = "12345678-1234-1234-1234-123456789012ABCDEFGHIJKLMNOP";
    expect(scrubString(shielded)).toBe("[redacted-token]");
  });

  it("SEC-05: the clamp does not cut mid-match and leave a partial address", () => {
    const out = scrubString(`${"x".repeat(1990)}seller@example.com`);
    expect(out).not.toContain("@exa");
    expect(out).not.toContain("seller");
  });

  it("SEC-05: preserves UUIDs — traceId/tenantId correlation is the point of the seam", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(scrubString(`tenant ${uuid} failed`)).toBe(`tenant ${uuid} failed`);
  });

  it("SEC-05: preserves an all-digit UUID (the phone pattern must not eat it)", () => {
    const uuid = "12345678-1234-1234-1234-123456789012";
    expect(scrubString(`tenant ${uuid}`)).toBe(`tenant ${uuid}`);
  });

  it("SEC-05: replaces a Drizzle query error wholesale — every bound param is seller PII", () => {
    // drizzle-orm errors.cjs: `Failed query: ${query}\nparams: ${params}` — for the batched
    // lead insert that is every seller name, phone, address and raw row.
    const drizzle = 'Failed query: insert into "leads" values ($1,$2)\nparams: Jane,Doe,12 Elm St';
    expect(scrubString(drizzle)).toBe("[redacted-query]");
  });

  it("SEC-05: clamps very long strings (the Drizzle message can reach megabytes)", () => {
    const out = scrubString("x".repeat(200_000));
    expect(out.length).toBeLessThan(3_000);
    expect(out).toContain("[clamped]");
  });

  it("SEC-05: is not quadratic — a 200KB string scrubs in well under a second (CWE-1333)", () => {
    const started = Date.now();
    scrubString("a".repeat(200_000));
    expect(Date.now() - started).toBeLessThan(200);
  });
});

describe("SEC-05: scrubDetail traversal", () => {
  it("SEC-05: scrubs nested values and array members", () => {
    expect(JSON.stringify(scrubDetail({ detail: { to: ["partner@real.test"] } }))).not.toContain(
      "partner@real.test",
    );
  });

  it("SEC-05: scrubs KEYS too — a payload keyed by an address would leak otherwise", () => {
    expect(Object.keys(scrubDetail({ "seller@example.com": 3 }))).toEqual(["[redacted-email]"]);
  });

  it("SEC-05: colliding scrubbed keys are disambiguated, never silently overwritten", () => {
    // Two addresses both scrub to [redacted-email]; the second must not delete the first.
    const out = scrubDetail({ "a@b.com": 1, "c@d.com": 2 });
    expect(Object.keys(out)).toHaveLength(2);
    expect(Object.values(out).sort()).toEqual([1, 2]);
  });

  it("SEC-05: key disambiguation stays linear — 5,000 colliding keys must not stall the request", () => {
    const many: Record<string, unknown> = {};
    for (let i = 0; i < 5_000; i++) many[`user${i}@example.com`] = i;
    const started = Date.now();
    const out = scrubDetail({ results: many });
    expect(Date.now() - started).toBeLessThan(1_000); // was 7.4s with an O(n²) probe
    expect(Object.keys((out.results ?? {}) as object)).toHaveLength(5_000);
  });

  it("SEC-05: a bigint is stringified — JSON.stringify would throw and drop the whole log line", () => {
    expect(scrubDetail({ n: BigInt(10) })).toEqual({ n: "10" });
    expect(() => JSON.stringify(scrubDetail({ n: BigInt(10) }))).not.toThrow();
  });

  it("SEC-05: renders Map, Set and binary instead of silently emptying them", () => {
    const out = scrubDetail({
      m: new Map([["seller@example.com", 1]]),
      s: new Set(["a@b.com"]),
      b: Buffer.from("hi"),
    });
    expect(JSON.stringify(out)).not.toContain("seller@example.com");
    expect(JSON.stringify(out)).not.toContain("a@b.com");
    expect(out.m).not.toEqual({}); // the old behaviour: silent data loss
    expect(String(out.b)).toContain("binary");
  });

  it("SEC-05: keeps ordinary diagnostics intact (no over-scrubbing)", () => {
    const detail = { uploadRef: "IM-26-014", count: 42, kind: "otp", ok: false };
    expect(scrubDetail(detail)).toEqual(detail);
  });

  it("SEC-05: renders Date and Error instead of silently emptying them", () => {
    const out = scrubDetail({ at: new Date("2026-07-17T10:00:00Z"), err: new Error("mail to a@b.test") });
    expect(out.at).toBe("2026-07-17T10:00:00.000Z");
    expect(out.err).toEqual({ name: "Error", message: "mail to [redacted-email]" });
  });

  it("SEC-05: scrubs numbers that are phone-shaped (SEC-05 names seller phone)", () => {
    expect(scrubDetail({ phone: 5551234567, count: 42 })).toEqual({ phone: "[redacted-phone]", count: 42 });
  });

  it("SEC-05: truncates past the depth cap rather than emitting an unvisited subtree", () => {
    expect(scrubDetail({ a: { b: { c: { leak: "seller@example.com" } } } })).toEqual({
      a: { b: { c: "[truncated]" } },
    });
  });

  it("SEC-05: a circular detail terminates without throwing", () => {
    const circular: Record<string, unknown> = { message: "boom" };
    circular.self = circular;
    expect(() => scrubDetail(circular)).not.toThrow();
  });

  it("SEC-05: fails CLOSED when traversal throws — marker, never the raw payload", () => {
    const poison: Record<string, unknown> = { safe: "keep-me" };
    Object.defineProperty(poison, "leak", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    expect(scrubDetail({ poison, email: "seller@example.com" })).toEqual({ scrub_failed: true });
  });

  it("SEC-05: a __proto__ key cannot reach Object.prototype", () => {
    const out = scrubDetail(JSON.parse('{"__proto__":{"leak":"a@b.com"}}'));
    expect(JSON.stringify(out)).not.toContain("a@b.com");
    expect(({} as Record<string, unknown>).leak).toBeUndefined(); // no pollution
  });
});
