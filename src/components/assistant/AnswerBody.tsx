"use client";

import * as React from "react";
import { formatAnswer, type InlineSpan } from "@/modules/ai/format-answer";

function Spans({ spans }: { spans: InlineSpan[] }) {
  return (
    <>
      {spans.map((s, i) =>
        s.kind === "bold" ? <strong key={i} className="font-semibold">{s.text}</strong>
        : s.kind === "ref" ? <span key={i} className="num text-brand-ink">{s.text}</span>
        // Inline code / file paths: mono chip. break-all so a long path can't force the
        // panel to scroll horizontally at 375px (WP-AI-STYLE-PERSIST: no raw paths).
        : s.kind === "code" ? <code key={i} className="break-all rounded-xs border border-border-soft bg-surface-2 px-1 py-px font-mono text-step-1">{s.text}</code>
        : <React.Fragment key={i}>{s.text}</React.Fragment>,
      )}
    </>
  );
}

export function AnswerBody({ text }: { text: string }) {
  const blocks = formatAnswer(text);
  return (
    <div className="flex flex-col gap-1.5">
      {blocks.map((b, i) =>
        b.type === "p" ? (
          <p key={i}><Spans spans={b.spans} /></p>
        ) : (
          <ul key={i} className="flex flex-col gap-1">
            {b.items.map((item, j) => (
              <li key={j} className="relative pl-4 before:absolute before:left-0 before:font-semibold before:text-brand-ink before:content-['–']">
                <Spans spans={item} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
