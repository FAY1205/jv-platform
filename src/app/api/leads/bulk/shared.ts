import { type NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/http";
import { BulkSelectionSchema } from "@/modules/leads/schema";

// Shared boundary bits for the three WP-N6 bulk endpoints (N6-04). The GATES are spelled out
// in each route rather than hidden behind a helper — the AUTHZ-06 / AUT-12 conformance tests
// read the route file, and a reader deciding "is this endpoint protected" should not have to
// follow an import. What IS shared is the input contract and how a bad one is reported.

/** Every bulk body carries the selection and may ask for a zero-write resolution (N6-05).
 *  Strict: an unknown key on a WRITE body is a client bug, not a field to ignore. */
export const BulkBodyBase = {
  selection: BulkSelectionSchema,
  dryRun: z.literal(true).optional(),
};

/**
 * N6-02 — a malformed FILTER is its own error code, because it is its own failure mode: the
 * read contract degrades a bad filter to "no filter", and a write that did the same would
 * silently widen the set it touches. The client shows the operator that their selection could
 * not be understood instead of a generic "invalid input".
 */
export function bulkInputError(error: z.ZodError): NextResponse {
  const issue = error.issues[0];
  const path = issue?.path ?? [];
  if (path[0] === "selection" && path[1] === "filters") {
    return jsonError("invalid_filters", "That filter isn't valid, so the selection couldn't be resolved.", 400);
  }
  return jsonError("invalid_input", issue?.message ?? "Invalid input.", 400);
}
