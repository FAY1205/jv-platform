import { PartnersView } from "./partners-view";

// N3C-04/C-56 — server shell: reads `?edit=<id>` (the partner-detail "Edit partner" deep
// link) and hands it to the client view as a prop. Deliberately NOT a
// useSearchParams()+Suspense client page — that construct froze hydration on this app's
// routes (Next 16); a server component prop is the boring, reliable path, and it is the
// pattern the sibling leads/page.tsx already follows.
//
// The id is passed through as an opaque string: it is only ever compared against ids the
// roster already returned (a value that matches nothing simply opens nothing), so it never
// reaches a query. Everything the edit form then writes goes through the scoped API.
export const dynamic = "force-dynamic";

export default async function PartnersPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string | string[] }>;
}) {
  const { edit } = await searchParams;
  return <PartnersView initialEditId={typeof edit === "string" ? edit : null} />;
}
