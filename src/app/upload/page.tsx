"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { parseWorkbookInWorker } from "@/lib/xlsx-client";
import { Card, CardBody, Button, Badge, Input, NativeSelect, AppShell, Tooltip } from "@/components";
import { csrfHeaders } from "@/lib/csrf-client";
import { validateUploadFile } from "@/lib/upload-guard";
// Client-safe: seed-profiles is pure data (its only import is a type, erased at build) —
// no DB/server chain reaches the bundle through it.
import { LEAD_SOURCE_1_PROFILE } from "@/modules/sources/seed-profiles";

interface Parsed {
  filename: string;
  headers: string[];
  rows: Record<string, string>[];
}

// Friendly labels for the canonical fields the app maps to (ING-03).
const CANONICAL_LABELS: Record<string, string> = {
  campaign: "Campaign", dateCreated: "Date created", notes: "Notes", address: "Address",
  city: "City", state: "State", zip: "ZIP", sellerFirst: "Seller first name",
  sellerLast: "Seller last name", phone: "Phone", email: "Email",
  reasonForSelling: "Reason for selling", motivation: "Motivation", timeToSell: "Time to sell",
};

/** A field missing from the label map still reads as words ("dateCreated" → "Date created"). */
function fieldLabel(field: string): string {
  const spaced = field.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

interface MappingNeed {
  kind: "drift" | "unknown";
  baseProfileId: string | null;
  baseProfileName: string | null;
  strictness: "flexible" | "strict";
  uploadHeaders: string[];
  suggestedMapping: Record<string, string>;
  diff: { added: string[]; removed: string[]; renamed: { from: string; to: string }[] } | null;
  requiredColumns: string[];
  canonicalFields: string[];
}

// WP-LS1: the only ingestable format. The retired investorfuse/generic ids left the
// seed list, and the template route resolves ids from it — so this MUST track the seed
// or the download 404s (it did; caught by driving the real upload page, not by a test).
const TEMPLATE_HREF = `/api/templates/${LEAD_SOURCE_1_PROFILE.id}`;

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { message?: string }).message ?? "Request failed.");
  return json;
}

export default function UploadPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [drag, setDrag] = React.useState(false);
  const [phase, setPhase] = React.useState<"idle" | "parsing" | "ready" | "error">("idle");
  const [parsed, setParsed] = React.useState<Parsed | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [need, setNeed] = React.useState<MappingNeed | null>(null);
  const [mapping, setMapping] = React.useState<Record<string, string>>({});
  const [newName, setNewName] = React.useState("");

  const idemKey = React.useRef<string>(crypto.randomUUID());

  const process = useMutation({
    mutationFn: (p: Parsed) => post("/api/uploads", { filename: p.filename, headers: p.headers, rows: p.rows, idempotencyKey: idemKey.current }),
    onSuccess: (data: { result: string; uploadRef?: string } & MappingNeed) => {
      if (data.result === "processed" && data.uploadRef) {
        qc.invalidateQueries({ queryKey: ["runs"] });
        router.push(`/imports/${data.uploadRef}`);
      } else if (data.result === "needs_mapping") {
        setNeed(data);
        setMapping({ ...data.suggestedMapping });
        setErr(null);
      }
    },
    onError: (e: Error) => setErr(e.message),
  });

  const confirm = useMutation({
    mutationFn: (p: Parsed) =>
      post("/api/uploads/confirm", {
        filename: p.filename, headers: p.headers, rows: p.rows, mapping,
        baseProfileId: need?.baseProfileId ?? undefined,
        newFormatName: need?.kind === "unknown" ? newName : undefined,
        strictness: need?.strictness ?? "flexible",
        idempotencyKey: idemKey.current,
      }),
    onSuccess: (data: { uploadRef: string }) => {
      qc.invalidateQueries({ queryKey: ["runs"] });
      router.push(`/imports/${data.uploadRef}`);
    },
    onError: (e: Error) => setErr(e.message),
  });

  async function handleFile(file: File) {
    setErr(null); setParsed(null); setNeed(null);
    const check = validateUploadFile({ name: file.name, size: file.size });
    if (!check.ok) { setErr(check.error ?? "That file can't be used."); setPhase("error"); return; }
    setPhase("parsing");
    idemKey.current = crypto.randomUUID();
    try {
      const { headers, rows } = await parseWorkbookInWorker(file);
      setParsed({ filename: file.name, headers, rows });
      setPhase("ready");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not read the file.");
      setPhase("error");
    }
  }

  function reset() {
    setPhase("idle"); setParsed(null); setErr(null); setNeed(null); setMapping({});
  }

  const headerOptions = (need?.uploadHeaders ?? []).map((h) => ({ value: h, label: h }));

  return (
    <AppShell>
        <div className="mx-auto max-w-[760px]">
        <div className="mb-6 flex items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-text">New import</h1>
            <p className="mt-1 text-sm text-text-2">Drop this week&apos;s export to process and distribute it.</p>
          </div>
          {/* File-download endpoint (not a page) — a plain anchor is correct; the href
              is a variable so the pages-link lint rule doesn't misfire. */}
          <Tooltip content="Download a template with the expected columns">
            <a href={TEMPLATE_HREF} download className="shrink-0 text-xs text-brand-ink hover:underline">
              ↓ Download template
            </a>
          </Tooltip>
        </div>

        <Card>
          <CardBody>
            <input ref={inputRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />

            {(phase === "idle" || phase === "error") && !need ? (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); e.dataTransfer.files?.[0] && handleFile(e.dataTransfer.files[0]); }}
                className={`flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors ${drag ? "border-brand bg-brand-soft" : "border-border hover:border-brand-line hover:bg-surface-2"}`}
              >
                <span className="grid h-11 w-11 place-items-center rounded-full bg-surface-3 text-lg text-text-2">↑</span>
                <span className="text-sm font-semibold text-text">Drop a weekly .xlsx here</span>
                <span className="text-xs text-text-3">or click to browse</span>
                {err && <span className="mt-2 text-xs text-danger">{err}</span>}
              </button>
            ) : need ? (
              // ── Mapping / drift confirm screen (ING-02/08) ──
              <div className="flex flex-col gap-4">
                <div>
                  <h2 className="font-display text-base font-semibold text-text">
                    {need.kind === "drift" ? `The ${need.baseProfileName} format changed` : "New file format"}
                  </h2>
                  <p className="mt-1 text-sm text-text-2">
                    {need.kind === "drift"
                      ? "Confirm how the columns map, and I'll save it as a new version."
                      : "Tell me which column is which, and I'll save it as a new format."}
                  </p>
                </div>

                {need.diff && (need.diff.added.length > 0 || need.diff.removed.length > 0) && (
                  <div className="flex flex-wrap gap-1.5 rounded-md border border-border-soft bg-surface-2 p-3 text-xs">
                    {need.diff.renamed.map((r) => <Badge key={r.from} variant="warn">Renamed: {r.from} → {r.to}</Badge>)}
                    {need.diff.added.filter((a) => !need.diff!.renamed.some((r) => r.to === a)).map((a) => <Badge key={a} variant="success">New column: {a}</Badge>)}
                    {need.diff.removed.filter((a) => !need.diff!.renamed.some((r) => r.from === a)).map((a) => <Badge key={a} variant="removed">No longer in file: {a}</Badge>)}
                  </div>
                )}

                {need.kind === "unknown" && (
                  <Input label="Format name" value={newName} onChange={(e) => setNewName(e.target.value)} hint="e.g. Acme CRM export" />
                )}

                <div className="flex flex-col gap-2">
                  {need.canonicalFields.map((field) => {
                    const req = need.requiredColumns.includes(field);
                    return (
                      <div key={field} className="grid grid-cols-[1fr_1.4fr] items-center gap-3">
                        <span className="text-sm text-text-2">
                          {CANONICAL_LABELS[field] ?? fieldLabel(field)}
                          {req && <span className="ml-1 text-danger">*</span>}
                        </span>
                        <NativeSelect
                          value={mapping[field] ?? ""}
                          onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value }))}
                        >
                          <option value="">— not in file —</option>
                          {headerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </NativeSelect>
                      </div>
                    );
                  })}
                </div>

                {err && <p className="text-sm text-danger">{err}</p>}

                <div className="flex items-center gap-3">
                  <Button
                    variant="primary"
                    loading={confirm.isPending}
                    disabled={need.kind === "unknown" && !newName.trim()}
                    onClick={() => parsed && confirm.mutate(parsed)}
                  >
                    Confirm &amp; process
                  </Button>
                  <Button variant="ghost" onClick={reset} disabled={confirm.isPending}>Cancel</Button>
                </div>
              </div>
            ) : (
              // ── Ready-to-process screen ──
              <div className="flex flex-col gap-5">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border-soft bg-surface-2 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-text">{parsed?.filename ?? "Reading…"}</div>
                    {parsed && (
                      <div className="mt-0.5 text-xs text-text-3">
                        <span className="num">{parsed.rows.length}</span> rows · <span className="num">{parsed.headers.length}</span> columns
                      </div>
                    )}
                  </div>
                </div>

                {err && <p className="text-sm text-danger">{err}</p>}

                <div className="flex items-center gap-3">
                  <Button variant="primary" onClick={() => parsed && process.mutate(parsed)} disabled={!parsed || process.isPending || phase === "parsing"} loading={process.isPending}>
                    Process file
                  </Button>
                  <Button variant="ghost" onClick={reset} disabled={process.isPending}>Choose another file</Button>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
        </div>
    </AppShell>
  );
}
