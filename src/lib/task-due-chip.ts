import { groupByDue } from "@/modules/tasks/dates";

// WP-TSK-4: the due-date CHIP presentation for one task — a thin UI-layer mapping on
// top of the pure TSK-10 grouping (modules/tasks/dates.groupByDue), extracted so its
// state → {tone, label} rules are unit-testable without mounting a component. `today`
// is always the caller's parameter, never Date.now() here (mirrors PRN-01 discipline
// even though this file sits outside src/modules/pipeline).
//
// PRN-14: a tone is never the only signal — every label carries the same information
// in text ("Overdue · Aug 14", "Due today", "Done · Aug 12"), so the chip reads
// correctly with color vision deficiency or in print.

export type DueChipTone = "danger" | "warn" | "neutral";

export interface DueChip {
  tone: DueChipTone;
  label: string;
  /** The formatted date fragment WITHIN `label` (e.g. "Aug 14" inside "Overdue · Aug 14"),
   *  present whenever the label carries a date. The mockup's chips are plain sans text —
   *  only this fragment is meant to render `num` (tabular mono) for alignment; the rest of
   *  `label` ("Overdue · ", "Done · ") stays plain (design F-3). Undefined for the two
   *  date-less labels, "Due today" and "No due date". */
  dateText?: string;
}

const LOCALE = "en-US";

/** "2026-08-14" → "Aug 14", parsed as a LOCAL calendar date (no `new Date(iso)` — that
 *  shifts a day for west-of-UTC viewers, the same trap `lib/dates.ts` documents). */
function humanDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(LOCALE, { month: "short", day: "numeric" });
}

/**
 * The due chip for one task. `doneAt` (a full timestamp) takes priority — a completed
 * task is always "Done", regardless of what its due date says. `today` is a
 * "YYYY-MM-DD" string, the same shape `groupByDue` takes.
 */
export function dueChipFor(dueOn: string | null | undefined, doneAt: string | null | undefined, today: string): DueChip {
  if (doneAt) {
    const d = humanDate(doneAt.slice(0, 10));
    return { tone: "neutral", label: `Done · ${d}`, dateText: d };
  }

  switch (groupByDue(dueOn, today)) {
    case "overdue": {
      const d = humanDate(dueOn as string);
      return { tone: "danger", label: `Overdue · ${d}`, dateText: d };
    }
    case "today":
      return { tone: "warn", label: "Due today" };
    case "upcoming": {
      const d = humanDate(dueOn as string);
      return { tone: "neutral", label: d, dateText: d };
    }
    case "none":
    default:
      return { tone: "neutral", label: "No due date" };
  }
}
