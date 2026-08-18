import { describe, it, expect } from "vitest";
import type { z } from "zod";
import { buildAiTools } from "@/modules/ai/tools";
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
