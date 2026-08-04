"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { Card, CardBody, CardHeader, CardTitle, Badge, Button, EmptyState, Skeleton } from "@/components";

// Dev-only "sent emails" viewer. Non-production + admin-gated by the API, and the
// route itself is 404'd in production by the server page wrapper (F-48). Surfaces
// the OTP codes / invite + reset links the SEC-07 sink captured, so the owner can
// self-test partner onboarding, password reset, and the portal without a real inbox.

interface DevEmail {
  seq: number;
  at: string;
  kind: string;
  subject: string;
  intendedTo: string[];
  redirected: boolean;
  code: string | null;
  links: string[];
  body: string;
}

const KIND_LABEL: Record<string, string> = {
  otp: "Sign-in code",
  partner_invite: "Partner invite",
  password_reset: "Password reset",
  password_changed: "Password changed",
  lockout: "Account locked",
  auth_anomaly: "Security alert",
  trust_reuse: "Device signed out",
  email: "Email",
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString();
}

function Copy({ value, label }: { value: string; label: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard unavailable — the value is shown for manual copy */
        }
      }}
    >
      {done ? "Copied ✓" : label}
    </Button>
  );
}

export function EmailsView() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dev-emails"],
    queryFn: () => apiGet<{ emails: DevEmail[] }>("/api/dev/emails"),
    refetchInterval: 3000, // codes appear within a few seconds of an action
  });

  const emails = data?.emails ?? [];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">Sent emails (dev)</h1>
          <p className="text-sm text-text-3">
            Everything the app tried to email in this test environment. Real delivery is off — copy
            codes and links from here. Auto-refreshes every few seconds.
          </p>
        </div>
      </div>

      {isError ? (
        <Card>
          <CardBody>
            <EmptyState
              title="Not available"
              description={
                (error as Error)?.message ??
                "This viewer only works in the test environment while signed in as admin."
              }
            />
          </CardBody>
        </Card>
      ) : isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : emails.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              title="No emails yet"
              description="Invite a partner, request a sign-in code, or start a password reset — it will show up here."
            />
          </CardBody>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {emails.map((e) => (
            <li key={e.seq}>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle>{e.subject}</CardTitle>
                    <Badge variant="outline">{KIND_LABEL[e.kind] ?? e.kind}</Badge>
                  </div>
                  <p className="mt-1 font-mono text-xs text-text-3">
                    to {e.intendedTo.join(", ") || "—"} · {fmt(e.at)}
                    {e.redirected ? " · redirected to sink" : ""}
                  </p>
                </CardHeader>
                <CardBody>
                  {e.code && (
                    <div className="mb-3 flex items-center gap-3">
                      <span className="font-mono text-2xl font-semibold tracking-widest tabular-nums">
                        {e.code}
                      </span>
                      <Copy value={e.code} label="Copy code" />
                    </div>
                  )}
                  {e.links.length > 0 && (
                    <div className="mb-3 flex flex-col gap-2">
                      {e.links.map((link) => (
                        <div key={link} className="flex items-center gap-2">
                          <a
                            href={link}
                            className="min-w-0 truncate font-mono text-xs text-brand-ink underline"
                          >
                            {link}
                          </a>
                          <Copy value={link} label="Copy link" />
                        </div>
                      ))}
                    </div>
                  )}
                  <pre className="whitespace-pre-wrap break-words text-xs text-text-2">{e.body}</pre>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
