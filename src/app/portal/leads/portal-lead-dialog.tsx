"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";
import {
  SidePanel,
  Skeleton,
  QueryErrorState,
  NotesPanel,
  TasksPanel,
  Timeline,
  ClampedText,
  ListingBadge,
  StatusSelect,
  Tooltip,
  type TimelineEntry,
} from "@/components";
import { addressLine } from "@/lib/address-line";
import { cn } from "@/lib/cn";
import { googleSearchUrl } from "@/lib/search-links";
import { portalLeadPlaceholder } from "./portal-lead-placeholder";

// VP-4: the partner-facing lead record (mirrors the admin LeadDialog pattern, portal-scoped).
// Replaces the retired /portal/leads/[ref] PAGE — same data + every feature it had (status
// change, listing check, status history, your notes) in the grouped layout. Shows ONLY what a
// partner may see (no routing internals, no other-partner data — PRN-08). "Motivation" is
// dropped: for Lead Source 1 it is never populated; reason-for-selling carries the content.
//
// N5-20: the shell is the non-modal SidePanel, not the centered Dialog — the same primitive the
// admin record adopted, read-scoped. Content is UNCHANGED (fields stay plain text: no inline
// editing here, and no pager — the portal list is its own working set). What the shell changes:
// below 768px the panel is a full-bleed MODAL sheet, which is the portal's primary reality, and
// at ≥768px it is non-modal, so the list behind stays clickable and a tap on another row
// SWITCHES this record in place instead of closing and reopening (see `resetKey`/`key` below).

// Exported for C-41b: portal-lead-placeholder.ts builds the partial the dialog paints while
// the real detail loads (type-only import there, so no runtime cycle).
export interface PortalLeadDetail {
  refId: string;
  seller: { first: string; last: string; phone: string; email: string };
  address: string;
  city: string;
  state: string;
  zip: string;
  reasonForSelling: string;
  timeToSell: string;
  notes: string;
  receivedAt: string;
  status: string;
  /** TSK-06: the unified timeline (arrival, this org's status changes/notes/tasks). Since
   *  C-12 this is the ONLY status-change surface in the dialog — the `status` entries under
   *  the Timeline's Status filter are what the retired "Status history" panel listed. */
  activity: TimelineEntry[];
  availableStatuses: string[];
  listing: { status: "pending" | "yes" | "no" | "unknown"; link: string | null };
}

// N5E-07: the partner's record wears the admin record's span grid and field order — same
// anatomy, read-scoped (plain values, no inline editing, no partner control). PRESENTATION
// only: not one byte of the payload or its scope changes (N5-21).
function Field({ label, children, className, nowrap = false }: { label: string; children: React.ReactNode; className?: string; nowrap?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <span className="text-step-1 font-semibold uppercase tracking-wide text-text-3">{label}</span>
      {/* Values WRAP, never ellipsize (N5E-05) — `nowrap` is the one exception (Received). */}
      <span className={cn("text-sm text-text-2", nowrap ? "whitespace-nowrap" : "[overflow-wrap:anywhere]")}>{children}</span>
    </div>
  );
}

export function PortalLeadDialog({ refId, onClose }: { refId: string; onClose: () => void }) {
  const qc = useQueryClient();
  // N5-20 / N5-30 (A11Y-03): the panel switches records without unmounting and deliberately
  // does NOT move focus on the switch (that is what keeps clicking a row behind it usable), so
  // the change is otherwise silent to a screen reader. Starts EMPTY and is only filled on a
  // switch: the panel's live region is mounted for its whole life, and a region that mounts
  // with text already in it announces nothing — on the first open the dialog role and its
  // title (the ref) already say which lead this is. Adjusting state during render, the
  // `seeded` idiom used across this app.
  const [prevRef, setPrevRef] = React.useState(refId);
  const [announcement, setAnnouncement] = React.useState("");
  if (prevRef !== refId) {
    setPrevRef(refId);
    setAnnouncement(`Now showing lead ${refId}`);
  }

  const { data, isPending, isPlaceholderData, error, refetch } = useQuery({
    queryKey: ["portal-lead", refId],
    // `encodeURIComponent`, always: a ref reaches this component from `?open=` as well as from
    // a row, and an unescaped one is a path segment an attacker helped write. The seeding
    // boundary (portal-leads-view) shape-checks it too — this is the second half of that pair,
    // at the point where the string stops being data and becomes a URL.
    queryFn: () => apiGet<PortalLeadDetail>(`/api/portal/leads/${encodeURIComponent(refId)}`),
    // C-41b: paint the identity the tapped row already carries instead of five skeleton
    // bars. placeholderData, never initialData — see portal-lead-placeholder.
    placeholderData: () => portalLeadPlaceholder(qc, refId),
  });
  /** True while `data` is the row-derived partial: everything the row can't supply stays a skeleton. */
  const partial = isPlaceholderData;
  // The Timeline's activity[] (task_created/task_completed entries) lives in this same
  // lead-detail payload, so a task add/complete/reopen/delete refreshes it too.
  const onTaskChanged = () => qc.invalidateQueries({ queryKey: ["portal-lead", refId] });

  return (
    <SidePanel
      open
      onClose={onClose}
      // N5-20: the panel switches records in place, so its per-open state (the captured opener
      // it returns focus to) has to reset on the REF — `open` never flips here.
      resetKey={refId}
      statusMessage={announcement}
      title={<span className="num">{refId}</span>}
    >
      {isPending ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : error || !data ? (
        <QueryErrorState title="Couldn't load this lead" error={error} description={(error as Error)?.message ?? "Not found."} onRetry={() => refetch()} />
      ) : (
        // N5-20: keyed on the ref because the panel no longer unmounts between records. The
        // sections below hold their own per-record DRAFT state (NotesPanel's composer,
        // TasksPanel's add/edit forms) that a plain prop change would carry across a switch —
        // a note typed against one lead must never be sitting in the composer of the next.
        <div key={refId} className="flex flex-col gap-5">
          {/* N5E-07: ONE six-column span grid, the admin record's — each field takes the width
              its content needs, and the status control is a labelled field in that grid rather
              than a boxed banner above it. Order matches the admin twin exactly. */}
          <div className="grid grid-cols-6 gap-x-4 gap-y-4">
            <Field label="First name" className="col-span-2">{data.seller.first || "—"}</Field>
            <Field label="Last name" className="col-span-2">{data.seller.last || "—"}</Field>
            {/* C-41b: the row gives the name; the phone/email a partner is about to use are
                detail-only, so they hold a labelled space instead of appearing late.
                C-51 sweep: `Field` renders its children inside a <span>, so these placeholders
                must be spans too (a <div> in phrasing content is invalid and
                hydration-mismatches). The tap-to-call / tap-to-mail affordances survive. */}
            <Field label="Phone" className="col-span-2">
              {partial ? <Skeleton as="span" className="h-4 w-24" /> : data.seller.phone ? (
                <a href={`tel:${data.seller.phone.replace(/[^\d+]/g, "")}`} className="num text-brand-ink hover:underline">{data.seller.phone}</a>
              ) : "—"}
            </Field>
            <Field label="Email" className="col-span-6">
              {partial ? <Skeleton as="span" className="h-4 w-48" /> : data.seller.email ? (
                <a href={`mailto:${data.seller.email}`} className="text-brand-ink hover:underline">{data.seller.email}</a>
              ) : "—"}
            </Field>

            {/* N5E-06: the same one combined line the admin record shows, display-only here —
                a partner reads and searches the address, they never edit it. */}
            <Field label="Address" className="col-span-6">
              {(() => {
                const parts = [data.address, data.city, data.state, data.zip];
                const line = addressLine(parts);
                return line ? (
                  <Tooltip content="Search this property on Google">
                    <a
                      href={googleSearchUrl(parts)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-brand-ink hover:underline"
                    >
                      {line}
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      </svg>
                    </a>
                  </Tooltip>
                ) : "—";
              })()}
            </Field>

            {/* The portal's two short values share a row, where Source / Routed by / Time to
                sell share one on the admin side (routing internals are not a partner's — PRN-08). */}
            <Field label="Time to sell" className="col-span-2">{partial ? <Skeleton as="span" className="h-4 w-28" /> : data.timeToSell || "—"}</Field>
            <Field label="Listing check" className="col-span-2">
              {/* Not a lead column — a server-side lookup, so it can only come from the detail. */}
              {partial ? <Skeleton as="span" className="h-4 w-24" /> : <ListingBadge status={data.listing.status} link={data.listing.link} />}
            </Field>

            <Field label="Reason for selling" className="col-span-6">{partial ? <Skeleton as="span" className="h-4 w-28" /> : data.reasonForSelling || "—"}</Field>
            {/* N5E-05: `nowrap`, so the timestamp can never break across two lines. */}
            <Field label="Received" className="col-span-6" nowrap><span className="num">{fmtDateTime(data.receivedAt)}</span></Field>

            {/* N5E-04: the partner's primary action — still one click, now a labelled field in
                the same position its admin twin occupies, wearing the same control chrome. */}
            <div className="col-span-3 flex min-w-0 flex-col gap-1">
              <span className="text-step-1 font-semibold uppercase tracking-wide text-text-3">Lead status</span>
              <StatusSelect refId={data.refId} status={data.status} mlsStatus="kept" scope="portal" variant="field" />
            </div>

            {data.notes && (
              <div className="col-span-6 flex flex-col gap-1.5">
                <span className="text-step-1 font-semibold uppercase tracking-wide text-text-3">Source notes</span>
                <div className="rounded-lg border border-border-soft bg-surface-2 px-3.5 py-3">
                  <ClampedText>{data.notes}</ClampedText>
                </div>
              </div>
            )}
          </div>

          {/* Tasks panel sits ABOVE the Timeline per the approved mockup (WP-TSK-4, portal
              parity — same components as the admin dialog, scoped to this org's own stream). */}
          {/* Tasks and Notes hold their OWN queries keyed on the ref (which the row gave us),
              so they are not held back by the partial — they load alongside the detail. */}
          {/* C-11: `canWrite` is passed, not derived from a capability. The portal's server
              gate is requirePassthroughResponse — a partner passes on SCOPE alone (ADR-0047;
              partners hold no capability at all) — and PortalLayout redirects every
              admin-stream tier away, so this surface is partners-only. */}
          <TasksPanel leadRef={data.refId} onTaskChanged={onTaskChanged} canWrite />

          {/* C-12: the separate "Status history" panel is retired. Every row it listed is
              already a `status` entry in this Timeline, at the same timestamp and the same
              newest-first order — the Status filter chip is the equivalent view, and the
              current status stays server-derived (PRN-15). */}
          {partial ? <Skeleton className="h-24 w-full rounded-xl" /> : <Timeline activity={data.activity} />}

          <div className="border-t border-border-soft pt-4">
            <NotesPanel leadRef={data.refId} title="Your notes" tosHref="/portal/tos" />
          </div>
        </div>
      )}
    </SidePanel>
  );
}
