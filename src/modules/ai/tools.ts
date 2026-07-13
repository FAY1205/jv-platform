import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { ScopeContext } from "@/lib/scope";
import { dashboardData } from "@/modules/analytics/queries";
import { RANGE_KEYS, type RangeKey } from "@/modules/analytics/ranges";
import { partnerPerformanceDetail } from "@/modules/analytics/partner-performance";
import { listPartners, territoryOf } from "@/modules/partners/queries";
import { coverageMapData } from "@/modules/coverage/queries";
import { listLeads, getAdminLeadDetail, unmatchedStateStats } from "@/modules/leads/queries";
import { LeadsQuerySchema, LEAD_STATUS_FILTERS } from "@/modules/leads/schema";
import { listRuns, getRunDetail } from "@/modules/run/queries";
import { maskLeadDetail, maskLeadRow, maskRunDetail } from "./mask";

// SEAM-07 / AIA-02: the assistant's ONLY data access. Every tool wraps an existing
// scope-first query function; `scope` is bound by closure from the verified session
// (PRN-08) — no tool accepts a tenant/partner/user id, and none mutates anything.
// Outputs pass through mask.ts (SEC-05) and carry `source` + `path` for the UI.

const RangeSchema = z.enum(RANGE_KEYS).default("30d");

/** Resolve "Meridian" / "JV-003" → the roster match(es). All matches are returned
 *  so ambiguity is structural — the model must ask, never guess (owner test F-3). */
async function resolvePartner(scope: ScopeContext, q: string) {
  const roster = await listPartners(scope);
  const needle = q.trim().toLowerCase();
  const matches = roster.filter((p) => p.refId.toLowerCase() === needle || p.name.toLowerCase().includes(needle));
  return { roster, matches };
}

export function buildAiTools(scope: ScopeContext): ToolSet {
  if (scope.role !== "admin") {
    throw new Error("AI tools are admin-only (WP-AI-1); a partner-scoped assistant needs partner-scoped tool variants.");
  }
  return {
    get_dashboard_stats: tool({
      description: "Workspace totals for a range (7d/30d/12mo/all): leads in, distributed, removed, unmatched, closed, contacted, active partners — plus per-partner and per-source rows. Call this for any 'how many/how are we doing' question.",
      inputSchema: z.object({ range: RangeSchema }),
      execute: async ({ range }) => {
        const d = await dashboardData(scope, range as RangeKey);
        return {
          source: `Dashboard stats · ${range}`, path: "/dashboard",
          range: d.range, stats: d.stats,
          partners: d.partners.map((p) => ({ name: p.name, refId: p.refId, given: p.given, untouched: p.untouched, contacted: p.contacted, closed: p.closed })),
          sources: d.sources,
        };
      },
    }),
    get_partner_performance: tool({
      description: "One partner's performance (leads given, contacted, closed, untouched, avg hours to first contact) for a range. `partner` is a JV-### ref or a name fragment. Call this when a question names a partner.",
      inputSchema: z.object({ partner: z.string().min(1).max(80), range: RangeSchema }),
      execute: async ({ partner, range }) => {
        const { matches } = await resolvePartner(scope, partner);
        if (matches.length === 0) return { source: "Partner roster", notFound: partner };
        if (matches.length > 1) return { source: "Partner roster", ambiguous: matches.map((m) => ({ name: m.name, refId: m.refId })) };
        const m = matches[0];
        const perf = await partnerPerformanceDetail(scope, m.id, range as RangeKey);
        return { source: `Partner performance · ${range}`, path: `/partners/${m.id}`, partner: { name: m.name, refId: m.refId, status: m.status }, range: perf.range, stats: perf.stats };
      },
    }),
    list_partners: tool({
      description: "The active partner roster: name, JV-### ref, status, coverage size (state/ZIP counts). Call this for 'who are my partners' or to check a name.",
      inputSchema: z.object({}),
      execute: async () => {
        const roster = await listPartners(scope);
        return { source: "Partner roster", path: "/partners", partners: roster.map((p) => ({ name: p.name, refId: p.refId, status: p.status, stateCount: p.stateCount, zipCount: p.zipCount })) };
      },
    }),
    get_partner_territory: tool({
      description: "The states and ZIP overrides one partner covers. `partner` is a JV-### ref or name fragment.",
      inputSchema: z.object({ partner: z.string().min(1).max(80) }),
      execute: async ({ partner }) => {
        const { matches } = await resolvePartner(scope, partner);
        if (matches.length === 0) return { source: "Partner roster", notFound: partner };
        if (matches.length > 1) return { source: "Partner roster", ambiguous: matches.map((m) => ({ name: m.name, refId: m.refId })) };
        const t = await territoryOf(scope, matches[0].id);
        return { source: "Coverage", path: `/partners/${matches[0].id}`, partner: { name: matches[0].name, refId: matches[0].refId }, states: t.states, zips: t.zips.length, zipList: t.zips.slice(0, 25) };
      },
    }),
    get_coverage_summary: tool({
      description: "Whole-workspace coverage: which partner owns each state, states with NO coverage, unmatched-lead counts per state, ZIP-override count. Call this for coverage-gap questions.",
      inputSchema: z.object({}),
      execute: async () => {
        const [cov, un] = await Promise.all([coverageMapData(scope), unmatchedStateStats(scope)]);
        return {
          source: "Coverage map", path: "/coverage",
          covered: cov.states.filter((s) => s.partnerId).map((s) => ({ state: s.code, partner: s.partnerName, refId: s.refId })),
          uncoveredStatesWithLeads: cov.states.filter((s) => s.gap).map((s) => ({ state: s.code, waitingLeads: s.leadCount })),
          zipOverrides: cov.zipCoverageCount, unmatchedTotal: un.total, unmatchedByState: un.byState,
        };
      },
    }),
    find_leads: tool({
      description: "Search kept leads by state / status, paginated 20 per page. Returns location + status only (no contact info). Call this for 'show/count leads in X'.",
      inputSchema: z.object({
        state: z.string().regex(/^[A-Za-z]{2}$/).optional(),
        status: z.enum(LEAD_STATUS_FILTERS).optional(),
        page: z.number().int().min(1).max(50).default(1),
      }),
      execute: async ({ state, status, page }) => {
        const q = LeadsQuerySchema.parse({ state, statuses: status ? [status] : [], page, pageSize: 20 });
        const res = await listLeads(scope, q);
        return { source: "Leads list", path: "/leads", total: res.total, page: res.page, leads: res.leads.map(maskLeadRow) };
      },
    }),
    get_lead: tool({
      description: "One lead by its LD-##-##### reference: location, status, routing and partner. Contact info and notes are NOT available — the answer must point to the lead page for those.",
      inputSchema: z.object({ refId: z.string().regex(/^LD-\d{2}-\d{5,}$/i) }),
      execute: async ({ refId }) => {
        const d = await getAdminLeadDetail(scope, refId.toUpperCase());
        return d ? { source: `Lead ${d.refId}`, ...maskLeadDetail(d) } : { source: "Leads", notFound: refId };
      },
    }),
    list_imports: tool({
      description: "Recent imports (uploads): ref, filename, status (processed/voided), row count, date. Call this for 'what came in / last import' questions.",
      inputSchema: z.object({}),
      execute: async () => {
        const runs = await listRuns(scope);
        return { source: "Imports", path: "/imports", imports: runs.slice(0, 12) };
      },
    }),
    get_import: tool({
      description: "One import by its IM-##-### ref: pipeline summary (imported/kept/removed/unmatched) and per-partner distribution.",
      inputSchema: z.object({ ref: z.string().regex(/^IM-\d{2}-\d{3,}$/i) }),
      execute: async ({ ref }) => {
        const d = await getRunDetail(scope, ref.toUpperCase());
        return d ? { source: `Import ${d.upload.refId}`, ...maskRunDetail(d) } : { source: "Imports", notFound: ref };
      },
    }),
  };
}
