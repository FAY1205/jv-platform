import * as React from "react";
import { Badge } from "./Badge";

// Phase C (team-page-spec §7): the ONE rendering of a staff role. A thin Badge wrapper —
// the pill always carries the role WORD, so the tier is never conveyed by fill alone
// (PRN-14). `owner` is a seat property (tenants.owner_user_id), not a `role` enum value;
// the roster passes it for the workspace owner's row.

export type BadgeRole = "owner" | "admin" | "member" | "viewer";

const VARIANTS = {
  owner: "zip", // brand-soft
  admin: "state", // info-soft
  member: "neutral",
  viewer: "outline",
} as const;

const LABELS: Record<BadgeRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

export interface RoleBadgeProps {
  role: BadgeRole;
  className?: string;
}

export function RoleBadge({ role, className }: RoleBadgeProps) {
  return (
    <Badge variant={VARIANTS[role]} className={className}>
      {LABELS[role]}
    </Badge>
  );
}
