import type { ListingCheckProvider, ListingLead, ListingResult } from "./provider";

// LST-02: LinkOnly — the always-available V1 provider. It can't determine a listing
// automatically, so it returns "unknown" plus a search link to verify manually.
// PURE (no I/O). An automated provider replaces this behind the same interface.

export class LinkOnlyProvider implements ListingCheckProvider {
  readonly name = "link_only";

  check(lead: ListingLead): ListingResult {
    const query = [lead.address, lead.city, lead.state, lead.zip]
      .map((p) => (p ?? "").trim())
      .filter(Boolean)
      .join(" ");
    const link = query
      ? `https://www.google.com/search?q=${encodeURIComponent(`${query} for sale`)}`
      : undefined;
    return { provider: this.name, status: "unknown", link };
  }
}
