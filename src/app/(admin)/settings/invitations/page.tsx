"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";
import { csrfHeaders } from "@/lib/csrf-client";
import { Card, CardBody, CardHeader, CardTitle, Button, Skeleton, EmptyState, QueryErrorState, useToast } from "@/components";
import { SettingsSection } from "../settings-section";

// SCP-06/SCP-07: owner-only signup invitation codes. Visible only to platform owners
// (ADMIN_ALLOWLIST); the API re-checks. Generate a single-use, 48-hour code and hand
// it to a prospective admin — they must enter it to create a workspace.

interface Me { isPlatformOwner?: boolean }
interface ActiveCode { id: string; createdBy: string; createdAt: string; expiresAt: string }

export default function InvitationsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const meQ = useQuery({ queryKey: ["me"], queryFn: () => apiGet<Me>("/api/me") });
  const [fresh, setFresh] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const owner = meQ.data?.isPlatformOwner === true;

  const codesQ = useQuery({
    queryKey: ["signup-codes"],
    queryFn: () => apiGet<{ codes: ActiveCode[] }>("/api/platform/signup-codes"),
    enabled: owner,
  });

  const generate = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/platform/signup-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: "{}",
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b?.message ?? "Could not generate a code.");
      return b as { code: string };
    },
    onSuccess: (b) => {
      setFresh(b.code);
      setCopied(false);
      qc.invalidateQueries({ queryKey: ["signup-codes"] });
    },
    onError: (e: Error) => toast(e.message, "danger"),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch("/api/platform/signup-codes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error("Could not revoke the code.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["signup-codes"] });
      toast("Code revoked.", "success");
    },
    onError: (e: Error) => toast(e.message, "danger"),
  });

  const copy = async () => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh);
      setCopied(true);
    } catch {
      toast("Couldn't copy — select and copy the code manually.", "danger");
    }
  };

  if (meQ.isPending) {
    return (
      <SettingsSection title="Invitations" description="Generate signup codes.">
        <Skeleton className="h-40" />
      </SettingsSection>
    );
  }
  if (!owner) {
    return (
      <SettingsSection title="Invitations" description="Generate signup codes.">
        <Card><CardBody><EmptyState title="Not available" description="Invitation codes are managed by the platform owner." /></CardBody></Card>
      </SettingsSection>
    );
  }

  const codes = codesQ.data?.codes ?? [];
  return (
    <SettingsSection title="Invitations" description="Generate a code someone needs to create a workspace.">
      <Card>
        <CardHeader className="flex items-center justify-between gap-3">
          <CardTitle>Signup invitation codes</CardTitle>
          <Button variant="primary" loading={generate.isPending} onClick={() => generate.mutate()}>
            Generate code
          </Button>
        </CardHeader>
        <CardBody>
          <p className="mb-3 text-sm text-text-2">Each code works once and expires 48 hours after it&rsquo;s created. Share it with the person you want to let sign up.</p>
          {fresh && (
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-brand-line bg-brand-soft p-3">
              <span className="num select-all text-lg font-semibold tracking-wider text-brand-ink">{fresh}</span>
              <Button size="sm" variant="secondary" onClick={copy}>{copied ? "Copied ✓" : "Copy"}</Button>
              <span className="text-xs text-text-3">Copy it now — it won&apos;t be shown again.</span>
            </div>
          )}
          {codesQ.isPending ? (
            <div className="flex flex-col gap-2"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
          ) : codesQ.error ? (
            <QueryErrorState title="Couldn't load codes" error={codesQ.error} onRetry={() => codesQ.refetch()} />
          ) : codes.length === 0 ? (
            <EmptyState title="No active codes" description="Generate a code to invite someone." />
          ) : (
            <ul className="flex flex-col divide-y divide-border-soft">
              {codes.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm text-text">Created {fmtDateTime(c.createdAt)}</p>
                    <p className="text-xs text-text-3">Expires {fmtDateTime(c.expiresAt)} · by {c.createdBy}</p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={revoke.isPending && revoke.variables === c.id}
                    onClick={() => revoke.mutate(c.id)}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </SettingsSection>
  );
}
