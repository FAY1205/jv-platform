"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { parseWorkbookInWorker } from "@/lib/xlsx-client";
import { Card, CardBody, Button, AppShell, Tooltip, Spinner } from "@/components";
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
  // The file didn't match the supported format. Product decision (owner): end users are
  // NEVER shown a column-mapping/confirm screen — a new format is added in code by the
  // developer. So an unrecognized file just reports back, it does not offer self-serve mapping.
  const [unrecognized, setUnrecognized] = React.useState(false);

  const idemKey = React.useRef<string>(crypto.randomUUID());

  const process = useMutation({
    mutationFn: (p: Parsed) => post("/api/uploads", { filename: p.filename, headers: p.headers, rows: p.rows, idempotencyKey: idemKey.current }),
    onSuccess: (data: { result: string; uploadRef?: string }) => {
      if (data.result === "processed" && data.uploadRef) {
        qc.invalidateQueries({ queryKey: ["runs"] });
        router.push(`/imports/${data.uploadRef}`);
      } else {
        // "needs_mapping" (drift/unknown) or anything non-processed → unsupported format.
        setUnrecognized(true);
        setErr(null);
      }
    },
    onError: (e: Error) => setErr(e.message),
  });

  async function handleFile(file: File) {
    setErr(null); setParsed(null); setUnrecognized(false);
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
    setPhase("idle"); setParsed(null); setErr(null); setUnrecognized(false);
  }

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

            {unrecognized ? (
              // ── Unsupported format (no self-serve mapping — owner decision) ──
              <div className="flex flex-col items-center gap-3 rounded-lg border border-border-soft bg-surface-2 px-6 py-10 text-center">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-warn-soft text-lg text-warn">!</span>
                <h2 className="font-display text-base font-semibold text-text">This file isn&apos;t the expected format</h2>
                <p className="max-w-[46ch] text-sm text-text-2">
                  We couldn&apos;t recognise the columns in <span className="font-medium text-text">{parsed?.filename}</span>.
                  Please upload the standard export. Use <span className="font-medium">Download template</span> above to check the
                  expected columns — and if the format has genuinely changed, contact your administrator to add it.
                </p>
                <Button variant="primary" onClick={reset}>Choose another file</Button>
              </div>
            ) : (phase === "idle" || phase === "error") ? (
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
            ) : phase === "parsing" ? (
              // ── Reading the workbook (client-side worker parse) — can take a moment on
              //    a large file, so show motion rather than a dead "Reading…" label. ──
              <div className="flex w-full flex-col items-center gap-2 rounded-lg border border-border-soft bg-surface-2 px-6 py-12 text-center text-text-2">
                <Spinner size={22} />
                <span className="text-sm font-semibold text-text">Reading your file…</span>
                <span className="text-xs text-text-3">Checking the columns — this stays in your browser.</span>
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
                  <Button variant="primary" onClick={() => parsed && process.mutate(parsed)} disabled={!parsed || process.isPending} loading={process.isPending}>
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
