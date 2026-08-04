import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

export type LinkCardProps = React.ComponentPropsWithoutRef<typeof Link>;

// LinkCard (WP-Q) — the shared tappable-card chrome for whole-card links (portal leads
// card, account rows). Deliberately owns NO display utility: callers set `block`/`flex`
// themselves, so a caller's display class never conflicts with the base (cn() joins,
// it does not dedupe). Tokens only (PRN-12); forwardRef to the underlying <a>.
// DSN-03 states: default/hover/focus-visible/active (press-scale, matching Button/IconButton);
// disabled/loading do not apply to a navigation link, so they are intentionally omitted.
const base =
  "rounded-xl border border-border bg-surface transition-[background-color,border-color,transform] " +
  "hover:border-text-3 hover:bg-surface-2 focus-visible:border-brand-ink active:scale-[.99]";

export const LinkCard = React.forwardRef<HTMLAnchorElement, LinkCardProps>(function LinkCard(
  { className, children, ...props },
  ref,
) {
  return (
    <Link ref={ref} className={cn(base, className)} {...props}>
      {children}
    </Link>
  );
});
