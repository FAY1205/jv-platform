import { z } from "zod";

// Global leads list query params (ADM). Zod-normalizes everything to canonical
// values so the query layer never sees raw user input; invalid shapes fall back
// to safe defaults instead of erroring — a filter UI should degrade, not 400.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const LeadsQuerySchema = z.object({
  q: z
    .unknown()
    .optional()
    .transform((v) => (typeof v === "string" ? v.trim().slice(0, 120) : "")),
  page: z
    .unknown()
    .optional()
    .transform((v) => {
      const n = Math.floor(Number(v));
      return Number.isFinite(n) && n >= 1 ? n : 1;
    }),
  partnerId: z
    .unknown()
    .optional()
    .transform((v) => (typeof v === "string" && UUID_RE.test(v) ? v : null)),
  state: z
    .unknown()
    .optional()
    .transform((v) =>
      typeof v === "string" && /^[a-z]{2}$/i.test(v.trim()) ? v.trim().toUpperCase() : "",
    ),
  mls: z
    .unknown()
    .optional()
    .transform((v) => (v === "kept" || v === "removed" ? v : ("all" as const))),
});

export type LeadsQuery = z.infer<typeof LeadsQuerySchema>;
