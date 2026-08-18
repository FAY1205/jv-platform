import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { walkSrc } from "../helpers/walk-src";

// ─────────────────────────────────────────────────────────────────────────────
// AUTHZ-06 (audit-tenancy on WP-ROLE-1a): every authenticated route either names the
// tier gate it stands behind — requireAdminResponse / requireCapabilityResponse /
// requirePassthroughResponse / isCallerPlatformOwner — or is on the documented
// personal-surface allowlist below. A route that resolves a scope and reaches data
// with neither is a defect: it is exactly how the portal-export hole (a viewer
// pulling a full-tenant PII export through partner-shaped code) almost shipped.
// Adding a route to the allowlist is a reviewed, reasoned act — not a default.
// ─────────────────────────────────────────────────────────────────────────────

const API = join(__dirname, "..", "..", "src", "app", "api");

const GATES = [
  "requireAdminResponse(",
  "requireCapabilityResponse(",
  "requirePassthroughResponse(",
  "isCallerPlatformOwner(",
];

/** Scoped-but-ungated routes, each with the reason it needs no tier gate. */
const ALLOWED = new Set(
  [
    "me/route.ts", // own identity; emits the capability list the client gates on
    "sessions/route.ts", // own trusted devices only (ownerWhere-style personal surface)
    "sessions/[familyId]/revoke/route.ts", // own-device revoke + inline can(ops.admin) for revoke-others
    "notifications/route.ts", // personal bell (user-pinned queries)
    "notifications/[id]/read/route.ts", // personal bell
    "notifications/read-all/route.ts", // personal bell
    "auth/tos/accept/route.ts", // every authed caller must be able to accept the ToS
    "auth/change-password/route.ts", // own credential
    "portal/activity/route.ts", // partner-ONLY surface: explicit isPartnerStream 403 for all staff
    "dev/emails/route.ts", // prod-404 dev mailbox + inline can(ops.admin)
  ].map((p) => p.split("/").join(sep)),
);

describe("AUTHZ-06: every scoped route names its gate", () => {
  it("AUTHZ-06: routes calling getServerScope carry a tier gate or a documented exemption", () => {
    const offenders: string[] = [];
    const staleAllowlist: string[] = [];
    const seen = new Set<string>();
    for (const file of walkSrc(API)) {
      if (!file.endsWith(`${sep}route.ts`)) continue;
      const rel = relative(API, file);
      const text = readFileSync(file, "utf8");
      if (!text.includes("getServerScope")) continue; // auth-plane/cron/public routes
      seen.add(rel);
      if (ALLOWED.has(rel)) continue;
      if (!GATES.some((g) => text.includes(g))) offenders.push(rel);
    }
    for (const rel of ALLOWED) if (!seen.has(rel)) staleAllowlist.push(rel);
    expect(offenders, `Scoped route with NO tier gate — add requireCapabilityResponse/requirePassthroughResponse or a reasoned allowlist entry:\n${offenders.join("\n")}`).toEqual([]);
    expect(staleAllowlist, "Allowlist entries no longer matching a scoped route — prune them").toEqual([]);
  });
});
