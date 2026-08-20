"use client";

import * as React from "react";
import { fmtDate } from "@/lib/dates";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { usePortalLeads } from "@/lib/portal-leads-client";
import {
  Button, Card, Input, Table, THead, TBody, Th, Tr, Td, Pagination, Skeleton, EmptyState, QueryErrorState, HotLeadMark, RowOpenButton, StatusSelect, StatusFilterMenu,
} from "@/components";
// leads-contract, NOT ./queries: this is a "use client" component and a VALUE import
// from queries would pull its @/db → postgres → node:fs chain into the client bundle.
import { PORTAL_STATUS_FILTERS, PORTAL_LEADS_DEFAULT_PAGE_SIZE, portalLeadsParams, type PortalLeadSort } from "@/modules/portal/leads-contract";

// WP-PW-3 Task 2: the desktop (>= lg) Leads table — admin-style sortable, status-
// filterable, server-side-paginated (mirrors src/app/(admin)/leads/leads-view.tsx, portal-scoped).
// Owns its own filter/sort/page STATE (no shared state with LeadsMobile) — exactly one of
// the two mounts after the media query settles. C-41a: the query itself is no longer its
// own; it goes through the shared usePortalLeads hook so the default page-1 view is the
// same cache entry the dashboard preview already filled. The mobile list no longer fetches
// during the hydration window either (see portal-leads-view), so a desktop first paint is
// exactly ONE request.

const DEFAULT_DIR: Record<PortalLeadSort, "asc" | "desc"> = {
  received: "desc",
  status: "asc",
  city: "asc",
  state: "asc",
  ref: "asc",
};

export function LeadsDesktop({ onOpen, openRef = null }: { onOpen: (refId: string) => void; openRef?: string | null }) {
  const [sort, setSort] = React.useState<PortalLeadSort>("received");
  const [dir, setDir] = React.useState<"asc" | "desc">("desc");
  const [statuses, setStatuses] = React.useState<string[]>([]);
  const [page, setPage] = React.useState(1);
  // The canonical default (= the Pagination primitive's DEFAULT_PAGE_SIZE; a unit test pins
  // them together) — so opening this table asks the question the dashboard already asked.
  const [pageSize, setPageSize] = React.useState<number>(PORTAL_LEADS_DEFAULT_PAGE_SIZE);

  // WP-PP-3: debounced free-text search (mirrors the admin leads-view 300ms debounce so
  // keystrokes don't refetch on every character; the committed value drives the query).
  const [qInput, setQInput] = React.useState("");
  const qCommitted = useDebouncedValue(qInput.trim());

  // Admin compare pattern (leads-view.tsx): a derived key that resets `page` to 1 the
  // moment search/sort/dir/statuses/pageSize change — a render-time compare, NOT an effect.
  const filterKey = `${qCommitted}|${sort}|${dir}|${statuses.join(",")}|${pageSize}`;
  const [resetKey, setResetKey] = React.useState(filterKey);
  if (filterKey !== resetKey) {
    setResetKey(filterKey);
    setPage(1);
  }

  const onSort = (field: PortalLeadSort) => {
    if (sort === field) setDir((p) => (p === "asc" ? "desc" : "asc"));
    else {
      setSort(field);
      setDir(DEFAULT_DIR[field]);
    }
  };


  const leadsQ = usePortalLeads(portalLeadsParams({ page, pageSize, sort, dir, statuses, q: qCommitted }));

  const data = leadsQ.data;
  const sortDir = (f: PortalLeadSort) => (sort === f ? dir : null);
  const hasFilters = statuses.length > 0 || qCommitted !== "";

  return (
    <main className="mx-auto w-full flex-1 p-4 md:p-0">
      {/* T7a: admin list-page order — search + filters row (search left, in-body action
          right), live result count, then the table in a Card (the admin leads-view idiom). */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="w-full max-w-[300px]">
          <Input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Search seller, address, ZIP, phone, lead ID…"
            aria-label="Search your leads"
          />
        </div>
        <a href="/api/portal/leads/export" download>
          <Button variant="secondary" size="lg">
            Export
          </Button>
        </a>
      </div>
      {/* WP-UX-6: the shared status multi-select (parity with the admin list). The portal's
          default is the empty set (= all shown), so the calm "All active" trigger stands in
          for the old "All" pill and each chosen status becomes a removable chip. */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <StatusFilterMenu options={PORTAL_STATUS_FILTERS} defaultValue={[]} value={statuses} onChange={setStatuses} />
      </div>

      {/* Live result count (admin T2 copy) — re-announces as the filter narrows the set.
          Suppressed at zero and on error (D2): the EmptyState announces those settles —
          stale `data` can coexist with `error` on a failed background refetch. */}
      {data && data.total > 0 && !leadsQ.error && (
        <p className="mb-2 text-step-1 text-text-3" aria-live="polite">
          <span className="num font-semibold text-text-2">{data.total.toLocaleString()}</span>{" "}
          {data.total === 1 ? "lead" : "leads"}{hasFilters ? " match the filters" : ""}
        </p>
      )}

      <Card>
        {leadsQ.isPending ? (
          <div className="flex flex-col gap-3 p-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : leadsQ.error ? (
          // EmptyState itself announces (role="status" on the primitive since D2, SC 4.1.3).
          <div className="p-6">
            <QueryErrorState title="Couldn't load your leads" error={leadsQ.error} onRetry={() => leadsQ.refetch()} />
          </div>
        ) : data!.leads.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No leads found"
              description={hasFilters ? "Try widening your search or status filter." : "Leads assigned to you will appear here after the next upload."}
            />
          </div>
        ) : (
          <Table>
            {/* WP-UX-1 (audit: portal triple-duplication): the ADDRESS run already carries
                city/state/zip, so the standalone CITY and STATE columns are gone — ~30% of
                the table restated itself while SELLER/ADDRESS couldn't flex. City stays a
                sortable FACET on the Address header (the state sort had no real use over a
                small territory; the API param remains for deep links). Width budget: fit
                for ref/date/status, clamp for the two identity columns. */}
            <THead>
              <Tr>
                <Th fit sortable sortDir={sortDir("ref")} onSort={() => onSort("ref")}>Ref</Th>
                <Th className="w-[28%]">Seller</Th>
                <Th sortable sortDir={sortDir("city")} onSort={() => onSort("city")} title="Sorts by city">Address</Th>
                <Th fit sortable sortDir={sortDir("received")} onSort={() => onSort("received")} align="right">Received</Th>
                {/* Status is not sortable — matches the admin leads table (a workflow value,
                    not an ordered dimension); it is edited inline in the cell below. */}
                <Th fit>Status</Th>
              </Tr>
            </THead>
            <TBody>
              {data!.leads.map((l) => (
                // N5-20: the record panel is non-modal at this width, so the row it is showing
                // has to be findable in the table beside it. `aria-current` carries that to AT
                // and the ref in the panel header names the same lead — the tint is never the
                // only signal (PRN-14).
                <Tr
                  key={l.refId}
                  aria-current={l.refId === openRef ? "true" : undefined}
                  className={l.refId === openRef ? "bg-brand-soft" : "hover:bg-surface-2"}
                >
                  <Td fit>
                    <span className="inline-flex items-center gap-1.5">
                      {/* N5-30: focus the button BEFORE opening — SidePanel captures its
                          return-focus target by sampling `document.activeElement` on the open
                          transition, and whether a mouse-down leaves a button focused is
                          browser-dependent. Applied here rather than inside RowOpenButton:
                          that primitive is shared with the admin tables (PR B territory). */}
                      <RowOpenButton onClick={(e) => { e.currentTarget.focus(); onOpen(l.refId); }}>{l.refId}</RowOpenButton>
                      {l.scoreGroup === "hot" && l.scoreTotal !== null && <HotLeadMark score={l.scoreTotal} />}
                    </span>
                  </Td>
                  <Td clamp clampTitle={`${l.sellerFirst} ${l.sellerLast}`}>
                    <span className="text-sm text-text">{l.sellerFirst} {l.sellerLast}</span>
                  </Td>
                  <Td clamp>
                    <span className="text-sm text-text-2">{l.address}</span>
                    <span className="ml-1.5 text-xs text-text-3">{[l.city, l.state].filter(Boolean).join(", ")} <span className="num">{l.zip}</span></span>
                  </Td>
                  <Td fit align="right"><span className="num text-xs text-text-3 tabular-nums">{fmtDate(l.receivedAt)}</span></Td>
                  <Td fit><StatusSelect refId={l.refId} status={l.status} mlsStatus="kept" scope="portal" /></Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {data && data.total > 0 && (
        <Pagination
          className="mt-4"
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      )}
    </main>
  );
}
