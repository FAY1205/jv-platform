"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { parseWorkbookInWorker } from "@/lib/xlsx-client";
import { detectProfile } from "@/modules/sources";
import { SEED_SOURCE_PROFILES } from "@/modules/sources/seed-profiles";
import { Card, CardBody, Button, Badge } from "@/components";
import { csrfHeaders } from "@/lib/csrf-client";
import { validateUploadFile } from "@/lib/upload-guard";
import { TopBar } from "../runs/_shell";

interface Parsed {
  filename: string;
  headers: string[];
  rows: Record<string, string>[];
  profileName: string | null;
  status: string;
}

type Step = { label: string; state: "done" | "active" | "pending" };

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="flex flex-col gap-2.5">
      {steps.map((s) => (
        <li key={s.label} className="flex items-center gap-2.5 text-sm">
          <span
            className={
              s.state === "done"
                ? "grid h-5 w-5 place-items-center rounded-full bg-success-soft text-success"
                : s.state === "active"
                  ? "grid h-5 w-5 place-items-center rounded-full bg-brand-soft text-brand"
                  : "grid h-5 w-5 place-items-center rounded-full bg-surface-3 text-text-3"
            }
          >
            {s.state === "done" ? "✓" : s.state === "active" ? <span className="h-2 w-2 animate-pulse rounded-full bg-current" /> : "○"}
          </span>
          <span className={s.state === "pending" ? "text-text-3" : "text-text-2"}>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

export default function UploadPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [drag, setDrag] = React.useState(false);
  const [phase, setPhase] = React.useState<"idle" | "parsing" | "ready" | "error">("idle");
  const [parsed, setParsed] = React.useState<Parsed | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const process = useMutation({
    mutationFn: async (p: Parsed) => {
      const res = await fetch("/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ filename: p.filename, headers: p.headers, rows: p.rows, idempotencyKey: crypto.randomUUID() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message ?? "Processing failed.");
      return body as { uploadRef: string };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["runs"] });
      router.push(`/runs/${data.uploadRef}`);
    },
  });

  async function handleFile(file: File) {
    setErr(null);
    setParsed(null);
    // SEC-03: reject an unsupported extension or an oversized file before parsing.
    const check = validateUploadFile({ name: file.name, size: file.size });
    if (!check.ok) {
      setErr(check.error ?? "That file can't be used.");
      setPhase("error");
      return;
    }
    setPhase("parsing");
    try {
      const { headers, rows } = await parseWorkbookInWorker(file);
      const det = detectProfile(headers, SEED_SOURCE_PROFILES);
      setParsed({ filename: file.name, headers, rows, profileName: det.profile?.name ?? null, status: det.status });
      setPhase("ready");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not read the file.");
      setPhase("error");
    }
  }

  const isExact = parsed?.status === "exact";
  const steps: Step[] = [
    { label: parsed ? `Read ${parsed.rows.length} rows` : "Read the file", state: phase === "parsing" ? "active" : parsed ? "done" : "pending" },
    { label: parsed ? (isExact ? `Detected ${parsed.profileName}` : "Format not recognized") : "Detect the source format", state: parsed ? "done" : "pending" },
    { label: "Process & distribute", state: process.isPending ? "active" : process.isSuccess ? "done" : "pending" },
  ];

  return (
    <div className="min-h-full">
      <TopBar />
      <main className="mx-auto max-w-[720px] px-6 py-8">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-text">New run</h1>
          <p className="mt-1 text-sm text-text-2">Drop this week&apos;s InvestorFuse export to process and distribute it.</p>
        </div>

        <Card>
          <CardBody>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />

            {phase === "idle" || phase === "error" ? (
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
                <span className="text-xs text-text-3">or click to browse · InvestorFuse export</span>
              </button>
            ) : (
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
                  {parsed && (isExact ? <Badge variant="success">{parsed.profileName}</Badge> : <Badge variant="warn">{parsed.status}</Badge>)}
                </div>

                <Steps steps={steps} />

                {err && <p className="text-sm text-danger">{err}</p>}
                {process.isError && <p className="text-sm text-danger">{(process.error as Error).message}</p>}

                <div className="flex items-center gap-3">
                  <Button
                    variant="primary"
                    onClick={() => parsed && process.mutate(parsed)}
                    disabled={!isExact || process.isPending || phase === "parsing"}
                    loading={process.isPending}
                  >
                    Process run
                  </Button>
                  <Button variant="ghost" onClick={() => { setPhase("idle"); setParsed(null); setErr(null); }} disabled={process.isPending}>
                    Choose another file
                  </Button>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </main>
    </div>
  );
}
