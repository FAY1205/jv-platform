"use client";

import * as React from "react";
import { Card, CardHeader, CardTitle, CardBody, Badge, EmptyState } from "@/components";
import { groupMlsPatterns, type MlsEffect } from "@/lib/mls-groups";

// WS-6 · the MLS filter-phrases card. READ-ONLY (2026-08-01, owner note): the phrase
// set and whether each one runs are fixed in code (seed + migrations, PRN-04); there is
// no runtime edit path. This shows the admin what the import currently filters on, grouped
// by effect with keep-override first (it wins, MLS-02). The effect is always conveyed by
// group title + badge TEXT, never color alone (PRN-14). Presentational only — the page
// owns the query.

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
    hint: "A lead whose notes match one of these is removed as already listed — unless a keep-override phrase also matches.",
    badge: "removed",
    badgeLabel: "Removes lead",
  },
};

/** The locked-note pill: the phrase set is fixed in code and can't be changed here. */
function LockedNote() {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-1 text-step-1 text-text-3">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </svg>
      These phrases are managed for you — contact us to change what gets filtered.
    </span>
  );
}

/** Sentence-case a lowercase seed label for display without editing the stored data. */
function displayLabel(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export interface MlsPhrasesCardProps {
  patterns: MlsPhrase[];
}

export function MlsPhrasesCard({ patterns }: MlsPhrasesCardProps) {
  return (
    <Card>
      <CardHeader><CardTitle>MLS phrases</CardTitle></CardHeader>
      <CardBody>
        {/* WP-UX-7 (audit R-2): the "managed for you" note lives INSIDE the card it describes,
            not floating atop the page above the unrelated Scoring card. */}
        <div className="mb-4"><LockedNote /></div>
        {patterns.length === 0 ? (
          // R-3: the empty copy states the CONSEQUENCE — an empty set means nothing is filtered,
          // which (leads silently removed as already-listed) is expensive to leave ambiguous.
          <EmptyState
            title="No phrases configured"
            description="No leads are being filtered as already-listed. Contact us to set up MLS filtering."
          />
        ) : (
          <div className="flex flex-col gap-6">
            {groupMlsPatterns(patterns).map((group) => {
              const meta = EFFECT_META[group.effect];
              return (
                <section key={group.effect} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={meta.badge}>{meta.badgeLabel}</Badge>
                    <h3 className="text-sm font-semibold text-text">{meta.title}</h3>
                  </div>
                  <p className="text-step-1 text-text-3">{meta.hint}</p>
                  <ul className="flex flex-col divide-y divide-border-soft rounded-lg border border-border-soft">
                    {group.patterns.map((m) => (
                      <li key={m.id} className="px-3 py-2.5 text-sm text-text">
                        {displayLabel(m.label)}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
