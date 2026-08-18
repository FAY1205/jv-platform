"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";
import {
  Dialog,
  Badge,
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

// VP-4: the partner-facing lead dialog (mirrors the admin LeadDialog pattern, portal-scoped).
// Replaces the retired /portal/leads/[ref] PAGE — same data + every feature it had (status
// change, listing check, status history, your notes) in the grouped layout. Shows ONLY what a
// partner may see (no routing internals, no other-partner data — PRN-08). "Motivation" is
// dropped: for Lead Source 1 it is never populated; reason-for-selling carries the content.

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
  history: { status: string; changedAt: string }[];
  /** TSK-06: the unified timeline (arrival, this org's status changes/notes/tasks). */
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
    <Dialog open onClose={onClose} size="lg" title={<span className="num">{refId}</span>}>
      {isPending ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : error || !data ? (
        <QueryErrorState title="Couldn't load this lead" error={error} description={(error as Error)?.message ?? "Not found."} onRetry={() => refetch()} />
      ) : (
        <div className="flex flex-col gap-5">
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
            <Field label="Reason for selling">{partial ? <Skeleton className="h-4 w-28" /> : data.reasonForSelling || "—"}</Field>
            <Field label="Time to sell">{partial ? <Skeleton className="h-4 w-28" /> : data.timeToSell || "—"}</Field>
            <Field label="Received">{fmtDateTime(data.receivedAt)}</Field>
            <Field label="Listing check">
              {/* Not a lead column — a server-side lookup, so it can only come from the detail. */}
              {partial ? <Skeleton className="h-4 w-24" /> : <ListingBadge status={data.listing.status} link={data.listing.link} />}
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
          <TasksPanel leadRef={data.refId} onTaskChanged={onTaskChanged} />

          {partial ? <Skeleton className="h-24 w-full rounded-xl" /> : <Timeline activity={data.activity} />}

          {/* Status history — kept alongside the Timeline (pre-existing PTL-02/03 feature;
              the Timeline's own "Status" filter already surfaces the same changes inline). */}
          <div className="rounded-xl border border-border-soft bg-surface-2 p-4">
            <h3 className="mb-3 text-step-1 font-semibold uppercase tracking-wide text-text-3">Status history</h3>
            {partial ? (
              <Skeleton className="h-4 w-40" />
            ) : data.history.length === 0 ? (
              <p className="text-sm text-text-3">No changes yet — the current status is the default.</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {data.history.map((h, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm">
                    <Badge>{h.status}</Badge>
                    <span className="num text-step-1 text-text-3">{fmtDateTime(h.changedAt)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="border-t border-border-soft pt-4">
            <NotesPanel leadRef={data.refId} title="Your notes" tosHref="/portal/tos" />
          </div>
        </div>
      )}
    </Dialog>
  );
}
