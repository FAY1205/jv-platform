"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

// SearchExpand (WP-B) — the topbar's global search: a compact icon that expands to a
// field on click or ⌘K, submits to the Leads list, and collapses on Escape / empty blur.
// Replaces the always-on search box so the topbar stays title-led (all DSN-03 states).

function SearchIcon({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function SearchExpand() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  const expand = () => {
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        expand();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const s = q.trim();
    router.push(s ? `/leads?q=${encodeURIComponent(s)}` : "/leads");
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        aria-label="Search"
        aria-expanded={false}
        onClick={expand}
        className="grid h-9 w-9 place-items-center rounded-md border border-transparent text-text-2 transition-colors hover:border-border hover:bg-surface focus-visible:border-border active:scale-95"
      >
        <SearchIcon className="h-[18px] w-[18px]" />
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex h-9 w-full max-w-[300px] items-center gap-2.5 rounded-md border border-border bg-surface px-3 text-text-3 transition-colors focus-within:border-brand-line"
    >
      <SearchIcon className="h-4 w-4" />
      <input
        ref={inputRef}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        onBlur={() => {
          if (q.trim() === "") setOpen(false);
        }}
        placeholder="Search leads, partners, ZIP codes…"
        aria-label="Search leads"
        className="w-full bg-transparent text-sm text-text outline-none placeholder:text-text-3"
      />
      <kbd className="num hidden rounded-xs border border-border px-1.5 text-[0.8125rem] text-text-3 sm:inline">⌘K</kbd>
    </form>
  );
}
