import * as React from "react";
import { PortalShell } from "@/components";

// WP-F.1: every /portal/* page renders inside the mobile PortalShell (top bar + bottom
// tabs). The shell itself renders bare on the pre-auth login/tos routes.
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell>{children}</PortalShell>;
}
