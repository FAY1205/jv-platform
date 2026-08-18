"use client";

import { Card, CardHeader, CardTitle, CardBody, Button, LinkCard, Skeleton, QueryErrorState, PortalDevices } from "@/components";
import { initialsFromEmail } from "@/lib/identity";
import { useSignOut } from "@/lib/use-sign-out";
import { useCurrentUser } from "@/lib/use-current-user";

// WP-PW-4 Task 2: the desktop (>= lg) Account two-column grid — left Profile (identity +
// Terms-of-service link + Sign out), right Devices (the shared PortalDevices list, ACC-02).
// Owns its own ["me"] query (same key as AccountMobile in portal-account.tsx — they never
// mount together) + the shared useSignOut() hook (AUT-14). No in-body <h1> — the desktop
// top bar already shows "Account" (WP-PW-1's portalTitleForPath). No <main> either — the
// parent server component (/portal/page.tsx) owns the single <main> for this route.
// On desktop the mobile "Your devices"/"Your activity" link rows are dropped (Devices is
// shown inline; Activity is a left-rail nav item) — only the ToS link is kept.

export function AccountDesktop() {
  const { data, isPending, error, refetch } = useCurrentUser();
  const { signOut, signingOut } = useSignOut();

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle as="h2">Profile</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          {error ? (
            <QueryErrorState title="Couldn't load your account" error={error} onRetry={() => refetch()} />
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

          <LinkCard href="/portal/tos" className="flex min-h-[52px] flex-col justify-center px-4 py-2.5">
            <span className="text-sm font-semibold text-text">Terms of service</span>
            <span className="text-step-1 text-text-3">The terms you accepted</span>
          </LinkCard>

          <Button
            variant="secondary"
            size="lg"
            loading={signingOut}
            onClick={signOut}
            className="w-full"
            aria-label="Sign out of your account"
          >
            Sign out
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Your devices</CardTitle>
        </CardHeader>
        <CardBody>
          <PortalDevices />
        </CardBody>
      </Card>
    </div>
  );
}
