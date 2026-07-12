"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { csrfHeaders } from "@/lib/csrf-client";
import {
  Dialog,
  Button,
  Badge,
  Input,
  Textarea,
  Select,
  PartnerTag,
  NotesPanel,
  Skeleton,
  EmptyState,
  useToast,
} from "@/components";
import { matchMethodLabel, routingExplanation } from "@/lib/match-method";
import { offersUnassign } from "@/lib/unassign";

// ADM: the lead dialog — opened from the global Leads table (no page navigation).
// Read-only by default; the Edit button unlocks every field (owner decision). The
// activity timeline + admin notes live here too. Data shapes mirror the server
// (getAdminLeadDetail) — re-declared client-side per the leads-view convention.

interface DetailPartner {
  id: string;
  name: string;
  refId: string;
  color: string;
}
interface Activity {
  kind: "imported" | "routed" | "assigned" | "status";
  at: string;
  label: string;
  actor: string | null;
  status?: string;
}
interface LeadDetail {
  refId: string;
  seller: { first: string; last: string; phone: string; email: string };
  address: string;
  city: string;
  state: string;
  zip: string;
  campaign: string;
  notes: string;
  reasonForSelling: string;
  motivation: string;
  timeToSell: string;
  mlsStatus: "kept" | "removed";
  mlsReason: string;
  status: string;
  editable: boolean;
  receivedAt: string;
  modifiedAt: string | null;
  partner: DetailPartner | null;
  assignment: {
    manual: boolean;
    reason: string;
    assignedAt: string | null;
    matchMethod: string;
    original: DetailPartner | null;
  };
  availableStatuses: string[];
  activity: Activity[];
}
interface Partner {
  id: string;
  refId: string;
  name: string;
  color: string;
}

const REVERT = "__revert__";
const UNASSIGNED = "__unassigned__";

function googleUrl(parts: string[]): string {
  return `https://www.google.com/search?q=${encodeURIComponent(parts.filter(Boolean).join(" "))}`;
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const ACTIVITY_DOT: Record<Activity["kind"], string> = {
  imported: "bg-info",
  routed: "bg-brand",
  assigned: "bg-prev",
  status: "bg-warn",
};

export function LeadDialog({ refId, onClose }: { refId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = React.useState(false);

  const detailQ = useQuery({
    queryKey: ["lead", refId],
    queryFn: () => apiGet<LeadDetail>(`/api/leads/${refId}`),
  });
  const roster = useQuery({
    queryKey: ["partners"],
    queryFn: () => apiGet<{ partners: Partner[] }>("/api/admin/partners"),
  });
  const d = detailQ.data;

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={
        <span className="flex items-center gap-2.5">
          <span className="num">{refId}</span>
          {d && d.mlsStatus === "removed" && <Badge variant="removed">Removed · MLS</Badge>}
        </span>
      }
    >
      {detailQ.isPending ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : detailQ.error || !d ? (
        <EmptyState title="Couldn't load lead" description={(detailQ.error as Error)?.message ?? "Not found."} />
      ) : editing ? (
        <EditForm
          d={d}
          partners={roster.data?.partners ?? []}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            qc.invalidateQueries({ queryKey: ["lead", refId] });
            qc.invalidateQueries({ queryKey: ["leads"] });
            qc.invalidateQueries({ queryKey: ["dashboard"] });
            // A partner reassign/unassign/revert changes the coverage payload
            // (unmatchedLeadCount, coveredVolumePct) that the dashboard hero map
            // and the attention banner consume.
            qc.invalidateQueries({ queryKey: ["coverage"] });
            toast.toast("Lead updated.", "success");
          }}
        />
      ) : (
        <ViewMode d={d} onEdit={() => setEditing(true)} />
      )}
    </Dialog>
  );
}

// ── Read-only view ────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-step-1 font-semibold uppercase tracking-wide text-text-3">{label}</span>
      <span className="text-sm text-text">{children}</span>
    </div>
  );
}

function ViewMode({ d, onEdit }: { d: LeadDetail; onEdit: () => void }) {
  const property = [d.address, d.city, d.state, d.zip].filter(Boolean).join(", ");
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {d.mlsStatus === "removed" ? (
            <Badge variant="removed">Removed · MLS</Badge>
          ) : (
            <Badge variant="neutral" dot>
              {d.status}
            </Badge>
          )}
          {d.partner ? (
            <PartnerTag size="sm" name={d.partner.name} color={d.partner.color} refId={d.partner.refId} />
          ) : d.mlsStatus === "kept" ? (
            <span className="text-xs font-semibold text-warn">Unmatched</span>
          ) : null}
        </div>
        <Button size="sm" variant="primary" onClick={onEdit}>
          Edit
        </Button>
      </div>

      {/* Why-routed note (mockup 02): the matching moment as plain language. The per-lead
          territory map was dropped (owner F-1) — it read at state level, which mismatched
          ZIP-level overrides; the sentence carries the "why" without that ambiguity. */}
      {d.partner && (
        <p className="text-sm text-text-2">
          {routingExplanation({
            partnerName: d.partner.name,
            manual: d.assignment.manual,
            matchMethod: d.assignment.matchMethod,
            zip: d.zip,
            state: d.state,
          })}
        </p>
      )}

      <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3">
        <Field label="Seller">{`${d.seller.first} ${d.seller.last}`.trim() || "—"}</Field>
        <Field label="Phone">{d.seller.phone || "—"}</Field>
        <Field label="Email">{d.seller.email || "—"}</Field>
        <div className="col-span-2 sm:col-span-3">
          <Field label="Property">
            {property ? (
              <a
                href={googleUrl([d.address, d.city, d.state, d.zip])}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-brand-ink hover:underline"
              >
                {property}
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                </svg>
              </a>
            ) : (
              "—"
            )}
          </Field>
        </div>
        <Field label="Source">{d.campaign || "—"}</Field>
        <Field label="Routed by">
          {d.assignment.manual ? (
            <Badge variant="neutral">Manual assignment</Badge>
          ) : (
            <Badge variant={matchMethodLabel(d.assignment.matchMethod).badge}>
              {matchMethodLabel(d.assignment.matchMethod).label}
            </Badge>
          )}
        </Field>
        <Field label="Received">{fmtWhen(d.receivedAt)}</Field>
        {d.assignment.manual && d.assignment.original && (
          <Field label="Original routing">
            <PartnerTag size="sm" name={d.assignment.original.name} color={d.assignment.original.color} refId={d.assignment.original.refId} />
          </Field>
        )}
        <Field label="Reason for selling">{d.reasonForSelling || "—"}</Field>
        <Field label="Motivation">{d.motivation || "—"}</Field>
        <Field label="Time to sell">{d.timeToSell || "—"}</Field>
        {d.mlsStatus === "removed" && (
          <div className="col-span-2 sm:col-span-3">
            <Field label="MLS removal reason">{d.mlsReason || "—"}</Field>
          </div>
        )}
        {d.notes && (
          <div className="col-span-2 sm:col-span-3">
            <Field label="Source notes">
              <span className="whitespace-pre-wrap text-text-2">{d.notes}</span>
            </Field>
          </div>
        )}
      </div>

      <ActivityLog activity={d.activity} />

      <div className="border-t border-border-soft pt-4">
        <NotesPanel leadRef={d.refId} title="Admin notes" />
      </div>
    </div>
  );
}

function ActivityLog({ activity }: { activity: Activity[] }) {
  return (
    <div className="rounded-xl border border-border-soft bg-surface-2 p-4">
      <h3 className="mb-3 text-step-1 font-semibold uppercase tracking-wide text-text-3">Activity</h3>
      {activity.length === 0 ? (
        <p className="text-sm text-text-3">No activity yet.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {activity.map((a, i) => (
            <li key={i} className="flex gap-3">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${ACTIVITY_DOT[a.kind]}`} aria-hidden="true" />
              <div className="flex flex-1 flex-col">
                <span className="text-sm text-text">{a.label}</span>
                <span className="num text-xs text-text-3">
                  {fmtWhen(a.at)}
                  {a.actor ? ` · ${a.actor}` : ""}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ── Edit mode ─────────────────────────────────────────────────────────────────

function EditForm({
  d,
  partners,
  onCancel,
  onSaved,
}: {
  d: LeadDetail;
  partners: Partner[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = React.useState({
    sellerFirst: d.seller.first,
    sellerLast: d.seller.last,
    phone: d.seller.phone,
    email: d.seller.email,
    address: d.address,
    city: d.city,
    state: d.state,
    zip: d.zip,
    campaign: d.campaign,
    reasonForSelling: d.reasonForSelling,
    motivation: d.motivation,
    timeToSell: d.timeToSell,
    notes: d.notes,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const [status, setStatus] = React.useState(d.status);
  // Partner select: current effective owner, a partner id, "unassigned" sentinel, or
  // "revert to original". Radix Select forbids an empty-string value, hence the sentinel.
  const [partnerSel, setPartnerSel] = React.useState(d.partner?.id ?? UNASSIGNED);

  const save = useMutation({
    mutationFn: async () => {
      // 1) Status (kept leads only) — its own endpoint appends history + event.
      if (d.editable && status !== d.status) {
        const res = await fetch(`/api/leads/${d.refId}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...csrfHeaders() },
          body: JSON.stringify({ status }),
        });
        const b = await res.json();
        if (!res.ok) throw new Error(b?.message ?? "Status update failed.");
      }
      // 2) Fields + partner overlay.
      const sel = partnerSel === UNASSIGNED ? "" : partnerSel;
      let partner: { action: "keep" } | { action: "set"; partnerId: string } | { action: "revert" } | { action: "unassign" } = { action: "keep" };
      if (sel === REVERT) partner = { action: "revert" };
      else if (sel === "" && d.partner) partner = { action: "unassign" }; // clearing a currently-assigned lead
      else if (sel && sel !== (d.partner?.id ?? "")) partner = { action: "set", partnerId: sel };
      const res = await fetch(`/api/leads/${d.refId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ fields: f, partner }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b?.message ?? "Save failed.");
      return b;
    },
    onSuccess: onSaved,
  });

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Input label="Seller first name" value={f.sellerFirst} onChange={set("sellerFirst")} />
        <Input label="Seller last name" value={f.sellerLast} onChange={set("sellerLast")} />
        <Input label="Phone" value={f.phone} onChange={set("phone")} />
        <Input label="Email" value={f.email} onChange={set("email")} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="col-span-2 sm:col-span-4">
          <Input label="Address" value={f.address} onChange={set("address")} />
        </div>
        <Input label="City" value={f.city} onChange={set("city")} />
        <Input label="State" value={f.state} onChange={(e) => setF((p) => ({ ...p, state: e.target.value.toUpperCase().slice(0, 2) }))} />
        <Input label="ZIP" value={f.zip} onChange={set("zip")} />
        <Input label="Source" value={f.campaign} onChange={set("campaign")} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        {d.editable ? (
          <Select
            label="Status"
            value={status}
            onValueChange={setStatus}
            options={d.availableStatuses.map((s) => ({ value: s, label: s }))}
          />
        ) : (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-text-2">Status</span>
            <Badge variant="removed">Removed · MLS (read-only)</Badge>
          </div>
        )}
        <Select
          label="Assigned partner"
          value={partnerSel}
          onValueChange={setPartnerSel}
          options={[
            // Offer "Unassigned" only when clearing the overlay would actually succeed —
            // a pipeline-routed lead can't be made owner-less (PRN-05); see offersUnassign.
            ...(offersUnassign({ hasEffectiveOwner: Boolean(d.partner), manual: d.assignment.manual, hasOriginal: Boolean(d.assignment.original) })
              ? [{ value: UNASSIGNED, label: "Unassigned" }]
              : []),
            ...partners.map((p) => ({ value: p.id, label: `${p.name} (${p.refId})` })),
            ...(d.assignment.manual && d.assignment.original
              ? [{ value: REVERT, label: `↩ Revert to original routing (${d.assignment.original.name})` }]
              : []),
          ]}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input label="Reason for selling" value={f.reasonForSelling} onChange={set("reasonForSelling")} />
        <Input label="Motivation" value={f.motivation} onChange={set("motivation")} />
        <Input label="Time to sell" value={f.timeToSell} onChange={set("timeToSell")} />
      </div>

      <Textarea label="Source notes" value={f.notes} onChange={set("notes")} rows={3} />

      {save.error && <p className="text-sm text-danger">{(save.error as Error).message}</p>}

      <div className="flex items-center justify-end gap-2 border-t border-border-soft pt-4">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={save.isPending}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
