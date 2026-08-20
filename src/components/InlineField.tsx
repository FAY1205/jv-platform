"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./Button";
import { ClampedText } from "./ClampedText";

// InlineField (N5-10) — a labelled value that edits where it sits. The whole-record Edit
// form retires with it: there is no save button, no draft that outlives the field, and so
// nothing that can accumulate unsaved (N5-13).
//
// The contract is deliberately narrow — this primitive owns the INTERACTION (open, mask,
// commit, revert) and nothing else. The caller owns the value, the request, the optimistic
// paint, and the rollback, because only the caller knows what a save means. That split is
// also what makes N5-15 hold for free: the draft lives here, in state a refetch of the
// caller's data cannot touch, so a save landing for one field can never overwrite another
// field's half-typed text.
//
// State matrix (§6.17): rest / hover / focus-visible / editing / saving / disabled. The
// error state is the CALLER's — a failed save rolls `value` back and toasts; `reopen` is how
// that toast's retry puts the attempted text back into the field.

/** Commit-on-blur copy, shown under the input on the first edit of a session (N5-10). */
export const INLINE_HINT = "Enter or click away saves · Esc cancels";
/** WP-UX-7: an empty value is DEMOTED to a muted line rather than an em-dash at full
 *  field prominence — four dashes at full weight made a routed lead read as broken. */
const EMPTY = "Not provided";

export interface InlineFieldProps {
  /** The field's name — the visible label AND the input's accessible name (FRM-04). */
  label: string;
  /** The committed value: server truth, or the optimistic value while a save is in flight. */
  value: string;
  /**
   * Enter (or blur) with a CHANGED value. Never fires for an unchanged one — an inline edit
   * that changes nothing must not cost a request (N5-11).
   */
  onCommit: (next: string) => void;
  /** False for a field that is never editable (Received, Routed by): plain labelled text. */
  editable?: boolean;
  /** Temporarily not editable (a partial record, a removed lead): the affordance is muted. */
  disabled?: boolean;
  /** Boxed textarea rather than a single line (Source notes). Enter is a newline there. */
  multiline?: boolean;
  /** A save for THIS field is in flight — the optimistic value paints with a quiet spinner. */
  saving?: boolean;
  /** Show the commit-on-blur hint under the input (the caller shows it on the first edit). */
  hint?: boolean;
  /** Per-keystroke mask, e.g. State's two uppercase letters (N5-12). */
  mask?: (raw: string) => string;
  /**
   * DSN-02 ledger identity: the value is a NUMBER-shaped string (phone, ZIP) and wears the
   * tabular monospace treatment — in the rest state AND in the editor, so the digits do not
   * shift under the caret the moment the field opens.
   */
  numeric?: boolean;
  /**
   * N5-11 retry: a NEW `nonce` re-opens the field seeded with `text`. A nonce rather than a
   * bare string because retrying the same text twice has to reopen the field twice.
   */
  reopen?: { text: string; nonce: number } | null;
  /** Rendered after the value in the rest state, OUTSIDE the editable target (Google link). */
  trailing?: React.ReactNode;
  /** Reported up so the record can gate ↑/↓ and Esc precedence (N5-13/N5-30). */
  onEditingChange?: (editing: boolean) => void;
  className?: string;
}

export function InlineField({
  label,
  value,
  onCommit,
  editable = true,
  disabled = false,
  multiline = false,
  saving = false,
  hint = false,
  mask,
  numeric = false,
  reopen = null,
  trailing,
  onEditingChange,
  className,
}: InlineFieldProps) {
  // An editing SESSION, or null. The draft itself lives in `Editor`, whose lifetime is
  // exactly the session's — which is what makes N5-15 structural rather than careful: a
  // refetch changes `value`, and `value` is only ever read when a session STARTS.
  // `n` is the session counter, so a retry landing on an already-open field remounts the
  // editor onto the attempted text rather than leaving the old draft in place.
  const [session, setSession] = React.useState<{ seed: string; n: number } | null>(null);
  const editing = session !== null;

  // N5-11 retry. Adjust-during-render (this codebase's seeding idiom) rather than an effect:
  // the field has to be open already in the commit that follows the retry click.
  //
  // The baseline starts UNDEFINED rather than at the incoming nonce, so a field that MOUNTS
  // with a `reopen` already on it opens too. `reopen` means "open this field on this text",
  // and N5E-06's address group has no other way to say it: its four sub-fields do not exist
  // until the group expands, so the seed can only ever reach them at mount.
  const [prevNonce, setPrevNonce] = React.useState<number | undefined>(undefined);
  if (reopen && reopen.nonce !== prevNonce) {
    setPrevNonce(reopen.nonce);
    setSession((s) => ({ seed: reopen.text, n: (s?.n ?? 0) + 1 }));
  }

  // The control the session was opened FROM, so focus can go back to it (N5-30). One ref for
  // both rest shapes: only one of them is ever mounted.
  const restRef = React.useRef<HTMLButtonElement>(null);
  /** Ties the hint to the input (A11Y / FRM-04) instead of leaving it as loose nearby text. */
  const hintId = React.useId();

  // Report the transition, never the mount: every field would otherwise announce "not
  // editing" on first paint, and a field mounting beside an open one would clear its gate.
  const reported = React.useRef(editing);
  React.useEffect(() => {
    if (reported.current === editing) return;
    const closed = reported.current && !editing;
    reported.current = editing;
    onEditingChange?.(editing);
    if (!closed) return;
    // N5-30 (WCAG 2.4.3 / 3.2.1): closing a session UNMOUNTS the focused input, and focus
    // falls to <body> — a keyboard user is dropped at the top of the document with the record
    // they were editing nowhere near the caret. Put focus back on the control they opened.
    //
    // Only when it actually fell, though: committing by CLICKING another control leaves focus
    // on that control, and yanking it back would be a worse bug than the one being fixed.
    // `document.activeElement` is already settled here — effects run after the DOM mutation.
    const active = typeof document === "undefined" ? null : document.activeElement;
    if (!active || active === document.body) restRef.current?.focus();
  }, [editing, onEditingChange]);

  const open = () => {
    if (!editable || disabled) return;
    setSession((s) => ({ seed: value, n: (s?.n ?? 0) + 1 }));
  };

  if (session) {
    return (
      <div
        className={cn(
          // brand-INK, not raw brand: --brand is the marigold FILL and lands under 3:1 against
          // surface, which WCAG 1.4.11 requires of a focus/state indicator. Every sibling ring
          // in this codebase (`focus-visible:ring-brand-ink`) already uses the ink tone.
          "-mx-1.5 -my-1 flex flex-col gap-1 rounded-lg px-1.5 py-1 outline outline-2 outline-brand-ink",
          className,
        )}
      >
        <Label>{label}</Label>
        <Editor
          key={session.n}
          multiline={multiline}
          label={label}
          seed={session.seed}
          mask={mask}
          numeric={numeric}
          describedBy={hint ? hintId : undefined}
          onCancel={() => setSession(null)}
          onCommit={(next) => {
            setSession(null);
            // An edit that changes nothing must not cost a request (N5-11).
            if (next !== value) onCommit(next);
          }}
        />
        {hint && (
          <span id={hintId} className="text-step-0 text-text-3">
            {INLINE_HINT}
          </span>
        )}
      </div>
    );
  }

  const shown = value || EMPTY;
  // DSN-02: `num` only ever rides a real value — "Not provided" is prose, not a figure.
  const text = (
    <span className={cn("text-sm", numeric && value && "num", value ? "text-text" : "italic text-text-3")}>{shown}</span>
  );

  // Never editable: the same shape with no affordance at all, so the grid stays even.
  if (!editable) {
    return (
      <div className={cn("-mx-1.5 -my-1 flex min-w-0 flex-col gap-0.5 px-1.5 py-1", className)}>
        <Label>{label}</Label>
        <span className="flex min-w-0 items-center gap-2">
          {text}
          {trailing}
        </span>
      </div>
    );
  }

  // Source notes: the boxed block VP-4c gave it, keeping ClampedText's "Show more" — so the
  // edit affordance is a corner pencil rather than wrapping the box in a button (a button
  // cannot contain ClampedText's toggle, and a click handler on the box would be a control
  // with no keyboard path).
  if (multiline) {
    return (
      <div className={cn("flex min-w-0 flex-col gap-1", className)}>
        <Label>{label}</Label>
        <div className="group relative rounded-lg border border-border-soft bg-surface-2 px-3.5 py-3 pr-10">
          {value ? <ClampedText>{value}</ClampedText> : text}
          <span className="absolute right-2 top-2 flex items-center gap-1.5">
            {saving && <Spinner size={12} />}
            <EditButton buttonRef={restRef} label={label} disabled={disabled} onClick={open} floating />
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group -mx-1.5 -my-1 flex min-w-0 flex-col gap-0.5 rounded-lg px-1.5 py-1 transition-colors",
        // §6.17 state matrix: the row is the hover/focus target, so it carries the PRESSED
        // step too (NotificationsPage's row recipe: hover surface-2 → active surface-3).
        // `active:` on the ROW works even though the press lands on the button inside it —
        // CSS :active applies to the pressed element and every ancestor of it.
        !disabled && "hover:bg-surface-2 focus-within:bg-surface-2 active:bg-surface-3",
        className,
      )}
    >
      <Label>{label}</Label>
      <span className="flex min-w-0 items-center gap-2">
        <button
          ref={restRef}
          type="button"
          disabled={disabled}
          onClick={open}
          // Enter on the focused field opens it — native button activation, so there is no
          // key handler here to steal Enter from anything already on top (A11Y-04).
          aria-label={`${label}: ${shown}. Edit`}
          className={cn(
            // N5E-05: WRAPS, never truncates. `truncate` is what put "mykelvinlove@gmai…" on
            // the owner's screen — and an ellipsized email or street address is precisely the
            // value they opened the record to read or copy. The span grid gives the long
            // fields their own rows now, so a wrap is the rare case rather than the norm.
            "min-w-0 flex-1 rounded text-left [overflow-wrap:anywhere] outline-none focus-visible:ring-1 focus-visible:ring-brand-ink",
            disabled ? "cursor-default opacity-60" : "cursor-text",
          )}
        >
          {text}
        </button>
        {/* Saving (N5-10): the optimistic value is already painted; this is the quiet
            "still in flight" mark. The toast, not this, is what reports a failure. */}
        {saving && <Spinner size={12} />}
        {!disabled && !saving && (
          <PencilIcon className="shrink-0 text-text-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" />
        )}
        {trailing}
      </span>
    </div>
  );
}

/**
 * One editing session: the draft, the commit/revert keys, and the focus. Its own component
 * so all three share the session's lifetime — the draft cannot outlive the open field, focus
 * + pre-select run exactly once on mount, and the "has this session exited?" latch starts
 * clean every time without anyone having to remember to reset it.
 */
function Editor({
  multiline,
  label,
  seed,
  mask,
  numeric,
  describedBy,
  onCommit,
  onCancel,
}: {
  multiline: boolean;
  label: string;
  seed: string;
  mask?: (raw: string) => string;
  numeric?: boolean;
  describedBy?: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = React.useState(seed);
  // ONE exit per session, whichever gesture gets there first — a STRUCTURAL guarantee, not a
  // per-path guard, because a second exit is a second `onCommit`: a duplicate PATCH, and under
  // READ COMMITTED a second `lead.edited` audit row, hence a duplicate "Details updated"
  // timeline entry (N5-14). Three gestures reach the exit and they overlap:
  //
  //  1. Esc reverts — and fires the blur it causes. Only the keystroke knows it was a revert.
  //  2. Enter commits — and unmounts the focused input, which browsers may answer with a
  //     phantom blur that would commit the same draft again.
  //  3. Blur commits.
  //
  // ⚠️ NOT OBSERVABLE FROM jsdom — mutation-verified, not assumed: replacing this latch with a
  // bare `run()` leaves every test in tests/unit/components/inline-field.test.tsx green. The
  // reason is the same for all three paths: closing the session unmounts the input, and jsdom
  // fires no blur on removal, so the competing second gesture never happens there. Whether a
  // real browser fires it is browser-dependent (Firefox historically does, Chrome does not)
  // and it may or may not reach React's delegated listener — which is exactly why this is a
  // latch and not a bet. `tests/e2e/admin-inline-edit.spec.ts` counts the PATCHes in a real
  // browser; ENGINEERING_STANDARDS §8 carries the rule for the class. Do not delete this on
  // the strength of a green unit run — the unit suite cannot see it either way.
  //
  // A ref, not state: it is written and read within the same tick, before any re-render.
  const settled = React.useRef(false);
  /** Run the session's exit exactly once. Every path out goes through here. */
  const exit = (run: () => void) => {
    if (settled.current) return;
    settled.current = true;
    run();
  };
  const ref = React.useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  React.useEffect(() => {
    // The value arrives pre-selected so typing replaces it (N5-10) — the common correction
    // is a whole new value, not an edit within the old one.
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      // N5-13: the first Esc belongs to the edit, the next one closes the panel. The panel
      // is told to hold its own Esc (SidePanel `escapeHeld`) because Radix listens in the
      // CAPTURE phase, ahead of this handler — preventDefault here would arrive too late.
      e.stopPropagation();
      exit(onCancel);
      return;
    }
    if (e.key !== "Enter") return;
    // A textarea's Enter is a newline; ⌘/Ctrl+Enter commits, and so does clicking away.
    if (multiline && !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    exit(() => onCommit(draft));
  };
  const onBlur = () => exit(() => onCommit(draft));
  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDraft(mask ? mask(e.target.value) : e.target.value);
  const cls = cn("w-full border-0 bg-transparent p-0 text-sm text-text outline-none", numeric && "num");

  return multiline ? (
    <textarea
      ref={ref as React.RefObject<HTMLTextAreaElement>}
      aria-label={label}
      aria-describedby={describedBy}
      rows={3}
      value={draft}
      onChange={onChange}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      className={cn(cls, "resize-y")}
    />
  ) : (
    <input
      ref={ref as React.RefObject<HTMLInputElement>}
      aria-label={label}
      aria-describedby={describedBy}
      value={draft}
      onChange={onChange}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      className={cls}
    />
  );
}

function EditButton({
  label,
  disabled,
  onClick,
  floating,
  buttonRef,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  floating?: boolean;
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={`Edit ${label}`}
      className={cn(
        "relative grid h-6 w-6 place-items-center rounded text-text-3 outline-none transition-[opacity,color,transform]",
        "hover:text-text focus-visible:ring-1 focus-visible:ring-brand-ink",
        // C-52 (WCAG 2.5.8), the SidePanel ✕ recipe: this 24px square is the ONLY way into
        // editing Source notes, so the REACH grows past the glyph rather than the glyph
        // growing past its layout. 24 + 2×6 = 36px, and 24 + 2×10 = 44px on coarse pointers.
        "before:absolute before:-inset-1.5 before:content-[''] pointer-coarse:before:-inset-2.5",
        // §6.17: the pressed step every other icon button in this codebase carries.
        !disabled && "active:scale-95",
        disabled ? "cursor-default opacity-40" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        floating && "bg-surface-2",
      )}
    >
      <PencilIcon />
    </button>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-step-1 font-semibold uppercase tracking-wide text-text-3">{children}</span>;
}

/** Exported for N5E-06: the admin record's combined address line is an edit affordance that
 *  is NOT an InlineField (it opens a group of four), and it has to wear the same mark as
 *  every other editable value or it reads as a link. */
export function PencilIcon({ className }: { className?: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
