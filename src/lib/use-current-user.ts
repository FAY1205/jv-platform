"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { Capability } from "@/lib/authz";

// C-10 / Phase C: the ONE client-side identity hook. Every surface that needs "who am I,
// what may I do" consumes this instead of hand-rolling its own ["me"] query + local Me
// interface (seven copies existed before). The capability list is for CHROME ONLY —
// hide/disable affordances — the server guard (lib/authz) is authoritative on every route.

/** The /api/me contract (route: src/app/api/me/route.ts). */
export interface CurrentUser {
  email: string;
  role: "admin" | "partner" | "member" | "viewer";
  capabilities: Capability[];
  workspace: { name: string };
  isPlatformOwner: boolean;
}

export function useCurrentUser() {
  const query = useQuery({ queryKey: ["me"], queryFn: () => apiGet<CurrentUser>("/api/me") });
  /** Chrome gate: false while loading (affordances appear when identity resolves). */
  const canDo = (cap: Capability): boolean => query.data?.capabilities.includes(cap) ?? false;
  return { ...query, canDo };
}
