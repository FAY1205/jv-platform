"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "./DropdownMenu";
import { initialsFromEmail } from "@/lib/identity";
import { useSignOut } from "@/lib/use-sign-out";

// T7a: the portal rail-foot account menu — the admin ProfileMenu pattern, portal-
// flavored (Account · Devices · Terms of service · Sign out). Identity from /api/me
// (the shared ["me"] cache); sign-out is the shared AUT-14 hook (server-side revoke →
// query-cache clear → /portal/login). Desktop-rail only — the mobile chrome keeps its
// bottom-tab Account entry.

interface Me {
  email: string;
  role: string;
  workspace: { name: string };
}

export function PortalProfileMenu() {
  const { data } = useQuery({ queryKey: ["me"], queryFn: () => apiGet<Me>("/api/me") });
  const email = data?.email ?? "";
  const { signOut } = useSignOut();

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
          <Link href="/portal">Account</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/portal/devices">Devices</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/portal/tos">Terms of service</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => signOut()}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
