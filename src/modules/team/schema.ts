import { z } from "zod";
import { INVITABLE_ROLES } from "@/lib/auth/team-invite";
import { TENANT_EDITABLE, type Capability } from "@/lib/authz";

// Phase C team management (TM-01..30 IDs live in the tests). Every input is
// Zod-validated at the boundary (API-01); strictObject rejects smuggled fields.

export const InviteInputSchema = z.strictObject({
  email: z.string().trim().toLowerCase().email().max(320),
  role: z.enum(INVITABLE_ROLES),
});
export type InviteInput = z.infer<typeof InviteInputSchema>;

export const RoleChangeSchema = z.strictObject({
  role: z.enum(INVITABLE_ROLES),
});

/** ADR-0049 §11.2 write side: ONLY tenant-editable capability keys are acceptable —
 *  a locked or unknown key is a loud 400 (an editor bug must surface), never a strip. */
const EditableCapabilitySchema = z
  .string()
  .refine((k): k is Capability => TENANT_EDITABLE.has(k as Capability), { message: "not an editable capability" });

/** `null` = reset that tier to the live defaults (DELETE the row, ADR-0049). */
export const PermissionsPatchSchema = z.strictObject({
  member: z.array(EditableCapabilitySchema).max(32).nullable().optional(),
  viewer: z.array(EditableCapabilitySchema).max(32).nullable().optional(),
});
export type PermissionsPatch = z.infer<typeof PermissionsPatchSchema>;

export const AcceptInviteSchema = z.strictObject({
  token: z.string().min(20).max(200),
  password: z.string().min(1).max(1024),
});
