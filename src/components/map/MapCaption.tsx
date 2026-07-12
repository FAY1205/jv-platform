import * as React from "react";

export interface MapCaptionProps {
  title: string;
  subtitle?: string;
}

/**
 * Blurred map title plate (WP-D — the mockups' `.mapcap`). Absolutely placed in
 * the map's top-left; the parent map owns the `relative` wrapper. The component
 * owns the chrome + type treatment (Fraunces title / 13px mono subtitle — ≥13px
 * per the WP-A/C no-tiny-chrome rule); pages pass content in WP-E. Tokenized,
 * theme-aware. `pointer-events-none` so it never blocks map interaction.
 */
export function MapCaption({ title, subtitle }: MapCaptionProps) {
  return (
    <div
      className="pointer-events-none absolute left-3.5 top-3.5 rounded-xl border border-border px-3.5 py-2 backdrop-blur-[6px]"
      style={{ background: "color-mix(in srgb, var(--surface) 88%, transparent)" }}
    >
      <div className="font-display text-xl font-semibold leading-tight tracking-tight text-balance">
        {title}
      </div>
      {subtitle && (
        <div className="num mt-0.5 text-step-1 tracking-[.04em] text-text-3">{subtitle}</div>
      )}
    </div>
  );
}
