import { redirect } from "next/navigation";
import { getServerScope } from "@/lib/scope-context";
import { AssistantMount } from "@/components/assistant/AssistantMount";
import { GlobalSearchOverlay } from "@/components/GlobalSearch";

// Parity #4: the ONE admin role gate. Every admin page lives in this route group
// (URLs are unchanged — route groups are invisible), so a partner who types an
// admin URL is sent to their portal instead of a broken admin shell over 403 data.
// Signed-out visitors fall through — the proxy owns the login redirect, and auth
// resolution failures must never mask a page (same contract as dashboard/layout).
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let target: string | null = null;
  try {
    const scope = await getServerScope();
    if (scope.role === "partner") target = "/portal/dashboard";
  } catch (e) {
    // redirect() signals by throwing — never swallow it; anything else (unauthenticated,
    // unprovisioned, transient) falls through to the page and the proxy/API guards.
    if (typeof e === "object" && e !== null && "digest" in e) throw e;
  }
  if (target) redirect(target);
  // The assistant mounts here (persistent across admin navigation), not per-page in
  // AppShell — so the panel stays open and the transcript survives as you move around.
  // SRCH-02: the global search overlay mounts HERE, beside the assistant — once for the
  // whole admin app, so Ctrl/⌘-K works on the few admin pages that don't render AppShell
  // and typing in it never re-renders the page behind it (§6.17).
  return (
    <>
      {children}
      <GlobalSearchOverlay />
      <AssistantMount />
    </>
  );
}
