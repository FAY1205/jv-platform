"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { csrfHeaders } from "@/lib/csrf-client";
import {
  AppShell,
  Card,
  Table,
  THead,
  TBody,
  Th,
  Tr,
  Td,
  Badge,
  Button,
  Dialog,
  Input,
  Textarea,
  Select,
  PartnerTag,
  EmptyState,
  Skeleton,
  ToastProvider,
  useToast,
} from "@/components";

// ADM-03: the admin partner roster — create, edit, invite, deactivate. Partners are
// managed entirely in-app (no pre-supplied list). Every partner is shown as the
// signature PartnerTag (color + name + JV-###); status never relies on color (PRN-14).

interface Partner {
  id: string;
  refId: string;
  name: string;
  email: string | null;
  phone: string | null;
  color: string;
  dealTerms: string | null;
  adminNotes: string | null;
  status: "not_invited" | "invited" | "active" | "revoked";
  zipCount: number;
  stateCount: number;
}
interface Territory {
  states: string[];
  zips: string[];
}

const STATUS: Record<Partner["status"], { label: string; variant: "neutral" | "warn" | "success" }> = {
  not_invited: { label: "Not invited", variant: "neutral" },
  invited: { label: "Invited", variant: "warn" },
  active: { label: "Active", variant: "success" },
  revoked: { label: "Deactivated", variant: "neutral" },
};

async function send(url: string, method: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...csrfHeaders() },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw Object.assign(new Error((json.message as string) ?? "Request failed"), { json, status: res.status });
  return json;
}

// ── Create / edit form ───────────────────────────────────────────────────────
type FormFields = { name: string; email: string; phone: string; dealTerms: string; adminNotes: string; zips: string; states: string };
const EMPTY: FormFields = { name: "", email: "", phone: "", dealTerms: "", adminNotes: "", zips: "", states: "" };

function PartnerForm({
  editing,
  onClose,
}: {
  editing: Partner | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [f, setF] = React.useState<FormFields>(
    editing
      ? {
          name: editing.name,
          email: editing.email ?? "",
          phone: editing.phone ?? "",
          dealTerms: editing.dealTerms ?? "",
          adminNotes: editing.adminNotes ?? "",
          zips: "",
          states: "",
        }
      : EMPTY,
  );
  const [err, setErr] = React.useState<string | null>(null);
  const set = (k: keyof FormFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  // On edit, load the partner's current coverage and seed the ZIP/state fields once
  // (adjust-during-render — the React-recommended alternative to an effect).
  const detail = useQuery({
    queryKey: ["partner", editing?.id],
    queryFn: () => apiGet<{ partner: Partner & { territory: Territory } }>(`/api/admin/partners/${editing!.id}`),
    enabled: !!editing,
  });
  const [seeded, setSeeded] = React.useState(false);
  if (editing && detail.data && !seeded) {
    setSeeded(true);
    const t = detail.data.partner.territory;
    setF((p) => ({ ...p, zips: t.zips.join(", "), states: t.states.join(", ") }));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const contact = { name: f.name, email: f.email, phone: f.phone, dealTerms: f.dealTerms, adminNotes: f.adminNotes };
      const id = editing
        ? (await send(`/api/admin/partners/${editing.id}`, "PATCH", contact), editing.id)
        : ((await send("/api/admin/partners", "POST", contact)).partner as { id: string }).id;
      // CVG-01: apply coverage (validated server-side; rejects unrecognized tokens).
      await send(`/api/admin/partners/${id}/coverage`, "PUT", { zips: f.zips, states: f.states });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["partners"] });
      toast(editing ? "Partner updated." : "Partner created.", "success");
      onClose();
    },
    onError: (e: Error & { json?: Record<string, unknown> }) => {
      const bad = [...((e.json?.invalidZips as string[]) ?? []), ...((e.json?.invalidStates as string[]) ?? [])];
      setErr(bad.length ? `Not recognized: ${bad.join(", ")}` : e.message);
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={editing ? `Edit ${editing.refId}` : "New partner"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={mutation.isPending}
            onClick={() => {
              setErr(null);
              if (!f.name.trim()) return setErr("Name is required.");
              mutation.mutate();
            }}
          >
            {editing ? "Save changes" : "Create partner"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {err && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
        <Input label="Name" value={f.name} onChange={set("name")} autoFocus />
        <Input label="Email" type="email" value={f.email} onChange={set("email")} hint="Needed to send an invite." />
        <Input label="Phone" value={f.phone} onChange={set("phone")} />
        <Textarea
          label="Coverage — ZIP codes"
          value={f.zips}
          onChange={set("zips")}
          rows={2}
          hint="ZIPs this partner covers, separated by commas or spaces."
        />
        <Textarea
          label="Coverage — whole states (optional)"
          value={f.states}
          onChange={set("states")}
          rows={1}
          hint="2-letter states (e.g. TX, CA) this partner covers as a fallback."
        />
        <Textarea label="Deal terms" value={f.dealTerms} onChange={set("dealTerms")} rows={2} />
        <Textarea label="Admin notes" value={f.adminNotes} onChange={set("adminNotes")} rows={2} hint="Private to admins." />
        {!editing && <p className="text-xs text-text-3">A locked color and JV-### reference are assigned automatically.</p>}
      </div>
    </Dialog>
  );
}

// ── Deactivate flow ──────────────────────────────────────────────────────────
function DeactivateModal({
  partner,
  roster,
  onClose,
}: {
  partner: Partner;
  roster: Partner[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [mode, setMode] = React.useState<"reassign" | "unmatched">("reassign");
  const others = roster.filter((p) => p.id !== partner.id);
  const [toPartnerId, setToPartnerId] = React.useState(others[0]?.id ?? "");
  const [err, setErr] = React.useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["partner", partner.id],
    queryFn: () => apiGet<{ partner: Partner & { territory: Territory } }>(`/api/admin/partners/${partner.id}`),
  });
  const territory = detail.data?.partner.territory;
  const owns = !!territory && (territory.states.length > 0 || territory.zips.length > 0);

  const mutation = useMutation({
    mutationFn: () =>
      send(`/api/admin/partners/${partner.id}/deactivate`, "POST", owns ? (mode === "reassign" ? { mode, toPartnerId } : { mode }) : undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["partners"] });
      toast(`${partner.refId} deactivated.`, "success");
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Deactivate ${partner.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={mutation.isPending}
            disabled={detail.isLoading || (owns && mode === "reassign" && !toPartnerId)}
            onClick={() => {
              setErr(null);
              mutation.mutate();
            }}
          >
            Deactivate
          </Button>
        </>
      }
    >
      {detail.isLoading ? (
        <Skeleton className="h-20" />
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          {err && <p className="rounded-md bg-danger-soft px-3 py-2 text-danger">{err}</p>}
          <p className="text-text-2">
            <PartnerTag name={partner.name} color={partner.color} refId={partner.refId} size="sm" /> will no longer receive
            leads or be able to sign in. Existing leads already assigned to them stay put.
          </p>
          {owns ? (
            <div className="flex flex-col gap-3 rounded-md border border-border-soft p-3">
              <p className="text-text">
                This partner still covers{" "}
                <span className="font-semibold">
                  {territory!.states.length} state{territory!.states.length === 1 ? "" : "s"}
                  {territory!.states.length > 0 && ` (${territory!.states.join(", ")})`}
                </span>{" "}
                and{" "}
                <span className="num font-semibold">{territory!.zips.length}</span> ZIP
                {territory!.zips.length === 1 ? "" : "s"}. Where should that territory go?
              </p>
              <label className="flex items-center gap-2">
                <input type="radio" name="mode" checked={mode === "reassign"} onChange={() => setMode("reassign")} />
                <span>Reassign to another partner</span>
              </label>
              {mode === "reassign" && (
                <div className="pl-6">
                  {others.length === 0 ? (
                    <p className="text-danger">No other partner to reassign to — route to Unmatched instead.</p>
                  ) : (
                    <Select
                      value={toPartnerId}
                      onValueChange={setToPartnerId}
                      options={others.map((p) => ({ value: p.id, label: `${p.name} (${p.refId})` }))}
                      ariaLabel="Reassign to partner"
                    />
                  )}
                </div>
              )}
              <label className="flex items-center gap-2">
                <input type="radio" name="mode" checked={mode === "unmatched"} onChange={() => setMode("unmatched")} />
                <span>Route this territory to Unmatched</span>
              </label>
            </div>
          ) : (
            <p className="text-text-3">This partner owns no coverage — nothing to reassign.</p>
          )}
        </div>
      )}
    </Dialog>
  );
}

// ── Roster row actions ───────────────────────────────────────────────────────
function RowActions({ p, onEdit, onDeactivate }: { p: Partner; onEdit: () => void; onDeactivate: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const invite = useMutation({
    mutationFn: () => send(`/api/admin/partners/${p.id}/invite`, "POST"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["partners"] });
      toast("Invitation sent — open “Sent emails” to get the sign-in link.", "success");
    },
    onError: (e: Error) => toast(e.message, "danger"),
  });
  // F-23: any non-active partner can be (re)invited — including a deactivated
  // ("revoked") one, which the roster previously left with no path back in.
  const canInvite = p.status !== "active";
  const inviteLabel = p.status === "revoked" ? "Reactivate" : p.status === "invited" ? "Re-invite" : "Invite";
  return (
    <div className="flex items-center justify-end gap-1.5">
      <Button variant="secondary" size="sm" onClick={onEdit}>
        Edit
      </Button>
      {canInvite && (
        <Button
          variant="secondary"
          size="sm"
          loading={invite.isPending}
          disabled={!p.email}
          title={p.email ? undefined : "Add an email first"}
          onClick={() => invite.mutate()}
        >
          {inviteLabel}
        </Button>
      )}
      {p.status !== "revoked" && (
        <Button variant="ghost" size="sm" onClick={onDeactivate}>
          Deactivate
        </Button>
      )}
    </div>
  );
}

function PartnersInner() {
  const { data, isPending, error } = useQuery({
    queryKey: ["partners"],
    queryFn: () => apiGet<{ partners: Partner[] }>("/api/admin/partners"),
  });
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<Partner | null>(null);
  const [deactivating, setDeactivating] = React.useState<Partner | null>(null);
  const roster = data?.partners ?? [];

  return (
    <AppShell>
        <div className="mb-6 flex items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-text">Partners</h1>
            <p className="mt-1 text-sm text-text-2">Your JV roster — add, invite, and manage coverage owners.</p>
          </div>
          <Button variant="primary" onClick={() => setCreating(true)}>
            + New partner
          </Button>
        </div>

        <Card>
          {isPending ? (
            <div className="flex flex-col gap-3 p-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : error ? (
            <div className="p-6">
              <EmptyState title="Couldn't load partners" description={(error as Error).message} />
            </div>
          ) : roster.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No partners yet" description="Add your first partner to start routing leads." />
            </div>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Partner</Th>
                  <Th>Contact</Th>
                  <Th>Status</Th>
                  <Th>Coverage</Th>
                  <Th align="right">Actions</Th>
                </Tr>
              </THead>
              <TBody>
                {roster.map((p) => (
                  <Tr key={p.id}>
                    <Td>
                      <Link
                        href={`/partners/${p.id}`}
                        className="inline-flex rounded-md transition-opacity hover:opacity-70 focus-visible:opacity-70"
                        title={`Open ${p.name}`}
                      >
                        <PartnerTag name={p.name} color={p.color} refId={p.refId} />
                      </Link>
                    </Td>
                    <Td>
                      <div className="text-sm text-text-2">{p.email ?? <span className="text-text-3">no email</span>}</div>
                      {p.phone && <div className="num text-xs text-text-3">{p.phone}</div>}
                    </Td>
                    <Td>
                      <Badge variant={STATUS[p.status].variant}>{STATUS[p.status].label}</Badge>
                    </Td>
                    <Td>
                      <span className="num text-xs text-text-3">
                        {p.zipCount} ZIP{p.zipCount === 1 ? "" : "s"}
                        {p.stateCount > 0 && ` · ${p.stateCount} state${p.stateCount === 1 ? "" : "s"}`}
                      </span>
                    </Td>
                    <Td align="right">
                      <RowActions p={p} onEdit={() => setEditing(p)} onDeactivate={() => setDeactivating(p)} />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

      {creating && <PartnerForm editing={null} onClose={() => setCreating(false)} />}
      {editing && <PartnerForm editing={editing} onClose={() => setEditing(null)} />}
      {deactivating && <DeactivateModal partner={deactivating} roster={roster} onClose={() => setDeactivating(null)} />}
    </AppShell>
  );
}

export default function PartnersPage() {
  return (
    <ToastProvider>
      <PartnersInner />
    </ToastProvider>
  );
}
