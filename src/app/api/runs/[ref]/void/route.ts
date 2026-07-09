import { z } from "zod";
import { getServerScope } from "@/lib/scope-context";
import { assertCsrf, authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { voidUpload, UploadNotFoundError, AlreadyVoidedError } from "@/modules/run/void";
import { jsonOk, jsonError } from "@/lib/http";

const RefSchema = z.string().regex(/^IM-\d{2}-\d{3,}$/);
const BodySchema = z.object({ reason: z.string().trim().min(3).max(500) });

// POST /api/runs/[ref]/void — soft-void a processed run with a required reason (ING-09).
export async function POST(req: Request, { params }: { params: Promise<{ ref: string }> }) {
  if (!assertCsrf(req, { requireToken: true })) {
    return jsonError("csrf_rejected", "CSRF check failed.", 403);
  }
  const { ref } = await params;
  if (!RefSchema.safeParse(ref).success) return jsonError("invalid_ref", "Invalid run reference.", 400);

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return jsonError("invalid_reason", "A void reason of at least 3 characters is required.", 400);
  }

  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const result = await voidUpload(scope, ref, body.reason);
    return jsonOk(result);
  } catch (e) {
    const authResp = authErrorResponse(e);
    if (authResp) return authResp;
    if (e instanceof UploadNotFoundError) return jsonError("not_found", e.message, 404);
    if (e instanceof AlreadyVoidedError) return jsonError("already_voided", e.message, 409);
    return jsonError("void_failed", e instanceof Error ? e.message : "Void failed.", 500);
  }
}
