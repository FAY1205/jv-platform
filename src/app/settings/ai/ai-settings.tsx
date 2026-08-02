"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiMutate } from "@/lib/api";
import { csrfHeaders } from "@/lib/csrf-client";
import { Card, CardBody, CardHeader, CardTitle, Switch, Input, Select, Button, EmptyState, Skeleton, Badge, useToast } from "@/components";

// SET-11 / ADR-0036: admin-only AI assistant control — a single card. The enable switch
// auto-saves; when ON it reveals the tenant's OWN provider credential (BYO). The API key
// is write-only: the server returns only whether one is configured and for which
// provider, never the key itself.

const PROVIDERS = [
  { value: "google", label: "Google Gemini" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic Claude" },
];
const PROVIDER_LABEL: Record<string, string> = { google: "Google Gemini", openai: "OpenAI", anthropic: "Anthropic Claude" };

interface AiSettingsPayload {
  settings: { enabled: boolean };
  credential: { configured: boolean; provider: string | null; encryptionAvailable: boolean };
}

export function AiSettings() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useQuery({ queryKey: ["settings", "ai"], queryFn: () => apiGet<AiSettingsPayload>("/api/settings/ai") });

  // Seed the switch from server data WITHOUT setState-in-effect (adjust during render).
  const [seed, setSeed] = React.useState<AiSettingsPayload["settings"] | null>(null);
  const [enabled, setEnabled] = React.useState(false);
  if (q.data && q.data.settings !== seed) {
    setSeed(q.data.settings);
    setEnabled(q.data.settings.enabled);
  }

  // Credential draft (write-only key).
  const [provider, setProvider] = React.useState("google");
  const [apiKey, setApiKey] = React.useState("");
  const [testResult, setTestResult] = React.useState<{ ok: boolean; message?: string; provider?: string; model?: string } | null>(null);

  // The switch auto-saves on toggle; onSettled re-syncs from the server (reverts on error).
  const save = useMutation({
    mutationFn: (next: boolean) => apiMutate("/api/settings/ai", "PUT", { enabled: next }),
    onError: (e: Error) => toast(e.message, "danger"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["settings", "ai"] }),
  });

  const saveKey = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/settings/ai", { method: "POST", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify(body) });
      const b = await res.json();
      if (!res.ok) throw new Error(b?.message ?? "Could not save the key.");
      return b;
    },
    onSuccess: (_d, vars) => {
      setApiKey("");
      setTestResult(null); // a prior test result no longer applies to the new/removed key
      qc.invalidateQueries({ queryKey: ["settings", "ai"] });
      toast((vars as { action?: string }).action === "clear" ? "API key removed." : "API key saved.", "success");
    },
    onError: (e: Error) => toast(e.message, "danger"),
  });

  // On-demand "test connection": one live provider call against the stored key (ADR-0036).
  const testKey = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings/ai", { method: "POST", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify({ action: "test" }) });
      const b = await res.json();
      if (!res.ok) throw new Error(b?.message ?? "Couldn't run the test.");
      return b.test as { ok: boolean; message?: string; provider?: string; model?: string };
    },
    onSuccess: (t) => setTestResult(t),
    onError: (e: Error) => setTestResult({ ok: false, message: e.message }),
  });

  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (q.isError || !q.data) return <EmptyState title="Couldn't load AI settings" description="Refresh to try again." />;

  const cred = q.data.credential;

  function toggle(next: boolean) {
    setEnabled(next);
    save.mutate(next);
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle>AI assistant</CardTitle>
        {enabled && cred.configured && cred.provider && (
          <Badge variant="success">{PROVIDER_LABEL[cred.provider] ?? cred.provider} · connected</Badge>
        )}
      </CardHeader>
      <CardBody className="flex flex-col gap-5">
        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="block text-sm font-medium text-text">Assistant enabled</span>
            <span className="block text-step-1 text-text-2">Turn on to connect an AI provider and show the in-app assistant to admins in this workspace.</span>
          </span>
          <Switch checked={enabled} onCheckedChange={toggle} disabled={save.isPending} ariaLabel="Assistant enabled" />
        </label>

        {/* Provider + key: revealed only when the assistant is on (ADR-0036 BYO). */}
        {enabled && (
          <div className="flex flex-col gap-4 border-t border-border-soft pt-5">
            <p className="text-sm text-text-2">
              The assistant runs on your own AI account. Choose a provider and paste an API key — it&apos;s stored
              encrypted and never shown again. Your provider bills you directly; requests go to them under your terms.
            </p>
            {!cred.encryptionAvailable ? (
              <p className="rounded-md bg-warn-soft px-3 py-2 text-sm text-text-2">Secure key storage isn&apos;t configured on this deployment yet. Contact support to enable it.</p>
            ) : (
              <>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <Select label="Provider" required value={provider} onValueChange={setProvider} options={PROVIDERS} className="sm:w-56" />
                  <Input
                    label={cred.configured ? "Replace API key" : "API key"}
                    type="password"
                    autoComplete="off"
                    required={!cred.configured}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={cred.configured ? "•••••••• (a key is saved)" : "Paste your API key"}
                    className="flex-1"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="primary"
                    loading={saveKey.isPending && (saveKey.variables as { action?: string })?.action !== "clear"}
                    disabled={apiKey.trim().length < 8}
                    onClick={() => saveKey.mutate({ action: "set", provider, apiKey: apiKey.trim() })}
                  >
                    {cred.configured ? "Update key" : "Save key"}
                  </Button>
                  {cred.configured && (
                    <>
                      <Button variant="secondary" loading={testKey.isPending} onClick={() => testKey.mutate()}>
                        Test connection
                      </Button>
                      <Button
                        variant="secondary"
                        loading={saveKey.isPending && (saveKey.variables as { action?: string })?.action === "clear"}
                        onClick={() => saveKey.mutate({ action: "clear" })}
                      >
                        Remove key
                      </Button>
                    </>
                  )}
                </div>

                {/* Test result (PRN-14: an icon + text carry the outcome, never colour alone). */}
                {testResult && (
                  <p
                    role="status"
                    className={
                      "flex items-start gap-2 rounded-md px-3 py-2 text-sm " +
                      (testResult.ok ? "bg-success-soft text-success" : "bg-danger-soft text-text-2")
                    }
                  >
                    <span aria-hidden="true" className="font-bold">{testResult.ok ? "✓" : "!"}</span>
                    <span>
                      {testResult.ok
                        ? `Connected to ${testResult.provider}${testResult.model ? ` (${testResult.model})` : ""}.`
                        : testResult.message}
                    </span>
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
