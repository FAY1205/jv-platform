import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse } from "@/lib/auth/guard";
import { requireTosResponse } from "@/lib/auth/tos-guard";
import { partnerTerritory } from "@/modules/portal/queries";
import { jsonOk, jsonServerError } from "@/lib/http";
import { requirePassthroughResponse } from "@/lib/authz";

// GET /api/portal/territory — the caller's own state territory, anonymized elsewhere (PTL, PRN-08).
export async function GET() {
  try {
    const scope = await getServerScope();
    // ADR-0047 Phase C: partners pass on scope alone; an ADMIN-STREAM caller reaches
    // tenant-wide data through this partner-shaped code, so it must hold leads.read.
    const gate = requirePassthroughResponse(scope, "leads.read");
    if (gate) return gate;
    const tos = await requireTosResponse(getDb(), scope); // F-04: gate data on ToS acceptance
    if (tos) return tos;
    return jsonOk(await partnerTerritory(scope));
  } catch (e) {
    return authErrorResponse(e) ?? jsonServerError("portal_territory_failed", "Failed to load your territory.", { message: e instanceof Error ? e.message : String(e) });
  }
}
