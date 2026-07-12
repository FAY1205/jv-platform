"use client";

import * as React from "react";
import { Card, CardHeader, CardTitle, CardBody, Table, THead, TBody, Th, Tr, Td, Badge, Switch, EmptyState } from "@/components";
import { groupMlsPatterns, type MlsEffect } from "@/lib/mls-groups";

// WS-6 · the MLS filter-phrases card. Phrases are view + on/off + label (never regex,
// PRN-04); grouped by effect with keep-override first (it wins, MLS-02). The effect is
// always conveyed by group title + badge TEXT, never color alone (PRN-14). Presentational
// only — the page owns the query + toggle mutation; this component also backs the
// throwaway two-theme screenshot route, so it takes plain data + callbacks.

export interface MlsPhrase {
  id: string;
  patternKey: string;
  type: MlsEffect;
  regex: string;
  flags: string;
  label: string;
  enabled: boolean;
}

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

/** The locked-note pill: phrase text is fixed in code (PRN-04); only the on/off runs. */
export function LockedNote() {
  return (
    <span className="mt-3 inline-flex items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-1 text-step-1 text-text-3">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </svg>
      Pattern text is locked in code — toggle whether each one runs.
    </span>
  );
}

export interface MlsPhrasesCardProps {
  patterns: MlsPhrase[];
  onToggle: (id: string, enabled: boolean) => void;
  /** The id of the phrase whose toggle is mid-flight (its Switch is disabled). */
  pendingId?: string | null;
}

export function MlsPhrasesCard({ patterns, onToggle, pendingId }: MlsPhrasesCardProps) {
  return (
    <Card>
      <CardHeader><CardTitle>MLS phrases</CardTitle></CardHeader>
      <CardBody>
        {patterns.length === 0 ? (
          <EmptyState title="No MLS phrases" description="No filter phrases are configured yet." />
        ) : (
          <div className="flex flex-col gap-6">
            {groupMlsPatterns(patterns).map((group) => {
              const meta = EFFECT_META[group.effect];
              return (
                <section key={group.effect} className="flex flex-col gap-2">
                  <div id={`mls-group-${group.effect}`} className="flex items-center gap-2">
                    <Badge variant={meta.badge}>{meta.badgeLabel}</Badge>
                    <h3 className="text-sm font-semibold text-text">{meta.title}</h3>
                  </div>
                  <p className="text-step-1 text-text-3">{meta.hint}</p>
                  {/* Tie the table to its effect header so AT users hear which group it is (WCAG 1.3.1). */}
                  <Table aria-labelledby={`mls-group-${group.effect}`}>
                    <THead><Tr><Th>Phrase</Th><Th>Key</Th><Th align="right">On</Th></Tr></THead>
                    <TBody>
                      {group.patterns.map((m) => (
                        <Tr key={m.id}>
                          <Td>
                            <div className="text-sm text-text">{m.label}</div>
                            <div className="num text-step-1 text-text-3">{m.regex}</div>
                          </Td>
                          <Td><span className="num text-step-1 text-text-3">{m.patternKey}</span></Td>
                          <Td align="right">
                            <div className="inline-flex justify-end">
                              <Switch
                                checked={m.enabled}
                                disabled={pendingId === m.id}
                                onCheckedChange={(v) => onToggle(m.id, v)}
                                ariaLabel={m.label}
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
  );
}
