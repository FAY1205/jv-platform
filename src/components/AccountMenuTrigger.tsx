"use client";

import * as React from "react";
import { initialsFromEmail } from "@/lib/identity";

// WP-PP-6: the account-menu trigger button — avatar initials, name/role block, chevron.
// Promoted from the byte-identical copies in ProfileMenu (admin) and PortalProfileMenu
// (portal) per the FRONTEND_STANDARDS §2 rule (2+ occurrences → primitive). A forwardRef
// so it works as the `asChild` child of Radix's DropdownMenuTrigger (which injects
// onClick / aria-expanded / ref); extra props are spread through.
export const AccountMenuTrigger = React.forwardRef<
  HTMLButtonElement,
  { email: string; role?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function AccountMenuTrigger({ email, role, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label="Account menu"
      className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-[background-color,transform] hover:bg-surface-3 active:scale-[0.99]"
      {...props}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-3 text-step-1 font-semibold text-text-2">
        {email ? initialsFromEmail(email) : "…"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-text">{email || "Account"}</span>
        {role && <span className="block truncate text-step-1 capitalize text-text-3">{role}</span>}
      </span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-text-3" aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  );
});
