"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { Card, CardBody, Skeleton, EmptyState } from "@/components";
import { SettingsSection } from "../settings-section";

interface Me {
  workspace: { name: string };
}

// WS-7c: Workspace — name (read-only for now) + branding placeholder. Full branding
// editor (SET-09) is token-driven and lands later; the tokens already support rebrand.
export default function WorkspaceSettingsPage() {
  const { data, isPending, error } = useQuery({ queryKey: ["me"], queryFn: () => apiGet<Me>("/api/me") });

  return (
    <SettingsSection title="General" description="Your workspace name and branding.">
      <Card>
        <CardBody>
          {error ? (
            <EmptyState title="Couldn't load workspace" description={(error as Error).message} />
          ) : isPending || !data ? (
            <Skeleton className="h-10" />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-text-2">Workspace name</span>
                <span className="text-sm text-text">{data.workspace.name}</span>
              </div>
              <p className="text-xs text-text-3">
                Branding — logo, colors, and typography — is theme-token driven (PRN-12) and becomes editable here in a later update.
              </p>
            </div>
          )}
        </CardBody>
      </Card>
    </SettingsSection>
  );
}
