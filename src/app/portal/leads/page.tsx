import { PortalLeadsView } from "./portal-leads-view";

// Server shell (mirrors the admin leads page): reads ?open=<ref> and hands it to the client
// gate, which mounts one of the two lists (mobile card list < lg, admin-style table >= lg —
// see the breakpoint note in portal-leads-view / leads-desktop) plus the shared lead dialog.
// A server component prop, not useSearchParams()+Suspense — that construct froze hydration
// on the admin route (Next 16), so the portal follows the same boring, reliable path.
export const dynamic = "force-dynamic";

export default async function PortalLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string | string[] }>;
}) {
  const { open } = await searchParams;
  return <PortalLeadsView initialOpenRef={typeof open === "string" ? open : null} />;
}
