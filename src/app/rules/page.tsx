"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { Card, CardBody, Skeleton, EmptyState, AppShell, usePageHeader } from "@/components";
import { LockedNote, MlsPhrasesCard, type MlsPhrase } from "./mls-phrases";

// WS-6 · CVG-02: the Rules area — MLS filter phrases only. READ-ONLY (2026-08-01, owner
// note): the phrase set and whether each runs are fixed in code (seed + migrations, PRN-04);
// there is no runtime edit path. Coverage moved to Partners (WS-5); recodes removed
// (ADR-0018). Every run captures the live rules into an immutable snapshot (DM-08).

interface RulesData { mlsPatterns: MlsPhrase[] }

function RulesBody() {
  usePageHeader({ title: "Rules" });
  const { data, isPending, error } = useQuery({ queryKey: ["rules"], queryFn: () => apiGet<RulesData>("/api/admin/rules") });

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div>
        <p className="text-sm text-text-2">These are the phrases that decide which already-listed properties are removed before leads are routed to partners.</p>
        <LockedNote />
      </div>

      {error ? (
        <Card><CardBody><EmptyState title="Couldn't load rules" description={(error as Error).message} /></CardBody></Card>
      ) : isPending ? (
        <Skeleton className="h-40" />
      ) : (
        <MlsPhrasesCard patterns={data.mlsPatterns} />
      )}
    </div>
  );
}

export default function RulesPage() {
  return (
    <AppShell>
      <RulesBody />
    </AppShell>
  );
}
