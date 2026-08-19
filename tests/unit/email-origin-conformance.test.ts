import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { walkSrc } from "../helpers/walk-src";

// ─────────────────────────────────────────────────────────────────────────────
// C-101 (CWE-644, audit-security F-3): a link that LEAVES the system in an email is built from
// `env.APP_URL` — the canonical, production-guarded origin — never from the request that
// triggered the send.
//
// Why a conformance test and not just the seven fixes: the Host header is attacker-controlled
// input, and `new URL(request.url).origin` reads as innocuous local plumbing, so the class
// regrows every time someone adds a route that emails a link. It regrew four times before this
// (reset/request, signup, signup/resend, uploads) plus three invite routes. The email is not a
// response the forger receives, so no same-request check (CSRF, Origin allowlist) defends it:
// a forged Host mails the VICTIM a link — carrying their reset token, verification token, or a
// one-time team-seat token — pointed at the attacker's origin.
//
// The assertion: no route file under src/app/api that calls an email-building function may also
// contain a request-derived-origin expression. That is deliberately a whole-file rule rather than
// dataflow — it is a tripwire, not a taint analysis, and it is the simplest honest rule that
// fires on all seven historical sites. A route that legitimately needs a request origin for its
// own HTTP RESPONSE (a redirect, a JSON body the caller consumes) and also sends mail is a real
// possibility; it belongs in the allowlist below with a reason saying which is which.
// ─────────────────────────────────────────────────────────────────────────────

const API = join(__dirname, "..", "..", "src", "app", "api");

/** Anything that hands text to the mail path. Prefix-matched so a new `notifyX` is covered
 *  the day it is written, not the day someone remembers to update this list. */
const EMAIL_BUILDER = /\b(notify[A-Z]\w*|enqueueEmail|enqueueRunDigests|sendEmail|buildPartner\w*|buildAdmin\w*)\s*\(/;

/** The two shapes a request-derived origin takes here: the URL of the incoming request, and the
 *  headers that URL is reconstructed from behind a proxy. Both are caller-controlled. */
const REQUEST_ORIGIN: readonly RegExp[] = [
  /new\s+URL\(\s*[A-Za-z_$][\w$]*\.url\s*\)\s*\.origin/,
  /\.get\(\s*["'`](?:host|x-forwarded-host|x-forwarded-proto)["'`]\s*\)/i,
];

const derivesRequestOrigin = (text: string) => REQUEST_ORIGIN.some((re) => re.test(text));

/**
 * Routes that send email AND legitimately derive an origin from the request — for a
 * same-request HTTP response only, never for the emailed link. Each entry states which use is
 * which, because the whole point of an entry here is that a reader can tell the safe use from
 * the dangerous one without re-deriving the analysis.
 *
 * Empty today: after C-101 no API route derives a request origin at all. An entry is a REVIEWED
 * act — adding one to make a red test green, without the response-only rationale actually
 * holding, re-opens the vulnerability this file exists to close.
 */
const RESPONSE_ONLY_ORIGIN = new Map<string, string>(
  ([] as readonly (readonly [string, string])[]).map(([p, reason]) => [p.split("/").join(sep), reason]),
);

function apiRouteFiles(): { rel: string; text: string }[] {
  return walkSrc(API)
    .filter((f) => f.endsWith(`${sep}route.ts`))
    .map((f) => ({ rel: relative(API, f), text: readFileSync(f, "utf8") }));
}

describe("C-101: emailed links are built from env.APP_URL, never the request Host", () => {
  it("C-101: no email-sending API route derives an origin from the request", () => {
    const emailRoutes = apiRouteFiles().filter((f) => EMAIL_BUILDER.test(f.text));
    const offenders = emailRoutes
      .filter((f) => derivesRequestOrigin(f.text) && !RESPONSE_ONLY_ORIGIN.has(f.rel))
      .map((f) => f.rel);

    expect(
      offenders,
      "Route sends email AND derives an origin from the request (CWE-644). Build the emailed link " +
        "from env.APP_URL; if the origin is genuinely for this request's own response, add a " +
        `reasoned RESPONSE_ONLY_ORIGIN entry:\n${offenders.join("\n")}`,
    ).toEqual([]);

    // Non-vacuous: the walk must actually be finding email-sending routes. Were EMAIL_BUILDER to
    // stop matching (a rename, a new indirection), the check above would pass over an empty set.
    expect(emailRoutes.length).toBeGreaterThan(12);
  });

  it("C-101: the detector still fires on the exact expressions this fix removed", () => {
    // The guard is only as good as its patterns, and a pattern that matches nothing fails silently
    // forever. These are the literal lines that shipped the vulnerability — verbatim from the
    // pre-fix routes — so a regex edit that stops catching them turns this test red, not quiet.
    const historical = [
      'const origin = new URL(request.url).origin;', // auth/reset/request, auth/signup, auth/signup/resend
      'const origin = new URL(req.url).origin;', // uploads
      'const origin = new URL(request.url).origin;\n  await notifyInvite(partner.email, `${origin}/portal/login`);', // partners invite
      'const proto = request.headers.get("x-forwarded-proto");', // the proxy-reconstruction shape
      'const host = headers().get("host");', // the raw Host shape
    ];
    for (const line of historical) {
      expect(derivesRequestOrigin(line), `detector no longer flags: ${line}`).toBe(true);
    }

    // And it must not fire on origins that have nothing to do with the request — otherwise the
    // rule gets defanged the first time it cries wolf.
    const innocent = [
      'const origin = new URL(supabaseUrl).origin;', // security-headers.ts: a configured URL
      'if (!isAllowedOrigin(c.origin, c.allowedOrigins)) return false;', // csrf.ts: the header value
      'd.assignment.original', // an unrelated field named "original"
      'const link = `${env.APP_URL}/reset?token=${token}`;', // the fix itself
    ];
    for (const line of innocent) {
      expect(derivesRequestOrigin(line), `detector false-positives on: ${line}`).toBe(false);
    }
  });

  it("C-101: every response-only allowance names a real email-sending route and states a reason", () => {
    const emailRoutes = new Set(apiRouteFiles().filter((f) => EMAIL_BUILDER.test(f.text)).map((f) => f.rel));
    const stale = [...RESPONSE_ONLY_ORIGIN.keys()].filter((rel) => !emailRoutes.has(rel));
    expect(stale, "Allowances no longer matching an email-sending route — prune them").toEqual([]);
    for (const [rel, reason] of RESPONSE_ONLY_ORIGIN) {
      expect(reason.length, `${rel} needs a real reason string`).toBeGreaterThan(30);
    }
  });

  it("C-101: the digest/reminder entrypoints pass env.APP_URL as the link base", () => {
    // The uploads route's links reach email one hop away (route → runUpload → enqueueRunDigests),
    // so the whole-file rule above would not see a base URL smuggled through that hop. These are
    // the only two producers of a `*BaseUrl` argument; both must name env.APP_URL, which also
    // keeps upload-time digests identical to the release cron's.
    const sources = ["src/modules/run/run-upload.ts", "src/app/api/cron/drain-outbox/route.ts"];
    for (const rel of sources) {
      const text = readFileSync(join(__dirname, "..", "..", ...rel.split("/")), "utf8");
      const bases = [...text.matchAll(/\b(?:portalBaseUrl|appBaseUrl):\s*([^,}\n]+)/g)].map((m) => m[1].trim());
      expect(bases.length, `${rel}: expected a *BaseUrl argument`).toBeGreaterThan(0);
      for (const base of bases) expect(base, `${rel} passes a non-canonical link base`).toBe("env.APP_URL");
    }
  });

  it("C-101: runUpload takes no caller-supplied origin", () => {
    // The field that carried the request origin into the digest builder is gone, not merely
    // unused — so a future caller cannot re-introduce the hop by filling it back in.
    const text = readFileSync(join(__dirname, "..", "..", "src", "modules", "run", "run-upload.ts"), "utf8");
    const input = text.slice(text.indexOf("export interface RunUploadInput"));
    expect(input.slice(0, input.indexOf("}"))).not.toMatch(/^\s*(origin|baseUrl|portalBaseUrl)\??:/m);
  });
});
