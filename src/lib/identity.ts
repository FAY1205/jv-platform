// WS-7: derive display initials from an email local-part. `users` has no name column
// yet, so the profile menu + Profile settings show the email and an avatar built from it.
export function initialsFromEmail(email: string): string {
  const local = (email.split("@")[0] ?? "").trim();
  const parts = local.split(/[.\-_+]/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0]).join("");
  return (letters || email.trim()[0] || "?").toUpperCase();
}
