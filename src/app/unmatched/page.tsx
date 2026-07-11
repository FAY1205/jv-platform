"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { apiGet } from "@/lib/api";
import { csrfHeaders } from "@/lib/csrf-client";
import {
  AppShell, Card, Badge, Button, Dialog, Select, Input, EmptyState, Skeleton,
  ToastProvider, useToast, CoverageMap, Table, THead, TBody, Th, Tr, Td, Pagination,
  RowOpenButton, DEFAULT_PAGE_SIZE, usePageHeader,
} from "@/components";
import type { StateCoverage } from "@/modules/coverage/map";
import { US_HEX_STATES } from "@/lib/geo/us-hexgrid";
import { formatWaiting } from "@/lib/waiting";

// ASN-03: the unmatched inbox. Per-state gap stats + a state map up top; a server-
// paginated leads table below (reuses /api/leads?partnerId=unmatched — no unbounded
// fetch, F-11). Each lead can be handed to a partner (additive, PRN-05); the row opens
// the shared LeadDialog (F-55).

const LeadDialog = dynamic(() => import("../leads/lead-dialog").then((m) => m.LeadDialog), { ssr: false });

interface Partner { id: string; refId: string; name: string; color: string }
interface StateStats { total: number; byState: { state: string; count: number }[] }
interface LeadRow {
  refId: string; seller: string; address: string; city: string | null; state: string | null;
  zip: string | null; campaign: string | null; receivedAt: string;
}
interface LeadsPage { leads: LeadRow[]; page: number; pageSize: number; total: number }

const PARTNER_PLACEHOLDER = "__choose__";

function AssignModal({ refId, onClose }: { refId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const roster = useQuery({ queryKey: ["partners"], queryFn: () => apiGet<{ partners: Partner[] }>("/api/admin/partners") });
  const [partnerId, setPartnerId] = React.useState(PARTNER_PLACEHOLDER);
  const [reason, setReason] = React.useState("");

  const assign = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/leads/${refId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ partnerId, reason: reason.trim() || undefined }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b?.message ?? "Assign failed.");
      return b as { message?: string };
    },
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: ["unmatched"] });
      qc.invalidateQueries({ queryKey: ["unmatched-stats"] });
      qc.invalidateQueries({ queryKey: ["coverage"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.toast(b.message ?? "Lead assigned.", "success");
      onClose();
    },
    onError: (e: Error) => toast.toast(e.message, "danger"),
  });

  const chosen = partnerId !== PARTNER_PLACEHOLDER;
  return (
    <Dialog
      open
      onClose={onClose}
      title={<span className="num">Assign {refId}</span>}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={assign.isPending}>Cancel</Button>
          <Button variant="primary" onClick={() => assign.mutate()} loading={assign.isPending} disabled={!chosen}>Assign lead</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Select
          label="Partner"
          value={partnerId}
          onValueChange={setPartnerId}
          options={[
            { value: PARTNER_PLACEHOLDER, label: "Choose a partner…" },
            ...(roster.data?.partners ?? []).map((p) => ({ value: p.id, label: `${p.name} (${p.refId})` })),
          ]}
        />
        <Input label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. covers this metro off-book" />
        <p className="text-[.8125rem] text-text-3">Recorded in the activity log. The lead&apos;s original &ldquo;unmatched&rdquo; record is kept — history isn&apos;t rewritten (PRN-05).</p>
      </div>
    </Dialog>
  );
}

function UnmatchedInner() {
  return (
    <AppShell>
      <UnmatchedBody />
    </AppShell>
  );
}

function UnmatchedBody() {
  usePageHeader({ title: "Unmatched" });
  // Snapshot "now" at mount (waiting times are a snapshot, not a live ticker) — keeps
  // Date.now() out of the render body (react-hooks/purity).
  const [now] = React.useState(() => Date.now());
  const statsQ = useQuery({ queryKey: ["unmatched-stats"], queryFn: () => apiGet<StateStats>("/api/leads/unmatched") });
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState<number>(DEFAULT_PAGE_SIZE);
  const [assigningRef, setAssigningRef] = React.useState<string | null>(null);
  const [openRef, setOpenRef] = React.useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ["unmatched", "list", page, pageSize],
    queryFn: () => apiGet<LeadsPage>(`/api/leads?partnerId=unmatched&sort=received&dir=desc&page=${page}&pageSize=${pageSize}`),
  });

  const stats = statsQ.data;
  const gapMapStates: StateCoverage[] = React.useMemo(() => {
    const byCode = new Map((stats?.byState ?? []).filter((g) => g.state !== "—").map((g) => [g.state, g.count]));
    return US_HEX_STATES.map((h) => {
      const count = byCode.get(h.code);
      return count
        ? { code: h.code, name: h.name, partnerId: "gap", partnerName: `${count} unmatched lead${count === 1 ? "" : "s"}`, refId: null, color: "var(--warn)", leadCount: count, gap: true }
        : { code: h.code, name: h.name, partnerId: null, partnerName: null, refId: null, color: null, leadCount: 0, gap: false };
    });
  }, [stats]);

  return (
    <>
      {statsQ.isPending ? (
        <div className="flex flex-col gap-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
      ) : statsQ.error ? (
        <Card><div className="p-6"><EmptyState title="Couldn't load unmatched leads" description={(statsQ.error as Error).message} /></div></Card>
      ) : (stats?.total ?? 0) === 0 ? (
        <Card><div className="p-8"><EmptyState title="Nothing unmatched — full coverage" description="Every lead you've processed reached a partner. New gaps will show up here." /></div></Card>
      ) : (
        <div className="flex flex-col gap-5">
          {/* Stats row */}
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border-soft bg-surface p-4 shadow-sm">
            <span className="text-sm text-text-2"><span className="num font-semibold text-text">{stats!.total}</span> unmatched across <span className="num font-semibold text-text">{stats!.byState.length}</span> state{stats!.byState.length === 1 ? "" : "s"}:</span>
            {stats!.byState.map((g) => (
              <span key={g.state} className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-2.5 py-0.5 text-xs font-semibold text-warn">
                <span className="num">{g.state}</span> <span className="num">{g.count}</span>
              </span>
            ))}
          </div>

          {/* State map */}
          <section className="rounded-2xl border border-border-soft bg-surface p-5 shadow-sm">
            <h2 className="mb-4 font-display text-[.95rem] font-semibold tracking-tight">Where the gaps are</h2>
            <CoverageMap states={gapMapStates} />
            <p className="mt-3 text-[.8125rem] text-text-3">States with unmatched leads carry a warn ring. Recruiting a partner (or adding a state rule) there closes the gap.</p>
          </section>

          {/* Paginated table (reuses the leads list; F-11) */}
          <Card>
            {listQ.isPending ? (
              <div className="flex flex-col gap-3 p-5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
            ) : listQ.error ? (
              <div className="p-6"><EmptyState title="Couldn't load the list" description={(listQ.error as Error).message} /></div>
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>Lead</Th><Th>Seller</Th><Th>Property</Th><Th>Source</Th>
                    <Th align="right">Waiting</Th><Th align="right">Assign</Th>
                  </Tr>
                </THead>
                <TBody>
                  {listQ.data!.leads.map((l) => (
                    <Tr key={l.refId} className="hover:bg-surface-2">
                      <Td><RowOpenButton className="text-xs" onClick={() => setOpenRef(l.refId)}>{l.refId}</RowOpenButton></Td>
                      <Td><span className="text-sm text-text">{l.seller}</span></Td>
                      <Td><span className="text-sm text-text-2">{l.address}</span> <span className="text-xs text-text-3">{[l.city, l.state].filter(Boolean).join(", ")} <span className="num">{l.zip}</span></span></Td>
                      <Td>{l.campaign ? <Badge variant="neutral">{l.campaign}</Badge> : <span className="text-xs text-text-3">—</span>}</Td>
                      <Td align="right"><span className="num tabular-nums text-text-2" title={new Date(l.receivedAt).toLocaleString()}>{formatWaiting(l.receivedAt, now)}</span></Td>
                      <Td align="right"><Button size="sm" variant="primary" onClick={() => setAssigningRef(l.refId)}>Assign →</Button></Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
          {listQ.data && listQ.data.total > 0 && (
            <Pagination page={listQ.data.page} pageSize={listQ.data.pageSize} total={listQ.data.total} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />
          )}
        </div>
      )}

      {assigningRef && <AssignModal refId={assigningRef} onClose={() => setAssigningRef(null)} />}
      {openRef && <LeadDialog refId={openRef} onClose={() => setOpenRef(null)} />}
    </>
  );
}

export default function UnmatchedPage() {
  return (
    <ToastProvider>
      <UnmatchedInner />
    </ToastProvider>
  );
}
