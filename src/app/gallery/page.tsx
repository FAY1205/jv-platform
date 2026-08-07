import { notFound } from "next/navigation";
import { isProduction } from "@/lib/env";
import GalleryView from "./gallery-view";

// SEC-07 / audit R-32: the component gallery is a dev-only surface. Like /dev/emails it
// must not exist in production — client-side concealment (a NODE_ENV menu check) is not a
// gate. This server component hard-404s it in prod before GalleryView ever renders.
export default function GalleryPage() {
  if (isProduction) notFound();
  return <GalleryView />;
}
