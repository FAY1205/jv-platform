import { getDb } from "@/db";
import { getServerScope } from "@/lib/scope-context";
import { authErrorResponse } from "@/lib/auth/guard";
import { requireTosResponse } from "@/lib/auth/tos-guard";
import { listPartnerLeads, PORTAL_LEAD_SORT_FIELDS, PORTAL_STATUS_FILTERS, type PortalLeadSort } from "@/modules/portal/queries";
import { pageParam, pageSizeParam, PORTAL_MAX_PAGE } from "@/lib/query-params";
import { jsonOk, jsonServerError } from "@/lib/http";
import { requirePassthroughResponse } from "@/lib/authz";

// Built once (portal ceiling); admin schemas build their page field the same way.
const portalPageSchema = pageParam({ max: PORTAL_MAX_PAGE });
const portalPageSizeSchema = pageSizeParam();

// WP-PW-3 Task 1: graceful ("degrade to default, never throw") params for the desktop
// table's sort/status/pageSize — mirrors the admin route's whitelist-via-includes style.
// Only whitelisted values are ever passed through; anything else is simply omitted so
// listPartnerLeads applies its own defaults (received/desc, no filter, pageSize 50).
function parseSort(v: string | null): PortalLeadSort | undefined {
  return v && (PORTAL_LEAD_SORT_FIELDS as readonly string[]).includes(v) ? (v as PortalLeadSort) : undefined;
}
function parseDir(v: string | null): "asc" | "desc" | undefined {
  return v === "asc" || v === "desc" ? v : undefined;
}
function parseStatuses(v: string | null): string[] {
  if (!v) return [];
  return v.split(",").map((s) => s.trim()).filter((s) => (PORTAL_STATUS_FILTERS as readonly string[]).includes(s));
}
// pageSizeParam() defaults missing/invalid input to 20 — only apply it when the caller
// actually sent a pageSize, so the no-param path keeps listPartnerLeads's own default
// of 50 (preserves the pre-WP-PW-3 /api/portal/leads behavior exactly).
function parsePageSize(v: string | null): number | undefined {
  return v == null ? undefined : portalPageSizeSchema.parse(v);
}
// WP-PP-3: free-text search — trimmed and length-capped (defensive; the query binds it via
// ilike regardless). Empty/whitespace degrades to undefined so the no-search path is unchanged.
function parseQ(v: string | null): string | undefined {
  const q = v?.trim().slice(0, 100);
  return q ? q : undefined;
}

// GET /api/portal/leads?page=&sort=&dir=&status=&pageSize=&q= — the caller's own leads,
// server-side paginated, sorted, status-filtered, and text-searched (PTL-02, FEP-03).
export async function GET(request: Request) {
  try {
    const scope = await getServerScope();
    // ADR-0047 Phase C: partners pass on scope alone; an ADMIN-STREAM caller reaches
    // tenant-wide data through this partner-shaped code, so it must hold leads.read.
    const gate = requirePassthroughResponse(scope, "leads.read");
    if (gate) return gate;
    const tos = await requireTosResponse(getDb(), scope); // F-04: gate data on ToS acceptance
    if (tos) return tos;
    const params = new URL(request.url).searchParams;
    const page = portalPageSchema.parse(params.get("page"));
    return jsonOk(
      await listPartnerLeads(scope, {
        page,
        pageSize: parsePageSize(params.get("pageSize")),
        sort: parseSort(params.get("sort")),
        dir: parseDir(params.get("dir")),
        statuses: parseStatuses(params.get("status")),
        q: parseQ(params.get("q")),
      }),
    );
  } catch (e) {
    return authErrorResponse(e) ?? jsonServerError("leads_failed", "Failed to load leads.", { message: e instanceof Error ? e.message : String(e) });
  }
}
