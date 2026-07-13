import { getDb } from "@/db";
import { env } from "@/lib/env";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse, assertCsrf } from "@/lib/auth/guard";
import { jsonError } from "@/lib/http";
import { ChatBodySchema, assistantGate, assistantResponse } from "@/modules/ai/chat";
import { resolveModel, hasProviderKey } from "@/modules/ai/model";

// AIA-01: the assistant chat endpoint. Admin-only, CSRF-gated, Zod-validated,
// budget/rate/tier gated BEFORE any model call. Streaming UIMessage response.
export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const parsed = ChatBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("invalid_input", "Invalid chat payload.", 400);
    const db = getDb();
    const gate = await assistantGate(db, scope, { appEnv: env.APP_ENV, aiTier: env.AI_TIER, hasProviderKey: hasProviderKey(), now: new Date() });
    if (!gate.ok) return jsonError(gate.code, gate.message, gate.status);
    return await assistantResponse(db, scope, parsed.data, { model: resolveModel(), now: new Date() });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("ai_chat_failed", "The assistant hit an error.", 500);
  }
}
