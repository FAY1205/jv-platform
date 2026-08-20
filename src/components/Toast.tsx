"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

type ToastTone = "default" | "success" | "danger";

/** N5-11: an optional single recovery action inside the toast ("Couldn't save Phone — Retry").
 *  One action only — a toast is a notification, not a dialog. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
}

interface ToastApi {
  toast: (message: string, tone?: ToastTone, action?: ToastAction) => void;
}

const ToastContext = React.createContext<ToastApi | null>(null);

// Long enough to read a short line; the countdown pauses on hover/focus (WCAG 2.2.1).
const TOAST_DURATION_MS = 2600;
/** An actionable toast has to outlive the reading of it — the user must still be able to
 *  reach the control after deciding to use it. Hover/focus still pause the countdown. */
const TOAST_ACTION_DURATION_MS = 9000;

/** useToast — surfaces the toast() function (UXQ-03: optimistic UI + toast on failure). */
export function useToast(): ToastApi {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

const TONES: Record<ToastTone, string> = {
  default: "bg-text text-surface",
  success: "bg-success text-on-status",
  danger: "bg-danger text-on-status",
};

/** ToastProvider — mounts once near the app root. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const nextId = React.useRef(1);
  // WCAG 2.2.1 (Timing Adjustable): pause the auto-dismiss countdown while the user is
  // reading (pointer over the stack) or interacting with it (keyboard focus within). Both
  // conditions pause; the countdown resumes when neither holds.
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const paused = hovered || focused;

  const toast = React.useCallback((message: string, tone: ToastTone = "default", action?: ToastAction) => {
    const id = nextId.current++;
    setItems((prev) => [...prev, { id, message, tone, action }]);
  }, []);
  const dismiss = React.useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const api = React.useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* The visible, interactive stack is NOT the live region (R-56): a toast row also holds a
          "Dismiss notification" ✕, and a screen reader would read that label out with every message.
          Announcements come from the dedicated sr-only region below, which carries message text only. */}
      <div
        data-testid="toast-stack"
        className="fixed bottom-5 left-1/2 z-[110] flex -translate-x-1/2 flex-col items-center gap-2"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          // Ignore focus moving between controls within the stack; only unpause when focus
          // actually leaves the region.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
        }}
      >
        {items.map((t) => (
          <ToastRow key={t.id} item={t} paused={paused} onDismiss={dismiss} />
        ))}
      </div>
      {/* WCAG 4.1.3 (R-56): a persistent polite live region carrying ONLY the message text, so a new
          toast is announced without the dismiss control's label being read out alongside it. */}
      <div className="sr-only" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id}>{t.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** One toast + its own auto-dismiss timer. The timer is cleared while `paused` and a fresh
 *  full-duration countdown starts on resume — the user always gets ample read time. */
function ToastRow({ item, paused, onDismiss }: { item: ToastItem; paused: boolean; onDismiss: (id: number) => void }) {
  const duration = item.action ? TOAST_ACTION_DURATION_MS : TOAST_DURATION_MS;
  React.useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => onDismiss(item.id), duration);
    return () => clearTimeout(t);
  }, [paused, duration, item.id, onDismiss]);

  return (
    <div
      className={cn(
        "pointer-events-auto flex items-center gap-2 rounded-full py-2.5 pl-4 pr-2 text-sm font-medium shadow-lg",
        TONES[item.tone],
      )}
    >
      <span>{item.message}</span>
      {item.action && (
        <button
          type="button"
          onClick={() => {
            // The action dismisses its own toast: the recovery it offers is now on screen
            // (a reopened field), and a stale "retry" hanging over it invites a double-send.
            onDismiss(item.id);
            item.action?.onClick();
          }}
          className="shrink-0 rounded-full px-2.5 py-1 text-sm font-semibold text-current underline decoration-current/50 underline-offset-2 outline-none transition-colors hover:decoration-current focus-visible:ring-1 focus-visible:ring-current active:scale-95"
        >
          {item.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(item.id)}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-current opacity-80 outline-none transition-[opacity,transform] hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-current active:scale-95"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
