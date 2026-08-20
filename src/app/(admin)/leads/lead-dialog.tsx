"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiGet, apiMutate } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtDateTime } from "@/lib/dates";
import {
  Dialog,
  SidePanel,
  Button,
  Badge,
  InlineField,
  PencilIcon,
  Select,
  StatusSelect,
  PartnerTag,
  NotesPanel,
  RECORD_CONTROL_CLASS,
  TasksPanel,
  Timeline,
  Skeleton,
  Spinner,
  QueryErrorState,
  useToast,
  Tooltip,
  HotLeadMark,
  HotLeadIcon,
  type TimelineEntry,
} from "@/components";
import type { ScoreBreakdown, ScoreGroup } from "@/modules/pipeline/score";
import { addressLine } from "@/lib/address-line";
import { routedByLabel } from "@/lib/match-method";
import { googleSearchUrl } from "@/lib/search-links";
import { offersUnassign } from "@/lib/unassign";
import { adminLeadPlaceholder } from "./lead-placeholder";
import { LeadPager, type LeadNav } from "./lead-pager";

// ADM: the lead record — opened from the global Leads table (no page navigation). The
// activity timeline + admin notes live here too. Data shapes mirror the server
// (getAdminLeadDetail) — re-declared client-side per the leads-view convention.
//
// N5-02: the shell is the non-modal SidePanel, not the centered Dialog — the table stays
// visible and clickable behind it and a row click switches the record IN PLACE (this component
// stays mounted; only `refId` changes). The file/export keep their names: renaming them would
// churn every call site for nothing.
//
// N5-10..15: editing is INLINE and per field. There is no Edit toggle, no whole-record form,
// and therefore no draft that can outlive the field it belongs to — which is why the R-54
// dirty/discard plumbing that used to guard a dismiss is gone with it. Each field commits on
// Enter/blur, reverts on Esc, and rolls back with a retry toast when the server refuses.
// Status and partner are NOT inline fields: they are dedicated controls in the record's
// control row (N5-06), because a status change writes to a different endpoint and a partner
// change moves ownership and must be confirmed (ASN-03/FRM-03).

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

export function LeadDialog({ refId, onClose, nav = null }: { refId: string; onClose: () => void; /** N5-04: prev/next over the list's working set, or null when the open ref isn't in it. */ nav?: LeadNav | null }) {
  const qc = useQueryClient();
  // N5-13/N5-30: which field is open for editing, or null. Two jobs: the document-level ↑/↓
  // handler stands down while a field is open (the same gate the old `editing` flag held), and
  // the panel hands that field the first Esc before closing itself.
  const [editingField, setEditingField] = React.useState<string | null>(null);

  // N5-02: the panel SWITCHES records without unmounting, so per-record state has to be reset
  // on the ref change. (Adjusting state during render, the `seeded` idiom used across this page.)
  //
  // N5-30 / A11Y-03: the switch also has to be ANNOUNCED. It deliberately does not move focus
  // (that is what keeps the pager and row-clicking usable), so without this a screen-reader
  // user presses ↓ and hears nothing at all. It starts EMPTY and is only filled on a switch:
  // the panel's live region is mounted for the panel's whole life, and a region that mounts
  // with its text already in it announces nothing — on the first open the dialog role and its
  // title already say which lead this is.
  const [prevRef, setPrevRef] = React.useState(refId);
  const [announcement, setAnnouncement] = React.useState("");
  if (prevRef !== refId) {
    setPrevRef(refId);
    if (editingField) setEditingField(null);
    setAnnouncement(`Now showing lead ${refId}`);
  }

  const detailQ = useQuery({
    queryKey: ["lead", refId],
    queryFn: () => apiGet<LeadDetail>(`/api/leads/${refId}`),
    // C-41b: paint the identity the clicked row already carries instead of six skeleton
    // bars. placeholderData (never initialData): it stays out of the cache and always
    // background-fetches, so this partial can never be mistaken for the real record.
    placeholderData: () => adminLeadPlaceholder(qc, refId),
  });
  const roster = useQuery({
    queryKey: ["partners"],
    queryFn: () => apiGet<{ partners: Partner[] }>("/api/admin/partners"),
  });
  const d = detailQ.data;
  // True while `d` is the row-derived partial: the sections it cannot supply stay skeletons
  // and editing is held (a field must never seed its draft from a partial record — committing
  // it would write the placeholder over the real value).
  const partial = detailQ.isPlaceholderData;

  // N5-04: ↑/↓ move to the previous/next lead. The binding lives HERE, not on the pager, for
  // the two things only the panel knows: whether an edit form is open (arrows must not steal
  // keys from a form) and whether the panel is on screen at all. Document-level because the
  // table behind is still focusable — but never over a text control, never over a key another
  // layer has already claimed (an open Radix Select consumes arrows and preventDefaults them),
  // and never with a modifier.
  const navRef = React.useRef(nav);
  React.useEffect(() => { navRef.current = nav; });
  React.useEffect(() => {
    if (editingField) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
      // A11Y-04, belt-and-braces: an open Radix Select/DropdownMenu owns the arrow keys and
      // preventDefaults them, so the check above already holds — but that is one library's
      // behavior standing between a listbox and a record switch. Name the surfaces too.
      if (t?.closest?.('[role="listbox"],[role="menu"],[data-radix-popper-content-wrapper]')) return;
      const n = navRef.current;
      if (!n || n.pending) return;
      if (e.key === "ArrowUp" ? n.canPrev : n.canNext) {
        e.preventDefault();
        if (e.key === "ArrowUp") n.prev(); else n.next();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editingField]);

  return (
    <SidePanel
      open
      onClose={onClose}
      // N5-13: nothing here can be dirty any more — a field commits or reverts on its way
      // out, so there is no unsaved state for a discard prompt to guard. (SidePanel keeps
      // `confirmClose` as primitive API; the Dialog forms elsewhere still use it.)
      escapeHeld={editingField !== null}
      ariaLabel={`Lead ${refId}`}
      // N5-02: the panel switches records in place, so its per-open state (the discard prompt,
      // the captured opener) has to reset on the REF, not on `open` — which never flips here.
      resetKey={refId}
      statusMessage={announcement}
      // N5-05: no pager at all when the open ref isn't in the current working set — a
      // deep-linked lead the filters exclude would otherwise be given a lying position.
      leading={nav ? <LeadPager nav={nav} /> : null}
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
      ) : (
        <LeadRecord
          // N5-02: EVERY per-record draft hangs off this key. A row click switches the record
          // without the panel unmounting — and with C-41b's placeholder resolving the new ref
          // from the list cache, the body does not unmount on its own either. Unkeyed, the
          // NotesPanel composer's half-typed note, its open task/note edit form, an open
          // InlineField's draft and the in-flight save map would all follow the switch onto
          // the NEXT lead. Re-keying is the whole fix; nothing here re-seeds on a prop change.
          key={refId}
          d={d}
          partial={partial}
          partners={roster.data?.partners ?? []}
          onEditingFieldChange={setEditingField}
        />
      )}
    </SidePanel>
  );
}

// ── Read-only view ────────────────────────────────────────────────────────────

/** The uppercase field label every cell in the record grid wears — plain fields, pending
 *  fields, and (N5E-04) the two live controls, which are labelled fields like any other.
 *  `id` is for the one caller that needs to POINT at its label: the expanded address editor,
 *  whose `aria-labelledby` is what gives that group its accessible name (A11Y-05). */
function FieldLabel({ children, id }: { children: React.ReactNode; id?: string }) {
  return <span id={id} className="text-step-1 font-semibold uppercase tracking-wide text-text-3">{children}</span>;
}

function Field({ label, children, className, nowrap = false }: { label: string; children: React.ReactNode; className?: string; nowrap?: boolean }) {
  // WP-UX-7 (audit 3.2): a missing value is DEMOTED to a muted "Not provided" rather than
  // a bare "—" at full field prominence — four em-dashes at full weight made a routed lead
  // read as broken. Every empty-able caller resolves to the "—" sentinel, so this one place
  // catches them all; JSX children (Property link, Routed-by tag) pass through unchanged.
  const isEmpty = children === "—" || children === "" || children == null;
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <FieldLabel>{label}</FieldLabel>
      {isEmpty ? (
        <span className="text-sm italic text-text-3">Not provided</span>
      ) : (
        // N5E-05: values WRAP, they never ellipsize — an email or a reason-for-selling the
        // admin might need to read or copy must not be hidden behind a "…". `nowrap` is the
        // one deliberate exception (Received: a timestamp that broke across two lines).
        <span className={cn("text-sm text-text", nowrap ? "whitespace-nowrap" : "[overflow-wrap:anywhere]")}>{children}</span>
      )}
    </div>
  );
}

/** C-41b: a field the clicked list row cannot supply — labelled, so the layout is the final
 *  one and nothing jumps when the detail lands. */
function PendingField({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <FieldLabel>{label}</FieldLabel>
      <Skeleton className="h-4 w-28" />
    </div>
  );
}

/** N5E-04: a labelled cell whose VALUE is a live control (status, assigned partner). Same
 *  label treatment as every field, the control sitting exactly where a value would. */
function ControlField({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  );
}

/**
 * N5-12 — the inline-editable roster and its labels. Exactly the retired EditForm's set,
 * which is `EDITABLE_COLUMNS` (modules/leads/commands) minus `motivation` (VP-4c: never
 * populated for Lead Source 1). Nothing else on this record edits — not here, not anywhere.
 * The labels are what the failure toast names, so they read as the field the admin clicked.
 */
const FIELD_LABELS = {
  sellerFirst: "First name",
  sellerLast: "Last name",
  phone: "Phone",
  email: "Email",
  // N5E-06: the `address` COLUMN is the street line, and since the four address columns now
  // live behind one combined "Address" field it has to say which of them it is — in the
  // editor's label and in the failure toast alike.
  address: "Street",
  city: "City",
  state: "State",
  zip: "ZIP",
  campaign: "Source",
  reasonForSelling: "Reason for selling",
  timeToSell: "Time to sell",
  notes: "Source notes",
} as const;
type EditableField = keyof typeof FIELD_LABELS;

/** Everything an InlineField needs that the RECORD, not the primitive, decides — the shape
 *  `LeadRecord.field()` builds and the address group forwards to its four sub-fields. */
interface RecordFieldProps {
  label: string;
  value: string;
  saving: boolean;
  disabled: boolean;
  hint: boolean;
  reopen: { field: EditableField; text: string; nonce: number } | null;
  onEditingChange: (editing: boolean) => void;
  onCommit: (next: string) => void;
}

/** N5-12: State stays a two-letter uppercase code, the mask the EditForm carried. */
const stateMask = (raw: string) => raw.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);

// ── Address (N5E-06) ──────────────────────────────────────────────────────────

/** The four columns the combined line is built from, in display order. */
const ADDRESS_KEYS = ["address", "city", "state", "zip"] as const;
type AddressKey = (typeof ADDRESS_KEYS)[number];
const isAddressKey = (k: EditableField): k is AddressKey => (ADDRESS_KEYS as readonly string[]).includes(k);
/** What the panel is told is "open" while the group is expanded but no sub-field is editing:
 *  enough to make it hold Esc for the collapse below (SidePanel `escapeHeld`), which Radix's
 *  capture-phase listener leaves no other seam for. */
const ADDRESS_GROUP = "address-group";

/**
 * N5E-06 — the address as ONE line that expands into its four columns.
 *
 * The owner's complaint was the shipped shape: ADDRESS / CITY / STATE / ZIP as four separate
 * cells, which is how the data is STORED but not how an address is read. So the rest state is
 * the combined line ("20443 Fleetwood Dr, Harper Woods, MI 48225") with the Google-search
 * affordance trailing it, and clicking the text expands the structured editor — where each
 * sub-field keeps EXACTLY the per-field commit-on-blur semantics every other field has
 * (single-key PATCH against its own column, Esc reverts, retry reopens), because the four
 * columns really are four independent writes (N5-11/N5-15).
 *
 * The group closes when it stops being used: focus leaving it with no session active, or Esc
 * with none open. Neither is inferred from a mouse gesture — both are focus facts, so the
 * keyboard path and the pointer path collapse for the same reason.
 */
function AddressGroup({
  parts,
  fieldProps,
  partial,
  anySaving,
  retry,
  trailing,
  report,
  className,
}: {
  /** The values on screen (optimistic while a save is in flight), keyed by column. */
  parts: Record<AddressKey, string>;
  fieldProps: (key: EditableField, committed: string) => RecordFieldProps;
  /** C-41b: a row-derived partial paints the LINE but cannot be edited from. */
  partial: boolean;
  /**
   * A save on ANY of the four columns is in flight. The expanded editor gets this per-column
   * through `fieldProps` (each sub-field spins for its own save), but the COLLAPSED line is one
   * value standing for four — commit a city and click away and the group collapses onto an
   * optimistic line with nothing to say a write is still out. Same quiet mark InlineField's
   * rest state uses, for the same reason.
   */
  anySaving: boolean;
  /** N5-11: the record's retry state — a retry on an address column re-expands the group. */
  retry: { field: EditableField; text: string; nonce: number } | null;
  trailing: React.ReactNode;
  /** N5-13/N5-30: what the panel gates ↑/↓ and Esc on. */
  report: (field: string | null) => void;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  // A11Y-05: the expanded editor is four separate fields that only mean "an address" together.
  // Without a name on the group, a screen-reader user tabbing in hears "Street", "City",
  // "State", "ZIP" as four unrelated record fields and never learns the Address field they
  // opened is what they are inside. The label is the group's own — one string, one source.
  const labelId = React.useId();
  const [editingKey, setEditingKey] = React.useState<AddressKey | null>(null);
  // Which sub-field opens, and on what text — handed straight to that InlineField as its
  // `reopen`, which is the primitive's own "open on this text" seam (N5-11). The sub-fields do
  // not exist until the group expands, so the seed is set in the SAME commit as the expansion
  // and lands at their mount.
  const [seed, setSeed] = React.useState<{ key: AddressKey; text: string; nonce: number } | null>(null);
  const lineRef = React.useRef<HTMLButtonElement>(null);
  const groupRef = React.useRef<HTMLDivElement>(null);
  const restoreFocus = React.useRef(false);
  const collapseTimer = React.useRef<number | null>(null);

  /** Expand (if it isn't already) and put the named sub-field into an editing session. */
  const expand = (key: AddressKey, text: string) => {
    // Functional, so a nonce is never reused — retrying the same field twice has to open it
    // twice, and the same call is legal from the render phase below.
    setSeed((s) => ({ key, text, nonce: (s?.nonce ?? 0) + 1 }));
    setOpen(true);
  };

  // N5-11: "Retry" on a failed address save has to land in the field that failed, even when
  // the group has since collapsed. Adjust-during-render (this file's seeding idiom, and the
  // one InlineField itself uses for the same event) rather than an effect: the group has to be
  // open in the very commit that follows the retry click, not a paint later. Keyed on the
  // NONCE — the retry object is rebuilt on every render, and reacting to its identity would
  // reopen the field forever.
  const retryNonce = retry && isAddressKey(retry.field) ? retry.nonce : null;
  const [prevRetryNonce, setPrevRetryNonce] = React.useState(retryNonce);
  if (retryNonce !== null && retryNonce !== prevRetryNonce) {
    setPrevRetryNonce(retryNonce);
    if (retry && isAddressKey(retry.field)) expand(retry.field, retry.text);
  }

  // N5-13/N5-30: one voice to the panel. A sub-field's own key while it is editing (so ↑/↓ and
  // Esc behave exactly as they do for every other field), and the group itself while it is
  // merely expanded — which is what lets Esc collapse it instead of closing the panel.
  React.useEffect(() => {
    report(editingKey ?? (open ? ADDRESS_GROUP : null));
  }, [editingKey, open, report]);

  React.useEffect(() => () => { if (collapseTimer.current !== null) window.clearTimeout(collapseTimer.current); }, []);

  // The combined line is what focus returns to on a collapse the USER asked for (Esc). Not on
  // a focus-out collapse: focus is already somewhere else the reader chose, and yanking it
  // back would be the worse bug (the same rule InlineField's own restore follows).
  React.useEffect(() => {
    if (open || !restoreFocus.current) return;
    restoreFocus.current = false;
    lineRef.current?.focus();
  }, [open]);

  const onFocusOut = () => {
    if (collapseTimer.current !== null) window.clearTimeout(collapseTimer.current);
    // DEFERRED a task on purpose. At focusout time `document.activeElement` is still the
    // element losing focus, and a sub-field committing by blur puts focus BACK on its own rest
    // control a tick later (InlineField's N5-30 restore) — reading focus synchronously would
    // collapse the group out from under a commit the reader is still inside.
    collapseTimer.current = window.setTimeout(() => {
      collapseTimer.current = null;
      const g = groupRef.current;
      if (!g || g.contains(document.activeElement)) return;
      setOpen(false);
    }, 0);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape" || editingKey) return;
    // An open sub-field's Esc never reaches here — its editor consumes it and reverts (N5-13).
    // With none open the press collapses the group, and the panel is already holding its own
    // Esc on our behalf, so this cannot also close the record.
    e.stopPropagation();
    restoreFocus.current = true;
    setOpen(false);
  };

  const line = addressLine([parts.address, parts.city, parts.state, parts.zip]);

  if (!open) {
    const shown = line || "Not provided";
    return (
      // The rest-state recipe is InlineField's, verbatim: this is the same affordance wearing
      // the same clothes, and DSN-03's matrix is the row's (hover → focus-within → pressed).
      <div
        className={cn(
          "group -mx-1.5 -my-1 flex min-w-0 flex-col gap-0.5 rounded-lg px-1.5 py-1 transition-colors",
          !partial && "hover:bg-surface-2 focus-within:bg-surface-2 active:bg-surface-3",
          className,
        )}
      >
        <FieldLabel>Address</FieldLabel>
        <span className="flex min-w-0 items-center gap-2">
          <button
            ref={lineRef}
            type="button"
            // C-41b: held while the record is the row-derived partial, exactly as every
            // InlineField is — a draft seeded from a placeholder would write it back as truth.
            disabled={partial}
            onClick={() => expand("address", parts.address)}
            // Enter opens it — native button activation, so no key handler here can steal
            // Enter from a layer above (A11Y-04). The name is the InlineField vocabulary.
            aria-label={`Address: ${shown}. Edit`}
            className={cn(
              "min-w-0 flex-1 rounded text-left outline-none focus-visible:ring-1 focus-visible:ring-brand-ink",
              partial ? "cursor-default opacity-60" : "cursor-text",
            )}
          >
            {/* N5E-05: wraps, never ellipsizes — a full street address is exactly the value
                an admin reads or copies, so hiding its tail behind a "…" is not an option. */}
            <span className={cn("text-sm [overflow-wrap:anywhere]", line ? "text-text" : "italic text-text-3")}>{shown}</span>
          </button>
          {/* The collapsed line's "still in flight" mark — InlineField's rest-state treatment
              verbatim, including its rule that the spinner REPLACES the pencil rather than
              crowding beside it. */}
          {anySaving && <Spinner size={12} />}
          {!partial && !anySaving && (
            <PencilIcon className="shrink-0 text-text-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" />
          )}
          {trailing}
        </span>
      </div>
    );
  }

  /** One sub-field: the record's own field props, with the group owning `reopen` and the
   *  editing report (both of which the group has to see before the panel does). */
  const sub = (key: AddressKey) => ({
    ...fieldProps(key, parts[key]),
    reopen: seed && seed.key === key ? seed : null,
    onEditingChange: (editing: boolean) =>
      setEditingKey((cur) => (editing ? key : cur === key ? null : cur)),
  });

  return (
    <div
      ref={groupRef}
      // A11Y-05: four inputs that are one field. The role makes the boundary programmatic
      // (it is otherwise carried by a border alone), and the name comes from the SAME label
      // the collapsed line wears — so what a reader sees and what they hear cannot drift.
      role="group"
      aria-labelledby={labelId}
      className={cn("flex min-w-0 flex-col gap-1", className)}
      onBlur={onFocusOut}
      onKeyDown={onKeyDown}
    >
      <FieldLabel id={labelId}>Address</FieldLabel>
      <div className="grid grid-cols-6 gap-x-4 gap-y-3 rounded-lg border border-border bg-surface p-3">
        <InlineField {...sub("address")} className="col-span-6" />
        <InlineField {...sub("city")} className="col-span-3" />
        <InlineField {...sub("state")} className="col-span-2" mask={stateMask} />
        <InlineField {...sub("zip")} className="col-span-1" numeric />
      </div>
    </div>
  );
}

function LeadRecord({
  d,
  partial = false,
  partners,
  onEditingFieldChange,
}: {
  d: LeadDetail;
  partial?: boolean;
  partners: Partner[];
  /** N5-13/N5-30: the panel gates ↑/↓ and Esc on whether a field is open. */
  onEditingFieldChange: (field: string | null) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  // A task add/complete/reopen/delete changes the Timeline's activity[] too (task_created /
  // task_completed entries) — both live in the same lead-detail payload, so a task change
  // refreshes it alongside the panel's own ["lead-tasks", refId] query.
  const onTaskChanged = () => qc.invalidateQueries({ queryKey: ["lead", d.refId] });

  // N5-11 optimistic paint: the value a save is carrying, per field. It holds until the
  // invalidated detail has LANDED (onSettled runs after onSuccess' promise), so the field
  // never blinks back to the stale value between the response and the refetch.
  const [inFlight, setInFlight] = React.useState<Partial<Record<EditableField, string>>>({});
  // N5-11 retry: bumping the nonce reopens the named field with the text that failed.
  const [reopen, setReopen] = React.useState<{ field: EditableField; text: string; nonce: number } | null>(null);
  const nonce = React.useRef(0);
  // N5-10: the commit-on-blur hint rides the first edit of this record and then retires —
  // deliberately per-record UI state, not a stored preference (no new store, §6.17).
  const [hintSpent, setHintSpent] = React.useState(false);
  // N5-30 / A11Y-03: a save is otherwise SILENT to a screen reader — the optimistic value is
  // already painted (so nothing changes on success) and the spinner is decorative. Mounted for
  // this record's life below, with only its text changing (never mounted with content in it).
  const [saveStatus, setSaveStatus] = React.useState("");

  // Every toast this record raises is tagged with the record, and the tag is what lets them
  // leave WITH it (see the cleanup below). `refId` is stable for this component's lifetime —
  // LeadRecord is keyed on it in LeadDialog, so a switch remounts rather than re-props.
  const toastScope = `lead:${d.refId}`;
  React.useEffect(
    () => () => {
      // N5-11: the failure toast's Retry reopens a field on THIS record. Close the panel or
      // click another row and this component unmounts, leaving a live-looking "Retry" wired to
      // a dead setState for the rest of TOAST_ACTION_DURATION_MS (9s) — pressing it does
      // nothing at all, silently. The dead button must not outlive the record it belongs to.
      // Deliberately NOT re-aimed at the newly-open lead: a retry means "put back the text I
      // typed, where I typed it", and there is no honest way to do that on a different record.
      toast.dismissScope(toastScope);
    },
    [toast, toastScope],
  );

  const save = useMutation({
    // Single-key `fields` (N5-11): the server patches only the keys it is sent, so one
    // field's save can never carry another field's stale value — which is exactly what lets
    // two rapid edits to different fields both persist (N5-15).
    mutationFn: ({ field, value }: { field: EditableField; value: string }) =>
      apiMutate(`/api/leads/${d.refId}`, "PATCH", { fields: { [field]: value } }),
    onMutate: ({ field, value }) => {
      setSaveStatus(`Saving ${FIELD_LABELS[field]}…`);
      setInFlight((m) => ({ ...m, [field]: value }));
    },
    onSuccess: (_res, { field }) => {
      setSaveStatus(`${FIELD_LABELS[field]} saved.`);
      return Promise.all([
        // The lead detail carries the new "Details updated" timeline entry (N5-14), so it is
        // refetched here rather than left to the next open. No ["coverage"]: only a partner
        // move changes coverage, and that lives in the partner control below.
        qc.invalidateQueries({ queryKey: ["lead", d.refId] }),
        qc.invalidateQueries({ queryKey: ["leads"] }),
        qc.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
    onError: (e, { field, value }) => {
      // The toast's own live region announces the failure; a second voice saying "Saving
      // Phone…" is left standing behind it would contradict it. Clearing to "" announces
      // nothing of its own.
      setSaveStatus("");
      // A 4xx carries a message the admin can act on — a dedupe collision on address/zip
      // names the clash (N5-12). A 5xx message is deliberately static (C-17), so appending
      // it would only say "it failed" twice.
      const detail = e instanceof ApiError && e.status < 500 ? ` — ${e.message}` : "";
      toast.toast(
        `Couldn't save ${FIELD_LABELS[field]}${detail}`,
        "danger",
        {
          label: "Retry",
          onClick: () => {
            nonce.current += 1;
            setReopen({ field, text: value, nonce: nonce.current });
          },
        },
        toastScope,
      );
    },
    onSettled: (_res, _err, { field }) =>
      setInFlight((m) => {
        const next = { ...m };
        delete next[field];
        return next;
      }),
  });

  /** The value on screen: the optimistic one while a save is in flight, else the record's. */
  const val = (field: EditableField, committed: string) => inFlight[field] ?? committed;

  /** Everything an InlineField needs that this record, not the primitive, decides. */
  const field = (key: EditableField, committed: string): RecordFieldProps => ({
    label: FIELD_LABELS[key],
    value: val(key, committed),
    saving: key in inFlight,
    // C-41b: held while the detail is the row-derived partial — a draft seeded from a
    // placeholder would write the placeholder back over the real value.
    disabled: partial,
    hint: !hintSpent,
    reopen: reopen && reopen.field === key ? reopen : null,
    onEditingChange: (editing: boolean) => onEditingFieldChange(editing ? key : null),
    onCommit: (next: string) => {
      setHintSpent(true);
      save.mutate({ field: key, value: next });
    },
  });

  const property = [val("address", d.address), val("city", d.city), val("state", d.state), val("zip", d.zip)];

  return (
    <div className="flex flex-col gap-5">
      {/* A11Y-03: mounted for this record's whole life, text-only changes — the panel's own
          region (SidePanel `statusMessage`) belongs to the record SWITCH, and one region
          cannot carry two independent stories without them overwriting each other. */}
      <span className="sr-only" role="status" aria-live="polite">
        {saveStatus}
      </span>

      {/* The why-routed sentence was removed (owner testing note #3, 2026-07-14) — the
          partner control + the Assignment fields below already carry how the lead routed. */}
      {/*
        N5E-05 — ONE span grid over six columns, replacing the equal-thirds grid (and the
        floating control row that used to sit above it). The owner's hands-on pass found the
        defect the old shape guaranteed: every field got the same width whatever it held, so
        an email ellipsized, a timestamp wrapped mid-value, and a reason-for-selling clipped —
        while Source, Routed by and Time to sell (all short) had width to spare. Six columns
        let each field take the width its CONTENT needs, and one grid means the whole record
        reads top-to-bottom as facts → the two live controls → notes.

        No breakpoint any more: the spans are proportional, so they hold at the panel's 560px
        and 600px alike (the old grid had to switch column count at 1100px to stay readable).
      */}
      {/* gap-y-3.5 = the mockup's 14px row rhythm (the fields carry their own -my-1 hit area,
          so a 16px gap read as too airy against the approved shape). */}
      <div className="grid grid-cols-6 gap-x-4 gap-y-3.5">
        {/* C-41b: the name, address parts and source come straight from the clicked row, so
            they paint at once; the rest wait as labelled skeletons. */}
        <InlineField {...field("sellerFirst", d.seller.first)} className="col-span-2" />
        <InlineField {...field("sellerLast", d.seller.last)} className="col-span-2" />
        {/* DSN-02: phone and ZIP are figures, so they wear the ledger's tabular monospace —
            the same treatment the ref, the score and every table number already carry. */}
        {partial ? <PendingField label="Phone" className="col-span-2" /> : <InlineField {...field("phone", d.seller.phone)} numeric className="col-span-2" />}
        {/* N5E-05: the longest routine value on the record owns a full row and wraps if it
            must — `mykelvinlove@gmai…` was the owner's example of what must never happen. */}
        {partial ? <PendingField label="Email" className="col-span-6" /> : <InlineField {...field("email", d.seller.email)} className="col-span-6" />}
        {/* N5E-06: one combined line that expands into its four columns. Q4: the property's
            Google search stays as the trailing icon, outside the edit target. */}
        <AddressGroup
          className="col-span-6"
          parts={{ address: val("address", d.address), city: val("city", d.city), state: val("state", d.state), zip: val("zip", d.zip) }}
          fieldProps={field}
          partial={partial}
          anySaving={ADDRESS_KEYS.some((k) => k in inFlight)}
          retry={reopen}
          report={onEditingFieldChange}
          trailing={
            property.some(Boolean) ? (
              <Tooltip content="Search this property on Google">
                <a
                  href={googleSearchUrl(property)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Search this property on Google"
                  // C-52 (WCAG 2.5.8), the SidePanel ✕ recipe: the glyph stays 13px and the
                  // REACH grows past it as an invisible pseudo-element, so the tap target is
                  // ~30px (44px on a coarse pointer) without the icon shoving the line around.
                  className="relative shrink-0 rounded p-0.5 text-brand-ink outline-none transition-colors hover:text-brand-strong focus-visible:ring-1 focus-visible:ring-brand-ink before:absolute before:-inset-1.5 before:content-[''] pointer-coarse:before:-inset-3"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  </svg>
                </a>
              </Tooltip>
            ) : null
          }
        />
        {/* Three short values share the row they can all live in. */}
        <InlineField {...field("campaign", d.campaign)} className="col-span-2" />
        {partial ? (
          <PendingField label="Routed by" className="col-span-2" />
        ) : (
          <Field label="Routed by" className="col-span-2">
            {d.assignment.manual ? (
              <Badge variant="neutral">Manual assignment</Badge>
            ) : (
              <Badge variant={routedByLabel(d.assignment.matchMethod, d.assignment.matchedOn).badge}>
                {routedByLabel(d.assignment.matchMethod, d.assignment.matchedOn).label}
              </Badge>
            )}
          </Field>
        )}
        {partial ? <PendingField label="Time to sell" className="col-span-2" /> : <InlineField {...field("timeToSell", d.timeToSell)} className="col-span-2" />}
        {/* "Motivation" dropped (VP-4c): for Lead Source 1 it is never populated —
            reason-for-selling carries the seller's motivation, and the scorer uses it as such. */}
        {partial ? <PendingField label="Reason for selling" className="col-span-6" /> : <InlineField {...field("reasonForSelling", d.reasonForSelling)} className="col-span-6" />}
        {/* DSN-02: a timestamp is a figure too — it reads beside the editable numeric fields
            above, so it wears the same tabular monospace they do. N5E-05: and `nowrap`, so
            "Aug 5, 2026, 4:50 PM" can never break across two lines again. */}
        <Field label="Received" className="col-span-6" nowrap><span className="num">{fmtDateTime(d.receivedAt)}</span></Field>

        {/* N5E-04: status and partner are the record's two LIVE controls — one click, no edit
            mode, each writing through the endpoint that owns it (N5-06, unchanged). What
            changed is their dress: they used to float above the grid as two chips of different
            shapes; now they are labelled fields like every other, in one row after Received,
            sharing one 36px chrome. */}
        <ControlField label="Status" className="col-span-3">
          <StatusSelect
            refId={d.refId}
            status={d.status}
            // `editable: false` is exactly `mlsStatus === "removed"`: StatusSelect renders the
            // read-only verdict badge instead of a control for those (PRN-04).
            mlsStatus={d.mlsStatus}
            statuses={d.availableStatuses.length ? d.availableStatuses : undefined}
            variant="field"
          />
        </ControlField>
        <ControlField label="Assigned partner" className="col-span-3">
          <PartnerControl d={d} partners={partners} disabled={partial} />
        </ControlField>

        {d.assignment.manual && d.assignment.original && (
          <Field label="Original routing" className="col-span-6">
            <PartnerTag size="sm" name={d.assignment.original.name} color={d.assignment.original.color} refId={d.assignment.original.refId} />
          </Field>
        )}
        {d.mlsStatus === "removed" && (
          // Not editable at all: the MLS verdict is the pipeline's, not an admin's (PRN-04).
          partial
            ? <PendingField label="MLS removal reason" className="col-span-6" />
            : <Field label="MLS removal reason" className="col-span-6">{d.mlsReason || "—"}</Field>
        )}
        {/* VP-4c: boxed so the long note reads as its own block, not another field. Always
            rendered now — an empty Source notes has to be reachable to be filled in. */}
        {partial ? (
          <PendingField label="Source notes" className="col-span-6" />
        ) : (
          <InlineField {...field("notes", d.notes)} multiline className="col-span-6" />
        )}
      </div>

      {/* The row carries the headline score but never the per-criterion breakdown. */}
      {partial ? <PanelSkeleton title="Lead score" lines={5} /> : <ScorePanel score={d.score} kept={d.mlsStatus === "kept"} />}

      {/* Tasks panel sits ABOVE the Timeline per the approved mockup. Tasks and Notes hold
          their OWN queries keyed on the ref (which the row gave us), so they are not held
          back by the partial — they load in parallel with the detail rather than after it. */}
      <TasksPanel leadRef={d.refId} onTaskChanged={onTaskChanged} />

      {partial ? <PanelSkeleton title="Timeline" lines={3} /> : <Timeline activity={d.activity} />}

      {/* C-58: Admin notes is a SIBLING panel of Lead score / Tasks / Timeline, so it wears
          the same chrome — the old border-t + Card wrapper made it read as a different,
          heavier thing bolted to the bottom of the dialog. */}
      <NotesPanel leadRef={d.refId} title="Admin notes" variant="section" />
    </div>
  );
}

/** C-65: a partial record's pending sections keep their PANEL shape (surface-2 shell + the
 *  real section heading + skeleton lines), like TasksPanel's loading state — a flat grey bar
 *  told the reader nothing about what was arriving and made the dialog reflow on resolve. */
function PanelSkeleton({ title, lines }: { title: string; lines: number }) {
  return (
    <div className="rounded-xl border border-border-soft bg-surface-2 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-step-1 font-semibold uppercase tracking-wide text-text-2">{title}</h3>
      </div>
      <div className="flex flex-col gap-2" aria-hidden="true">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
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
        <h3 className="text-step-1 font-semibold uppercase tracking-wide text-text-2">Lead score</h3>
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

// ── Partner control (N5-06) ───────────────────────────────────────────────────

/**
 * The dedicated "assigned partner" control: always visible, one click, no edit mode — and
 * every ownership-moving selection still passes the ASN-03/FRM-03 confirmation, through the
 * same `partnerActionFor` / `transferCopy` pair and with the copy unchanged. The consequence
 * has not changed either: a re-route hands the lead to a new owner who starts with a clean
 * status timeline and cannot see the previous owner's history or notes (R-01/R-22).
 *
 * The trigger's value is DERIVED from the record rather than held in state: the record is the
 * server's answer, and a local copy would need re-seeding on every refetch to stay honest.
 * The one piece of state here is the selection awaiting confirmation.
 */
function PartnerControl({ d, partners, disabled = false }: { d: LeadDetail; partners: Partner[]; disabled?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [pendingSel, setPendingSel] = React.useState<string | null>(null);

  const move = useMutation({
    mutationFn: (action: PartnerAction) => apiMutate(`/api/leads/${d.refId}`, "PATCH", { partner: action }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead", d.refId] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      // A reassign/unassign/revert changes the coverage payload (unmatchedLeadCount,
      // coveredVolumePct) that the dashboard hero map and the attention banner consume.
      qc.invalidateQueries({ queryKey: ["coverage"] });
      toast.toast("Lead updated.", "success");
    },
    onError: (e: Error) => toast.toast(e.message, "danger"),
  });

  const transfer = pendingSel === null ? null : transferCopy(partnerActionFor(pendingSel, d), d, partners);

  // PRN-14 / WCAG 4.1.2: `renderValue` paints the trigger, but an `aria-label` REPLACES the
  // accessible name Radix would otherwise build from the selected item — so a bare "Assigned
  // partner" tells a screen-reader user the control exists and nothing about who owns the
  // lead. The current owner is composed in, in the same words the visible tag carries (name +
  // JV ref). (Teaching the Select primitive to mirror `renderValue` into the name is the
  // general fix and a logged candidate; this is the one control that needs it today.)
  const ownerName = d.partner
    ? `${d.partner.name} (${d.partner.refId})`
    : d.mlsStatus === "kept"
      ? "Unmatched"
      : "Unassigned";

  return (
    <>
      <Select
        ariaLabel={`Assigned partner: ${ownerName}`}
        // N5E-04: the same chrome the Status control wears — one string, so "identical" is
        // structural rather than two class lists someone has to keep in step. It was `w-auto`
        // (shrink-to-fit) while it floated beside a pill; as a labelled field it fills its cell.
        className={RECORD_CONTROL_CLASS}
        disabled={disabled || move.isPending}
        value={d.partner?.id ?? UNASSIGNED}
        onValueChange={(sel) => {
          // Selecting the current owner is a no-op — it writes nothing and asks nothing.
          if (partnerActionFor(sel, d).action === "keep") return;
          setPendingSel(sel);
        }}
        // PRN-14: the swatch never travels alone — the owner's name and JV ref ride with it.
        renderValue={() =>
          d.partner ? (
            <PartnerTag size="sm" name={d.partner.name} color={d.partner.color} refId={d.partner.refId} />
          ) : d.mlsStatus === "kept" ? (
            <span className="text-sm font-semibold text-warn">Unmatched</span>
          ) : (
            <span className="text-sm text-text-3">Unassigned</span>
          )
        }
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

      {transfer && (
        <Dialog
          open
          onClose={() => setPendingSel(null)}
          size="sm"
          title={transfer.title}
          footer={
            <>
              <Button type="button" variant="ghost" onClick={() => setPendingSel(null)} disabled={move.isPending}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                loading={move.isPending}
                onClick={() => {
                  const action = partnerActionFor(pendingSel as string, d);
                  setPendingSel(null);
                  move.mutate(action);
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

