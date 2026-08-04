"use client";

import dynamic from "next/dynamic";

// WP-AI-PERSIST: mount point for the assistant, rendered ONCE from the admin layout
// (not per-page inside AppShell) so the panel + transcript survive client-side
// navigation. Lazy + ssr:false keeps the AI SDK out of the base bundle and off the
// server — the same contract the old AppShell mount had. A server component can't pass
// ssr:false to next/dynamic, so this thin client wrapper owns the import.
const AssistantWidget = dynamic(() => import("./AssistantWidget"), { ssr: false });

export function AssistantMount() {
  return <AssistantWidget />;
}
