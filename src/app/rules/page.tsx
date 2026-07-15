"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { csrfHeaders } from "@/lib/csrf-client";
import { Card, CardBody, Skeleton, EmptyState, useToast, AppShell, usePageHeader } from "@/components";
import { LockedNote, MlsPhrasesCard, type MlsPhrase } from "./mls-phrases";

// WS-6 · CVG-02: the Rules area — MLS filter phrases only. Phrases are view + on/off +
// label (never regex, PRN-04). The exact matching is vetted and tested, so the wording
// here can't change how a phrase matches — surfaced to the user via the locked-note pill.
// Coverage moved to Partners (WS-5); recodes removed (ADR-0018). Every change is audited
// and picked up by the next run (DM-08). The toggle touches only ["rules"] — no
// coverage/dashboard cache is involved.

interface RulesData { mlsPatterns: MlsPhrase[] }

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: body === undefined ? "{}" : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { message?: string }).message ?? "Request failed");
  return json;
}

function RulesBody() {
  usePageHeader({ title: "Rules" });
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isPending, error } = useQuery({ queryKey: ["rules"], queryFn: () => apiGet<RulesData>("/api/admin/rules") });

  const toggleMls = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => send(`/api/admin/rules/mls/${v.id}`, "PATCH", { enabled: v.enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rules"] }),
    onError: (e: Error) => toast(e.message, "danger"),
  });

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div>
        <p className="text-sm text-text-2">MLS filter phrases decide which listings are removed before routing. Changes apply to future runs and are logged.</p>
        <LockedNote />
      </div>

      {error ? (
        <Card><CardBody><EmptyState title="Couldn't load rules" description={(error as Error).message} /></CardBody></Card>
      ) : isPending ? (
        <Skeleton className="h-40" />
      ) : (
        <MlsPhrasesCard
          patterns={data.mlsPatterns}
          onToggle={(id, enabled) => toggleMls.mutate({ id, enabled })}
          pendingId={toggleMls.isPending ? toggleMls.variables?.id ?? null : null}
        />
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
