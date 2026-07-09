import { z } from "zod";

// CVG-02: validation for the editable Rules area. MLS patterns are toggle + label
// only — their regex is never editable at runtime (PRN-04: MLS token changes go
// through the corpus-first test flow at dev time). (Campaign recodes removed, ADR-0018.)

// Unknown fields (e.g. a smuggled `regex`) are stripped by Zod's default object
// parse, so the regex can never be edited at runtime (PRN-04).
export const MlsPatternUpdateSchema = z.object({
  label: z.string().trim().min(1, "A label is required").max(200).optional(),
  enabled: z.boolean().optional(),
});
export type MlsPatternUpdateInput = z.infer<typeof MlsPatternUpdateSchema>;
