import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { walkSrc } from "../helpers/walk-src";

// ─────────────────────────────────────────────────────────────────────────────
// AUT-12 (WP-NF2, audit-security): every STATE-CHANGING API route either calls `assertCsrf(`
// or appears in the exemption map below WITH a reason. The twin of the AUTHZ-06 gate
// conformance test, on the other axis: that one asks "who may call this", this one asks "can
// a third-party page make the browser call it".
//
// An exemption is a REVIEWED, REASONED act — the map is the record, and a route added without
// one fails the build rather than quietly shipping unprotected. Equally: an entry here is a
// decision to PRESERVE. Several of these routes would BREAK if someone "fixed" them by adding
// assertCsrf, so the reason strings say why, not merely that.
// ─────────────────────────────────────────────────────────────────────────────

const API = join(__dirname, "..", "..", "src", "app", "api");

/** The verbs that change state. GET/HEAD are safe by definition and never need the check. */
const MUTATING = /export\s+(?:async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b/;

/** Routes that deliberately do NOT call assertCsrf, each with the reason it is safe without it. */
const CSRF_EXEMPT = new Map<string, string>(
  (
    [
      [
        "unsubscribe/route.ts",
        // NTF-13. Two independent reasons, either of which alone is sufficient:
        //  (1) It is a BEARER-TOKEN CAPABILITY with no session and no cookie. CSRF protects a
        //      request whose authority comes from ambient credentials the browser attaches
        //      automatically; this request has none — its entire authority is the unguessable
        //      token in the body. An attacker who can forge the request already holds that
        //      token, and would simply call the endpoint directly rather than via a victim.
        //  (2) Adding assertCsrf would BREAK RFC 8058 one-click unsubscribe
        //      (List-Unsubscribe-Post): the mail provider POSTs from its own infrastructure,
        //      with no Origin the app could allowlist and no cookie jar at all. That flow is the
        //      intended direction for this endpoint, so the exemption is forward-looking, not
        //      merely tolerated. DO NOT "fix" this by adding assertCsrf.
        "bearer-token capability: no session/cookie authority to forge, and assertCsrf would break RFC 8058 one-click POSTs",
      ],
    ] as const
  ).map(([p, reason]) => [p.split("/").join(sep), reason]),
);

describe("AUT-12: every state-changing route is CSRF-protected or reasoned-exempt", () => {
  it("AUT-12: mutating API routes call assertCsrf or carry a documented exemption", () => {
    const offenders: string[] = [];
    const seen = new Set<string>();
    for (const file of walkSrc(API)) {
      if (!file.endsWith(`${sep}route.ts`)) continue;
      const text = readFileSync(file, "utf8");
      if (!MUTATING.test(text)) continue; // read-only route
      const rel = relative(API, file);
      seen.add(rel);
      if (CSRF_EXEMPT.has(rel)) continue;
      if (!text.includes("assertCsrf(")) offenders.push(rel);
    }
    expect(
      offenders,
      `State-changing route with NO CSRF check — call assertCsrf or add a reasoned CSRF_EXEMPT entry:\n${offenders.join("\n")}`,
    ).toEqual([]);

    // Non-vacuous: the walk must actually be finding mutating routes.
    expect(seen.size).toBeGreaterThan(10);
  });

  it("AUT-12: every exemption still matches a real mutating route, and states a reason", () => {
    const mutating = new Set<string>();
    for (const file of walkSrc(API)) {
      if (!file.endsWith(`${sep}route.ts`)) continue;
      if (MUTATING.test(readFileSync(file, "utf8"))) mutating.add(relative(API, file));
    }
    const stale = [...CSRF_EXEMPT.keys()].filter((rel) => !mutating.has(rel));
    expect(stale, "Exemptions no longer matching a mutating route — prune them").toEqual([]);
    for (const [rel, reason] of CSRF_EXEMPT) {
      expect(reason.length, `${rel} needs a real reason string`).toBeGreaterThan(30);
    }
  });

  it("AUT-12: the unsubscribe exemption records BOTH the no-cookie and the RFC 8058 rationale", () => {
    // Pinned explicitly: a future reader tempted to "harden" this endpoint must find the
    // one-click-unsubscribe consequence in the same breath as the exemption itself.
    const reason = CSRF_EXEMPT.get(["unsubscribe", "route.ts"].join(sep));
    expect(reason).toBeDefined();
    expect(reason).toMatch(/bearer-token/i);
    expect(reason).toMatch(/8058|one-click/i);
  });
});
