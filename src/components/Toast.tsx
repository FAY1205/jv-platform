"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

type ToastTone = "default" | "success" | "danger";
interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastApi {
  toast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = React.createContext<ToastApi | null>(null);

/** useToast — surfaces the toast() function (UXQ-03: optimistic UI + toast on failure). */
export function useToast(): ToastApi {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

/** ToastProvider — mounts once near the app root. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const nextId = React.useRef(1);

  const toast = React.useCallback((message: string, tone: ToastTone = "default") => {
    const id = nextId.current++;
    setItems((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 2600);
  }, []);

  const api = React.useMemo(() => ({ toast }), [toast]);

  const tones: Record<ToastTone, string> = {
    default: "bg-text text-surface",
    success: "bg-success text-on-status",
    danger: "bg-danger text-on-status",
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[110] flex flex-col items-center gap-2"
        role="status"
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              "rounded-full px-4 py-2.5 text-sm font-medium shadow-lg",
              tones[t.tone],
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
