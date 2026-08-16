import * as React from "react";
import { cn } from "@/lib/cn";

// PageContainer (WP-UX-2) — the shared page-width vocabulary. The UX audit's T2
// theme: every page picked its own width and anchor (Rules stopped at 72% with a
// dead right gutter, the Settings ensemble hugged the left, Tasks stretched
// reading content across the full region), so adjacent nav items had four
// different right edges and the inconsistency itself read as "misaligned".
//
// One centered container, four earned sizes (Tailwind's max-w scale — no
// arbitrary widths):
//   prose   (max-w-3xl, 768px) — forms and settings sections; a control's label
//           and its button stay within one eye span.
//   reading (max-w-4xl, 896px) — documentation-style pages (Rules) and
//           single-column lists that are read, not scanned (Tasks).
//   hub     (max-w-5xl, 1024px) — a sub-nav + prose content ensemble
//           (the Settings layout's 210px rail + gap + prose column).
//   full    — data surfaces (tables, boards, maps) that earn the whole region.
//
// Deliberately NOT configurable beyond the size: padding stays with AppShell,
// vertical rhythm stays with the page — this component owns exactly one thing,
// the horizontal budget.

export type PageContainerSize = "prose" | "reading" | "hub" | "full";

const SIZE: Record<PageContainerSize, string> = {
  prose: "max-w-3xl",
  reading: "max-w-4xl",
  hub: "max-w-5xl",
  full: "",
};

export interface PageContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: PageContainerSize;
}

export function PageContainer({ size = "full", className, ...rest }: PageContainerProps) {
  return <div className={cn("mx-auto w-full min-w-0", SIZE[size], className)} {...rest} />;
}
