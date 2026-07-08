import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse, requireAdminResponse } from "@/lib/auth/guard";
import { SEED_SOURCE_PROFILES } from "@/modules/sources/seed-profiles";
import { renderTemplate } from "@/modules/sources/template";
import { jsonError } from "@/lib/http";

// ING-05: download an .xlsx template for a known source format (header row + one
// example row). Admin-only (uploads are admin). No tenant data — pure format help.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await getServerScope();
    const adminOnly = requireAdminResponse(scope);
    if (adminOnly) return adminOnly;

    const { id } = await params;
    const profile = SEED_SOURCE_PROFILES.find((p) => p.id === id);
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
