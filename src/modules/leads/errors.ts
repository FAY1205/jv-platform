/**
 * Shared lead-child errors (C-5). Every lead-child module (leads/commands, notes, tasks, tags,
 * portal/status-update) used to declare its OWN identical `LeadNotFoundError`, and each API route
 * catches it with `instanceof` — so the class must be ONE object across all throw/catch sites, or a
 * route importing it from module A would not catch the copy thrown by module B. Each module now
 * re-exports this class, so a change to the message (or the not-found contract) lives in one place.
 *
 * `refId` is optional: `leads/commands` throws it without a reference (a generic "Lead not found."),
 * every other path throws it with the lead's reference id.
 */
export class LeadNotFoundError extends Error {
  constructor(refId?: string) {
    super(refId ? `Lead ${refId} not found.` : "Lead not found.");
    this.name = "LeadNotFoundError";
  }
}
