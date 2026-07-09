"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import {
  AppShell,
  CoverageMap,
  PartnerTag,
  Badge,
  Table,
  THead,
  TBody,
  Th,
  Tr,
  Td,
  EmptyState,
  Skeleton,
} from "@/components";
import { US_HEX_STATES } from "@/lib/geo/us-hexgrid";
import type { StateCoverage } from "@/modules/coverage/map";

// ADM-03: a single partner's home — profile, territory (their states on the hex
// map), lead history, and private admin notes (PRN-13). Read + link out to the
// Partners roster for edits. Admin-only (the API enforces role).
interface Territory {
  states: string[];
  zips: string[];
}
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
  leadCount: number;
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
  matchMethod: "zip" | "state_fallback" | "none";
  receivedAt: string;
}

const STATUS: Record<Partner["status"], { label: string; variant: "neutral" | "warn" | "success" }> = {
  not_invited: { label: "Not invited", variant: "neutral" },
  invited: { label: "Invited", variant: "warn" },
  active: { label: "Active", variant: "success" },
  revoked: { label: "Deactivated", variant: "neutral" },
};

const panel = "rounded-2xl border border-border-soft bg-surface p-5 shadow-sm";

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={panel}>
      <div className="text-xs font-medium text-text-2">{label}</div>
      <div className="mt-1.5 font-display text-2xl font-semibold leading-none tracking-tight tabular-nums">{value}</div>
    </div>
  );
}

function matchLabel(m: PartnerLead["matchMethod"]): string {
  return m === "zip" ? "ZIP" : m === "state_fallback" ? "State" : "—";
}

export default function PartnerDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const partnerQ = useQuery({
    queryKey: ["partner", id],
    queryFn: () => apiGet<{ partner: Partner }>(`/api/admin/partners/${id}`),
    enabled: Boolean(id),
  });
  const leadsQ = useQuery({
    queryKey: ["partner", id, "leads"],
    queryFn: () => apiGet<{ leads: PartnerLead[] }>(`/api/admin/partners/${id}/leads`),
    enabled: Boolean(id),
  });

  const partner = partnerQ.data?.partner;

  // Build the hex-map view model locally: only this partner's states are lit.
  const mapStates: StateCoverage[] = React.useMemo(() => {
    if (!partner) return [];
    const owned = new Set(partner.territory.states);
    return US_HEX_STATES.map((h) => {
      const mine = owned.has(h.code);
      return {
        code: h.code,
        name: h.name,
        partnerId: mine ? partner.id : null,
        partnerName: mine ? partner.name : null,
        refId: mine ? partner.refId : null,
        color: mine ? partner.color : null,
        leadCount: 0,
        gap: false,
      };
    });
  }, [partner]);

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
              </div>
            </div>
            <Link
              href="/partners"
              className="shrink-0 rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-semibold text-text-2 shadow-xs transition-colors hover:border-text-3 hover:bg-surface-2"
            >
              Edit on Partners →
            </Link>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Leads delivered" value={partner.leadCount} />
            <Stat label="States owned" value={partner.stateCount} />
            <Stat label="ZIP codes" value={partner.zipCount} />
          </div>

          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_320px]">
            {/* Territory */}
            <section className={panel}>
              <h2 className="mb-3 font-display text-[.95rem] font-semibold tracking-tight">Territory</h2>
              {partner.stateCount > 0 ? (
                <>
                  <CoverageMap states={mapStates} selectedPartnerId={partner.id} />
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {partner.territory.states.map((s) => (
                      <span key={s} className="num rounded-md bg-surface-3 px-1.5 py-0.5 text-[.68rem] font-semibold text-text-2">
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

            {/* Admin notes */}
            <aside className={panel}>
              <h2 className="mb-3 font-display text-[.95rem] font-semibold tracking-tight">Admin notes</h2>
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
              <h2 className="font-display text-[.95rem] font-semibold tracking-tight">Recent leads</h2>
              <span className="num text-xs text-text-3">last {leadsQ.data?.leads.length ?? 0}</span>
            </div>
            {leadsQ.isPending ? (
              <div className="flex flex-col gap-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
            ) : (leadsQ.data?.leads ?? []).length === 0 ? (
              <p className="py-4 text-center text-sm text-text-3">No leads delivered to this partner yet.</p>
            ) : (
              <Table>
                <THead>
                  <Tr><Th>Lead</Th><Th>Seller</Th><Th>Location</Th><Th>Via</Th><Th align="right">Received</Th></Tr>
                </THead>
                <TBody>
                  {leadsQ.data!.leads.map((l) => (
                    <Tr key={l.refId}>
                      <Td>
                        <Link href={`/leads/${l.refId}`} className="num text-xs font-medium text-brand hover:underline">
                          {l.refId}
                        </Link>
                      </Td>
                      <Td><span className="text-sm text-text-2">{l.seller}</span></Td>
                      <Td>
                        <span className="text-xs text-text-3">
                          {[l.city, l.state].filter(Boolean).join(", ")} <span className="num">{l.zip}</span>
                        </span>
                      </Td>
                      <Td><Badge variant={l.matchMethod === "zip" ? "zip" : "state"}>{matchLabel(l.matchMethod)}</Badge></Td>
                      <Td align="right"><span className="num text-xs text-text-3">{new Date(l.receivedAt).toLocaleDateString()}</span></Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}
