import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse, assertCsrf } from "@/lib/auth/guard";
import { jsonOk, jsonError } from "@/lib/http";
import { z } from "zod";

// AIA-04 (feedback half): thumbs on an assistant answer → ai_feedback. The
// messageId is the client-generated UI message id — no chat content is stored.
const BodySchema = z.object({
  messageId: z.string().min(1).max(64),
  rating: z.enum(["up", "down"]),
  note: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) return jsonError("csrf_rejected", "CSRF check failed.", 403);
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("invalid_input", "Invalid feedback.", 400);
    await getDb().insert(schema.aiFeedback).values({ tenantId: scope.tenantId, messageId: parsed.data.messageId, rating: parsed.data.rating, note: parsed.data.note ?? null });
    return jsonOk({ code: "ok", message: "Feedback recorded." });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("ai_feedback_failed", "Could not record feedback.", 500);
  }
}
