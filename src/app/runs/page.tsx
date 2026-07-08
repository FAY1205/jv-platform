"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { RunListItem } from "@/modules/run/view-types";
import { Card, Table, THead, TBody, Th, Tr, Td, Badge, EmptyState, Skeleton } from "@/components";
import { TopBar, fmtDate } from "./_shell";

export default function RunsIndexPage() {
  const { data, isPending, error } = useQuery({
    queryKey: ["runs"],
    queryFn: () => apiGet<{ runs: RunListItem[] }>("/api/runs"),
  });

  return (
    <div className="min-h-full">
      <TopBar />
      <main className="mx-auto max-w-[1160px] px-6 py-8">
        <div className="mb-6 flex items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-text">Runs</h1>
            <p className="mt-1 text-sm text-text-2">Every weekly file processed through the pipeline.</p>
          </div>
          <Link
            href="/upload"
            className="inline-flex items-center gap-1.5 rounded-md border border-brand bg-brand px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-strong"
          >
            + New run
          </Link>
        </div>

        <Card>
          {isPending ? (
            <div className="flex flex-col gap-3 p-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : error ? (
            <div className="p-6">
              <EmptyState title="Couldn't load runs" description={(error as Error).message} />
            </div>
          ) : data.runs.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No runs yet" description="Process a weekly file to see it here." />
            </div>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Run</Th>
                  <Th>File</Th>
                  <Th align="right">Rows</Th>
                  <Th>Status</Th>
                  <Th align="right">Processed</Th>
                </Tr>
              </THead>
              <TBody>
                {data.runs.map((run) => (
                  <Tr key={run.refId} className="hover:bg-surface-2">
                    <Td>
                      <Link href={`/runs/${run.refId}`} className="num font-semibold text-brand hover:underline">
                        {run.refId}
                      </Link>
                    </Td>
                    <Td className="text-text-2">{run.filename}</Td>
                    <Td align="right"><span className="num text-text-2">{run.rowCount ?? "—"}</span></Td>
                    <Td>
                      <Badge variant={run.status === "processed" ? "success" : run.status === "voided" ? "removed" : "neutral"}>
                        {run.status}
                      </Badge>
                    </Td>
                    <Td align="right"><span className="num text-text-3">{fmtDate(run.createdAt)}</span></Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </main>
    </div>
  );
}
