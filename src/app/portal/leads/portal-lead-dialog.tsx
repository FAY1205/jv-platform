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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-step-1 font-semibold uppercase tracking-wide text-text-3">{label}</span>
      <span className="text-sm text-text-2">{children}</span>
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
    queryFn: () => apiGet<PortalLeadDetail>(`/api/portal/leads/${refId}`),
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
          {/* Status — the partner's primary action, up top and editable inline. */}
          <div className="flex items-center gap-3 rounded-lg border border-border-soft bg-surface-2 px-4 py-3">
            <span className="text-step-1 font-semibold uppercase tracking-wide text-text-3">Lead status</span>
            <StatusSelect refId={data.refId} status={data.status} mlsStatus="kept" scope="portal" />
          </div>

          {/* Contact */}
          <div className="flex flex-col gap-1">
            <span className="text-base font-semibold text-text">{`${data.seller.first} ${data.seller.last}`.trim() || "—"}</span>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              {/* C-41b: the row gives the name; the phone/email a partner is about to use
                  are detail-only, so they hold a labelled space instead of appearing late. */}
              {partial ? <Skeleton className="h-4 w-48" /> : null}
              {data.seller.phone ? (
                <a href={`tel:${data.seller.phone.replace(/[^\d+]/g, "")}`} className="text-brand-ink hover:underline">{data.seller.phone}</a>
              ) : null}
              {data.seller.email ? (
                <a href={`mailto:${data.seller.email}`} className="text-brand-ink hover:underline">{data.seller.email}</a>
              ) : null}
            </div>
          </div>

          {/* Property */}
          <Field label="Property">
            {(() => {
              const property = [data.address, data.city, data.state, data.zip].filter(Boolean).join(", ");
              return property ? (
                <Tooltip content="Search this property on Google">
                  <a
                    href={googleSearchUrl([data.address, data.city, data.state, data.zip])}
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
              ) : "—";
            })()}
          </Field>

          {/* Details */}
          <div className="grid grid-cols-2 gap-x-5 gap-y-4">
            {/* C-51 sweep: `Field` renders its children inside a <span>, so these
                placeholders must be spans too (a <div> in phrasing content is invalid
                and hydration-mismatches). */}
            <Field label="Reason for selling">{partial ? <Skeleton as="span" className="h-4 w-28" /> : data.reasonForSelling || "—"}</Field>
            <Field label="Time to sell">{partial ? <Skeleton as="span" className="h-4 w-28" /> : data.timeToSell || "—"}</Field>
            <Field label="Received">{fmtDateTime(data.receivedAt)}</Field>
            <Field label="Listing check">
              {/* Not a lead column — a server-side lookup, so it can only come from the detail. */}
              {partial ? <Skeleton as="span" className="h-4 w-24" /> : <ListingBadge status={data.listing.status} link={data.listing.link} />}
            </Field>
          </div>

          {data.notes && (
            <div className="flex flex-col gap-1.5">
              <span className="text-step-1 font-semibold uppercase tracking-wide text-text-3">Source notes</span>
              <div className="rounded-lg border border-border-soft bg-surface-2 px-3.5 py-3">
                <ClampedText>{data.notes}</ClampedText>
              </div>
            </div>
          )}

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
