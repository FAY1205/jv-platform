import * as React from "react";
import { initialsFromEmail } from "@/lib/identity";
import { cn } from "@/lib/cn";

// The 2-letter initials circle, promoted out of AccountMenuTrigger (the account-menu
// button ProfileMenu renders) once the Team roster became a second consumer — the
// FRONTEND_STANDARDS §2 rule (2+ occurrences → primitive). Purely decorative: the
// circle is aria-hidden because every call site renders the identity as text beside it,
// so a screen reader would otherwise hear the initials twice.

export interface AvatarInitialsProps {
  /** Display name when one exists; falls back to the email local-part (`users` has no name column). */
  name?: string | null;
  email: string;
  size?: "xs" | "sm" | "md";
  className?: string;
}

const SIZES: Record<NonNullable<AvatarInitialsProps["size"]>, string> = {
  // C-11: 20px, for identity inside a dense in-dialog list row (TasksPanel's meta row) —
  // it must not change the row height, so it sits under the ~24px DueChip beside it.
  xs: "h-5 w-5 text-step-0",
  sm: "h-7 w-7 text-step-1",
  md: "h-8 w-8 text-step-1",
};

/** Initials from a display name (first letters of the first two words), else the email. */
function initialsFrom(name: string | null | undefined, email: string): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length > 0) {
    return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  }
  return email ? initialsFromEmail(email) : "…";
}

export function AvatarInitials({ name, email, size = "md", className }: AvatarInitialsProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-surface-3 font-semibold text-text-2",
        SIZES[size],
        className,
      )}
    >
      {initialsFrom(name, email)}
    </span>
  );
}
