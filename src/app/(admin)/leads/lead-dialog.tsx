"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { csrfHeaders } from "@/lib/csrf-client";
import { useDirty } from "@/lib/use-dirty";
import { fmtDateTime } from "@/lib/dates";
import {
  Dialog,
  Button,
  Badge,
  Input,
  Textarea,
  Select,
  PartnerTag,
  NotesPanel,
  TasksPanel,
  Timeline,
  ClampedText,
  Skeleton,
  QueryErrorState,
  useToast,
  Tooltip,
  HotLeadMark,
  HotLeadIcon,
  type TimelineEntry,
} from "@/components";
import type { ScoreBreakdown, ScoreGroup } from "@/modules/pipeline/score";
import { routedByLabel } from "@/lib/match-method";
import { googleSearchUrl } from "@/lib/search-links";
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
export interface LeadDetail {
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
  score: { total: number | null; group: ScoreGroup | null; status: "complete" | "incomplete"; breakdown: ScoreBreakdown | null };
  editable: boolean;
  receivedAt: string;
  modifiedAt: string | null;
  partner: DetailPartner | null;
  assignment: {
    manual: boolean;
    assignedAt: string | null;
    matchMethod: string;
    matchedOn: string | null;
    original: DetailPartner | null;
  };
  availableStatuses: string[];
  activity: TimelineEntry[];
}
interface Partner {
  id: string;
  refId: string;
  name: string;
  color: string;
}

export const REVERT = "__revert__";
export const UNASSIGNED = "__unassigned__";

// ASN-03: the partner-overlay action a given selection implies. A "keep" is a no-op; the other
// three MOVE ownership (and, per R-01/R-22, hide the prior owner's notes + status timeline from
// the new owner) — so EditForm gates those behind a confirmation. Pure: the submit-time confirm
// gate and the mutation body both derive the action from here, so they can never disagree.
export type PartnerAction =
  | { action: "keep" }
  | { action: "set"; partnerId: string }
  | { action: "revert" }
  | { action: "unassign" };

export function partnerActionFor(partnerSel: string, d: LeadDetail): PartnerAction {
  const sel = partnerSel === UNASSIGNED ? "" : partnerSel;
  if (sel === REVERT) return { action: "revert" };
  if (sel === "" && d.partner) return { action: "unassign" }; // clearing a currently-assigned lead
  if (sel && sel !== (d.partner?.id ?? "")) return { action: "set", partnerId: sel };
  return { action: "keep" };
}

/** Confirmation copy for an ownership-moving action, or null for "keep" (no confirmation needed).
 *  Names the destination (FRM-03) so the admin sees exactly where the lead is going, and states the
 *  consequence accurately per action — an unassign has no "new owner" to inherit a clean timeline. */
interface TransferCopy {
  title: string;
  confirmLabel: string;
  verb: string;
  dest: string;
  consequence: string;
}
// A re-route to another partner (set/revert): the destination partner becomes the new owner.
const NEW_OWNER_CONSEQUENCE =
  "The new owner starts with a clean status timeline and cannot see the previous owner's status history or notes; the previous owner loses access to this lead.";
function transferCopy(action: PartnerAction, d: LeadDetail, partners: Partner[]): TransferCopy | null {
  switch (action.action) {
    case "set": {
      const p = partners.find((x) => x.id === action.partnerId);
      return { title: "Reassign this lead?", confirmLabel: "Reassign", verb: "will move to", dest: p ? `${p.name} (${p.refId})` : "the selected partner", consequence: NEW_OWNER_CONSEQUENCE };
    }
    case "revert": {
      const o = d.assignment.original;
      return { title: "Revert this lead's routing?", confirmLabel: "Revert routing", verb: "will move to", dest: o ? `${o.name} (${o.refId})` : "its original routing", consequence: NEW_OWNER_CONSEQUENCE };
    }
    case "unassign":
      return {
        title: "Unassign this lead?",
        confirmLabel: "Unassign",
        verb: "will return to",
        dest: "the unassigned pool",
        consequence: "No partner will own it; the current owner loses access to this lead, its status history, and notes.",
      };
    default:
      return null;
  }
}

export function LeadDialog({ refId, onClose }: { refId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = React.useState(false);
  // R-54 (FRM-02a): while editing, EditForm reports whether its fields are dirty so a dismiss
  // gesture (Esc/backdrop/✕) on unsaved edits asks before discarding. Reset when leaving edit mode.
  const [editDirty, setEditDirty] = React.useState(false);
  const leaveEdit = () => {
    setEditing(false);
    setEditDirty(false);
  };

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
      confirmClose={editing && editDirty}
      title={
        <span className="flex items-center gap-2.5">
          <span className="num">{refId}</span>
          {/* Target mark after the ref (mirrors the leads table), only for a kept hot lead. */}
          {d && d.mlsStatus === "kept" && d.score.group === "hot" && d.score.total !== null && (
            <HotLeadMark score={d.score.total} size={16} />
          )}
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
        <QueryErrorState title="Couldn't load lead" error={detailQ.error} description={(detailQ.error as Error)?.message ?? "Not found."} onRetry={() => detailQ.refetch()} />
      ) : editing ? (
        <EditForm
          d={d}
          partners={roster.data?.partners ?? []}
          onDirtyChange={setEditDirty}
          onCancel={leaveEdit}
          onSaved={() => {
            leaveEdit();
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
  const qc = useQueryClient();
  const property = [d.address, d.city, d.state, d.zip].filter(Boolean).join(", ");
  // A task add/complete/reopen/delete changes the Timeline's activity[] too (task_created /
  // task_completed entries) — both live in the same lead-detail payload, so a task change
  // refreshes it alongside the panel's own ["lead-tasks", refId] query.
  const onTaskChanged = () => qc.invalidateQueries({ queryKey: ["lead", d.refId] });
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

      {/* The why-routed sentence was removed (owner testing note #3, 2026-07-14) — the
          partner tag + the Assignment fields below already carry how the lead routed. */}
      <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3">
        <Field label="Seller">{`${d.seller.first} ${d.seller.last}`.trim() || "—"}</Field>
        <Field label="Phone">{d.seller.phone || "—"}</Field>
        <Field label="Email">{d.seller.email || "—"}</Field>
        <div className="col-span-2 sm:col-span-3">
          <Field label="Property">
            {property ? (
              <Tooltip content="Search this property on Google">
                <a
                  href={googleSearchUrl([d.address, d.city, d.state, d.zip])}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-brand-ink hover:underline"
                >
                  {property}
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  </svg>
                </a>
              </Tooltip>
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
            <Badge variant={routedByLabel(d.assignment.matchMethod, d.assignment.matchedOn).badge}>
              {routedByLabel(d.assignment.matchMethod, d.assignment.matchedOn).label}
            </Badge>
          )}
        </Field>
        <Field label="Received">{fmtDateTime(d.receivedAt)}</Field>
        {d.assignment.manual && d.assignment.original && (
          <Field label="Original routing">
            <PartnerTag size="sm" name={d.assignment.original.name} color={d.assignment.original.color} refId={d.assignment.original.refId} />
          </Field>
        )}
        {/* "Motivation" dropped (VP-4c): for Lead Source 1 it is never populated —
            reason-for-selling carries the seller's motivation, and the scorer uses it as such. */}
        <Field label="Reason for selling">{d.reasonForSelling || "—"}</Field>
        <Field label="Time to sell">{d.timeToSell || "—"}</Field>
        {d.mlsStatus === "removed" && (
          <div className="col-span-2 sm:col-span-3">
            <Field label="MLS removal reason">{d.mlsReason || "—"}</Field>
          </div>
        )}
        {d.notes && (
          <div className="col-span-2 flex flex-col gap-1 sm:col-span-3">
            <span className="text-step-1 font-semibold uppercase tracking-wide text-text-3">Source notes</span>
            {/* VP-4c: boxed so the long note reads as its own block, not another field. */}
            <div className="rounded-lg border border-border-soft bg-surface-2 px-3.5 py-3">
              <ClampedText>{d.notes}</ClampedText>
            </div>
          </div>
        )}
      </div>

      <ScorePanel score={d.score} kept={d.mlsStatus === "kept"} />

      {/* Tasks panel sits ABOVE the Timeline per the approved mockup. */}
      <TasksPanel leadRef={d.refId} onTaskChanged={onTaskChanged} />

      <Timeline activity={d.activity} />

      <div className="border-t border-border-soft pt-4">
        <NotesPanel leadRef={d.refId} title="Admin notes" />
      </div>
    </div>
  );
}

// ── Lead score (SCR) ────────────────────────────────────────────────────────
const GROUP_META: Record<ScoreGroup, { label: string; badge: "warn" | "neutral" | "outline" }> = {
  hot: { label: "Hot", badge: "warn" },
  warm: { label: "Warm", badge: "neutral" },
  nurture: { label: "Nurture", badge: "outline" },
};
const CRITERION_ORDER: (keyof Omit<ScoreBreakdown, "penalty">)[] = ["state", "motivation", "timeline", "equity", "mortgage"];
const CRITERION_NAME: Record<keyof Omit<ScoreBreakdown, "penalty">, string> = {
  state: "State", motivation: "Motivation", timeline: "Timeline", equity: "Equity", mortgage: "Mortgage",
};

function ScorePanel({ score, kept }: { score: LeadDetail["score"]; kept: boolean }) {
  const { breakdown } = score;
  return (
    <div className="rounded-xl border border-border-soft bg-surface-2 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-step-1 font-semibold uppercase tracking-wide text-text-3">Lead score</h3>
        {score.status === "complete" && score.group ? (
          <Badge variant={GROUP_META[score.group].badge} className="gap-1.5">
            {/* Icon only for a kept hot lead (owner: no hot mark on MLS-listed). */}
            {kept && score.group === "hot" && <HotLeadIcon size={12} />}
            {GROUP_META[score.group].label} · <span className="num tabular-nums">{score.total}/50</span>
          </Badge>
        ) : (
          <Badge variant="outline">Not scored</Badge>
        )}
      </div>
      {score.status === "complete" && breakdown ? (
        <ul className="flex flex-col gap-1.5">
          {CRITERION_ORDER.map((key) => (
            <li key={key} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-text-3">{CRITERION_NAME[key]}</span>
              <span className="flex items-baseline gap-2">
                <span className="text-text-2">{breakdown[key].label}</span>
                <span className="num w-6 text-right font-semibold tabular-nums text-text">{breakdown[key].points}</span>
              </span>
            </li>
          ))}
          {breakdown.penalty !== 0 && (
            <li className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-danger">Penalty</span>
              <span className="num font-semibold tabular-nums text-danger">{breakdown.penalty}</span>
            </li>
          )}
        </ul>
      ) : (
        <p className="text-sm text-text-3">
          {missingReason(breakdown)}
        </p>
      )}
    </div>
  );
}

/** Human "why not scored" from the breakdown's null criteria. */
function missingReason(breakdown: ScoreBreakdown | null): string {
  if (!breakdown) return "This lead is missing the details needed to score.";
  const missing = CRITERION_ORDER.filter((k) => breakdown[k].points === null).map((k) => CRITERION_NAME[k].toLowerCase());
  if (missing.length === 0) return "This lead couldn't be scored.";
  return `Not enough data to score — missing ${missing.join(", ")}.`;
}

// ── Edit mode ─────────────────────────────────────────────────────────────────

export function EditForm({
  d,
  partners,
  onCancel,
  onSaved,
  onDirtyChange,
}: {
  d: LeadDetail;
  partners: Partner[];
  onCancel: () => void;
  onSaved: () => void;
  /** R-54: reports whether any field has changed, so the host Dialog can guard a dismiss. */
  onDirtyChange?: (dirty: boolean) => void;
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
    timeToSell: d.timeToSell,
    notes: d.notes,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const [status, setStatus] = React.useState(d.status);
  // Partner select: current effective owner, a partner id, "unassigned" sentinel, or
  // "revert to original". Radix Select forbids an empty-string value, hence the sentinel.
  const [partnerSel, setPartnerSel] = React.useState(d.partner?.id ?? UNASSIGNED);

  // R-54 (FRM-02a): the fields seed synchronously from `d`, so the baseline is the loaded record;
  // report any divergence up so the host Dialog can raise a discard-confirmation on dismiss.
  const dirty = useDirty({ ...f, status, partnerSel });
  React.useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

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
      // 2) Fields + partner overlay (the action was decided — and, for a transfer, confirmed — pre-submit).
      const partner = partnerActionFor(partnerSel, d);
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

  // ASN-03/FRM-03: reassigning a lead moves ownership and hides the prior owner's notes + status
  // timeline (R-01/R-22) — a consequential, easy-to-misclick change. Any ownership-moving action is
  // gated behind a confirmation naming the lead + destination; a plain field edit saves directly.
  const [confirmTransfer, setConfirmTransfer] = React.useState(false);
  const transfer = transferCopy(partnerActionFor(partnerSel, d), d, partners);
  const submit = () => {
    if (transfer) setConfirmTransfer(true);
    else save.mutate();
  };

  return (
    <>
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
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

      {/* Motivation dropped (VP-4c/FU-2): never populated for Lead Source 1. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label="Reason for selling" value={f.reasonForSelling} onChange={set("reasonForSelling")} />
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

      {transfer && (
        <Dialog
          open={confirmTransfer}
          onClose={() => setConfirmTransfer(false)}
          size="sm"
          title={transfer.title}
          footer={
            <>
              <Button type="button" variant="ghost" onClick={() => setConfirmTransfer(false)} disabled={save.isPending}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                loading={save.isPending}
                onClick={() => {
                  setConfirmTransfer(false);
                  save.mutate();
                }}
              >
                {transfer.confirmLabel}
              </Button>
            </>
          }
        >
          <p className="text-sm text-text-2">
            <span className="num">{d.refId}</span> {transfer.verb} <strong className="text-text">{transfer.dest}</strong>.{" "}
            {transfer.consequence}
          </p>
        </Dialog>
      )}
    </>
  );
}
