"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { Card, CardBody, Skeleton, QueryErrorState, AppShell, usePageHeader } from "@/components";
import { LockedNote, MlsPhrasesCard, type MlsPhrase } from "./mls-phrases";
import { ScoringCard } from "./scoring-card";

// WS-6 · CVG-02: the Rules area — MLS filter phrases only. READ-ONLY (2026-08-01, owner
// note): the phrase set and whether each runs are fixed in code (seed + migrations, PRN-04);
// there is no runtime edit path. Coverage moved to Partners (WS-5); recodes removed
// (ADR-0018). Every run captures the live rules into an immutable snapshot (DM-08).

interface RulesData { mlsPatterns: MlsPhrase[] }

function RulesBody() {
  usePageHeader({ title: "Rules" });
  const { data, isPending, error, refetch } = useQuery({ queryKey: ["rules"], queryFn: () => apiGet<RulesData>("/api/admin/rules") });

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div>
        <p className="text-sm text-text-2">How the import decides which leads are removed as already-listed, and how every kept lead is scored.</p>
        <LockedNote />
      </div>

      <ScoringCard />

      {error ? (
        <Card><CardBody><QueryErrorState title="Couldn't load rules" error={error} onRetry={() => refetch()} /></CardBody></Card>
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
