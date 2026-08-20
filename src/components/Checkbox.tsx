"use client";

import * as React from "react";
import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { cn } from "@/lib/cn";

// Checkbox — Radix-backed (ADR-0016), replacing the ad-hoc `<input type=checkbox>` sites
// (F-62). Controlled `checked` / `onCheckedChange`, an optional bound label, tokened box
// + check indicator, and a visible focus-visible ring.

export interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /**
   * N6-52: TRI-STATE. `true` draws the dash and reports `aria-checked="mixed"` — "some of
   * what this box governs is selected". Takes precedence over `checked` for DISPLAY only;
   * activating a mixed box still calls `onCheckedChange`, and the caller decides what a
   * click on a partial selection means (the leads header checkbox selects the rest of the
   * page). Kept as a separate prop rather than widening `checked` to Radix's
   * `boolean | "indeterminate"` so the ~30 existing call sites are untouched.
   */
  indeterminate?: boolean;
  label?: React.ReactNode;
  /** NATIVE disabled — use for TRANSIENT states (a request in flight). Removes the control
   *  from the tab order, so never use it to express a standing permission: the reason a
   *  control is inert must stay reachable by keyboard (see `ariaDisabled`). */
  disabled?: boolean;
  /**
   * PERMANENT inert state (a11y F-1, team-page precedent): the box stays focusable and keeps
   * its accessible name, reports `aria-disabled`, and swallows activation — so a keyboard
   * user can tab to it and hear the tooltip that explains why. Pair it with a Tooltip and
   * the `aria-describedby` pass-through below.
   */
  ariaDisabled?: boolean;
  id?: string;
  className?: string;
  /** Accessible label when no visible `label` is provided. */
  ariaLabel?: string;
  /** Pass-through so a wrapping Tooltip's bubble id lands on the CONTROL a screen reader
   *  focuses, not on an outer label element (a11y F-2). Tooltip clones this onto its direct
   *  child, so this component must be that child. */
  "aria-describedby"?: string;
}

/** C-52 hit-area expansion: -6px from the box's PADDING box (what absolute insets resolve
 *  against), less the 1px border = 5px of invisible reach per side, so the 16px box hit-tests
 *  at 26px — above the WCAG 2.5.8 (AA) 24px minimum, measured in the browser. Deliberately not
 *  larger: 5px stays inside the 8px `gap-2` a labelled checkbox uses and inside the row gaps of
 *  the stacked checkbox lists in settings, so two boxes never steal each other's clicks.
 *  Exported so a test can assert the contract without re-spelling the classes. */
export const CHECKBOX_HIT_AREA = "relative before:absolute before:-inset-1.5 before:content-['']";

export function Checkbox({
  checked,
  onCheckedChange,
  indeterminate = false,
  label,
  disabled,
  ariaDisabled,
  id,
  className,
  ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: CheckboxProps) {
  const autoId = React.useId();
  const boxId = id ?? autoId;
  const box = (
    <RadixCheckbox.Root
      id={boxId}
      checked={indeterminate ? "indeterminate" : checked}
      // aria-disabled means inert: the control is controlled, so swallowing the change here
      // is the whole block — pointer, Space and Enter all arrive through this one callback.
      onCheckedChange={(v) => {
        if (ariaDisabled) return;
        onCheckedChange(v === true);
      }}
      disabled={disabled}
      aria-disabled={ariaDisabled || undefined}
      aria-label={label ? undefined : ariaLabel}
      aria-describedby={ariaDescribedBy}
      className={cn(
        "grid h-4 w-4 place-items-center rounded border outline-none transition-colors",
        // C-52 (WCAG 2.5.8): the visual box stays 16px — desktop tables are dense — while an
        // INVISIBLE, centered 26px hit area rides on a pseudo-element. Layout-neutral by
        // construction (absolute, out of flow): no neighbor moves, and at the two sites that
        // already wrap this in a 44px <label> (TasksPanel, MyTasksList) it is simply inert
        // hit area inside a larger one — no double-padding, no shift.
        CHECKBOX_HIT_AREA,
        "focus-visible:ring-1 focus-visible:ring-brand-ink",
        "data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:hover:bg-brand-strong",
        // A mixed box is filled like a checked one — it is a live selection, not an empty
        // control; the DASH is what distinguishes it (and aria-checked="mixed" for AT).
        "data-[state=indeterminate]:border-brand data-[state=indeterminate]:bg-brand data-[state=indeterminate]:hover:bg-brand-strong",
        "data-[state=unchecked]:border-border data-[state=unchecked]:bg-surface data-[state=unchecked]:hover:border-text-3",
        "disabled:cursor-not-allowed disabled:opacity-60",
        // Same treatment as native disabled, minus the tab-order removal.
        ariaDisabled && "cursor-not-allowed opacity-60 data-[state=checked]:hover:bg-brand data-[state=indeterminate]:hover:bg-brand data-[state=unchecked]:hover:border-border",
        className,
      )}
    >
      <RadixCheckbox.Indicator className="text-brand-contrast">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {indeterminate ? <path d="M5 12h14" /> : <path d="M20 6 9 17l-5-5" />}
        </svg>
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );

  if (!label) return box;
  return (
    <label htmlFor={boxId} className={cn("inline-flex cursor-pointer items-center gap-2 text-sm text-text", disabled && "cursor-not-allowed opacity-60")}>
      {box}
      {label}
    </label>
  );
}
