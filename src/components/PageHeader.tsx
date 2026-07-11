"use client";

import * as React from "react";

// PageHeader (WP-B) — the single home of the topbar's page title + actions. A page
// declares its header via usePageHeader(); the shell's PageHeaderSlot renders it. This
// keeps the title in the shell chrome without pages hand-rolling their own topbars.
// The slot renders nothing until a page provides a title, so pages that still carry an
// in-content <h1> (pre-WP-E) don't double up.

type Header = { title?: React.ReactNode; actions?: React.ReactNode };
type Ctx = { header: Header; set: (h: Header) => void };

const PageHeaderContext = React.createContext<Ctx | null>(null);

export function PageHeaderProvider({ children }: { children: React.ReactNode }) {
  const [header, set] = React.useState<Header>({});
  const value = React.useMemo(() => ({ header, set }), [header]);
  return <PageHeaderContext.Provider value={value}>{children}</PageHeaderContext.Provider>;
}

/** A page declares its topbar title/actions; cleared on unmount. No-op outside a provider. */
export function usePageHeader(value: Header): void {
  // Depend on the STABLE setState fn, not the memoized ctx object: ctx gets a new identity
  // every time set() fires, so depending on ctx would re-register the effect on its own
  // update and loop forever. The useState setter is referentially stable.
  const set = React.useContext(PageHeaderContext)?.set;
  const { title, actions } = value;
  React.useEffect(() => {
    if (!set) return;
    set({ title, actions });
    return () => set({});
  }, [set, title, actions]);
}

/** The topbar's title/actions region. Renders nothing until a page provides content. */
export function PageHeaderSlot() {
  const ctx = React.useContext(PageHeaderContext);
  const { title, actions } = ctx?.header ?? {};
  if (!title && !actions) return null;
  return (
    <div className="flex min-w-0 items-center gap-3">
      {title && <h1 className="truncate font-display text-lg font-semibold tracking-tight text-text">{title}</h1>}
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
