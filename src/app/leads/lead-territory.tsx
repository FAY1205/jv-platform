"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { Skeleton } from "@/components";
import { routingExplanation } from "@/lib/match-method";
import type { CoverageMapResponse } from "@/modules/coverage/map";

// The "matchcard" (mockup 02) — the matching moment for a matched lead: the partner's
// territory highlighted on the real coverage map + a plain-language routing reason.
// Map geometry (~0.9 MB) is code-split so opening a lead never blocks on it; PRN-14 is
// kept by the map caption naming the partner + JV-### alongside the colored fills.
const CountyCoverageMap = dynamic(() => import("@/components/CountyCoverageMap").then((m) => m.CountyCoverageMap), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-lg" />,
});

export interface LeadTerritoryProps {
  partner: { id: string; name: string; refId: string; color: string };
  manual: boolean;
  matchMethod: string;
  zip: string;
  state: string;
}

export function LeadTerritory({ partner, manual, matchMethod, zip, state }: LeadTerritoryProps) {
  const coverage = useQuery({ queryKey: ["coverage"], queryFn: () => apiGet<CoverageMapResponse>("/api/coverage") });
  const why = routingExplanation({ partnerName: partner.name, manual, matchMethod, zip, state });
  return (
    <section className="overflow-hidden rounded-xl border border-border-soft bg-surface-2">
      <div className="p-3">
        {/* Fixed aspect (matches the map geometry 960×600) so skeleton→map doesn't jump. */}
        <div className="relative aspect-[960/600] w-full">
          {coverage.data ? (
            <CountyCoverageMap
              states={coverage.data.states}
              selectedPartnerId={partner.id}
              caption={{ title: partner.name, subtitle: partner.refId }}
              interactive={false}
            />
          ) : coverage.isError ? (
            <div role="status" className="grid h-full place-items-center text-sm text-text-3">Territory map unavailable.</div>
          ) : (
            <Skeleton className="h-full w-full rounded-lg" />
          )}
        </div>
      </div>
      <div className="border-t border-border-soft px-4 py-3">
        <p className="text-sm text-text-2">{why}</p>
        {/* Honesty caveat: the map is state-level, but a ZIP match is more precise —
            the full state-vs-ZIP territory treatment is a tracked follow-up. */}
        {matchMethod === "zip" && (
          <p className="mt-1 text-[.8125rem] text-text-3">Map shows state-level coverage; this lead matched a ZIP-level override.</p>
        )}
      </div>
    </section>
  );
}
