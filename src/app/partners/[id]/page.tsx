"use client";

import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import {
  AppShell,
  PartnerTag,
  Badge,
  SegmentedControl,
  Tooltip,
  LineChart,
  Table,
  THead,
  TBody,
  Th,
  Tr,
  Td,
  RowOpenButton,
  EmptyState,
  Skeleton,
} from "@/components";
import type { CoverageMapResponse } from "@/modules/coverage/map";
import { formatContactTime, AVG_CONTACT_DEFINITION, type RangeKey } from "@/modules/analytics/ranges";
import { matchMethodLabel } from "@/lib/match-method";

// Partner territory = the real coverage map with THIS partner highlighted (other partners
// dimmed, true gaps hatched) — same pattern as the WS-3 matchcard. Static (no zoom/pan);
// code-split so the ~0.9MB geometry doesn't block the profile.
const CountyCoverageMap = dynamic(() => import("@/components/CountyCoverageMap").then((m) => m.CountyCoverageMap), {
  ssr: false,
  loading: () => <Skeleton className="aspect-[960/600] w-full rounded-lg" />,
});

// ADM-03: a single partner's home — profile, territory, per-partner performance
// (given / contacted / closed over a rolling range + Avg Contact), lead history, and
// private admin notes (PRN-13). All numbers come from the analytics module (PRN-15);
// leads open in the shared dialog (F-55). Admin-only (the API enforces role).

const LeadDialog = dynamic(() => import("../../leads/lead-dialog").then((m) => m.LeadDialog), { ssr: false });

interface Territory { states: string[]; zips: string[] }
interface Partner {
  id: string;
  refId: string;
  name: string;
  email: string | null;
  phone: string | null;
  color: string;
  dealTerms: string | null;
  adminNotes: string | null;
  status: "not_invited" | "invited" | "active" | "revoked";
  zipCount: number;
  stateCount: number;
  territory: Territory;
}
interface PartnerLead {
  refId: string;
  seller: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  matchMethod: "zip" | "state_fallback" | "none" | "manual";
  receivedAt: string;
}
interface Performance {
  range: { key: RangeKey; start: string; end: string; bucket: "day" | "month" };
  stats: { given: number; contacted: number; closed: number; avgContactHours: number | null };
  history: { bucketStart: string; given: number; contacted: number; closed: number }[];
}

const STATUS: Record<Partner["status"], { label: string; variant: "neutral" | "warn" | "success" }> = {
  not_invited: { label: "Not invited", variant: "neutral" },
  invited: { label: "Invited", variant: "warn" },
  active: { label: "Active", variant: "success" },
  revoked: { label: "Deactivated", variant: "neutral" },
};

const RANGES: { value: RangeKey; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "12mo", label: "12 months" },
  { value: "all", label: "All" },
];

const panel = "rounded-2xl border border-border-soft bg-surface p-5 shadow-sm";

const fmtBucket = (iso: string, bucket: "day" | "month") => {
  const dt = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return bucket === "month"
    ? dt.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
    : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};

function Stat({ label, value, sub, tip }: { label: React.ReactNode; value: React.ReactNode; sub?: string; tip?: string }) {
  const header = tip ? (
    <Tooltip content={tip}>
      <span tabIndex={0} className="inline-flex cursor-help rounded text-xs font-medium text-text-2 underline decoration-dotted underline-offset-2 outline-none focus-visible:ring-1 focus-visible:ring-brand-ink">{label}</span>
    </Tooltip>
  ) : (
    <span className="text-xs font-medium text-text-2">{label}</span>
  );
  return (
    <div className={panel}>
      {header}
      <div className="mt-1.5 font-display text-2xl font-semibold leading-none tracking-tight tabular-nums text-text">{value}</div>
      {sub && <div className="mt-1 text-step-1 text-text-3">{sub}</div>}
    </div>
  );
}

function matchBadge(m: PartnerLead["matchMethod"]) {
  if (m === "manual") return <Badge variant="prev">Manual</Badge>;
  const meta = matchMethodLabel(m);
  return <Badge variant={meta.badge}>{meta.label}</Badge>;
}

export default function PartnerDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [range, setRange] = React.useState<RangeKey>("12mo");
  const [openRef, setOpenRef] = React.useState<string | null>(null);

  const partnerQ = useQuery({
    queryKey: ["partner", id],
    queryFn: () => apiGet<{ partner: Partner }>(`/api/admin/partners/${id}`),
    enabled: Boolean(id),
  });
  const perfQ = useQuery({
    queryKey: ["partner", id, "perf", range],
    queryFn: () => apiGet<Performance>(`/api/admin/partners/${id}/performance?range=${range}`),
    enabled: Boolean(id),
  });
  const leadsQ = useQuery({
    queryKey: ["partner", id, "leads"],
    queryFn: () => apiGet<{ leads: PartnerLead[] }>(`/api/admin/partners/${id}/leads`),
    enabled: Boolean(id),
  });
  // Full coverage so the territory map shows this partner highlighted in the context of
  // the whole network (other partners dimmed, true gaps hatched). Shared cached query.
  const coverageQ = useQuery({
    queryKey: ["coverage"],
    queryFn: () => apiGet<CoverageMapResponse>("/api/coverage"),
    enabled: Boolean(id),
  });

  const partner = partnerQ.data?.partner;
  const perf = perfQ.data;

  return (
    <AppShell>
      <Link href="/partners" className="mb-4 inline-block text-sm text-text-3 transition-colors hover:text-text-2">
        ← Partners
      </Link>

      {partnerQ.isPending ? (
        <div className="flex flex-col gap-5">
          <Skeleton className="h-16 w-72" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : partnerQ.error || !partner ? (
        <div className={panel}>
          <EmptyState title="Couldn't load partner" description={(partnerQ.error as Error)?.message ?? "Not found."} />
        </div>
      ) : (
        <div className="stagger flex flex-col gap-5">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <PartnerTag name={partner.name} color={partner.color} refId={partner.refId} />
                <Badge variant={STATUS[partner.status].variant} dot>
                  {STATUS[partner.status].label}
                </Badge>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-2">
                {partner.email ? <span>{partner.email}</span> : <span className="text-text-3">No email</span>}
                {partner.phone && <span className="num">{partner.phone}</span>}
                {partner.dealTerms && <span className="text-text-3">· {partner.dealTerms}</span>}
                <span className="text-text-3">· {partner.stateCount} state{partner.stateCount === 1 ? "" : "s"} · {partner.zipCount} ZIP{partner.zipCount === 1 ? "" : "s"}</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <SegmentedControl<RangeKey> ariaLabel="Performance range" value={range} onValueChange={setRange} options={RANGES} />
              <Link
                href="/partners"
                className="shrink-0 rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-semibold text-text-2 shadow-xs transition-colors hover:border-text-3 hover:bg-surface-2"
              >
                Edit on Partners →
              </Link>
            </div>
          </div>

          {/* Performance stat cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Given" value={perf ? perf.stats.given : "—"} sub="leads received in range" />
            <Stat label="Contacted" value={perf ? perf.stats.contacted : "—"} sub="first action in range" tip="Leads whose first partner action (status change or note) fell in the selected range." />
            <Stat label="Closed" value={perf ? perf.stats.closed : "—"} sub="closed in range" />
            <Stat label="Avg contact" value={perf ? formatContactTime(perf.stats.avgContactHours) : "—"} sub="received → first action" tip={AVG_CONTACT_DEFINITION} />
          </div>

          {/* Performance history */}
          <section className={panel}>
            <h2 className="mb-4 font-display text-step-3 font-semibold tracking-tight">Performance over time</h2>
            {perfQ.isPending ? (
              <Skeleton className="h-64 w-full" />
            ) : perfQ.error ? (
              <EmptyState title="Couldn't load performance" description={(perfQ.error as Error).message} />
            ) : !perf || perf.history.length === 0 ? (
              <p className="py-8 text-center text-sm text-text-3">No activity in this range.</p>
            ) : (
              <LineChart
                data={perf.history.map((b) => ({ x: fmtBucket(b.bucketStart, perf.range.bucket), Given: b.given, Contacted: b.contacted, Closed: b.closed }))}
                xKey="x"
                series={[
                  { key: "Given", name: "Given", color: "var(--text-2)" },
                  { key: "Contacted", name: "Contacted", color: "var(--brand)" },
                  { key: "Closed", name: "Closed", color: "var(--success)" },
                ]}
              />
            )}
          </section>

          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_320px]">
            {/* Territory */}
            <section className={panel}>
              <h2 className="mb-3 font-display text-step-3 font-semibold tracking-tight">Territory</h2>
              {partner.stateCount > 0 ? (
                <>
                  <div className="relative aspect-[960/600] w-full overflow-hidden rounded-lg">
                    {coverageQ.data ? (
                      <CountyCoverageMap
                        states={coverageQ.data.states}
                        selectedPartnerId={partner.id}
                        interactive={false}
                        caption={{ title: partner.name, subtitle: `${partner.stateCount} state${partner.stateCount === 1 ? "" : "s"}` }}
                      />
                    ) : coverageQ.isError ? (
                      <div role="status" className="grid h-full place-items-center px-4 text-center text-sm text-text-3">Territory map unavailable.</div>
                    ) : (
                      <Skeleton className="h-full w-full rounded-lg" />
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {partner.territory.states.map((s) => (
                      <span key={s} className="num rounded-md bg-surface-3 px-1.5 py-0.5 text-step-1 font-semibold text-text-2">
                        {s}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-text-3">
                  No whole-state coverage. This partner is covered at the ZIP level
                  {partner.zipCount > 0 ? ` (${partner.zipCount} ZIP${partner.zipCount === 1 ? "" : "s"}).` : "."}
                </p>
              )}
            </section>

            {/* Admin notes (PRN-13) */}
            <aside className={panel}>
              <h2 className="mb-3 font-display text-step-3 font-semibold tracking-tight">Admin notes</h2>
              {partner.adminNotes ? (
                <p className="whitespace-pre-wrap text-sm text-text-2">{partner.adminNotes}</p>
              ) : (
                <p className="text-sm text-text-3">No notes yet. Add private notes when editing this partner.</p>
              )}
            </aside>
          </div>

          {/* Recent leads */}
          <section className={panel}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-step-3 font-semibold tracking-tight">Recent leads</h2>
              <span className="num text-xs text-text-3">last {leadsQ.data?.leads.length ?? 0}</span>
            </div>
            {leadsQ.isPending ? (
              <div className="flex flex-col gap-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
            ) : (leadsQ.data?.leads ?? []).length === 0 ? (
              <p className="py-4 text-center text-sm text-text-3">No leads distributed to this partner yet.</p>
            ) : (
              <Table>
                <THead>
                  <Tr><Th>Lead</Th><Th>Seller</Th><Th>Location</Th><Th>Via</Th><Th align="right">Received</Th></Tr>
                </THead>
                <TBody>
                  {leadsQ.data!.leads.map((l) => (
                    <Tr key={l.refId} className="hover:bg-surface-2">
                      <Td><RowOpenButton className="text-xs" onClick={() => setOpenRef(l.refId)}>{l.refId}</RowOpenButton></Td>
                      <Td><span className="text-sm text-text-2">{l.seller}</span></Td>
                      <Td>
                        <span className="text-xs text-text-3">
                          {[l.city, l.state].filter(Boolean).join(", ")} <span className="num">{l.zip}</span>
                        </span>
                      </Td>
                      <Td>{matchBadge(l.matchMethod)}</Td>
                      <Td align="right"><span className="num text-xs text-text-3 tabular-nums">{new Date(l.receivedAt).toLocaleDateString()}</span></Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </section>
        </div>
      )}

      {openRef && <LeadDialog refId={openRef} onClose={() => setOpenRef(null)} />}
    </AppShell>
  );
}
