// One home for the lead record's combined address line (N5E-06). Pure + client-safe: the
// admin record and its read-scoped portal twin must render the SAME string, and the four
// parts arrive in the same order `googleSearchUrl` already takes them in.

/**
 * `"20443 Fleetwood Dr, Harper Woods, MI 48225"` from the four stored columns, in
 * `[street, city, state, zip]` order. Empty parts drop out with their separator, so a lead
 * with only a city reads "Harper Woods" rather than ", Harper Woods, ".
 *
 * State and ZIP are ONE comma segment on purpose: they are read as a single place designator,
 * and "MI, 48225" reads as two of them.
 */
export function addressLine(parts: readonly (string | null | undefined)[]): string {
  const [street, city, state, zip] = parts.map((p) => (p ?? "").trim());
  const region = [state, zip].filter(Boolean).join(" ");
  return [street, city, region].filter(Boolean).join(", ");
}
