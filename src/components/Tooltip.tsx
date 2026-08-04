"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  className?: string;
}

// SSR-safe "is this the client, post-hydration?" without setState-in-an-effect:
// false on the server and during hydration, true afterwards — so the body portal is
// only created on the client, matching the server markup.
const noopSubscribe = () => () => {};
const getClient = () => true;
const getServer = () => false;

/**
 * Tooltip — shows on hover and keyboard focus (never hover-only, DSN-07). Used for
 * the calculation tooltips required on every computed value and badge (UXQ-05/F-64).
 * Hand-rolled and accessible (role="tooltip" + aria-describedby). The bubble is
 * PORTALED to <body> and positioned in viewport-fixed coordinates so it escapes any
 * overflow-hidden / scrolling ancestor (KPI strips, tables) instead of being clipped;
 * it flips below the trigger when there is no room above.
 * (Intentionally NOT a Radix primitive — it is outside the ADR-0016 list.)
 */
export function Tooltip({ content, children, className }: TooltipProps) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ top: number; left: number; below: boolean } | null>(null);
  const wrapRef = React.useRef<HTMLSpanElement>(null);
  const id = React.useId();
  const mounted = React.useSyncExternalStore(noopSubscribe, getClient, getServer);

  const measure = React.useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = r.top < 96; // too close to the viewport top → flip under the trigger
    const left = Math.min(Math.max(r.left + r.width / 2, 160), window.innerWidth - 160);
    setPos({ top: below ? r.bottom + 8 : r.top - 8, left, below });
  }, []);

  const show = React.useCallback(() => {
    measure();
    setOpen(true);
  }, [measure]);
  const hide = React.useCallback(() => setOpen(false), []);

  React.useEffect(() => {
    if (!open) return;
    const onMove = () => measure();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, measure]);

  return (
    <span
      ref={wrapRef}
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
    >
      {React.cloneElement(children, { "aria-describedby": id } as React.HTMLAttributes<HTMLElement>)}
      {mounted &&
        createPortal(
          <span
            role="tooltip"
            id={id}
            hidden={!open}
            style={
              pos
                ? { position: "fixed", top: pos.top, left: pos.left, transform: `translate(-50%, ${pos.below ? "0" : "-100%"})` }
                : undefined
            }
            className={cn(
              "pointer-events-none z-[200] w-max max-w-xs rounded-md bg-text px-2.5 py-1.5 text-xs font-medium text-surface shadow-md",
              className,
            )}
          >
            {content}
          </span>,
          document.body,
        )}
    </span>
  );
}
