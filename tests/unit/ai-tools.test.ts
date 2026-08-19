import { describe, it, expect } from "vitest";
import type { z } from "zod";
import { buildAiTools } from "@/modules/ai/tools";
import { can } from "@/lib/authz";
import type { ScopeContext } from "@/lib/scope";

// The DB-backed behaviour of the tool surface lives in tests/integration/ai-tools.test.ts
// (real Postgres, real tenancy). These legs cover the parts that are pure: who may build the
// tool set at all, and the shape of the input contract the model is handed.

const adminScope: ScopeContext = { tenantId: "11111111-1111-4111-8111-111111111111", role: "admin", userId: "22222222-2222-4222-8222-222222222222" };

/** The zod schema each `tool()` was declared with (AI SDK v6 keeps it on the tool object). */
const inputSchemaOf = (tools: ReturnType<typeof buildAiTools>, name: string) =>
  (tools[name] as unknown as { inputSchema: z.ZodType }).inputSchema;

describe("AIA-02: the assistant tool surface", () => {
  it("AIS-11: get_recent_activity is registered and takes an all/security/data category, default all", () => {
    const tools = buildAiTools(adminScope);
    expect(Object.keys(tools)).toContain("get_recent_activity");
    const schema = inputSchemaOf(tools, "get_recent_activity");
    expect(schema.parse({})).toEqual({ category: "all" });
    expect(schema.parse({ category: "security" })).toEqual({ category: "security" });
    expect(schema.parse({ category: "data" })).toEqual({ category: "data" });
    // A category the activity screen does not offer is rejected at the boundary, not coerced.
    expect(() => schema.parse({ category: "everything" })).toThrow();
  });

  it("AIS-11: the audit trail follows ops.admin, not ai.use — a member's tool set has no such door", () => {
    // The human surface for this data (/api/activity) requires ops.admin, which is
    // ADMIN_LOCKED (ADR-0049 §11.3), while ai.use is in the DEFAULT member set. If the tool
    // rode ai.use, a member could read through the assistant what the Activity screen refuses
    // them — the assistant must never be a capability bypass. Absent, not throwing: the model
    // cannot call (or apologise for) a tool it was never handed.
    const member = { ...adminScope, role: "member" } as ScopeContext;
    expect(can(member, "ai.use")).toBe(true); // the member CAN use the assistant…
    expect(can(member, "ops.admin")).toBe(false); // …but not read the audit trail
    expect(Object.keys(buildAiTools(member))).not.toContain("get_recent_activity");
    expect(Object.keys(buildAiTools(adminScope))).toContain("get_recent_activity");
    // Every other tool is unaffected — this gate removes one door, not the assistant.
    expect(Object.keys(buildAiTools(member))).toContain("get_dashboard_stats");
    expect(Object.keys(buildAiTools(member)).length).toBe(Object.keys(buildAiTools(adminScope)).length - 1);
  });

  it("AIS-11: partner scope is unreachable by construction — no partner-scoped activity branch exists", () => {
    // C-45b deliberately adds NO role branching inside the tool. Partners hold no capability
    // (authz.ts: `can` is false for the partner stream), so the whole tool set — including the
    // audit trail, which is admin-only data — is refused before any query is built (PRN-08).
    const partnerScope = { ...adminScope, role: "partner", partnerId: "33333333-3333-4333-8333-333333333333" } as unknown as ScopeContext;
    expect(() => buildAiTools(partnerScope)).toThrow(/ai\.use/);
    // A viewer (admin stream, no ai.use in the default matrix) is refused by the same guard.
    expect(() => buildAiTools({ ...adminScope, role: "viewer" } as ScopeContext)).toThrow(/ai\.use/);
  });
});
