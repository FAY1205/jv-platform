"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { csrfHeaders } from "@/lib/csrf-client";
import {
  AppShell,
  Card,
  Badge,
  Button,
  Modal,
  Select,
  EmptyState,
  Skeleton,
  ToastProvider,
  useToast,
} from "@/components";
import type { UnmatchedGroup, UnmatchedLead } from "@/modules/leads/unmatched";

// ASN-03: the unmatched inbox. Leads no partner covers, grouped by state (biggest
// gap first). Each can be handed to a partner (audited, additive — the original
// "unmatched" snapshot is preserved, PRN-05).
interface Partner {
  id: string;
  refId: string;
  name: string;
  color: string;
}

function AssignModal({ lead, onClose }: { lead: UnmatchedLead; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const roster = useQuery({ queryKey: ["partners"], queryFn: () => apiGet<{ partners: Partner[] }>("/api/admin/partners") });
  const [partnerId, setPartnerId] = React.useState("");
  const [reason, setReason] = React.useState("");

  const assign = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/leads/${lead.refId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ partnerId, reason: reason.trim() || undefined }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b?.message ?? "Assign failed.");
      return b;
    },
    onSuccess: (b: { message: string }) => {
      qc.invalidateQueries({ queryKey: ["unmatched"] });
      qc.invalidateQueries({ queryKey: ["coverage"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      toast.toast(b.message ?? "Lead assigned.", "success");
      onClose();
    },
    onError: (e: Error) => toast.toast(e.message, "danger"),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Assign this lead to a partner"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={assign.isPending}>Cancel</Button>
          <Button variant="primary" onClick={() => assign.mutate()} loading={assign.isPending} disabled={!partnerId}>
            Assign lead
          </Button>
        </>
      }
    >
      <div className="mb-4 rounded-lg border border-border-soft bg-surface-2 px-3.5 py-2.5 text-sm">
        <div className="num font-semibold text-brand">{lead.refId}</div>
        <div className="text-text-2">{lead.seller}</div>
        <div className="text-xs text-text-3">{lead.address}, {lead.city} <span className="num">{lead.state} {lead.zip}</span></div>
      </div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-3">Partner</label>
      <Select value={partnerId} onChange={(e) => setPartnerId(e.target.value)} aria-label="Partner">
        <option value="">Choose a partner…</option>
        {(roster.data?.partners ?? []).map((p) => (
          <option key={p.id} value={p.id}>{p.name} ({p.refId})</option>
        ))}
      </Select>
      <label className="mb-1.5 mt-4 block text-xs font-semibold uppercase tracking-wider text-text-3">Reason (optional)</label>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. covers this metro off-book"
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none transition-colors focus-visible:border-brand"
      />
      <p className="mt-3 text-xs text-text-3">
        This is recorded in the activity log. The lead&apos;s original &ldquo;unmatched&rdquo; record is kept — history isn&apos;t rewritten.
      </p>
    </Modal>
  );
}

function UnmatchedInner() {
  const { data, isPending, error } = useQuery({
    queryKey: ["unmatched", "list"],
    queryFn: () => apiGet<{ groups: UnmatchedGroup[] }>("/api/leads/unmatched"),
  });
  const [assigning, setAssigning] = React.useState<UnmatchedLead | null>(null);
  const total = (data?.groups ?? []).reduce((sum, g) => sum + g.count, 0);

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-text">Unmatched</h1>
        <p className="mt-1 text-sm text-text-2">Leads no partner covers yet — hand each to a partner, or use the pattern to recruit one.</p>
      </div>

      {isPending ? (
        <div className="flex flex-col gap-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
      ) : error ? (
        <Card><div className="p-6"><EmptyState title="Couldn't load unmatched leads" description={(error as Error).message} /></div></Card>
      ) : total === 0 ? (
        <Card><div className="p-8"><EmptyState title="Nothing unmatched — full coverage" description="Every lead you've processed reached a partner. New gaps will show up here." /></div></Card>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="text-sm text-text-2"><span className="num font-semibold text-text">{total}</span> lead{total === 1 ? "" : "s"} across <span className="num font-semibold text-text">{data!.groups.length}</span> state{data!.groups.length === 1 ? "" : "s"} need a home.</div>
          {data!.groups.map((g) => (
            <section key={g.state} className="overflow-hidden rounded-2xl border border-border-soft bg-surface shadow-sm">
              <div className="flex flex-wrap items-center gap-3 border-b border-border-soft bg-surface-2 px-5 py-3">
                <span className="num rounded-md bg-warn-soft px-2 py-0.5 text-sm font-bold text-warn">{g.state}</span>
                <span className="text-sm font-semibold text-text">{g.count} unmatched lead{g.count === 1 ? "" : "s"}</span>
                {g.zips.length > 0 && (
                  <span className="num ml-auto text-xs text-text-3">ZIPs: {g.zips.slice(0, 8).join(", ")}{g.zips.length > 8 ? "…" : ""}</span>
                )}
              </div>
              <div className="flex flex-col">
                {g.leads.map((l) => (
                  <div key={l.refId} className="flex flex-wrap items-center gap-3 border-t border-border-soft px-5 py-3 first:border-t-0">
                    <Link href={`/leads/${l.refId}`} className="num text-xs font-semibold text-brand hover:underline">{l.refId}</Link>
                    <span className="text-sm text-text">{l.seller}</span>
                    <span className="text-xs text-text-3">{l.address}, {l.city} <span className="num">{l.zip}</span></span>
                    {l.campaign && <Badge variant="neutral">{l.campaign}</Badge>}
                    <Button size="sm" variant="primary" className="ml-auto" onClick={() => setAssigning(l)}>
                      Assign →
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {assigning && <AssignModal lead={assigning} onClose={() => setAssigning(null)} />}
    </AppShell>
  );
}

export default function UnmatchedPage() {
  return (
    <ToastProvider>
      <UnmatchedInner />
    </ToastProvider>
  );
}
