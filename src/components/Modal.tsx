"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** Accessible label when no visible title is provided. */
  ariaLabel?: string;
}

/**
 * Modal — dialog with scrim. Esc closes, scrim click closes, focus moves into the
 * panel on open and the page scroll is locked (DSN-03, FRM-04). Rendered in a portal.
 */
export function Modal({ open, onClose, title, children, footer, ariaLabel }: ModalProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="anim-scrim fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "var(--scrim)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : ariaLabel}
        tabIndex={-1}
        className={cn(
          "anim-pop w-full max-w-md bg-surface border border-border rounded-2xl shadow-lg outline-none",
          "max-h-[90vh] overflow-auto",
        )}
      >
        {title && (
          <div className="flex items-center gap-3 px-5 py-4 border-b border-border-soft">
            <h2 className="font-display text-base font-semibold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="ml-auto text-text-3 hover:text-text transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        <div className="p-5">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border-soft">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
