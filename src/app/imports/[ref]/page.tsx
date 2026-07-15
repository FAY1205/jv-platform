"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { csrfHeaders } from "@/lib/csrf-client";
import type { RunDetail, RunLeadView, PartnerView } from "@/modules/run/view-types";
import { buildAnalytics } from "@/modules/analytics/overview";
import { Badge, Button, Dialog, Textarea, Card, CardHeader, CardTitle, CardBody, PartnerTag, Table, THead, TBody, Th, Tr, Td, RowOpenButton, EmptyState, Skeleton, AppShell, useToast } from "@/components";
import { fmtDate } from "../_shell";
import { isWithinVoidWindow } from "@/modules/run/void-window";

// F-55: leads open in the shared dialog, not the old read-only /leads/[ref] page.
const LeadDialog = dynamic(() => import("../../leads/lead-dialog").then((m) => m.LeadDialog), { ssr: false });

export default function ImportDetailPage() {
  const params = useParams<{ ref: string }>();
  const ref = params.ref;
  const { data, isPending, error } = useQuery({
    queryKey: ["run", ref],
    queryFn: () => apiGet<RunDetail>(`/api/runs/${ref}`),
    enabled: Boolean(ref),
  });

  return (
    <AppShell>
        <Link href="/imports" className="mb-4 inline-block text-sm text-text-3 transition-colors hover:text-text-2">
          ← Imports
        </Link>
        {isPending ? <LoadingState /> : error ? <ErrorState message={(error as Error).message} /> : <RunView detail={data} />}
    </AppShell>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-8 w-56" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
      <Card><CardBody><Skeleton className="h-64 w-full" /></CardBody></Card>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return <Card><CardBody><EmptyState title="Couldn't load this import" description={message} /></CardBody></Card>;
}

// Import pipeline funnel (mockup 14): Imported → Removed → Distributed → Unmatched.
// A stage view (not strict arithmetic — dedupe drops + previously-matched overlap).
function Funnel({ steps }: { steps: { v: number; label: string; desc: string; tone: "neutral" | "warn" | "brand" }[] }) {
  const toneCls = { neutral: "text-text", warn: "text-warn", brand: "text-brand-ink" } as const;
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {steps.map((s, i) => (
        <div key={s.label} className="relative rounded-2xl border border-border-soft bg-surface p-4 shadow-sm">
          <div className={`font-display text-2xl font-semibold leading-none tabular-nums ${toneCls[s.tone]}`}>{s.v.toLocaleString()}</div>
          <div className="mt-1.5 text-step-1 font-semibold uppercase tracking-[.05em] text-text-3">{s.label}</div>
          <div className="mt-0.5 text-step-1 text-text-3">{s.desc}</div>
          {i < steps.length - 1 && (
            <span aria-hidden="true" className="absolute -right-2.5 top-1/2 hidden -translate-y-1/2 text-lg text-text-3 sm:block">→</span>
          )}
        </div>
      ))}
    </div>
  );
}

function RunView({ detail }: { detail: RunDetail }) {
  const { upload, summary, distribution, partners, leads } = detail;
  const qc = useQueryClient();
  const { toast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [openRef, setOpenRef] = useState<string | null>(null);
  const isVoided = upload.status === "voided";
  // WP-J1 (ING-09): void is a bounded undo — only within 10 min of import. Snapshot at mount
  // (server is authoritative; this only gates the button). new Date in a useState initializer
  // keeps render pure (mirrors the WS-4 `now` snapshot pattern).
  const [voidWindowOpen] = useState(() => isWithinVoidWindow(new Date(upload.createdAt), new Date()));

  const voidMut = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/runs/${upload.refId}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ reason }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b?.message ?? "Void failed.");
      return b;
    },
    onSuccess: (result: { recalledLeadCount?: number }) => {
      qc.invalidateQueries({ queryKey: ["run", upload.refId] });
      qc.invalidateQueries({ queryKey: ["runs"] });
      // Voiding removes this import's leads and excludes them from analytics — invalidate
      // every aggregate that counted them (F-1), mirroring the assign flow.
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["coverage"] });
      qc.invalidateQueries({ queryKey: ["unmatched"] });
      qc.invalidateQueries({ queryKey: ["unmatched-stats"] });
      setModalOpen(false);
      setReason("");
      const n = result?.recalledLeadCount ?? 0;
      toast(n > 0 ? `Import voided — ${n} lead${n === 1 ? "" : "s"} removed.` : "Import voided.", "success");
    },
  });

  // All lead-derived views are memoized on the query data so typing a void reason (or
  // any unrelated state change) doesn't re-filter/re-analyze the whole import (F-2/FEP-06).
  // F-75: Distributed reads the server run summary's per-partner counts (PRN-15), not a
  // client re-derivation; the routing composition comes from the analytics module.
  const { delivered, removed, unmatched, distributed, composition, keptTotal, groups } = useMemo(() => {
    const delivered = leads.filter((l) => l.mlsStatus === "kept" && l.partnerId);
    const removed = leads.filter((l) => l.mlsStatus === "removed");
    const unmatched = leads.filter((l) => l.partnerId === null && l.mlsStatus === "kept");
    const distributed = summary.perPartner.reduce((sum, pp) => sum + pp.count, 0);
    const composition = buildAnalytics(
      leads.map((l) => ({
        uploadId: upload.refId,
        mlsStatus: l.mlsStatus,
        matchMethod: l.matchMethod,
        partnerId: l.partnerId,
        mlsReason: null,
        previouslyMatched: l.previouslyMatched,
      })),
      [],
    ).matchBreakdown;
    const keptTotal = composition.zip + composition.stateFallback + composition.unmatched;
    const byPartner = new Map<string, RunLeadView[]>();
    for (const l of delivered) {
      const bucket = byPartner.get(l.partnerId!);
      if (bucket) bucket.push(l);
      else byPartner.set(l.partnerId!, [l]);
    }
    const groups = [...byPartner.entries()].sort((a, b) => {
      const ra = partners[a[0]]?.refId ?? a[0];
      const rb = partners[b[0]]?.refId ?? b[0];
      return ra < rb ? -1 : ra > rb ? 1 : 0;
    });
    return { delivered, removed, unmatched, distributed, composition, keptTotal, groups };
  }, [leads, partners, summary, upload.refId]);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-1.5 flex items-center gap-2.5">
            <h1 className="num text-2xl font-semibold tracking-tight text-text">{upload.refId}</h1>
            <Badge variant={upload.status === "processed" ? "success" : upload.status === "voided" ? "removed" : "neutral"}>
              {upload.status}
            </Badge>
          </div>
          <p className="text-sm text-text-2">
            {upload.filename} · <span className="num">{upload.rowCount ?? leads.length}</span> rows · processed {fmtDate(upload.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isVoided && (
            <a
              href={`/api/runs/${upload.refId}/export`}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3.5 py-2 text-sm font-semibold text-text-2 shadow-xs transition-colors hover:border-text-3 hover:bg-surface-2"
            >
              <span aria-hidden="true">↓</span> Download Excel
            </a>
          )}
          {!isVoided && voidWindowOpen && (
            <Button variant="ghost" onClick={() => setModalOpen(true)}>
              Void import
            </Button>
          )}
        </div>
      </div>

      {!isVoided && !voidWindowOpen && (
        <div className="mb-6 rounded-lg border border-border bg-surface-2 px-4 py-3 text-step-1 text-text-3">
          The 10-minute window to void this import has closed — voiding is only available right after an import.
        </div>
      )}

      {isVoided && (
        <div className="mb-6 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
          This import was voided{upload.voidReason ? ` — ${upload.voidReason}` : ""}. Its leads are excluded from
          future dedupe, analytics and exports.
        </div>
      )}

      <Funnel
        steps={[
          { v: upload.rowCount ?? leads.length, label: "Imported", desc: "rows read", tone: "neutral" },
          { v: summary.removed, label: "Removed", desc: "by MLS rules", tone: "warn" },
          { v: distributed, label: "Distributed", desc: `to ${distribution.length} ${distribution.length === 1 ? "partner" : "partners"}`, tone: "brand" },
          { v: summary.unmatched, label: "Unmatched", desc: "no coverage", tone: "warn" },
        ]}
      />
      {summary.previouslyMatched > 0 && (
        <p className="-mt-3 mb-6 text-step-1 text-text-3">
          <span className="num font-semibold text-text-2">{summary.previouslyMatched}</span> previously matched (excluded from distribution).
        </p>
      )}

      {(distribution.length > 0 || keptTotal > 0) && (
      <Card className="mb-6">
        <CardBody>
          {distribution.length > 0 && (
            <div>
              <div className="mb-2 text-step-1 font-semibold uppercase tracking-wider text-text-3">Distribution</div>
              <div className="flex h-2.5 overflow-hidden rounded-full">
                {distribution.map((d) => (
                  <div key={d.partnerId} style={{ flexGrow: d.count, background: d.color }} title={`${d.name}: ${d.count}`} />
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                {distribution.map((d) => (
                  <span key={d.partnerId} className="inline-flex items-center gap-2">
                    <PartnerTag size="sm" name={d.name} color={d.color} refId={d.refId} />
                    <span className="num text-sm font-semibold text-text">{d.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {keptTotal > 0 && (
            <div className="mt-6">
              <div className="mb-2 text-step-1 font-semibold uppercase tracking-wider text-text-3">How leads routed</div>
              <div className="flex h-2.5 overflow-hidden rounded-full">
                {composition.zip > 0 && <div style={{ flexGrow: composition.zip, background: "var(--brand)" }} title={`ZIP match: ${composition.zip}`} />}
                {composition.stateFallback > 0 && <div style={{ flexGrow: composition.stateFallback, background: "var(--info)" }} title={`State fallback: ${composition.stateFallback}`} />}
                {composition.unmatched > 0 && <div style={{ flexGrow: composition.unmatched, background: "var(--warn)" }} title={`Unmatched: ${composition.unmatched}`} />}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-2">
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: "var(--brand)" }} /> ZIP match <b className="num">{composition.zip}</b></span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: "var(--info)" }} /> State fallback <b className="num">{composition.stateFallback}</b></span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: "var(--warn)" }} /> Unmatched <b className="num">{composition.unmatched}</b></span>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Distributed leads</CardTitle>
          <span className="text-xs text-text-3"><span className="num">{delivered.length}</span> distributed</span>
        </CardHeader>
        {delivered.length === 0 ? (
          <CardBody><EmptyState title="Nothing distributed" description="No leads matched partner coverage in this import." /></CardBody>
        ) : (
          <Table ariaLabel="Distributed leads">
            <THead>
              <Tr>
                <Th>Lead ID</Th>
                <Th>Campaign</Th>
                <Th>Property</Th>
                <Th>ZIP</Th>
                <Th>Match</Th>
                <Th>Partner</Th>
                <Th align="right">Flags</Th>
              </Tr>
            </THead>
            <TBody>
              {groups.map(([partnerId, rows]) => (
                <GroupRows key={partnerId} info={partners[partnerId]} rows={rows} onOpen={setOpenRef} />
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Removed · listed on MLS</CardTitle>
            <span className="text-xs text-text-3"><span className="num">{removed.length}</span></span>
          </CardHeader>
          {removed.length === 0 ? (
            <CardBody><EmptyState title="Nothing removed" description="No leads matched an MLS-listed pattern." /></CardBody>
          ) : (
            <Table ariaLabel="Removed leads">
              <THead><Tr><Th>Lead ID</Th><Th>Property</Th><Th>Matched pattern</Th></Tr></THead>
              <TBody>
                {removed.map((l) => (
                  <Tr key={l.refId}>
                    <Td><span className="num text-text-2">{l.refId}</span></Td>
                    <Td>{l.address}, {l.city} <span className="num text-text-3">{l.state}</span></Td>
                    <Td><Badge variant="removed">{l.mlsPatternKey ?? "mls"}</Badge></Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Unmatched · coverage gaps</CardTitle>
            <span className="text-xs text-text-3"><span className="num">{unmatched.length}</span></span>
          </CardHeader>
          {unmatched.length === 0 ? (
            <CardBody><EmptyState title="Full coverage" description="Every lead routed to a partner." /></CardBody>
          ) : (
            <Table ariaLabel="Unmatched leads">
              <THead><Tr><Th>Lead ID</Th><Th>Property</Th><Th>State</Th><Th align="right">ZIP</Th></Tr></THead>
              <TBody>
                {unmatched.map((l) => (
                  <Tr key={l.refId}>
                    <Td><span className="num text-text-2">{l.refId}</span></Td>
                    <Td>{l.address}, {l.city}</Td>
                    <Td><span className="num">{l.state}</span></Td>
                    <Td align="right"><span className="num text-text-2">{l.zip}</span></Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>

      <Dialog
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={<span>Void <span className="num">{upload.refId}</span>?</span>}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={voidMut.isPending}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => voidMut.mutate()}
              loading={voidMut.isPending}
              disabled={reason.trim().length < 3}
            >
              Void import
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-text-2">
          Voiding <span className="num font-semibold text-text">{upload.refId}</span> ({upload.filename}) marks the run voided in
          history and excludes its leads from dedupe, analytics and exports. Only available within 10 minutes of an import; this can&apos;t be undone.
        </p>
        {distributed > 0 && (
          <p className="mb-3 text-sm text-text-2">
            This <span className="font-semibold text-text">recalls</span> the{" "}
            <span className="num font-semibold text-text">{distributed}</span> lead{distributed === 1 ? "" : "s"} already delivered:{" "}
            {distributed === 1 ? "it is" : "they are"} removed from the partner{distributed === 1 ? "’s" : "s’"} lists,
            exports and stats (still visible here as voided), and affected partners are notified unless you&apos;ve turned that off
            in Settings.
          </p>
        )}
        <Textarea
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="e.g. wrong file uploaded"
          hint="Required — at least 3 characters. Recorded in the activity log as why this run was voided."
          error={voidMut.isError ? (voidMut.error as Error).message : undefined}
        />
      </Dialog>

      {openRef && <LeadDialog refId={openRef} onClose={() => setOpenRef(null)} />}
    </>
  );
}

function GroupRows({ info, rows, onOpen }: { info: PartnerView | undefined; rows: RunLeadView[]; onOpen: (ref: string) => void }) {
  const name = info?.name ?? "Unknown partner";
  const color = info?.color ?? "var(--text-3)";
  const refId = info?.refId ?? "";
  return (
    <>
      <tr>
        <td colSpan={7} className="border-b border-border-soft bg-surface-2/60 px-3.5 py-2">
          <span className="inline-flex items-center gap-2">
            <PartnerTag size="sm" name={name} color={color} refId={refId} />
            <span className="num text-xs text-text-3">{rows.length} {rows.length === 1 ? "lead" : "leads"}</span>
          </span>
        </td>
      </tr>
      {rows.map((l) => (
        <Tr key={l.refId} accent={color}>
          <Td rail={color}><RowOpenButton onClick={() => onOpen(l.refId)}>{l.refId}</RowOpenButton></Td>
          <Td><Badge variant="neutral">{l.campaign}</Badge></Td>
          <Td>{l.address}, {l.city}</Td>
          <Td><span className="num">{l.zip}</span></Td>
          <Td>{l.matchMethod === "zip" ? <span className="text-xs font-medium text-brand-ink">ZIP</span> : <span className="text-xs text-text-3">state</span>}</Td>
          <Td><PartnerTag size="sm" name={name} color={color} refId={refId} /></Td>
          <Td align="right">
            {l.previouslyMatched && (
              <span className="inline-flex items-center gap-1 rounded-full bg-prev-soft px-2 py-0.5 text-step-1 font-semibold text-prev">
                prev. matched
              </span>
            )}
          </Td>
        </Tr>
      ))}
    </>
  );
}
