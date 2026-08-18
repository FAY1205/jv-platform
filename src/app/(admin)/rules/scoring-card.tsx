"use client";

import * as React from "react";
import { Card, CardHeader, CardTitle, CardBody, Badge, HotLeadIcon } from "@/components";
import { SCORING_SCHEME, type ScoreGroup } from "@/modules/pipeline/score";

// WP-SCORE-1 · the Lead-scoring documentation card. READ-ONLY: the scheme is fixed in
// code (score.ts, pinned by SCORING_VERSION into every run's rules snapshot, DM-08) and
// this renders straight from SCORING_SCHEME — a unit test locks the descriptor to the
// engine, so the page can never describe a scheme the import doesn't run. Group meaning
// is carried by label + range TEXT, never color alone (PRN-14). Presentational only.

/** Amber for Hot (matches the table mark), neutral for the rest. */
const GROUP_BADGE: Record<ScoreGroup, "warn" | "neutral"> = {
  hot: "warn",
  warm: "neutral",
  nurture: "neutral",
};

export function ScoringCard() {
  return (
    <Card>
      <CardHeader><CardTitle>Lead scoring</CardTitle></CardHeader>
      <CardBody>
        <div className="flex flex-col gap-6">
          <p className="text-step-1 text-text-3">
            Every imported lead is scored out of {SCORING_SCHEME.maxTotal} from the five criteria below. The
            values are read automatically from each lead&rsquo;s details — nothing is entered by hand. A lead only
            scores when all five are present; if one is missing it stays <span className="font-semibold text-text-2">unscored</span> rather
            than being given a misleading number.
          </p>

          {/* Criteria → tiers → points */}
          <div className="overflow-x-auto rounded-lg border border-border-soft">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border-soft text-left text-step-0 uppercase tracking-wide text-text-3">
                  <th className="px-3 py-2 font-semibold">Criterion</th>
                  <th className="px-3 py-2 font-semibold">Answer</th>
                  <th className="px-3 py-2 text-right font-semibold">Points</th>
                </tr>
              </thead>
              <tbody>
                {SCORING_SCHEME.criteria.map((criterion) =>
                  criterion.tiers.map((tier, i) => (
                    <tr key={`${criterion.key}-${i}`} className="border-b border-border-soft last:border-0">
                      {i === 0 && (
                        <td className="px-3 py-2 align-top font-semibold text-text" rowSpan={criterion.tiers.length}>
                          {criterion.name}
                          {/* WP-UX-7: the intro already says all five are required, so "Required: Yes"
                              on every row was noise — annotate ONLY the criterion whose rule differs. */}
                          {criterion.required !== "Yes" && (
                            <span className="mt-0.5 block text-step-0 font-normal text-text-3">
                              Required {criterion.required.toLowerCase()}
                            </span>
                          )}
                        </td>
                      )}
                      <td className="px-3 py-2 text-text-2">{tier.values}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-text">{tier.points}</td>
                    </tr>
                  )),
                )}
                <tr className="border-t border-border">
                  <td className="px-3 py-2 align-top font-semibold text-text">Penalty</td>
                  <td className="px-3 py-2 text-text-2">{SCORING_SCHEME.penalty.when}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-danger">
                    {SCORING_SCHEME.penalty.points}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Groups */}
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-text">Groups</h3>
            <ul className="flex flex-col divide-y divide-border-soft rounded-lg border border-border-soft">
              {[...SCORING_SCHEME.groups]
                .sort((a, b) => b.min - a.min)
                .map((group) => (
                  <li key={group.key} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                    {/* WP-UX-7: fixed-width badge + range slots so the ranges (and the text after
                        them) line up down the column regardless of label/number width. */}
                    <span className="flex w-24 shrink-0">
                      <Badge variant={GROUP_BADGE[group.key]} className="gap-1.5">
                        {group.key === "hot" && <HotLeadIcon size={12} />}
                        {group.label}
                      </Badge>
                    </span>
                    <span className="w-14 shrink-0 text-right tabular-nums text-text-2">
                      {group.min}–{group.max}
                    </span>
                    <span className="text-text-3">
                      {group.alerts ? "Alerts the admin instantly, and the partner once the import is released" : "Kept in the list, no alert"}
                    </span>
                  </li>
                ))}
            </ul>
          </div>

          <span className="inline-flex items-center gap-2 self-start rounded-full border border-border bg-surface-2 px-3 py-1 text-step-1 text-text-3">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
            This scoring scheme is fixed — contact us to change how leads are scored.
          </span>
        </div>
      </CardBody>
    </Card>
  );
}
