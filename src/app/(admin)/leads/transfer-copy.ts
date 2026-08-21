/**
 * The consequence sentence a partner re-route carries, in ONE place.
 *
 * The single-lead edit (lead-dialog) and the WP-N6 bulk assign confirm (N6-14) state the same
 * fact — re-routing MOVES ownership, and ownership carries the notes and the status timeline
 * with it (R-01/R-22). Hand-copying that sentence into the second surface is the failure class
 * this file exists to prevent: the two would drift the first time the wording is refined, and
 * the bulk surface — where the consequence lands on hundreds of leads at once — is the one
 * that must not be the stale copy.
 *
 * Its own module rather than an export from `lead-dialog.tsx`: that component is code-split
 * (`dynamic(...)`), so importing a constant out of it would pull the whole dialog into the
 * list's bundle.
 */
export const NEW_OWNER_CONSEQUENCE =
  "The new owner starts with a clean status timeline and cannot see the previous owner's status history or notes; the previous owner loses access to this lead.";
