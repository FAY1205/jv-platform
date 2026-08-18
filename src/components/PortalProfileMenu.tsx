"use client";

import * as React from "react";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "./DropdownMenu";
import { AccountMenuTrigger } from "./AccountMenuTrigger";
import { useSignOut } from "@/lib/use-sign-out";
import { useCurrentUser } from "@/lib/use-current-user";

// T7a: the portal rail-foot account menu — the admin ProfileMenu pattern, portal-
// flavored (Account · Devices · Terms of service · Sign out). Identity from /api/me
// (the shared ["me"] cache); sign-out is the shared AUT-14 hook (server-side revoke →
// query-cache clear → /portal/login). Desktop-rail only — the mobile chrome keeps its
// bottom-tab Account entry.


export function PortalProfileMenu() {
  const { data } = useCurrentUser();
  const email = data?.email ?? "";
  const { signOut } = useSignOut();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <AccountMenuTrigger email={email} role={data?.role} />
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
