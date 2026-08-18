import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { requireTosResponse } from "@/lib/auth/tos-guard";
import { listLeadTags, attachTag, LeadNotFoundError, TagNotFoundError } from "@/modules/tags/tags";
import { AttachTagSchema } from "@/modules/tags/schema";
import { jsonOk, jsonError, jsonServerError, newTraceId } from "@/lib/http";
import { requireCapabilityResponse } from "@/lib/authz";

// TAG-03 — the attachments on ONE lead. GET lists them; POST attaches (IDEMPOTENT: attaching
// a tag the lead already carries is a 200 no-op, not a 409 — the ✕/＋ UI can retry safely).
// Admin-only (TAG-02) + CSRF on the write. Detach is DELETE on the [tagId] child route, so
// the removal target sits in the URL rather than in a DELETE body.
const RefSchema = z.string().regex(/^LD-\d{2}-\d{5,}$/);

export async function GET(_req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  if (!RefSchema.safeParse(ref).success) return jsonError("invalid_ref", "Invalid lead reference.", 400);
  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "leads.read");
    if (gate) return gate;
    const tos = await requireTosResponse(getDb(), scope);
    if (tos) return tos;
    return jsonOk({ tags: await listLeadTags(scope, ref) });
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    if (e instanceof LeadNotFoundError) return jsonError("not_found", e.message, 404);
    return jsonServerError("lead_tags_failed", "Failed to load tags.", {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ ref: string }> }) {
  if (!assertCsrf(request, { requireToken: true })) return jsonError("csrf_rejected", "CSRF check failed.", 403);
  const { ref } = await params;
  if (!RefSchema.safeParse(ref).success) return jsonError("invalid_ref", "Invalid lead reference.", 400);
  const parsed = AttachTagSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("invalid_input", "A tag id is required.", 400);
  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "leads.write");
    if (gate) return gate;
    const tos = await requireTosResponse(getDb(), scope);
    if (tos) return tos;
    // Both references are re-resolved under the tenant predicate inside attachTag — the body
    // carries only a HINT, and a foreign lead ref or foreign tag id 404s (TAG-02).
    return jsonOk(await attachTag(scope, ref, parsed.data.tagId, newTraceId()));
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    if (e instanceof LeadNotFoundError || e instanceof TagNotFoundError) return jsonError("not_found", e.message, 404);
    return jsonServerError("tag_attach_failed", "Failed to add the tag.", {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
