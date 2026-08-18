"use client";

import * as React from "react";
import { Button, Card, CardBody, CardHeader, CardTitle, Skeleton, QueryErrorState, PasswordChangeForm } from "@/components";
import { initialsFromEmail } from "@/lib/identity";
import { SettingsSection } from "../settings-section";
import { useCurrentUser } from "@/lib/use-current-user";


// WS-7c: Profile — identity (email read-only; no name column yet) + password change.
// The password form sits behind a disclosure so the page doesn't open on three
// password fields (owner feedback, testing round 2).
export default function ProfileSettingsPage() {
  const { data, isPending, error, refetch } = useCurrentUser();
  const [changingPassword, setChangingPassword] = React.useState(false);

  return (
    <SettingsSection title="Profile" description="Your account and password.">
      <Card>
        <CardBody>
          {error ? (
            <QueryErrorState title="Couldn't load your account" error={error} onRetry={() => refetch()} />
          ) : isPending || !data ? (
            <Skeleton className="h-14" />
          ) : (
            <div className="flex items-center gap-4">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-brand text-base font-semibold text-brand-contrast">
                {initialsFromEmail(data.email)}
              </span>
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-text">{data.email}</span>
                <span className="text-xs capitalize text-text-3">
                  {data.role} · {data.workspace.name}
                </span>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
        </CardHeader>
        <CardBody>
          {changingPassword ? (
            <div className="flex flex-col gap-3">
              <PasswordChangeForm />
              <Button variant="ghost" size="sm" className="self-start" onClick={() => setChangingPassword(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-text-2">Update the password you use to sign in.</p>
              <Button variant="secondary" onClick={() => setChangingPassword(true)}>
                Change password
              </Button>
            </div>
          )}
        </CardBody>
      </Card>
    </SettingsSection>
  );
}
