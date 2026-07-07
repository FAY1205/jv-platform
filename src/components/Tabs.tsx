import * as React from "react";
import { cn } from "@/lib/cn";

export interface TabItem {
  id: string;
  label: React.ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onValueChange: (id: string) => void;
  className?: string;
}

/** Tabs — controlled tab strip (underline style). Keyboard: roving with ←/→. */
export function Tabs({ items, value, onValueChange, className }: TabsProps) {
  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const next = (index + dir + items.length) % items.length;
    onValueChange(items[next].id);
  };

  return (
    <div role="tablist" className={cn("flex gap-0.5 border-b border-border", className)}>
      {items.map((item, i) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onValueChange(item.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "px-3.5 py-2.5 text-sm font-semibold -mb-px border-b-2 transition-colors",
              active
                ? "text-brand border-brand"
                : "text-text-3 border-transparent hover:text-text",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
