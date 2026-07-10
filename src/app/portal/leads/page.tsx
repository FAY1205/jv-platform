"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Table,
  THead,
  TBody,
  Th,
  Tr,
  Td,
  Badge,
  Button,
  EmptyState,
  Skeleton,
} from "@/components";

interface Lead {
  refId: string;
  sellerFirst: string;
  sellerLast: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  receivedAt: string;
  status: string;
  previouslyMatched: boolean;
}
interface LeadsPage {
  leads: Lead[];
  page: number;
  pageSize: number;
  total: number;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

export default function PortalLeadsPage() {
  const [page, setPage] = React.useState(1);
  const { data, isLoading, error } = useQuery({
    queryKey: ["portal-leads", page],
    queryFn: () => apiGet<LeadsPage>(`/api/portal/leads?page=${page}`),
  });

  const leads = data?.leads ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 50;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 p-6">
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Your leads</CardTitle>
          <a href="/api/portal/leads/export" download>
            <Button variant="secondary" size="lg">
              Export .xlsx
            </Button>
          </a>
        </CardHeader>
        <CardBody>
          {error ? (
            <EmptyState title="Couldn't load your leads" description={(error as Error).message} />
          ) : isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : leads.length === 0 ? (
            <EmptyState title="No leads yet" description="Leads assigned to you will appear here after the next upload." />
          ) : (
            <>
              <Table>
                <THead>
                  <Tr>
                    <Th>Reference</Th>
                    <Th>Seller</Th>
                    <Th>Property</Th>
                    <Th>Status</Th>
                    <Th>Received</Th>
                  </Tr>
                </THead>
                <TBody>
                  {leads.map((l) => (
                    <Tr key={l.refId}>
                      <Td>
                        <Link href={`/portal/leads/${l.refId}`} className="font-mono text-sm text-brand hover:underline">
                          {l.refId}
                        </Link>
                      </Td>
                      <Td>
                        {l.sellerFirst} {l.sellerLast}
                      </Td>
                      <Td className="text-text-2">
                        {l.address}, {l.city} {l.state} <span className="font-mono">{l.zip}</span>
                      </Td>
                      <Td>
                        <Badge>{l.status}</Badge>
                        {l.previouslyMatched && <span className="ml-1 text-xs text-text-3">(returning)</span>}
                      </Td>
                      <Td className="font-mono text-xs text-text-3">{fmtDate(l.receivedAt)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between text-sm text-text-3">
                  <span>
                    Page <span className="font-mono">{page}</span> of <span className="font-mono">{totalPages}</span> ·{" "}
                    <span className="font-mono">{total}</span> leads
                  </span>
                  <div className="flex gap-2">
                    <Button variant="secondary" size="lg" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                      Previous
                    </Button>
                    <Button variant="secondary" size="lg" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardBody>
      </Card>
    </main>
  );
}
