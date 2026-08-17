import { z } from "zod";
import { pageParam, PORTAL_MAX_PAGE } from "@/lib/query-params";

// TSK-07 query contract for My Tasks. Zod normalizes everything at the boundary so the
// query layer never sees raw input; an invalid filter degrades to the default rather than
// 400-ing (the house "invalid filters degrade to defaults" rule).

/** Title bounds (TSK-01). Trimmed, so whitespace alone is rejected. */
export const TASK_TITLE_MAX = 200;

/** My Tasks rows per page. Fixed rather than client-chosen: the view is a personal work
 *  list with a bounded row count, not a data table with a page-size control.
 *  C-6: reviewed and kept fixed — no UI exposes a size selector (WP-TSK-5) and a personal
 *  list needs none. IF one is ever added, adopt the shared `pageSizeParam()` ({10,20,50})
 *  from lib/query-params like the leads/activity endpoints, not a second convention. */
export const MY_TASKS_PAGE_SIZE = 20;

/** A calendar date as the `date` column round-trips it (TSK-10 — UTC semantics). The
 *  round-trip check rejects impossible dates ("2026-02-31" rolls forward to Mar 3) that the
 *  regex alone allows.
 *
 *  The NaN guard is load-bearing, not defensive noise (pr-review HIGH): a regex-valid but
 *  unreal month/day ("2026-13-01", "2026-00-05", "2026-01-00") makes an INVALID Date, and
 *  `.toISOString()` on one THROWS RangeError — out of `safeParse`, past the route's
 *  `!parsed.success` branch, into a raw 500 instead of the uniform 400 envelope. Same
 *  shape as `dateParam()` in lib/query-params. */
export const DueOnSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "A due date must be YYYY-MM-DD.")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Not a real calendar date.");

export const TaskTitleSchema = z.string().trim().min(1).max(TASK_TITLE_MAX);

/** POST body for a new task. `assignedToUserId` is a HINT only — the server re-validates
 *  it against the author's tenant + stream (TSK-03) and refuses anything outside. */
export const CreateTaskSchema = z.object({
  title: TaskTitleSchema,
  dueOn: DueOnSchema.nullish(),
  assignedToUserId: z.string().uuid().nullish(),
});

/** PATCH edit body — at least one field, and a present key with `null` CLEARS that field.
 *  STRICT (pr-review F-5): an unknown key is a client bug or a probe, not something to
 *  silently drop — a typo'd `titel` should 400, not report success having changed nothing.
 *  Strictness only rejects UNKNOWN keys, so the undefined-vs-null patch semantics are
 *  untouched (pinned by the partial-edit case in tasks-api.test.ts). */
export const EditTaskSchema = z
  .strictObject({
    title: TaskTitleSchema.optional(),
    dueOn: DueOnSchema.nullish(),
    assignedToUserId: z.string().uuid().nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to change.");

/** PATCH action body — the complete/reopen half of the same endpoint (TSK-04). Strict for
 *  the same reason: `{action:"complete", title:"x"}` is an ambiguous request, not an edit
 *  plus a completion, and must be refused rather than half-honoured. */
export const TaskActionSchema = z.strictObject({ action: z.enum(["complete", "reopen"]) });

export const MyTasksQuerySchema = z.object({
  status: z.unknown().optional().transform((v): "open" | "done" => (v === "done" ? "done" : "open")),
  // Capped like the other cross-role list endpoints — a personal task list is inherently
  // bounded, so the ceiling only bounds a pathological ?page=<huge>.
  page: pageParam({ max: PORTAL_MAX_PAGE }),
});

export type MyTasksQuery = z.infer<typeof MyTasksQuerySchema> & { pageSize?: number };
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;
export type EditTaskInput = z.infer<typeof EditTaskSchema>;
