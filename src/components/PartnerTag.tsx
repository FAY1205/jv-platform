import * as React from "react";
import { cn } from "@/lib/cn";

export interface PartnerTagProps {
  name: string;
  /** Locked partner color hex (PRN-06). */
  color: string;
  /** Human-readable reference ID, e.g. "PR-003" (DM-07). */
  refId?: string;
  size?: "sm" | "md";
  /**
   * "full" (default) = swatch + name + reference ID — the signature identity element.
   * "name" = name only, for DENSE rows (the admin leads table) where the owner asked to
   * drop the swatch + refId chrome. PRN-14 stays satisfied: with NO color present, the
   * "color never alone" rule has nothing to accompany — and the refId is not lost, it
   * moves to the cell's `title`/aria. Every lower-density surface keeps the full identity.
   */
  variant?: "full" | "name";
  className?: string;
}

/**
 * PartnerTag — the signature identity element. A partner is ALWAYS shown as
 * color + name (+ reference ID), never color alone (PRN-14). This is the one
 * component that turns the color-independence rule into the product's visual
 * fingerprint; reuse it everywhere a partner appears (rows, legend, portal).
 */
export function PartnerTag({ name, color, refId, size = "md", variant = "full", className }: PartnerTagProps) {
  const swatch = size === "sm" ? 14 : 18;
  if (variant === "name") {
    // Name-only cell: no swatch, no visible refId (both survive in the title/aria), one weight
    // lighter than the full badge because here it's a data cell, not an identity element.
    const label = refId && refId !== "HOUSE" ? `${name} (${refId})` : name;
    return (
      <span className={cn("block min-w-0 truncate font-medium text-text-2", className)} title={label} aria-label={label}>
        {name}
      </span>
    );
  }
  return (
    // WP-UX-1: `max-w-full` + a shrinkable, truncating NAME span. Without min-w-0 the
    // name refused to shrink inside width-constrained cells, so ancestors' `truncate`
    // hard-clipped it with no ellipsis (the audit's Coverage-panel finding — "Lone Star
    // Holding" cut mid-word). The name is the flexible part; swatch + refId never shrink,
    // so PRN-14's ID always survives and the ellipsis lands on the recoverable part.
    <span className={cn("inline-flex max-w-full items-center gap-2 font-semibold whitespace-nowrap", className)}>
      <span
        className="rounded-[6px] border shrink-0"
        style={{ width: swatch, height: swatch, background: color, borderColor: "var(--swatch-border)" }}
        aria-hidden="true"
      />
      <span className={cn("min-w-0 truncate", size === "sm" ? "text-xs" : "text-sm")}>{name}</span>
      {/* The house territory (ADR-0037, ref "HOUSE") is singular and self-identifying —
          "My Territory" alone is unambiguous, so its sentinel ref is not shown (owner). */}
      {refId && refId !== "HOUSE" && (
        <span className="num shrink-0 text-step-0 font-medium text-text-3" aria-label={`Reference ${refId}`}>
          {refId}
        </span>
      )}
    </span>
  );
}
