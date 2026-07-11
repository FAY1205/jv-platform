import * as React from "react";
import { cn } from "@/lib/cn";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Adds a hover lift — use for cards that are themselves a link/button target. */
  interactive?: boolean;
}

export function Card({ className, interactive = false, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        // Minimal aesthetic: generous radius, a hairline for definition, and a
        // soft resting elevation (shadow token — consistent across the app).
        "bg-surface border border-border-soft rounded-2xl shadow-sm",
        "transition-[background-color,border-color,box-shadow,transform] duration-200",
        interactive && "hover:-translate-y-0.5 hover:shadow-md",
        className,
      )}
      {...rest}
    />
  );
}

export function CardHeader({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 px-5 py-4 border-b border-border-soft flex-wrap",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardTitle({
  as: Tag = "h3",
  className,
  ...rest
}: React.HTMLAttributes<HTMLHeadingElement> & { as?: "h2" | "h3" }) {
  // Default h3 keeps every existing call site unchanged; pages pass `as="h2"` where the
  // card is a direct section under the page <h1> (avoids an h1→h3 heading skip).
  return <Tag className={cn("text-sm font-semibold", className)} {...rest} />;
}

export function CardBody({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...rest} />;
}
