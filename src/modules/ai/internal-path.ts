// Shared client+server deep-link guard (PRN-10/AIA-05). Extracted to a leaf module so the
// client widget can import it WITHOUT value-importing the system-prompt module (which holds
// buildSystemPrompt/SCREENS/HOW_TO — server-only copy that must not reach the client bundle).
// The segment must be followed by "/", "?" (a query string, e.g. the P-1 lead deep link
// /leads?open=LD-…), or end-of-string — never bare (so /leadsX is rejected). Missing the
// "?" branch is why the get_lead citation used to degrade from a clickable pill to a plain
// chip: its path is /leads?open=<ref>, which the "/"-or-end form didn't accept.
const INTERNAL_PATH_RE = /^\/(dashboard|leads|unmatched|imports|partners|coverage|activity|rules|settings)([/?]|$)/;
export function isInternalPath(href: string): boolean {
  return INTERNAL_PATH_RE.test(href) && !href.startsWith("//");
}
