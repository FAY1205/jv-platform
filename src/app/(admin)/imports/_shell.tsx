// Route-private helpers for the admin run views (underscore keeps it out of routing).
// The app chrome now lives in the shared <AppShell> component; only formatting
// helpers remain here.

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
