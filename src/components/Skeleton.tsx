import * as React from "react";
import { cn } from "@/lib/cn";

interface SkeletonProps extends React.HTMLAttributes<HTMLElement> {
  /** C-51: the element to render. `"span"` (rendered `inline-block`, so width/height
   *  utilities still apply) is for placeholders that sit inside PHRASING content —
   *  `<p>`, `<h1>`-`<h6>`, `<span>`, `<label>`, `<a>`, `<button>`. A `<div>` there is
   *  invalid HTML: the parser relocates it out of its parent, which React then reports
   *  as a hydration mismatch. Default stays `"div"`, so no call site has to change. */
  as?: "div" | "span";
}

/** Skeleton — loading placeholder (DSN-03, UXQ-03). Prefer over spinners on data
 *  screens. Honors reduced-motion via the global pulse override. */
export function Skeleton({ as = "div", className, ...rest }: SkeletonProps) {
  const Tag = as;
  return (
    <Tag
      className={cn("bg-surface-3 rounded-md animate-pulse", as === "span" && "inline-block", className)}
      aria-hidden="true"
      {...rest}
    />
  );
}
