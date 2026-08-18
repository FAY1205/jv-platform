"use client";

import * as React from "react";
import Link from "next/link";
import { isInternalPath } from "@/modules/ai/internal-path";
import { AnswerBody } from "./AnswerBody";
import { AssistantIconButton } from "./AssistantIconButton";

export interface AssistantSource {
  label: string;
  path?: string;
  /** The reference a tool looked up and could not find (`{source, notFound}` outputs,
   *  tools.ts:54/74/111/127). Without it a NOT-FOUND turn is indistinguishable from a
   *  successful one and the fallback would claim "here's what I found" (WP-AI-STYLE). */
  notFound?: string;
}
export interface AssistantMessageProps {
  id: string;
  text: string;
  sources: AssistantSource[];
  showThumbs?: boolean;
  onFeedback?: (id: string, rating: "up" | "down") => void;
  /** True while this (last) message is still streaming — shows a "checking" state
   *  instead of an empty bubble while a data tool runs. */
  pending?: boolean;
  /** Seed the initial thumb selection (uncontrolled). Used by the /gallery showcase to
   *  render the confirmed "rated" state statically; unset in the live widget. */
  defaultRating?: "up" | "down";
  /** First message of a consecutive assistant run → show the "Assistant" marker above the
   *  answer (redesign: flat annotations with a quiet brand signature per turn, not a box per
   *  message). Defaults to true so single/standalone renders (the gallery) still mark. */
  firstOfRun?: boolean;
}

/** The quiet brand signature above the first answer in a run — a short brand tick + label
 *  (a margin-mark on survey paper), no orb: the living orb stays special to the launcher +
 *  the empty title-page, not sprinkled as a flat disc on every reply. */
export function AssistantMarker() {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden="true" className="h-3 w-0.5 rounded-full bg-brand-line" />
      <span className="text-step-0 font-semibold uppercase tracking-[.08em] text-text-3">Assistant</span>
    </div>
  );
}

/** The body indent that lines the answer up under the marker's label (past the tick + gap). */
const ANSWER_INDENT = "pl-3";

/** Tool labels are built for source pills, not prose ("Dashboard stats · 30d"). Strip the
 *  range suffix; NEVER change case — "Lead LD-25-00123" must keep its ref-ID casing (the
 *  REF_RE mono-ref span in format-answer.ts is case-sensitive, so lowercasing would break
 *  the chip as well as the reference itself). */
const detok = (label: string) => label.replace(/\s·\s.*$/, "");

/** The one thinking string, shared by the message pending branch and the widget's thinking
 *  row — no trailing ellipsis, because the animated dots ARE the ellipsis (WP-AI-STYLE). */
export const THINKING_COPY = "Checking your workspace";

/** The animated three-dot span that follows THINKING_COPY, shared by both call sites. */
export function ThinkingDots() {
  return (
    <span className="flex gap-1" aria-hidden="true">
      <i className="h-1 w-1 animate-[blink_1s_infinite] rounded-full bg-text-3" />
      <i className="h-1 w-1 animate-[blink_1s_infinite_.18s] rounded-full bg-text-3" />
      <i className="h-1 w-1 animate-[blink_1s_infinite_.36s] rounded-full bg-text-3" />
    </span>
  );
}

/** A never-empty reply: if the model returned only chips/links (or nothing at all), fall back
 *  to a sentence so the bubble is never blank (WP-AI-STYLE). First match wins, and NOT-FOUND
 *  outranks a link — a mixed turn's news is the miss, not the other tool's page. */
function fallbackText(sources: AssistantSource[]): string {
  const missing = sources.find((s) => s.notFound);
  if (missing) return `No match for that reference in ${detok(missing.label)} — check it and try again.`;
  const link = sources.find((s) => s.path && isInternalPath(s.path));
  if (link) return `Open ${detok(link.label)} below for the details.`;
  // Sources ran but the model produced no prose: a model failure, stated as fact. The
  // "From: …" chip below already names the source, so don't repeat it here.
  if (sources.length > 0) return "The answer didn't come through — try asking again.";
  return "I don't have an answer for that — try a question about partners, leads, coverage or imports.";
}

function ThumbIcon({ down }: { down?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" style={down ? { transform: "rotate(180deg)" } : undefined} aria-hidden="true">
      <path d="M7 11v9h10a3 3 0 0 0 3-3l-1-6a2 2 0 0 0-2-2h-4l1-4a2 2 0 0 0-2-2l-5 8H4v9h3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AssistantMessage({ id, text, sources, showThumbs = true, onFeedback, pending = false, defaultRating, firstOfRun = true }: AssistantMessageProps) {
  const [rated, setRated] = React.useState<"up" | "down" | null>(defaultRating ?? null);

  // Dedupe source labels, but a notFound source WINS a label collision: three partner tools
  // share the literal "Partner roster" label, and if a successful list call landed first the
  // plain first-wins dedup would swallow the miss — reintroducing the false "found it" reply
  // in exactly the model-silent turn fallbackText exists for (review F-1). The miss is the news.
  const byLabel = new Map<string, AssistantSource>();
  for (const s of sources) {
    const existing = byLabel.get(s.label);
    if (!existing || (!existing.notFound && s.notFound)) byLabel.set(s.label, s);
  }
  const uniqueSources = [...byLabel.values()];
  const link = uniqueSources.find((s) => s.path && isInternalPath(s.path));
  // The linked source renders only as the clickable pill, never also as a plain chip.
  const chips = uniqueSources.filter((s) => s !== link);

  const rate = (r: "up" | "down") => { setRated(r); onFeedback?.(id, r); };

  const hasText = text.trim() !== "";
  // Body: real text if present; a "checking" line while a tool runs; else a never-blank
  // fallback sentence (WP-AI-STYLE — a reply is never just chips or empty).
  const body = hasText ? (
    <AnswerBody text={text} />
  ) : pending ? (
    <p className="flex items-center gap-2 text-text-3">{THINKING_COPY}<ThinkingDots /></p>
  ) : (
    <AnswerBody text={fallbackText(uniqueSources)} />
  );

  return (
    // Flat annotation on the panel background (no box) — the marker gives each turn a quiet
    // brand signature, and long persisted answers read as a column of text, not stacked cards.
    <div className="flex flex-col gap-1.5 self-stretch">
      {firstOfRun && <AssistantMarker />}
      <div className={`${ANSWER_INDENT} text-step-2 leading-relaxed text-text`}>
      {body}
      {(chips.length > 0 || link || showThumbs) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {chips.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1.5 rounded-full border border-border-soft bg-surface-2 px-2.5 py-0.5 text-step-0 text-text-3">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-[2px] bg-info" />
              From: {s.label}
            </span>
          ))}
          {link && (
            <Link href={link.path!} className="inline-flex items-center gap-1 rounded-full border border-brand-line bg-brand-soft px-2.5 py-0.5 text-step-1 font-semibold text-brand-ink no-underline transition-all duration-150 hover:border-brand-strong hover:shadow-xs">
              Open {link.label} →
            </Link>
          )}
          {showThumbs && (
            <span role="group" aria-label="Was this helpful?" className="ml-auto inline-flex gap-0.5">
              <AssistantIconButton variant="toggle" aria-label="Helpful" aria-pressed={rated === "up"} disabled={rated !== null} onClick={() => rate("up")}>
                <ThumbIcon />
              </AssistantIconButton>
              <AssistantIconButton variant="toggle" aria-label="Not useful" aria-pressed={rated === "down"} disabled={rated !== null} onClick={() => rate("down")}>
                <ThumbIcon down />
              </AssistantIconButton>
            </span>
          )}
        </div>
      )}
      {rated && <div role="status" className="mt-1.5 text-step-0 text-success">Thanks — feedback recorded.</div>}
      </div>
    </div>
  );
}
