import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { findProfileById } from "@/modules/sources/profile-store";
import { renderTemplate } from "@/modules/sources/template";
import { jsonError } from "@/lib/http";

// ING-05: download an .xlsx template for a known source format (header row + one
// example row) — a saved version or a built-in. Admin-only; no tenant data.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;

    const { id } = await params;
    const profile = await findProfileById(getDb(), scope, id);
    if (!profile) return jsonError("not_found", "Unknown format.", 404);

    const bytes = await renderTemplate(profile);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${profile.id}-template.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return authErrorResponse(e) ?? jsonError("template_failed", "Could not build the template.", 500);
  }
}
