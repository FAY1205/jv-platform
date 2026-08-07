"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { csrfHeaders } from "@/lib/csrf-client";
import { fmtDateTime } from "@/lib/dates";
import { Card, CardHeader, CardTitle, CardBody } from "./Card";
import { Button } from "./Button";
import { Textarea } from "./Textarea";
import { Skeleton } from "./Skeleton";

// NTS/PRN-13: one lead-note stream (the caller's — admin OR partner; the API scopes
// it). Append-with-edit: existing notes save on blur with a saved indicator (NTS-02).
// Save failures surface inline (F-20) and status changes announce via aria-live (a11y F-6).
// Saved notes render as OPEN TEXT (owner testing note #3, 2026-07-14) — a boxed
// textarea per note read like a comment thread; editing now swaps in a textarea
// only on demand (the Edit affordance), same blur-to-save behavior.
interface Note {
  id: string;
  body: string;
  authorRole: string;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
}

// tosHref (audit R-19): this panel is shared by the admin lead dialog AND the partner
// portal dialog. The ToS-recovery link must point at the CALLER's own ToS page — sending
// a partner to the admin /tos (then its admin-only /dashboard redirect) bounces them out
// of the portal into an app they can't use. Portal callers pass "/portal/tos".
export function NotesPanel({
  leadRef,
  title,
  headingLevel = "h3",
  tosHref = "/tos",
}: {
  leadRef: string;
  title: string;
  headingLevel?: "h2" | "h3";
  tosHref?: string;
}) {
  const qc = useQueryClient();
  const key = ["lead-notes", leadRef];
  // `error` is destructured deliberately: without it a failed load renders as "No notes
  // yet.", so a 403 (e.g. the LGL-01 ToS gate) is indistinguishable from an empty list —
  // the reader sees no notes and no reason.
  const { data, isLoading, isError } = useQuery({
    queryKey: key,
    queryFn: () => apiGet<{ notes: Note[] }>(`/api/leads/${leadRef}/notes`),
  });
  const [draft, setDraft] = React.useState("");
  const [savedId, setSavedId] = React.useState<string | null>(null);
  const [addErr, setAddErr] = React.useState<string | null>(null);
  const [editErr, setEditErr] = React.useState<string | null>(null);

  const add = useMutation({
    mutationFn: async (body: string) => {
      const res = await fetch(`/api/leads/${leadRef}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ body }),
      });
      // R-51: surface the server's real reason (rate limit, PRN-13 scope/authorship
      // rejection, validation) instead of a generic string that hides it.
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(b?.message ?? "Could not add note.");
      }
    },
    onMutate: () => setAddErr(null),
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => setAddErr(e.message),
  });

  const edit = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: string }) => {
      const res = await fetch(`/api/leads/${leadRef}/notes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(b?.message ?? "Could not save note.");
      }
    },
    onMutate: () => setEditErr(null),
    onSuccess: (_d, v) => {
      setSavedId(v.id);
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => setEditErr(e.message),
  });

  const notes = data?.notes ?? [];
  const [editingId, setEditingId] = React.useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle as={headingLevel}>{title}</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : isError ? (
          <p role="alert" className="text-sm text-danger">
            Notes could not be loaded. You may need to{" "}
            <a href={tosHref} className="underline">
              accept the current Terms of Service
            </a>
            , or you no longer have access to this lead.
          </p>
        ) : notes.length === 0 ? (
          <p className="text-sm text-text-3">No notes yet.</p>
        ) : (
          notes.map((n) => (
            <div key={n.id} className="flex flex-col gap-1">
              {editingId === n.id ? (
                <Textarea
                  autoFocus
                  defaultValue={n.body}
                  rows={3}
                  aria-label="Edit note"
                  disabled={edit.isPending && edit.variables?.id === n.id}
                  onFocus={() => setSavedId(null)}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== n.body) edit.mutate({ id: n.id, body: v });
                    setEditingId(null);
                  }}
                />
              ) : (
                <p className="whitespace-pre-wrap text-sm text-text">{n.body}</p>
              )}
              {/* The Edit button sits OUTSIDE the live region (pr-review F-2) — controls
                  inside aria-live get re-announced noisily by some screen readers. */}
              <span className="text-xs text-text-3">
                <span aria-live="polite">
                  {fmtDateTime(n.updatedAt)}
                  {n.edited ? " · edited" : ""}
                  {edit.isPending && edit.variables?.id === n.id ? " · Saving…" : savedId === n.id ? " · Saved ✓" : ""}
                </span>
                {editingId !== n.id && (
                  <>
                    {" · "}
                    <button
                      type="button"
                      onClick={() => setEditingId(n.id)}
                      className="rounded font-semibold text-text-2 underline-offset-2 hover:text-text hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-brand-ink"
                    >
                      Edit
                    </button>
                  </>
                )}
              </span>
            </div>
          ))
        )}
        {editErr && (
          <p className="text-xs text-danger" role="alert">
            {editErr}
          </p>
        )}

        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a note…"
            rows={2}
            aria-label="Add a note"
            disabled={add.isPending}
          />
          {addErr && (
            <p className="text-xs text-danger" role="alert">
              {addErr}
            </p>
          )}
          <Button
            variant="secondary"
            size="lg"
            className="w-fit"
            loading={add.isPending}
            disabled={!draft.trim()}
            onClick={() => add.mutate(draft.trim())}
          >
            Add note
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
