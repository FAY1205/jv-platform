"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { rowClickGuard, CLICKABLE_ROW_CLASS } from "@/lib/row-click";
import { csrfHeaders } from "@/lib/csrf-client";
import { useDirty } from "@/lib/use-dirty";
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
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Dialog,
  Input,
  Textarea,
  Select,
  Combobox,
  SegmentedControl,
  StateMultiSelect,
  PartnerTag,
  EmptyState,
  QueryErrorState,
  RadioGroup,
  RadioGroupItem,
  Skeleton,
  useToast,
  usePageHeader,
} from "@/components";
import { coverageSummary } from "@/lib/coverage-summary";
import { US_STATES } from "@/lib/us-states";
import type { CoverageMapResponse } from "@/modules/coverage/map";

// ADM-03: the admin partner roster — create, edit, invite, deactivate. Partners are
// managed entirely in-app (no pre-supplied list). Every partner is shown as the
// signature PartnerTag (color + name + PR-###); status never relies on color (PRN-14).

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
  isHouse: boolean;
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
type FormFields = { name: string; email: string; phone: string; dealTerms: string; adminNotes: string; zips: string };
const EMPTY: FormFields = { name: "", email: "", phone: "", dealTerms: "", adminNotes: "", zips: "" };

interface CoverageConflict {
  kind: "zip" | "state";
  value: string;
  ownerRefId: string;
  ownerName: string;
}

function isValidEmail(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

// Client-side ZIP token check (UX only — the server re-validates authoritatively). Mirrors
// modules/coverage/parse: a real ZIP's first digit group is 3–5 digits.
function zipTokens(raw: string): string[] {
  return raw.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean);
}
function invalidZipTokens(raw: string): string[] {
  return zipTokens(raw).filter((t) => {
    const g = t.split(/\D+/).filter(Boolean)[0] ?? "";
    return !(g.length >= 3 && g.length <= 5);
  });
}

function ConflictPanel({ conflicts }: { conflicts: CoverageConflict[] }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-danger">
      <p className="font-semibold">Some coverage is already assigned to another partner:</p>
      <ul className="flex flex-col gap-0.5">
        {conflicts.map((c) => (
          <li key={`${c.kind}-${c.value}`}>
            <span className="num font-medium">{c.value}</span> ({c.kind === "zip" ? "ZIP" : "state"}) is covered by{" "}
            <span className="font-medium">{c.ownerName}</span> ({c.ownerRefId}).
          </li>
        ))}
      </ul>
      <p className="text-danger/80">Remove it from that partner first, then save again.</p>
    </div>
  );
}

export // Coverage editor shared by the partner form and the house-territory dialog: a mode toggle
// (States | ZIP codes, with live counts), a searchable state multi-select, and a validated ZIP
// paste box. Controlled — the parent owns states/zips/conflicts.
function CoverageEditor({
  states,
  onStatesChange,
  zips,
  onZipsChange,
  conflicts,
}: {
  states: string[];
  onStatesChange: (s: string[]) => void;
  zips: string;
  onZipsChange: (z: string) => void;
  conflicts: CoverageConflict[];
}) {
  const [mode, setMode] = React.useState<"states" | "zips">("states");
  // Open on whichever dimension already has data, once it first arrives (edit seeds after mount).
  const [modeSeeded, setModeSeeded] = React.useState(false);
  if (!modeSeeded && (states.length > 0 || zips.trim() !== "")) {
    setModeSeeded(true);
    setMode(states.length > 0 ? "states" : "zips");
  }
  const zipInvalid = invalidZipTokens(zips);
  const zipValidCount = zipTokens(zips).length - zipInvalid.length;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border-soft p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-text">Coverage</span>
        <SegmentedControl
          ariaLabel="Coverage type"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: "states", label: states.length ? `States · ${states.length}` : "States" },
            { value: "zips", label: zipValidCount > 0 ? `ZIP codes · ${zipValidCount}` : "ZIP codes" },
          ]}
        />
      </div>
      {mode === "states" ? (
        <div className="flex flex-col gap-1.5">
          <StateMultiSelect selected={states} onChange={onStatesChange} ariaLabel="Add covered states" />
          <span className="text-xs text-text-3">Whole states covered as a fallback. Search and pick — no typing codes.</span>
        </div>
      ) : (
        <Textarea
          label="Covered ZIP codes"
          value={zips}
          onChange={(e) => onZipsChange(e.target.value)}
          rows={3}
          optional
          error={zipInvalid.length > 0 ? `These aren't valid ZIPs: ${zipInvalid.join(", ")}` : undefined}
          hint="ZIPs covered, separated by commas or spaces. ZIP coverage beats a state fallback."
        />
      )}
      {conflicts.length > 0 && <ConflictPanel conflicts={conflicts} />}
    </div>
  );
}

export function PartnerForm({
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
        }
      : EMPTY,
  );
  // States are picked from a fixed list (StateMultiSelect) so an invalid state is impossible.
  const [states, setStates] = React.useState<string[]>([]);
  const [nameErr, setNameErr] = React.useState<string | null>(null);
  const [emailErr, setEmailErr] = React.useState<string | null>(null);
  const [banner, setBanner] = React.useState<string | null>(null);
  const [conflicts, setConflicts] = React.useState<CoverageConflict[]>([]);
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
    setF((p) => ({ ...p, zips: t.zips.join(", ") }));
    setStates(t.states);
  }

  const zipInvalid = invalidZipTokens(f.zips);

  // FRM-02a: guard the dismiss gestures once the form has unsaved edits. On edit the baseline
  // is deferred until coverage seeds, so the loaded record — not the blank pre-seed form — is
  // the baseline; on create the empty form is the baseline from the first render.
  const dirty = useDirty({ ...f, states }, editing ? seeded : true);

  const mutation = useMutation({
    mutationFn: async () => {
      const contact = { name: f.name, email: f.email, phone: f.phone, dealTerms: f.dealTerms, adminNotes: f.adminNotes };
      const statesStr = states.join(",");
      // WP-C: contact + coverage travel together in ONE atomic request — create (POST) or edit
      // (PATCH). A coverage rejection (unrecognized token or territory conflict) rolls the whole
      // thing back, so there's never an orphan on create or a half-applied edit.
      if (editing) {
        await send(`/api/admin/partners/${editing.id}`, "PATCH", { ...contact, zips: f.zips, states: statesStr });
      } else {
        await send("/api/admin/partners", "POST", { ...contact, zips: f.zips, states: statesStr });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["partners"] });
      // Contact/coverage edits change the territory the coverage map shows (profile,
      // dashboard, matchcard all read ["coverage"]) and this partner's detail (F-1).
      qc.invalidateQueries({ queryKey: ["coverage"] });
      if (editing) qc.invalidateQueries({ queryKey: ["partner", editing.id] });
      toast(editing ? "Partner updated." : "Partner created.", "success");
      onClose();
    },
    onError: (e: Error & { json?: Record<string, unknown> }) => {
      const j = e.json ?? {};
      // WP-C: a territory conflict names the owning partner(s) so the owner edits them first.
      if (j.code === "coverage_conflict" && Array.isArray(j.conflicts)) {
        setConflicts(j.conflicts as CoverageConflict[]);
        return;
      }
      const bad = [...((j.invalidZips as string[]) ?? []), ...((j.invalidStates as string[]) ?? [])];
      setBanner(bad.length ? `These entries weren't recognized: ${bad.join(", ")}` : e.message);
    },
  });

  const submit = () => {
    setNameErr(null);
    setEmailErr(null);
    setBanner(null);
    setConflicts([]);
    let bad = false;
    if (!f.name.trim()) { setNameErr("Name is required."); bad = true; }
    if (!f.email.trim()) { setEmailErr("Email is required."); bad = true; }
    else if (!isValidEmail(f.email)) { setEmailErr("Enter a valid email."); bad = true; }
    if (zipInvalid.length > 0) bad = true;
    if (bad) return;
    mutation.mutate();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      confirmClose={dirty}
      title={editing ? `Edit ${editing.refId}` : "New partner"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={mutation.isPending} onClick={submit}>
            {editing ? "Save changes" : "Create partner"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input
          label="Name"
          value={f.name}
          onChange={(e) => { setNameErr(null); set("name")(e); }}
          required
          error={nameErr ?? undefined}
          autoFocus
        />
        <Input
          label="Email"
          type="email"
          value={f.email}
          onChange={(e) => { setEmailErr(null); set("email")(e); }}
          required
          error={emailErr ?? undefined}
          hint="Needed to send an invite."
        />
        <Input label="Phone" value={f.phone} onChange={set("phone")} optional />

        {/* Coverage — pick the type, then the matching editor (owner note #1). */}
        <CoverageEditor
          states={states}
          onStatesChange={setStates}
          zips={f.zips}
          onZipsChange={(v) => setF((p) => ({ ...p, zips: v }))}
          conflicts={conflicts}
        />

        <Textarea label="Deal terms" value={f.dealTerms} onChange={set("dealTerms")} rows={2} optional />
        <Textarea label="Admin notes" value={f.adminNotes} onChange={set("adminNotes")} rows={2} optional hint="Private to admins." />
        {banner && <p className="text-xs text-danger">{banner}</p>}
        {!editing && <p className="text-xs text-text-3">A locked color and PR-### reference are assigned automatically.</p>}
      </div>
    </Dialog>
  );
}

// ── House territory (owner note #7) ──────────────────────────────────────────
// Coverage-only editor for the tenant's own territory. No contact fields (house has no
// email/portal identity); saves through the same conflict-aware coverage endpoint, so house
// and partners can't silently overlap each other.
function HouseTerritoryDialog({ house, onClose }: { house: Partner; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [states, setStates] = React.useState<string[]>([]);
  const [zips, setZips] = React.useState("");
  const [conflicts, setConflicts] = React.useState<CoverageConflict[]>([]);
  const [banner, setBanner] = React.useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["partner", house.id],
    queryFn: () => apiGet<{ partner: Partner & { territory: Territory } }>(`/api/admin/partners/${house.id}`),
  });
  const [seeded, setSeeded] = React.useState(false);
  if (detail.data && !seeded) {
    setSeeded(true);
    const t = detail.data.partner.territory;
    setStates(t.states);
    setZips(t.zips.join(", "));
  }
  const zipInvalid = invalidZipTokens(zips);
  // R-54 (FRM-02a): baseline is the loaded territory (ready=seeded), so a dismiss gesture on
  // edited coverage asks before discarding — not on the pre-seed blank.
  const dirty = useDirty({ states, zips }, seeded);

  const mutation = useMutation({
    mutationFn: () => send(`/api/admin/partners/${house.id}/coverage`, "PUT", { zips, states: states.join(",") }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["partners"] });
      qc.invalidateQueries({ queryKey: ["coverage"] });
      qc.invalidateQueries({ queryKey: ["partner", house.id] });
      toast("Your territory was updated.", "success");
      onClose();
    },
    onError: (e: Error & { json?: Record<string, unknown> }) => {
      const j = e.json ?? {};
      if (j.code === "coverage_conflict" && Array.isArray(j.conflicts)) {
        setConflicts(j.conflicts as CoverageConflict[]);
        return;
      }
      const bad = [...((j.invalidZips as string[]) ?? []), ...((j.invalidStates as string[]) ?? [])];
      setBanner(bad.length ? `These entries weren't recognized: ${bad.join(", ")}` : e.message);
    },
  });

  const submit = () => {
    setBanner(null);
    setConflicts([]);
    if (zipInvalid.length > 0) return;
    mutation.mutate();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="My Territory"
      confirmClose={dirty}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={mutation.isPending} disabled={detail.isLoading} onClick={submit}>
            Save territory
          </Button>
        </>
      }
    >
      {detail.isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-2">
            ZIPs and states you manage yourself. Leads here route to you, and show in your own color on every map.
          </p>
          <CoverageEditor states={states} onStatesChange={setStates} zips={zips} onZipsChange={setZips} conflicts={conflicts} />
          {banner && <p className="text-xs text-danger">{banner}</p>}
        </div>
      )}
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
      qc.invalidateQueries({ queryKey: ["partner", partner.id] });
      // Deactivating a coverage-owning partner reassigns/releases its territory (F-1).
      if (owns) qc.invalidateQueries({ queryKey: ["coverage"] });
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
              <RadioGroup
                ariaLabel="Where should this territory go?"
                value={mode}
                onValueChange={(v) => setMode(v as typeof mode)}
              >
                <RadioGroupItem value="reassign" label="Reassign to another partner" />
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
                <RadioGroupItem value="unmatched" label="Route this territory to Unmatched" />
              </RadioGroup>
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
// WP-UX-6 (audit P-2): the per-row Edit + (Re)invite + Deactivate cluster used to change
// width row-to-row (the Invited row's extra button shoved Edit ~100px out of line) and
// left a destructive action permanently exposed at equal weight. Collapsed to a single
// fixed-slot ⋯ menu — columnar rhythm restored, Deactivate quiet (styled danger) inside it.
function RowActions({ p, onEdit, onDeactivate }: { p: Partner; onEdit: () => void; onDeactivate: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const invite = useMutation({
    mutationFn: () => send(`/api/admin/partners/${p.id}/invite`, "POST"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["partners"] });
      qc.invalidateQueries({ queryKey: ["partner", p.id] });
      toast("Invitation sent — open “Sent emails” to get the sign-in link.", "success");
    },
    onError: (e: Error) => toast(e.message, "danger"),
  });
  // F-23: any non-active partner can be (re)invited — including a deactivated
  // ("revoked") one, which the roster previously left with no path back in.
  const canInvite = p.status !== "active";
  const inviteLabel = p.status === "revoked" ? "Reactivate" : p.status === "invited" ? "Re-invite" : "Invite";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`Actions for ${p.name}`} className={rowMenuTrigger}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" />
        </svg>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
        {canInvite && (
          <DropdownMenuItem
            disabled={!p.email || invite.isPending}
            // The row lives inside a table cell; a menu item never re-triggers the row.
            onSelect={(e) => {
              e.preventDefault();
              if (p.email) invite.mutate();
            }}
            title={p.email ? undefined : "Add an email first"}
          >
            {invite.isPending ? "Sending…" : inviteLabel}
          </DropdownMenuItem>
        )}
        {p.status !== "revoked" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={onDeactivate}>
              Deactivate
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Shared ⋯ trigger — the board's MoveMenu recipe (KAN-05), tokened, all states.
const rowMenuTrigger =
  "grid h-8 w-8 place-items-center rounded-md text-text-3 outline-none transition-colors hover:bg-surface-2 hover:text-text focus-visible:ring-1 focus-visible:ring-brand-ink data-[state=open]:bg-surface-2";

interface PartnersViewProps {
  /** N3C-04/C-56: partner id from `?edit=`, or null. Opens the roster's edit form for that
   *  partner once the roster has loaded — a SEED only; the user's own opens/closes take over
   *  from there (the ?open= idiom on /leads). */
  initialEditId?: string | null;
}

export function PartnersView({ initialEditId = null }: PartnersViewProps) {
  return (
    <AppShell>
      <PartnersBody initialEditId={initialEditId} />
    </AppShell>
  );
}

function PartnersBody({ initialEditId = null }: PartnersViewProps) {
  // Topbar carries the title only; the "New partner" action moved in-body
  // (owner testing note #7, 2026-07-15 — same treatment as Imports/Dashboard).
  usePageHeader({ title: "Partners" });
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["partners"],
    queryFn: () => apiGet<{ partners: Partner[] }>("/api/admin/partners"),
  });
  // State filter (note #7): "who covers Texas?" — answered from the shared coverage
  // query (state-rule ownership; the same source every map reads). ZIP-only coverage
  // inside a state is NOT included — this filters by state-rule owner.
  const coverage = useQuery({ queryKey: ["coverage"], queryFn: () => apiGet<CoverageMapResponse>("/api/coverage") });
  const [stateFilter, setStateFilter] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<Partner | null>(null);
  const [deactivating, setDeactivating] = React.useState<Partner | null>(null);
  const router = useRouter();
  const [editingHouse, setEditingHouse] = React.useState(false);
  const all = React.useMemo(() => data?.partners ?? [], [data]);
  // WP-D: the house row is the admin's own territory — pulled out of the partner roster and
  // shown in its own section (never invited/deactivated).
  const house = React.useMemo(() => all.find((p) => p.isHouse) ?? null, [all]);
  const partnersOnly = React.useMemo(() => all.filter((p) => !p.isHouse), [all]);
  const roster = React.useMemo(() => {
    if (!stateFilter) return partnersOnly;
    const owner = coverage.data?.states.find((s) => s.code === stateFilter)?.partnerId ?? null;
    return owner ? partnersOnly.filter((p) => p.id === owner) : [];
  }, [partnersOnly, stateFilter, coverage.data]);

  // N3C-04/C-56: `?edit=<id>` is the roster's edit state, so "edit this partner" is a LINK
  // anywhere in the app instead of an instruction ("Edit on Partners →" landed on the roster
  // and left the reader to find the row and its ⋯ menu themselves).
  //
  // Seeded ONCE, and only after the roster resolves — the deep link names a partner, and the
  // form needs the row, which arrives with the query. Matching against `partnersOnly` (not
  // the state-FILTERED roster) so an unrelated "Covers state…" filter can't swallow the link.
  // An id that matches nothing opens nothing: no error state, because a stale link is not an
  // error the admin can act on.
  //
  // A render-phase seed (the `seededOpenRef` idiom on leads-view), not an effect: React
  // re-runs this component before painting, so the form is open on the first frame that has
  // the roster — an effect would paint the bare roster once and then pop the dialog open.
  const [editSeeded, setEditSeeded] = React.useState(false);
  if (!editSeeded && data) {
    setEditSeeded(true);
    const target = initialEditId ? partnersOnly.find((p) => p.id === initialEditId) : undefined;
    if (target) setEditing(target);
  }

  // Opening/closing the form keeps the URL truthful so the state is linkable and survives a
  // reload. `replace`, not `push`: opening a form is not a navigation the Back button should
  // have to step through (and the roster is the same page either way).
  const openEdit = (p: Partner) => {
    setEditing(p);
    router.replace(`/partners?edit=${p.id}`, { scroll: false });
  };
  const closeEdit = () => {
    setEditing(null);
    router.replace("/partners", { scroll: false });
  };

  const createHouse = useMutation({
    mutationFn: () => send("/api/admin/partners/house", "POST"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["partners"] });
      setEditingHouse(true); // the dialog mounts once the refetched roster includes the house row
    },
    onError: (e: Error) => toast(e.message, "danger"),
  });

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2.5">
        <div className="flex flex-wrap items-end gap-2.5">
          <div className="w-48">
            <Combobox
              ariaLabel="Filter by covered state"
              placeholder="Covers state…"
              value={stateFilter}
              onValueChange={setStateFilter}
              options={US_STATES.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` }))}
            />
          </div>
          {/* Suppressed at zero and on error (D2): the EmptyState announces those settles —
              stale `data` can coexist with `error` on a failed background refetch. */}
          {data && roster.length > 0 && !error && (
            <p className="pb-2 text-step-1 text-text-3" aria-live="polite">
              <span className="num font-semibold text-text-2">{roster.length}</span>{" "}
              {roster.length === 1 ? "partner" : "partners"}{stateFilter ? (roster.length === 1 ? " covers this state" : " cover this state") : ""}
            </p>
          )}
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          + New partner
        </Button>
      </div>

      {/* WP-D: the admin's own territory (owner note #7) — distinct from partners. */}
      {data && (
        <Card className="mb-3">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            {house ? (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <PartnerTag name={house.name} color={house.color} refId={house.refId} />
                  <span className="num text-xs text-text-3">{coverageSummary(house.zipCount, house.stateCount)}</span>
                </div>
                <Button variant="secondary" size="sm" onClick={() => setEditingHouse(true)}>
                  Edit territory
                </Button>
              </>
            ) : (
              <>
                <div className="max-w-md">
                  <p className="text-sm font-medium text-text">Your own territory</p>
                  <p className="text-xs text-text-3">
                    Add ZIPs or states you manage yourself — leads there route to you and show in your own color on the maps.
                  </p>
                </div>
                <Button variant="secondary" size="sm" loading={createHouse.isPending} onClick={() => createHouse.mutate()}>
                  Set up my territory
                </Button>
              </>
            )}
          </div>
        </Card>
      )}

        <Card>
          {isPending ? (
            <div className="flex flex-col gap-3 p-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : error ? (
            <div className="p-6">
              <QueryErrorState title="Couldn't load partners" error={error} onRetry={() => refetch()} />
            </div>
          ) : roster.length === 0 ? (
            <div className="p-6">
              {stateFilter ? (
                <EmptyState title="No partner covers this state" description="No state rule assigns it — recruit a partner or add coverage. (ZIP-only coverage isn't included in this filter.)" />
              ) : (
                <EmptyState title="No partners yet" description="Add your first partner to start routing leads." />
              )}
            </div>
          ) : (
            <Table>
              {/* WP-UX-1: Partner + Contact are the flexible identity columns (ellipsizing
                  with the full value on hover); status/coverage/actions take content width,
                  so a long real-world partner name can't collide with Contact and the wide
                  fixed gutters between the narrow columns are gone. */}
              <THead>
                <Tr>
                  <Th className="w-[38%]">Partner</Th>
                  <Th>Contact</Th>
                  <Th fit>Status</Th>
                  <Th fit>Coverage</Th>
                  <Th fit align="right">Actions</Th>
                </Tr>
              </THead>
              <TBody>
                {roster.map((p) => (
                  // N3C-02/Q5: the whole row opens the partner. Pointer convenience only —
                  // the keyboard/AT path is still the partner-name Link in the first cell (so
                  // no tabIndex/role here); rowClickGuard defers to the inner Link and the ⋯
                  // RowActions menu, and to an in-progress text selection (lib/row-click).
                  <Tr
                    key={p.id}
                    className={CLICKABLE_ROW_CLASS}
                    onClick={(e) => { if (rowClickGuard(e.target)) router.push(`/partners/${p.id}`); }}
                  >
                    {/* UXF-10.1 (Scope-E audit §10.1): at 390px this cell used to render the
                        swatch and a clipped reference ID with NO partner name at all — the
                        row lost its identity. Two changes, both pure layout: a min-width
                        floor so the column can't be squeezed to nothing, and the reference
                        ID moved onto its OWN line (the /coverage partner-list pattern) so it
                        stops competing with the name for horizontal space. The name is now
                        the part that gets the width and ellipsizes last; PRN-14 still holds —
                        swatch, name AND reference ID are all present. */}
                    <Td clamp clampTitle={`${p.name} (${p.refId})`} className="min-w-[10rem]">
                      <Link
                        href={`/partners/${p.id}`}
                        className="block max-w-full rounded-md transition-opacity hover:opacity-70 focus-visible:opacity-70"
                        title={`Open ${p.name}`}
                      >
                        <PartnerTag name={p.name} color={p.color} />
                        <span className="num mt-0.5 block text-step-0 font-medium text-text-3" aria-label={`Reference ${p.refId}`}>
                          {p.refId}
                        </span>
                      </Link>
                    </Td>
                    <Td clamp clampTitle={p.email ?? undefined}>
                      <div className="truncate text-sm text-text-2">{p.email ?? <span className="text-text-3">no email</span>}</div>
                      {p.phone && <div className="num text-xs text-text-3">{p.phone}</div>}
                    </Td>
                    <Td fit>
                      <Badge variant={STATUS[p.status].variant}>{STATUS[p.status].label}</Badge>
                    </Td>
                    <Td fit>
                      {/* UXF-10.2: zero segments are omitted — "0 ZIPs · 2 states" read as a
                          defect rather than as a fact (lib/coverage-summary). */}
                      <span className="num text-xs text-text-3">{coverageSummary(p.zipCount, p.stateCount)}</span>
                    </Td>
                    <Td fit align="right">
                      <RowActions p={p} onEdit={() => openEdit(p)} onDeactivate={() => setDeactivating(p)} />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

      {creating && <PartnerForm editing={null} onClose={() => setCreating(false)} />}
      {editing && <PartnerForm editing={editing} onClose={closeEdit} />}
      {deactivating && <DeactivateModal partner={deactivating} roster={roster} onClose={() => setDeactivating(null)} />}
      {editingHouse && house && <HouseTerritoryDialog house={house} onClose={() => setEditingHouse(false)} />}
    </>
  );
}

