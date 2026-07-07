import * as React from "react";
import { cn } from "@/lib/cn";

/** Skeleton — loading placeholder (DSN-03, UXQ-03). Prefer over spinners on data
 *  screens. Honors reduced-motion via the global pulse override. */
export function Skeleton({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("bg-surface-3 rounded-md animate-pulse", className)}
      aria-hidden="true"
      {...rest}
    />
  );
}
