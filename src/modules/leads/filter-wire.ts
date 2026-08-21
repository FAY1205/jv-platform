// N6-50 — ONE serializer for the leads page's committed filter state, in both directions it
// travels: the list GET's query string and a bulk write's `mode:"filter"` body. They must
// describe the SAME set — the whole honesty claim of "Select all N matching this filter" is
// that the N the list counted and the rows the write touches came from identical inputs. Two
// hand-rolled serializers is exactly how that drifts, so there is one.
//
// Pure and dependency-free: the client imports it (the leads page) and so can a server
// route, without either pulling in the other's world.

/** The nine committed filter fields, in the shape the leads page's `Filters` state holds
 *  them (empty string / empty array = "off"). Mirrors the saved-view blob minus `viewMode`. */
export interface LeadsFilterState {
  q: string;
  partnerId: string;
  state: string;
  source: string;
  statuses: readonly string[];
  hot: boolean;
  tags: readonly string[];
  dateFrom: string;
  dateTo: string;
}

export interface LeadsListPosition {
  sort: string;
  dir: string;
  page: number;
  pageSize: number;
}

/** GET /api/leads params. `q` is always present (the read contract normalizes an empty
 *  string to "no search"); every other key appears only when the filter is on. */
export function leadsQueryParams(f: LeadsFilterState, pos: LeadsListPosition): URLSearchParams {
  const params = new URLSearchParams({
    q: f.q,
    sort: pos.sort,
    dir: pos.dir,
    page: String(pos.page),
    pageSize: String(pos.pageSize),
  });
  if (f.partnerId) params.set("partnerId", f.partnerId);
  if (f.state) params.set("state", f.state);
  if (f.source) params.set("source", f.source);
  if (f.statuses.length) params.set("statuses", f.statuses.join(","));
  if (f.hot) params.set("hot", "1");
  if (f.tags.length) params.set("tags", f.tags.join(","));
  if (f.dateFrom) params.set("dateFrom", f.dateFrom);
  if (f.dateTo) params.set("dateTo", f.dateTo);
  return params;
}

/**
 * The same state as a `BulkFilterSchema` body. Keys that are OFF are omitted rather than sent
 * empty — the write schema is strict, and "absent" is the only spelling of "off" that cannot
 * be confused with a malformed value. `statuses` is sent even when empty so the server's
 * "no status filter" is explicit rather than inferred from a missing key.
 */
export function bulkFilterBody(f: LeadsFilterState): Record<string, unknown> {
  const body: Record<string, unknown> = { statuses: [...f.statuses] };
  if (f.q) body.q = f.q;
  if (f.partnerId) body.partnerId = f.partnerId;
  if (f.state) body.state = f.state;
  if (f.source) body.source = f.source;
  if (f.hot) body.hot = true;
  if (f.tags.length) body.tags = [...f.tags];
  if (f.dateFrom) body.dateFrom = f.dateFrom;
  if (f.dateTo) body.dateTo = f.dateTo;
  return body;
}
