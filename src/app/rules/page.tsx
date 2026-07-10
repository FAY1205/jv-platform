"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { csrfHeaders } from "@/lib/csrf-client";
import {
  Card, CardBody, CardHeader, CardTitle, Table, THead, TBody, Th, Tr, Td,
  Badge, Checkbox, Skeleton, EmptyState, ToastProvider, useToast, AppShell,
} from "@/components";
import { groupMlsPatterns, type MlsEffect } from "@/lib/mls-groups";

// WS-6 · CVG-02: the Rules area — now MLS filter phrases only. Phrases are view + on/off
// + label (never regex, PRN-04); grouped by effect with keep-override first (it wins,
// MLS-02). Coverage moved to Partners (WS-5); recodes removed (ADR-0018). File formats
// (Source Profiles, SET-12) stay here until WS-7 relocates them to Settings → Data.
// Every change is audited and picked up by the next run (DM-08).

interface MlsPattern { id: string; patternKey: string; type: MlsEffect; regex: string; flags: string; label: string; enabled: boolean }
interface RulesData { mlsPatterns: MlsPattern[] }

// Per-effect copy. The effect is always conveyed by group title + badge TEXT, never
// color alone (PRN-14).
const EFFECT_META: Record<MlsEffect, { title: string; hint: string; badge: "success" | "removed"; badgeLabel: string }> = {
  keep_override: {
    title: "Keep-override phrases",
    hint: "These win over everything — a lead matching one is kept even if a disqualify phrase also matches.",
    badge: "success",
    badgeLabel: "Keeps lead",
  },
  disqualify: {
    title: "Disqualify phrases",
    hint: "A lead whose notes match one of these is removed as on-market — unless a keep-override phrase also matches.",
    badge: "removed",
    badgeLabel: "Removes lead",
  },
};

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: body === undefined ? "{}" : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { message?: string }).message ?? "Request failed");
  return json;
}

function RulesInner() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isPending, error } = useQuery({ queryKey: ["rules"], queryFn: () => apiGet<RulesData>("/api/admin/rules") });

  const toggleMls = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => send(`/api/admin/rules/mls/${v.id}`, "PATCH", { enabled: v.enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rules"] }),
    onError: (e: Error) => toast(e.message, "danger"),
  });

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-text">Rules</h1>
          <p className="mt-1 text-sm text-text-2">The MLS phrases that shape each run. Changes apply to future runs and are logged.</p>
        </div>

        {error ? (
          <Card><CardBody><EmptyState title="Couldn't load rules" description={(error as Error).message} /></CardBody></Card>
        ) : isPending ? (
          <Skeleton className="h-40" />
        ) : (
          <>
            {/* MLS phrases — grouped by effect (keep-override first) */}
            <Card>
              <CardHeader><CardTitle>MLS phrases</CardTitle></CardHeader>
              <CardBody>
                <p className="mb-4 text-xs text-text-3">
                  Phrases that decide whether a lead is “listed on MLS”. Toggle them on or off — the exact matching is
                  vetted and tested, so the wording here can’t change how a phrase matches (PRN-04).
                </p>
                {data.mlsPatterns.length === 0 ? (
                  <EmptyState title="No MLS phrases" description="No filter phrases are configured yet." />
                ) : (
                  <div className="flex flex-col gap-6">
                    {groupMlsPatterns(data.mlsPatterns).map((group) => {
                      const meta = EFFECT_META[group.effect];
                      return (
                        <section key={group.effect} className="flex flex-col gap-2">
                          <div id={`mls-group-${group.effect}`} className="flex items-center gap-2">
                            <Badge variant={meta.badge}>{meta.badgeLabel}</Badge>
                            <h3 className="text-sm font-semibold text-text">{meta.title}</h3>
                          </div>
                          <p className="text-xs text-text-3">{meta.hint}</p>
                          {/* Tie the table to its effect header so AT users hear which group it is (WCAG 1.3.1). */}
                          <Table aria-labelledby={`mls-group-${group.effect}`}>
                            <THead><Tr><Th>Phrase</Th><Th>Key</Th><Th align="right">On</Th></Tr></THead>
                            <TBody>
                              {group.patterns.map((m) => (
                                <Tr key={m.id}>
                                  <Td>
                                    <div className="text-sm text-text">{m.label}</div>
                                    <div className="num text-[.66rem] text-text-3">{m.regex}</div>
                                  </Td>
                                  <Td><span className="num text-xs text-text-3">{m.patternKey}</span></Td>
                                  <Td align="right">
                                    <div className="inline-flex justify-end">
                                      <Checkbox
                                        checked={m.enabled}
                                        disabled={toggleMls.isPending && toggleMls.variables?.id === m.id}
                                        onCheckedChange={(v) => toggleMls.mutate({ id: m.id, enabled: v })}
                                        ariaLabel={`${m.label} enabled`}
                                      />
                                    </div>
                                  </Td>
                                </Tr>
                              ))}
                            </TBody>
                          </Table>
                        </section>
                      );
                    })}
                  </div>
                )}
              </CardBody>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}

export default function RulesPage() {
  return (
    <ToastProvider>
      <RulesInner />
    </ToastProvider>
  );
}
