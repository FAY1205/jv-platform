// One home for the "search this property on Google" link (T3; previously copied in
// leads-view + lead-dialog, now also the Unmatched table). Pure + client-safe.

/** Google search URL for the non-empty parts, joined with spaces. */
export function googleSearchUrl(parts: readonly (string | null | undefined)[]): string {
  return `https://www.google.com/search?q=${encodeURIComponent(parts.filter(Boolean).join(" "))}`;
}
