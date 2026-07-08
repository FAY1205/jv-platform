import { z } from "zod";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { getRunDetail } from "@/modules/run/queries";
import { jsonOk, jsonError } from "@/lib/http";

const RefSchema = z.string().regex(/^UP-\d{4}-\d{3,}$/);

export async function GET(_req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const parsed = RefSchema.safeParse(ref);
  if (!parsed.success) return jsonError("invalid_ref", "Invalid run reference.", 400);
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;
    const detail = await getRunDetail(scope, parsed.data);
    if (!detail) return jsonError("not_found", `Run ${parsed.data} not found.`, 404);
    return jsonOk(detail);
  } catch (e) {
    return (
      authErrorResponse(e) ??
      jsonError("run_detail_failed", e instanceof Error ? e.message : "Failed to load run", 500)
    );
  }
}
