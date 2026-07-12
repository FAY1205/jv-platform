"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { csrfHeaders } from "@/lib/csrf-client";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "./DropdownMenu";
import { initialsFromEmail } from "@/lib/identity";

// WS-7d / WP-B: the account menu, now a user block at the sidebar foot (theme moved to the
// topbar ThemeToggle). Identity from /api/me; links to Settings + (dev) the gallery + Help;
// and sign out (AUT-14 — server-side revoke via /api/auth/logout, then a full navigation
// that drops the client cache so the back button reveals no authed data).

interface Me {
  email: string;
  role: string;
  workspace: { name: string };
}

const isDev = process.env.NODE_ENV !== "production";

export function ProfileMenu() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["me"], queryFn: () => apiGet<Me>("/api/me") });
  const email = data?.email ?? "";

  async function signOut() {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ scope: "local" }),
      });
    } catch {
      // Navigate away regardless — the session cookie is HttpOnly and server-revoked.
    }
    qc.clear();
    window.location.assign("/login");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-[background-color,transform] hover:bg-surface-3 active:scale-[0.99]"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-3 text-step-1 font-semibold text-text-2">
            {email ? initialsFromEmail(email) : "…"}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-text">{email || "Account"}</span>
            {data && <span className="block truncate text-step-1 capitalize text-text-3">{data.role}</span>}
          </span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-text-3" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="min-w-[224px]">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="truncate text-sm font-semibold text-text">{email || "Signed in"}</span>
            {data && <span className="text-xs capitalize text-text-3">{data.role} · {data.workspace.name}</span>}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">Settings</Link>
        </DropdownMenuItem>
        {isDev && (
          <DropdownMenuItem asChild>
            <Link href="/gallery">Component gallery</Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link href="/dev/emails">Help &amp; guides</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => signOut()}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
