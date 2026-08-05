// CWE-601 (audit R-29): a post-login redirect target read from the URL is
// attacker-controlled. Honor only a single-slash-rooted, same-origin PATH; reject
// protocol-relative (`//host`, `/\host`) and absolute URLs in favor of the fallback.
export function safeNextPath(raw: string | null | undefined, fallback: string): string {
  if (!raw || !raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw;
}
