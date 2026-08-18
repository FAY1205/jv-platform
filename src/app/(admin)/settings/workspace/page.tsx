"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { csrfHeaders } from "@/lib/csrf-client";
import { Card, CardBody, Input, Button, Skeleton, QueryErrorState, useToast } from "@/components";
import { SettingsSection } from "../settings-section";
import { useCurrentUser } from "@/lib/use-current-user";


// WS-7c: Workspace — editable name + branding placeholder. Full branding editor (SET-09)
// is token-driven and lands later; the tokens already support rebrand.
export default function WorkspaceSettingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isPending, error, refetch } = useCurrentUser();

  // Seed the field once the workspace loads; keep local edits after that. Render-time
  // guard (ADR-0008, per settings/notifications) — never copy server data into state via
  // an effect. Re-seeds only when the loaded name actually changes.
  const [name, setName] = React.useState("");
  const [seededFrom, setSeededFrom] = React.useState<string | undefined>(undefined);
  if (data?.workspace.name !== undefined && data.workspace.name !== seededFrom) {
    setSeededFrom(data.workspace.name);
    setName(data.workspace.name);
  }

  const save = useMutation({
    mutationFn: async (next: string) => {
      const res = await fetch("/api/settings/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ name: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { message?: string }).message ?? "Could not save.");
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      toast("Workspace name saved.", "success");
    },
    onError: (e: Error) => toast(e.message, "danger"),
  });

  const trimmed = name.trim();
  const dirty = data ? trimmed !== data.workspace.name && trimmed.length > 0 : false;

  return (
    <SettingsSection title="General" description="Your workspace name and branding.">
      <Card>
        <CardBody>
          {error ? (
            <QueryErrorState title="Couldn't load workspace" error={error} onRetry={() => refetch()} />
          ) : isPending || !data ? (
            <Skeleton className="h-10" />
          ) : (
            <div className="flex flex-col gap-4">
              <form
                className="flex items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (dirty && !save.isPending) save.mutate(trimmed);
                }}
              >
                <Input
                  label="Workspace name"
                  className="max-w-xs"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                  required
                />
                <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>
                  Save
                </Button>
              </form>
              <p className="text-xs text-text-3">
                Shown across the app and on partner-facing emails. Workspace branding — logo, colors, and
                typography — becomes editable here in a later update.
              </p>
            </div>
          )}
        </CardBody>
      </Card>
    </SettingsSection>
  );
}
