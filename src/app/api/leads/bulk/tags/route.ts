import { z } from "zod";
import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse } from "@/lib/auth/guard";
import { requireTosResponse } from "@/lib/auth/tos-guard";
import { requireCapabilityResponse } from "@/lib/authz";
import { jsonOk, jsonError, jsonServerError } from "@/lib/http";
import { bulkTags } from "@/modules/leads/bulk";
import { TagNotFoundError } from "@/modules/tags/tags";
import { BulkBodyBase, bulkInputError } from "../shared";

// WP-N6 (N6-30..33) — attach or detach ONE tag across a selection. `leads.write` (a lead's
// labels are lead work), not `rules.manage` (which owns the tag VOCABULARY) — the same split
// the per-lead attach/detach routes already draw. No tag is created here: creation stays in
// the picker and Settings, so the TAG_LIMIT advisory-lock path is untouched.
const BodySchema = z.strictObject({
  ...BulkBodyBase,
  op: z.enum(["add", "remove"]),
  tagId: z.string().uuid(),
});

export async function POST(request: Request) {
  if (!assertCsrf(request, { requireToken: true })) return jsonError("csrf_rejected", "CSRF check failed.", 403);
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return bulkInputError(parsed.error);

  try {
    const scope = await getServerScope();
    const gate = requireCapabilityResponse(scope, "leads.write");
    if (gate) return gate;
    const tos = await requireTosResponse(getDb(), scope);
    if (tos) return tos;

    const { outcome, tagName } = await bulkTags(scope, {
      selection: parsed.data.selection,
      op: parsed.data.op,
      tagId: parsed.data.tagId,
      dryRun: parsed.data.dryRun,
    });
    return jsonOk({ ...outcome, op: parsed.data.op, tag: { id: parsed.data.tagId, name: tagName } });
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    // A tag id outside the tenant simply does not resolve (TAG-02) — 404, exactly as the
    // per-lead attach reports it.
    if (e instanceof TagNotFoundError) return jsonError("not_found", e.message, 404);
    return jsonServerError("bulk_tags_failed", "Could not update the tags.", {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
