import { type NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/http";
import { BulkSelectionSchema } from "@/modules/leads/schema";

// Shared boundary bits for the three WP-N6 bulk endpoints (N6-04). The GATES are spelled out
// in each route rather than hidden behind a helper — the AUTHZ-06 / AUT-12 conformance tests
// read the route file, and a reader deciding "is this endpoint protected" should not have to
// follow an import. What IS shared is the input contract and how a bad one is reported.

/**
 * Every bulk body carries the selection and may ask for a zero-write resolution (N6-05).
 * Strict: an unknown key on a WRITE body is a client bug, not a field to ignore.
 *
 * `z.boolean()`, not `z.literal(true)` (audit-tenancy F-6): a literal makes an explicit
 * `dryRun: false` — the obvious way for a client to say "actually execute this" — a 400,
 * which is a foot-gun on the SAFE side of the flag. The resolvers branch on truthiness, so
 * `false` and absent mean the same thing.
 */
export const BulkBodyBase = {
  selection: BulkSelectionSchema,
  dryRun: z.boolean().optional(),
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
  // An EMPTY ref list is the one input failure with a real-world cause rather than a client
  // bug: the operator's selection was cleared underneath the open dialog (a filter change, a
  // second tab). Zod's "Too small: expected array to have >=1 items" is not something to show
  // a human, and it is not the same message as a malformed ref (audit-ux-flows F-5).
  if (path[0] === "selection" && path[1] === "leadRefs" && issue?.code === "too_small") {
    return emptySelectionError();
  }
  return jsonError("invalid_input", issue?.message ?? "Invalid input.", 400);
}

/**
 * The one spelling of "there is nothing here to act on". Raised by the Zod boundary above when
 * a refs list arrives empty, and by the EXPORT route when a selection resolves to zero rows
 * (N6-40) — the same cause (the selection moved out from under the dialog) and the same
 * remedy, so the same code and the same sentence.
 */
export function emptySelectionError(): NextResponse {
  return jsonError("empty_selection", "Your selection is no longer available — close this and reselect.", 400);
}
