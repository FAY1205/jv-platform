/**
 * N3C-02/Q5 — whole-row click, in ONE place.
 *
 * Two dense tables (the leads list and the partners roster) present rows that LOOK clickable
 * and aren't: the affordance is a small button or link inside the first cell, so the 95% of
 * the row that is dead space silently swallows the click. Making the row itself clickable is
 * a POINTER convenience only — the keyboard/AT path stays the real control inside the row
 * (RowOpenButton on leads, the partner-name Link on partners), which is why no caller puts
 * `tabIndex`/`role="button"` on the <tr>: a row-level tab stop would duplicate every inner
 * control in the tab order for no new capability.
 *
 * Two things must NOT trigger the row action, and both bit every naive implementation:
 *  1. a click that originated on an inner control (a link, a button, the ⋯ menu, a checkbox,
 *     a form field) — the row handler would fire ON TOP of the control's own action;
 *  2. a click that ENDS a text selection — a user dragging across a seller's name to copy it
 *     released the button inside the row, and the row would open a dialog over their
 *     selection.
 *
 * One implementation because two copies drift: the day a new inner control lands in either
 * table, only one selector needs to learn about it.
 */

/** The interactive descendants a row click must defer to. Ancestor-matched via `closest`, so a
 *  click on an icon/span INSIDE one of these still counts as a click on the control. */
const INTERACTIVE_SELECTOR = "a,button,input,label,select,[role=menuitem],[role=checkbox]";

/**
 * True when a click on a row should run the row's open action — i.e. it is a plain click on
 * the row's own surface, not on an inner control and not the tail of a text selection.
 *
 * Takes the raw `EventTarget`/`Element` rather than a React event so it stays trivially
 * testable and framework-agnostic; callers pass `e.target`.
 */
export function rowClickGuard(target: EventTarget | null): boolean {
  if (target instanceof Element && target.closest(INTERACTIVE_SELECTOR)) return false;
  if ((window.getSelection()?.toString() ?? "") !== "") return false;
  return true;
}

/** Shared row styling for a clickable row: the pointer cursor is applied ONLY where the whole
 *  row actually responds to a click, so it never promises an action a row cannot perform. */
export const CLICKABLE_ROW_CLASS = "cursor-pointer hover:bg-surface-2";
