"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { csrfHeaders } from "@/lib/csrf-client";
import { TopBar } from "../runs/_shell";
import {
  Card, CardBody, CardHeader, CardTitle, Table, THead, TBody, Th, Tr, Td,
  Badge, Button, Modal, Input, Skeleton, EmptyState, PartnerTag, ToastProvider, useToast,
} from "@/components";

// CVG-02: the Rules area. Campaign recodes are fully editable; MLS phrases are
// view + on/off + label (never regex, PRN-04); coverage is read-only here (edited
// on Partners). Every change is audited and picked up by the next run (DM-08).

interface Recode { id: string; matchPattern: string; code: string }
interface MlsPattern { id: string; patternKey: string; type: "disqualify" | "keep_override"; regex: string; flags: string; label: string; enabled: boolean }
interface Coverage { zipCount: number; stateRules: { state: string; partnerName: string; partnerRef: string; color: string }[] }
interface Format { id: string; name: string; version: number; columns: number; strictness: "flexible" | "strict" }
interface RulesData { recodes: Recode[]; mlsPatterns: MlsPattern[]; coverage: Coverage; formats: Format[] }

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json", ...csrfHeaders() }, body: body === undefined ? "{}" : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { message?: string }).message ?? "Request failed");
  return json;
}

function RecodeModal({ editing, onClose }: { editing: Recode | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [matchPattern, setMatch] = React.useState(editing?.matchPattern ?? "");
  const [code, setCode] = React.useState(editing?.code ?? "");
  const [err, setErr] = React.useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      editing
        ? send(`/api/admin/rules/recodes/${editing.id}`, "PATCH", { matchPattern, code })
        : send("/api/admin/rules/recodes", "POST", { matchPattern, code }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rules"] }); toast(editing ? "Recode updated." : "Recode added.", "success"); onClose(); },
    onError: (e: Error) => setErr(e.message),
  });
  return (
    <Modal open onClose={onClose} title={editing ? "Edit recode" : "New recode"} footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} onClick={() => { setErr(null); if (!matchPattern.trim() || !code.trim()) return setErr("Both fields are required."); save.mutate(); }}>Save</Button>
      </>
    }>
      <div className="flex flex-col gap-3">
        {err && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
        <Input label="Campaign match" value={matchPattern} onChange={(e) => setMatch(e.target.value)} hint="e.g. Lead Zolo*  (a * matches the rest)" autoFocus />
        <Input label="Code" value={code} onChange={(e) => setCode(e.target.value)} hint="Short code used in the export, e.g. Z" />
      </div>
    </Modal>
  );
}

function RulesInner() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isPending, error } = useQuery({ queryKey: ["rules"], queryFn: () => apiGet<RulesData>("/api/admin/rules") });
  const [recodeModal, setRecodeModal] = React.useState<{ editing: Recode | null } | null>(null);

  const toggleMls = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => send(`/api/admin/rules/mls/${v.id}`, "PATCH", { enabled: v.enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rules"] }),
    onError: (e: Error) => toast(e.message, "danger"),
  });
  const delRecode = useMutation({
    mutationFn: (id: string) => send(`/api/admin/rules/recodes/${id}`, "DELETE"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rules"] }); toast("Recode removed.", "success"); },
    onError: (e: Error) => toast(e.message, "danger"),
  });

  return (
    <div className="min-h-full">
      <TopBar active="rules" />
      <main className="mx-auto max-w-[1000px] px-6 py-8 flex flex-col gap-6">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-text">Rules</h1>
          <p className="mt-1 text-sm text-text-2">The rules that shape each run. Changes apply to future runs and are logged.</p>
        </div>

        {error ? (
          <Card><CardBody><EmptyState title="Couldn't load rules" description={(error as Error).message} /></CardBody></Card>
        ) : isPending ? (
          <Skeleton className="h-40" />
        ) : (
          <>
            {/* Campaign recodes */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle>Campaign recodes</CardTitle>
                  <Button variant="secondary" size="sm" onClick={() => setRecodeModal({ editing: null })}>+ New recode</Button>
                </div>
              </CardHeader>
              <CardBody>
                {data.recodes.length === 0 ? (
                  <EmptyState title="No recodes" description="Map a campaign name to a short export code." />
                ) : (
                  <Table>
                    <THead><Tr><Th>Campaign match</Th><Th>Code</Th><Th align="right">Actions</Th></Tr></THead>
                    <TBody>
                      {data.recodes.map((r) => (
                        <Tr key={r.id}>
                          <Td><span className="num text-sm">{r.matchPattern}</span></Td>
                          <Td><Badge variant="neutral">{r.code}</Badge></Td>
                          <Td align="right">
                            <div className="flex justify-end gap-1.5">
                              <Button variant="secondary" size="sm" onClick={() => setRecodeModal({ editing: r })}>Edit</Button>
                              <Button variant="ghost" size="sm" loading={delRecode.isPending && delRecode.variables === r.id} onClick={() => delRecode.mutate(r.id)}>Remove</Button>
                            </div>
                          </Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                )}
              </CardBody>
            </Card>

            {/* MLS phrases */}
            <Card>
              <CardHeader><CardTitle>MLS phrases</CardTitle></CardHeader>
              <CardBody>
                <p className="mb-3 text-xs text-text-3">Phrases that decide whether a lead is “listed on MLS”. Toggle them on or off; the exact matching is vetted and tested.</p>
                <Table>
                  <THead><Tr><Th>Phrase</Th><Th>Effect</Th><Th align="right">On</Th></Tr></THead>
                  <TBody>
                    {data.mlsPatterns.map((m) => (
                      <Tr key={m.id}>
                        <Td>
                          <div className="text-sm text-text">{m.label}</div>
                          <div className="num text-[.66rem] text-text-3">{m.regex}</div>
                        </Td>
                        <Td>
                          <Badge variant={m.type === "disqualify" ? "removed" : "success"}>
                            {m.type === "disqualify" ? "Removes lead" : "Keeps lead"}
                          </Badge>
                        </Td>
                        <Td align="right">
                          <label className="inline-flex items-center">
                            <input
                              type="checkbox"
                              checked={m.enabled}
                              disabled={toggleMls.isPending && toggleMls.variables?.id === m.id}
                              onChange={(e) => toggleMls.mutate({ id: m.id, enabled: e.target.checked })}
                              className="h-4 w-4 accent-brand"
                              aria-label={`${m.label} enabled`}
                            />
                          </label>
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </CardBody>
            </Card>

            {/* Coverage summary (read-only) */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle>Coverage</CardTitle>
                  <Link href="/partners" className="text-xs text-brand hover:underline">Edit on Partners →</Link>
                </div>
              </CardHeader>
              <CardBody>
                <p className="mb-3 text-sm text-text-2">
                  <span className="num font-semibold">{data.coverage.zipCount}</span> ZIP{data.coverage.zipCount === 1 ? "" : "s"} covered ·{" "}
                  <span className="num font-semibold">{data.coverage.stateRules.length}</span> whole-state rule{data.coverage.stateRules.length === 1 ? "" : "s"}.
                </p>
                {data.coverage.stateRules.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {data.coverage.stateRules.map((s) => (
                      <span key={s.state} className="inline-flex items-center gap-1.5 rounded-md border border-border-soft px-2 py-1">
                        <Badge variant="state">{s.state}</Badge>
                        <PartnerTag name={s.partnerName} color={s.color} refId={s.partnerRef} size="sm" />
                      </span>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>

            {/* File formats (Source Profiles) + templates */}
            <Card>
              <CardHeader><CardTitle>File formats</CardTitle></CardHeader>
              <CardBody>
                <p className="mb-3 text-xs text-text-3">The upload formats the app recognizes. Download a template to prepare a file with the right columns (ING-05).</p>
                <Table>
                  <THead><Tr><Th>Format</Th><Th align="right">Columns</Th><Th>Match</Th><Th align="right">Template</Th></Tr></THead>
                  <TBody>
                    {data.formats.map((fmt) => (
                      <Tr key={fmt.id}>
                        <Td><span className="text-sm text-text">{fmt.name}</span> <span className="num text-xs text-text-3">v{fmt.version}</span></Td>
                        <Td align="right"><span className="num text-sm text-text-2">{fmt.columns}</span></Td>
                        <Td><Badge variant={fmt.strictness === "strict" ? "warn" : "neutral"}>{fmt.strictness}</Badge></Td>
                        <Td align="right">
                          <a href={`/api/templates/${fmt.id}`} className="text-xs text-brand hover:underline">↓ Download</a>
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </CardBody>
            </Card>
          </>
        )}
      </main>

      {recodeModal && <RecodeModal editing={recodeModal.editing} onClose={() => setRecodeModal(null)} />}
    </div>
  );
}

export default function RulesPage() {
  return (
    <ToastProvider>
      <RulesInner />
    </ToastProvider>
  );
}
