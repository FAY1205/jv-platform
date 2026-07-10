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
import { usePreferences, setPreferences, nextTheme, type ThemePref } from "@/lib/preferences";

// WS-7d: the top-right account menu (first production use of DropdownMenu). Identity from
// /api/me; an inline theme quick-toggle; a link to Settings + (dev) the gallery; and sign
// out (AUT-14 — server-side revoke via /api/auth/logout, then a full navigation that drops
// the client cache so the back button reveals no authed data).

interface Me {
  email: string;
  role: string;
  workspace: { name: string };
}

const THEME_LABEL: Record<ThemePref, string> = { system: "System", light: "Light", dark: "Dark" };
const isDev = process.env.NODE_ENV !== "production";

export function ProfileMenu() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["me"], queryFn: () => apiGet<Me>("/api/me") });
  const { theme } = usePreferences();
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
          className="flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-2.5 transition-colors hover:bg-surface-3"
        >
          <span className="grid h-7 w-7 place-items-center rounded-full bg-brand text-[.68rem] font-semibold text-white">
            {email ? initialsFromEmail(email) : "…"}
          </span>
          <span className="hidden max-w-[130px] truncate text-[.78rem] font-semibold text-text-2 sm:inline">{email || "Account"}</span>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-text-3" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[224px]">
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
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault(); // keep the menu open while cycling
            setPreferences({ theme: nextTheme(theme) });
          }}
        >
          Theme: {THEME_LABEL[theme]}
        </DropdownMenuItem>
        {isDev && (
          <DropdownMenuItem asChild>
            <Link href="/gallery">Component gallery</Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => signOut()}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
