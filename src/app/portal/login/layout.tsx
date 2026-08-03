import type { Metadata } from "next";
import { APP_NAME } from "@/lib/app";

// Distinct tab title (mirrors the admin /login title) so the two sign-in
// surfaces are self-identifying. The client login page cannot export metadata,
// so the segment layout carries it. Renders bare — PortalShell already detects
// the pre-auth login route.
export const metadata: Metadata = { title: `Partner portal sign-in — ${APP_NAME}` };

export default function PortalLoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
