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
      const raw = typeof v === "string" ? v.split(",") : Array.isArray(v) ? v.map(String) : [];
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
