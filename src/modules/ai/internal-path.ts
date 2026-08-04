// Shared client+server deep-link guard (PRN-10/AIA-05). Extracted to a leaf module so the
// client widget can import it WITHOUT value-importing the system-prompt module (which holds
// buildSystemPrompt/SCREENS/HOW_TO — server-only copy that must not reach the client bundle).
const INTERNAL_PATH_RE = /^\/(dashboard|leads|unmatched|imports|partners|coverage|activity|rules|settings)(\/|$)/;
export function isInternalPath(href: string): boolean {
  return INTERNAL_PATH_RE.test(href) && !href.startsWith("//");
}
