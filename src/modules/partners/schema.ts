import { z } from "zod";

// ADM-03: partner contact-detail validation for the CRUD forms (API-04 Zod
// boundary). Color is assigned by the system and locked (PRN-06); status is
// lifecycle-managed (invite / deactivate) — neither is editable through these
// forms, so neither appears in the schemas.

/** Blank/whitespace → undefined; otherwise a trimmed string. */
const optionalText = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : v.trim()) : v),
  z.string().optional(),
);

/** Blank → undefined; otherwise a trimmed, valid email. */
const optionalEmail = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : v.trim()) : v),
  z.string().email("Enter a valid email").optional(),
);

const name = z.string().trim().min(1, "Name is required").max(120);

export const PartnerCreateSchema = z.object({
  name,
  email: optionalEmail,
  phone: optionalText,
  dealTerms: optionalText,
  adminNotes: optionalText,
});
export type PartnerCreateInput = z.infer<typeof PartnerCreateSchema>;

export const PartnerUpdateSchema = z.object({
  name: name.optional(),
  email: optionalEmail,
  phone: optionalText,
  dealTerms: optionalText,
  adminNotes: optionalText,
});
export type PartnerUpdateInput = z.infer<typeof PartnerUpdateSchema>;

// Deactivating a partner who still owns territory must resolve where it goes:
// reassign to another partner, or route it to Unmatched (ADM-03).
export const DeactivateSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("reassign"), toPartnerId: z.string().uuid() }),
  z.object({ mode: z.literal("unmatched") }),
]);
export type DeactivateInput = z.infer<typeof DeactivateSchema>;
