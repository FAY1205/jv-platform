"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { RunDetail, RunLeadView, PartnerView } from "@/modules/run/view-types";
import { Badge, Card, CardHeader, CardTitle, CardBody, Stat, PartnerTag, Table, THead, TBody, Th, Tr, Td, EmptyState, Skeleton } from "@/components";
import { TopBar, fmtDate } from "../_shell";

export default function RunDetailPage() {
  const params = useParams<{ ref: string }>();
  const ref = params.ref;
  const { data, isPending, error } = useQuery({
    queryKey: ["run", ref],
    queryFn: () => apiGet<RunDetail>(`/api/runs/${ref}`),
    enabled: Boolean(ref),
  });

  return (
    <div className="min-h-full">
      <TopBar />
      <main className="mx-auto max-w-[1160px] px-6 py-8">
        <Link href="/runs" className="mb-4 inline-block text-sm text-text-3 transition-colors hover:text-text-2">
          ← Runs
        </Link>
        {isPending ? <LoadingState /> : error ? <ErrorState message={(error as Error).message} /> : <RunView detail={data} />}
      </main>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-8 w-56" />
      <Card><CardBody><div className="grid grid-cols-2 gap-6 sm:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div></CardBody></Card>
      <Card><CardBody><Skeleton className="h-64 w-full" /></CardBody></Card>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return <Card><CardBody><EmptyState title="Couldn't load this run" description={message} /></CardBody></Card>;
}

function RunView({ detail }: { detail: RunDetail }) {
  const { upload, summary, distribution, partners, leads } = detail;

  const delivered = leads.filter((l) => l.mlsStatus === "kept" && l.partnerId);
  const removed = leads.filter((l) => l.mlsStatus === "removed");
  const unmatched = leads.filter((l) => l.partnerId === null && l.mlsStatus === "kept");

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
        <a
          href={`/api/runs/${upload.refId}/export`}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3.5 py-2 text-sm font-semibold text-text-2 shadow-xs transition-colors hover:border-text-3 hover:bg-surface-2"
        >
          <span aria-hidden="true">↓</span> Download Excel
        </a>
      </div>

      <Card className="mb-6">
        <CardBody>
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Total leads" value={summary.total} />
            <Stat label="Delivered" value={delivered.length} foot={`to ${distribution.length} ${distribution.length === 1 ? "partner" : "partners"}`} />
            <Stat label="Removed · MLS" value={summary.removed} />
            <Stat label="Unmatched" value={summary.unmatched} foot="coverage gaps" />
            <Stat label="Previously matched" value={summary.previouslyMatched} />
          </div>

          {distribution.length > 0 && (
            <div className="mt-7">
              <div className="mb-2 text-[.68rem] font-semibold uppercase tracking-wider text-text-3">Distribution</div>
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
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Distributed leads</CardTitle>
          <span className="text-xs text-text-3"><span className="num">{delivered.length}</span> delivered</span>
        </CardHeader>
        {delivered.length === 0 ? (
          <CardBody><EmptyState title="Nothing distributed" description="No leads matched partner coverage this run." /></CardBody>
        ) : (
          <Table>
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
                <GroupRows key={partnerId} info={partners[partnerId]} rows={rows} />
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
            <Table>
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
            <Table>
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
    </>
  );
}

function GroupRows({ info, rows }: { info: PartnerView | undefined; rows: RunLeadView[] }) {
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
          <Td rail={color}><span className="num text-text-2">{l.refId}</span></Td>
          <Td><Badge variant="neutral">{l.campaignCode}</Badge></Td>
          <Td>{l.address}, {l.city}</Td>
          <Td><span className="num">{l.zip}</span></Td>
          <Td>{l.matchMethod === "zip" ? <span className="text-xs font-medium text-brand">ZIP</span> : <span className="text-xs text-text-3">state</span>}</Td>
          <Td><PartnerTag size="sm" name={name} color={color} refId={refId} /></Td>
          <Td align="right">
            {l.previouslyMatched && (
              <span className="inline-flex items-center gap-1 rounded-full bg-prev-soft px-2 py-0.5 text-[.7rem] font-semibold text-prev">
                prev. matched
              </span>
            )}
          </Td>
        </Tr>
      ))}
    </>
  );
}
