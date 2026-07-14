"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { Card, CardBody, Button, LinkCard, Skeleton, EmptyState } from "@/components";
import { initialsFromEmail } from "@/lib/identity";
import { useIsDesktop } from "@/lib/use-media-query";
import { useSignOut } from "@/lib/use-sign-out";
import { AccountDesktop } from "./account-desktop";

// WP-F.2 (mobile body) / WP-PW-4 Task 2 (desktop gate): the portal "Account" tab.
// PortalAccount is now the useIsDesktop() gate — unconditional hook, before any return —
// so exactly one of the two bodies mounts: mobile (< lg) is AccountMobile, extracted
// verbatim from the pre-WP-PW-4 body (the ONE sanctioned non-verbatim change: sign-out
// now goes through the shared useSignOut() hook instead of an inline copy — identical
// runtime behavior, AUT-14 intact); desktop (>= lg) is the two-column AccountDesktop grid
// (account-desktop.tsx). PortalAccount itself returns whatever its child returns — a
// <div>, never a <main> — the server component (/portal/page.tsx) owns the page's <main>.
// INTENTIONAL asymmetry (same as leads/activity): the portal shell switches chrome (rail
// vs. bottom nav) at md (768), but this content gates at lg (1024, useIsDesktop) for
// portal-wide consistency — so 768-1024 shows desktop chrome + the mobile body. Don't
// "fix" this to md.
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
  const isDesktop = useIsDesktop();
  return isDesktop ? <AccountDesktop /> : <AccountMobile />;
}

function AccountMobile() {
  const { data, isPending, error } = useQuery({ queryKey: ["me"], queryFn: () => apiGet<Me>("/api/me") });
  const { signOut, signingOut } = useSignOut();

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
                <p className="text-step-1 capitalize text-text-3">
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
            <LinkCard href={l.href} className="flex min-h-[52px] flex-col justify-center px-4 py-2.5">
              <span className="text-sm font-semibold text-text">{l.label}</span>
              <span className="text-step-1 text-text-3">{l.hint}</span>
            </LinkCard>
          </li>
        ))}
      </ul>

      <Button variant="secondary" size="lg" loading={signingOut} onClick={signOut} className="mt-1 w-full">
        Sign out
      </Button>
    </div>
  );
}
