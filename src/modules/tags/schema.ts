import { z } from "zod";
import { TAG_PALETTE } from "@/lib/tokens/tokens";

// WP-TAG-1 (TAG-03) — the tag API's input contracts. Zod normalizes at the boundary so the
// command layer never sees raw input. Two different house conventions apply here on
// purpose: BODIES are strict and 400 on nonsense (a mis-typed key is a client bug), while
// LIST FILTER params degrade to "no filter" (a filter UI should degrade, not error) — the
// same split the tasks + leads modules already draw.

/** TAG-01: a tag name is a short human label. Trimmed, so whitespace alone is rejected. */
export const TAG_NAME_MAX = 40;

/** How many tag ids one `?tags=` filter may carry. A bound, not a feature: it keeps a
 *  hand-crafted URL from turning into an unbounded IN-list (the pageSize discipline). */
export const TAG_FILTER_MAX = 20;

/**
 * TAG-08: the hard per-tenant tag cap. Chosen at ≤ half the FEP-03 virtualization threshold
 * (~200 rows) so the roster is bounded BY CONSTRUCTION and the plain (unvirtualized)
 * TagPicker + Settings lists stay compliant without a new dependency. It is also a product
 * guardrail: a tag vocabulary past ~100 has stopped being a scanning vocabulary and become a
 * data-quality problem. Enforced server-side inside createTag's transaction (exactly, under a
 * per-tenant advisory lock) and mirrored as a read-side LIMIT in listTags.
 *
 * The CLIENT never hardcodes this — GET /api/tags reports it as `limit`, so changing the cap
 * is one constant plus its tests, with no client change.
 */
export const TAG_LIMIT = 100;

export const TagNameSchema = z.string().trim().min(1).max(TAG_NAME_MAX);
/** The stored value is a PALETTE KEY, never a hex — see lib/tokens TAG_PALETTE. */
export const TagColorSchema = z.enum(TAG_PALETTE);

/** POST /api/tags. `color` is optional: omitted means "next palette color, round-robin"
 *  (TAG-04's create-inline path, which sends a name only). */
export const CreateTagSchema = z.strictObject({
  name: TagNameSchema,
  color: TagColorSchema.optional(),
});

/** PATCH /api/tags/[id] — rename and/or recolor (TAG-06). Strict, and at least one field:
 *  an empty patch is a client bug, not a successful no-op. */
export const UpdateTagSchema = z
  .strictObject({
    name: TagNameSchema.optional(),
    color: TagColorSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to change.");

/** POST /api/leads/[ref]/tags — attach. The tag id is a hint only: the command re-reads it
 *  under the tenant predicate and refuses anything outside (TAG-02). */
export const AttachTagSchema = z.strictObject({ tagId: z.string().uuid() });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * How many comma-separated segments the raw param is split into before ANY validation. The
 * cap above matters only after parsing; this one bounds the parse itself (audit-tenancy
 * F-7). `?tags=` accepts up to 120 characters of query string per segment from an untrusted
 * URL, and `"a,".repeat(500_000).split(",")` materialises half a million strings before the
 * uuid test ever runs. A generous multiple of TAG_FILTER_MAX, so a legitimate over-long
 * request still degrades to the cap rather than erroring.
 */
const TAG_PARAM_MAX_SEGMENTS = TAG_FILTER_MAX * 10;

/**
 * The shared `?tags=` filter parser for BOTH the list and the board (TAG-03: v1 is OR /
 * any-of). Comma-separated uuids; anything unparseable is dropped rather than 400-ing, an
 * empty result means "no tag filter", and the list is de-duplicated + capped so a crafted
 * URL cannot widen the query. One definition, so the two endpoints can never disagree on
 * what `?tags=` means.
 */
export const tagsParam = () =>
  z
    .unknown()
    .optional()
    .transform((v): string[] => {
      const raw =
        typeof v === "string"
          ? // Bounded split: the limit argument makes the ARRAY size bounded, not just the
            // result — the whole point of the cap (a 500k-segment string is a URL, not a filter).
            v.split(",", TAG_PARAM_MAX_SEGMENTS)
          : Array.isArray(v)
            ? v.slice(0, TAG_PARAM_MAX_SEGMENTS).map(String)
            : [];
      const seen = new Set<string>();
      for (const s of raw) {
        const id = s.trim().toLowerCase();
        if (UUID_RE.test(id)) seen.add(id);
        if (seen.size >= TAG_FILTER_MAX) break;
      }
      return [...seen];
    });

export type CreateTagInput = z.infer<typeof CreateTagSchema>;
export type UpdateTagInput = z.infer<typeof UpdateTagSchema>;
