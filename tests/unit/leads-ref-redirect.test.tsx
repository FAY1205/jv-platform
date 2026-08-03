import { describe, it, expect, vi, beforeEach } from "vitest";

// P-1 (portal-parity audit): the retired read-only /leads/[ref] page is now a redirect
// into the capable leads dialog, so already-sent notifications and AI citations that carry
// the old URL still land somewhere they can act on the lead.

// The page's sole job is to call redirect() with the right target; mock it as a no-op
// (the real one throws NEXT_REDIRECT to unwind, which is irrelevant to this assertion).
const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));

import LeadRefRedirect from "@/app/(admin)/leads/[ref]/page";

beforeEach(() => redirect.mockClear());

describe("/leads/[ref] retired → redirect", () => {
  it("redirects to the leads list with the ref auto-opening the dialog", async () => {
    await LeadRefRedirect({ params: Promise.resolve({ ref: "LD-26-00001" }) });
    expect(redirect).toHaveBeenCalledWith("/leads?open=LD-26-00001");
  });

  it("URL-encodes the ref so a stray char can't break out of the query", async () => {
    await LeadRefRedirect({ params: Promise.resolve({ ref: "a b&x" }) });
    expect(redirect).toHaveBeenCalledWith("/leads?open=a%20b%26x");
  });
});
