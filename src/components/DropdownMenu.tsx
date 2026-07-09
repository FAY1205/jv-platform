"use client";

import * as React from "react";
import * as RadixMenu from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/cn";

// DropdownMenu — Radix-backed menu (ADR-0016): keyboard navigation, focus management,
// and portaled positioning built in. Tokened, all states. Consumed by the profile menu
// (WS-7) and row-action menus (WS-5). Thin styled re-exports of the Radix parts.

export const DropdownMenu = RadixMenu.Root;
export const DropdownMenuTrigger = RadixMenu.Trigger;

export const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof RadixMenu.Content>,
  React.ComponentPropsWithoutRef<typeof RadixMenu.Content>
>(function DropdownMenuContent({ className, sideOffset = 6, ...props }, ref) {
  return (
    <RadixMenu.Portal>
      <RadixMenu.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          "anim-pop z-[120] min-w-[12rem] overflow-hidden rounded-md border border-border bg-surface p-1 shadow-md",
          className,
        )}
        {...props}
      />
    </RadixMenu.Portal>
  );
});

export const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof RadixMenu.Item>,
  React.ComponentPropsWithoutRef<typeof RadixMenu.Item> & { destructive?: boolean }
>(function DropdownMenuItem({ className, destructive, ...props }, ref) {
  return (
    <RadixMenu.Item
      ref={ref}
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-sm outline-none",
        "data-[highlighted]:bg-surface-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        destructive ? "text-danger data-[highlighted]:bg-danger-soft" : "text-text",
        className,
      )}
      {...props}
    />
  );
});

export const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof RadixMenu.Separator>,
  React.ComponentPropsWithoutRef<typeof RadixMenu.Separator>
>(function DropdownMenuSeparator({ className, ...props }, ref) {
  return <RadixMenu.Separator ref={ref} className={cn("my-1 h-px bg-border-soft", className)} {...props} />;
});

export const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof RadixMenu.Label>,
  React.ComponentPropsWithoutRef<typeof RadixMenu.Label>
>(function DropdownMenuLabel({ className, ...props }, ref) {
  return <RadixMenu.Label ref={ref} className={cn("px-2 py-1.5 text-xs font-semibold text-text-3", className)} {...props} />;
});
