"use client";

import * as React from "react";
import Link from "next/link";
import { isInternalPath } from "@/modules/ai/internal-path";
import { AnswerBody } from "./AnswerBody";
import { AssistantIconButton } from "./AssistantIconButton";

export interface AssistantSource { label: string; path?: string }
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
}

/** A never-empty reply: if the model returned only chips/links (or nothing yet), fall
 *  back to a sentence so the bubble is never blank (WP-AI-STYLE). */
function fallbackText(sources: AssistantSource[]): string {
  const link = sources.find((s) => s.path);
  if (link) return `Here's your ${link.label.toLowerCase()} — open it below.`;
  if (sources.length > 0) return "Here's what I found — see the sources below.";
  return "I don't have anything to show for that.";
}

function ThumbIcon({ down }: { down?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" style={down ? { transform: "rotate(180deg)" } : undefined} aria-hidden="true">
      <path d="M7 11v9h10a3 3 0 0 0 3-3l-1-6a2 2 0 0 0-2-2h-4l1-4a2 2 0 0 0-2-2l-5 8H4v9h3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AssistantMessage({ id, text, sources, showThumbs = true, onFeedback, pending = false, defaultRating }: AssistantMessageProps) {
  const [rated, setRated] = React.useState<"up" | "down" | null>(defaultRating ?? null);

  // Dedupe source labels; the deep link is the first source with an internal path (PRN-10).
  const seen = new Set<string>();
  const uniqueSources = sources.filter((s) => (seen.has(s.label) ? false : (seen.add(s.label), true)));
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
    <p className="text-text-3">Checking your workspace…</p>
  ) : (
    <AnswerBody text={fallbackText(uniqueSources)} />
  );

  return (
    <div className="max-w-[94%] self-start rounded-md rounded-tl-xs border border-border-soft bg-surface p-2.5 px-3 text-step-2 leading-relaxed shadow-xs">
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
  );
}
