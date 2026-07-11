"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { Card, CardBody, CardHeader, CardTitle, Skeleton, EmptyState, PasswordChangeForm } from "@/components";
import { initialsFromEmail } from "@/lib/identity";
import { SettingsSection } from "../settings-section";

interface Me {
  email: string;
  role: "admin" | "partner";
  workspace: { name: string };
}

// WS-7c: Profile — identity (email read-only; no name column yet) + password change.
export default function ProfileSettingsPage() {
  const { data, isPending, error } = useQuery({ queryKey: ["me"], queryFn: () => apiGet<Me>("/api/me") });

  return (
    <SettingsSection title="Profile" description="Your account and password.">
      <Card>
        <CardBody>
          {error ? (
            <EmptyState title="Couldn't load your account" description={(error as Error).message} />
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
          <CardTitle>Change password</CardTitle>
        </CardHeader>
        <CardBody>
          <PasswordChangeForm />
        </CardBody>
      </Card>
    </SettingsSection>
  );
}
