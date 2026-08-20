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
  const [prevNonce, setPrevNonce] = React.useState(reopen?.nonce);
  if (reopen && reopen.nonce !== prevNonce) {
    setPrevNonce(reopen.nonce);
    setSession((s) => ({ seed: reopen.text, n: (s?.n ?? 0) + 1 }));
  }

  // Report the transition, never the mount: every field would otherwise announce "not
  // editing" on first paint, and a field mounting beside an open one would clear its gate.
  const reported = React.useRef(editing);
  React.useEffect(() => {
    if (reported.current === editing) return;
    reported.current = editing;
    onEditingChange?.(editing);
  }, [editing, onEditingChange]);

  const open = () => {
    if (!editable || disabled) return;
    setSession((s) => ({ seed: value, n: (s?.n ?? 0) + 1 }));
  };

  if (session) {
    return (
      <div
        className={cn(
          "-mx-1.5 -my-1 flex flex-col gap-1 rounded-lg px-1.5 py-1 outline outline-2 outline-brand",
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
          onCancel={() => setSession(null)}
          onCommit={(next) => {
            setSession(null);
            // An edit that changes nothing must not cost a request (N5-11).
            if (next !== value) onCommit(next);
          }}
        />
        {hint && <span className="text-step-0 text-text-3">{INLINE_HINT}</span>}
      </div>
    );
  }

  const shown = value || EMPTY;
  const text = <span className={cn("text-sm", value ? "text-text" : "italic text-text-3")}>{shown}</span>;

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
            <EditButton label={label} disabled={disabled} onClick={open} floating />
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group -mx-1.5 -my-1 flex min-w-0 flex-col gap-0.5 rounded-lg px-1.5 py-1 transition-colors",
        !disabled && "hover:bg-surface-2 focus-within:bg-surface-2",
        className,
      )}
    >
      <Label>{label}</Label>
      <span className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={open}
          // Enter on the focused field opens it — native button activation, so there is no
          // key handler here to steal Enter from anything already on top (A11Y-04).
          aria-label={`${label}: ${shown}. Edit`}
          className={cn(
            "min-w-0 flex-1 truncate rounded text-left outline-none focus-visible:ring-1 focus-visible:ring-brand-ink",
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
 * + pre-select run exactly once on mount, and the "was this exit a revert?" flag starts
 * clean every time without anyone having to remember to reset it.
 */
function Editor({
  multiline,
  label,
  seed,
  mask,
  onCommit,
  onCancel,
}: {
  multiline: boolean;
  label: string;
  seed: string;
  mask?: (raw: string) => string;
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = React.useState(seed);
  // Esc must beat the blur it causes: leaving the field fires both, and only the keystroke
  // knows the exit was a revert. A ref, not state — it is read in the same tick.
  const cancelled = React.useRef(false);
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
      cancelled.current = true;
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key !== "Enter") return;
    // A textarea's Enter is a newline; ⌘/Ctrl+Enter commits, and so does clicking away.
    if (multiline && !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    onCommit(draft);
  };
  const onBlur = () => {
    if (!cancelled.current) onCommit(draft);
  };
  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDraft(mask ? mask(e.target.value) : e.target.value);
  const cls = "w-full border-0 bg-transparent p-0 text-sm text-text outline-none";

  return multiline ? (
    <textarea
      ref={ref as React.RefObject<HTMLTextAreaElement>}
      aria-label={label}
      rows={3}
      value={draft}
      onChange={onChange}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      className={`${cls} resize-y`}
    />
  ) : (
    <input
      ref={ref as React.RefObject<HTMLInputElement>}
      aria-label={label}
      value={draft}
      onChange={onChange}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      className={cls}
    />
  );
}

function EditButton({ label, disabled, onClick, floating }: { label: string; disabled: boolean; onClick: () => void; floating?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={`Edit ${label}`}
      className={cn(
        "grid h-6 w-6 place-items-center rounded text-text-3 outline-none transition-[opacity,color]",
        "hover:text-text focus-visible:ring-1 focus-visible:ring-brand-ink",
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

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
