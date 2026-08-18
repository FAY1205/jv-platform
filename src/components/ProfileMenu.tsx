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

// WS-7d / WP-B: the account menu, now a user block at the sidebar foot (theme moved to the
// topbar ThemeToggle). Identity from /api/me; links to Settings + (dev) the gallery and the
// email preview; and sign out (AUT-14 — server-side revoke via /api/auth/logout, then a full
// navigation that drops the client cache so the back button reveals no authed data).
// P-2 (portal-parity audit): the old "Help & guides" item pointed at /dev/emails, which
// notFound()s in production — a permanent 404 on every admin screen. There is no real help
// destination yet, so the dev email preview is now honestly labeled and dev-gated (like the
// gallery); a genuine Help link is a follow-up when help content exists.


const isDev = process.env.NODE_ENV !== "production";

export function ProfileMenu() {
  const { data } = useCurrentUser();
  const email = data?.email ?? "";
  // WP-PP-6: the shared sign-out hook, admin variant → /login (portal callers default to
  // /portal/login). AUT-14: server-side revoke → cache clear → full navigation.
  const { signOut } = useSignOut("/login");

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
          <Link href="/settings">Settings</Link>
        </DropdownMenuItem>
        {isDev && (
          <DropdownMenuItem asChild>
            <Link href="/gallery">Component gallery</Link>
          </DropdownMenuItem>
        )}
        {isDev && (
          <DropdownMenuItem asChild>
            <Link href="/dev/emails">Email preview (dev)</Link>
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
