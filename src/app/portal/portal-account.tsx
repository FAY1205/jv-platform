"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { csrfHeaders } from "@/lib/csrf-client";
import { Card, CardBody, Button, Skeleton, EmptyState } from "@/components";
import { initialsFromEmail } from "@/lib/identity";

// WP-F.2: the portal "Account" tab body. Identity from /api/me (PRN-08 — caller's own
// row only), links to the other account surfaces, and the portal's first sign-out
// (AUT-14: server-side revoke, then a full navigation that drops the client cache).
interface Me {
  email: string;
  role: string;
  workspace: { name: string };
}

const LINKS = [
  { href: "/portal/devices", label: "Your devices", hint: "Remembered browsers you can sign out" },
  { href: "/portal/activity", label: "Your activity", hint: "Your status updates and notes" },
  { href: "/portal/tos", label: "Terms of service", hint: "The terms you accepted" },
];

export function PortalAccount() {
  const qc = useQueryClient();
  const { data, isPending, error } = useQuery({ queryKey: ["me"], queryFn: () => apiGet<Me>("/api/me") });
  const [signingOut, setSigningOut] = React.useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ scope: "local" }),
      });
    } catch {
      // Navigate away regardless — the session cookie is HttpOnly + server-revoked.
    }
    qc.clear();
    window.location.assign("/portal/login");
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardBody>
          {error ? (
            <EmptyState title="Couldn't load your account" description={(error as Error).message} />
          ) : isPending || !data ? (
            <Skeleton className="h-12" />
          ) : (
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-surface-3 text-base font-semibold text-text-2">
                {initialsFromEmail(data.email)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-text">{data.email}</p>
                <p className="text-[13px] capitalize text-text-3">
                  {data.role} · {data.workspace.name}
                </p>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <ul className="flex flex-col gap-2">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className="flex min-h-[52px] flex-col justify-center rounded-xl border border-border bg-surface px-4 py-2.5 transition-colors hover:border-text-3 hover:bg-surface-2 focus-visible:border-brand-ink"
            >
              <span className="text-sm font-semibold text-text">{l.label}</span>
              <span className="text-[13px] text-text-3">{l.hint}</span>
            </Link>
          </li>
        ))}
      </ul>

      <Button variant="secondary" size="lg" loading={signingOut} onClick={signOut} className="mt-1 w-full">
        Sign out
      </Button>
    </div>
  );
}
