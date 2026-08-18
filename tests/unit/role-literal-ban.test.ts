import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { walkSrc } from "../helpers/walk-src";

// ─────────────────────────────────────────────────────────────────────────────
// Phase C / WP-ROLE-1: the polarity chokepoint. `ScopeContext.role` is a FOUR-value
// union, but TypeScript happily compiles `scope.role === "admin"` — and that literal
// comparison is exactly how a member/viewer scope silently falls down the wrong arm
// of a data-shape branch (the partner arm of a scope builder, or an admin-only allow
// that should be a capability). So the ban is mechanical: application code compares
// scope.role ONLY inside the two seam modules (lib/scope.ts owns the stream
// predicate, lib/authz.ts owns allow/deny) plus the enumerated legacy sites below.
// Everything else uses isPartnerStream()/streamOf()/can().
// ─────────────────────────────────────────────────────────────────────────────

const SRC = join(__dirname, "..", "..", "src");

/** Files allowed to compare `scope.role`/`row.role` against a literal, with why. */
const ALLOWED = new Set(
  [
    "lib/scope.ts", // owns isPartnerStream/streamOf — THE stream seam
    "lib/authz.ts", // owns can() — THE tier seam
    "lib/scope-context.ts", // resolveScope maps the users row into a scope (partner link rules)
    "lib/auth/guard.ts", // the deprecated legacy admin gate (fail-closed for new tiers)
    "lib/auth/platform-owner.ts", // ADR-0040: the platform tier requires the admin role specifically
  ].map((p) => p.split("/").join(sep)),
);

// Comparisons of `scope.role` against a role literal — the hazard pattern. Constructions
// (`role: "admin"` in provisioning/system-scope fabrication) and DB-ROW reads
// (`user.role`, `recipient.role` — data, not a ScopeContext decision) are out of scope.
const BAN = /\bscope\.role\s*(?:===|!==|==|!=)\s*["'](?:admin|partner|member|viewer)["']/;

describe("AUTHZ-04: role-literal comparisons live only in the seam modules", () => {
  it("AUTHZ-04: no `.role ===/!== <literal>` outside the allowlist", () => {
    const offenders: string[] = [];
    for (const file of walkSrc(SRC)) {
      const rel = relative(SRC, file);
      if (ALLOWED.has(rel)) continue;
      const text = readFileSync(file, "utf8");
      if (!BAN.test(text)) continue;
      // Report line numbers for actionability.
      text.split("\n").forEach((line, i) => {
        if (BAN.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders, `Role-literal comparison outside the seam. Use isPartnerStream()/streamOf() for stream shape or can()/requireCapabilityResponse() for allow/deny:\n${offenders.join("\n")}`).toEqual([]);
  });
});
