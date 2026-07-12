"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { csrfHeaders } from "@/lib/csrf-client";
import { Card, CardHeader, CardTitle, CardBody } from "./Card";
import { Button } from "./Button";
import { Textarea } from "./Textarea";

// NTS/PRN-13: one lead-note stream (the caller's — admin OR partner; the API scopes
// it). Append-with-edit: existing notes save on blur with a saved indicator (NTS-02).
// Save failures surface inline (F-20) and status changes announce via aria-live (a11y F-6).
interface Note {
  id: string;
  body: string;
  authorRole: string;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
}

export function NotesPanel({ leadRef, title, headingLevel = "h3" }: { leadRef: string; title: string; headingLevel?: "h2" | "h3" }) {
  const qc = useQueryClient();
  const key = ["lead-notes", leadRef];
  const { data, isLoading } = useQuery({
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
      if (!res.ok) throw new Error("Could not add note.");
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
      if (!res.ok) throw new Error("Could not save note.");
    },
    onMutate: () => setEditErr(null),
    onSuccess: (_d, v) => {
      setSavedId(v.id);
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => setEditErr(e.message),
  });

  const notes = data?.notes ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle as={headingLevel}>{title}</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        {isLoading ? (
          <p className="text-sm text-text-3">Loading…</p>
        ) : notes.length === 0 ? (
          <p className="text-sm text-text-3">No notes yet.</p>
        ) : (
          notes.map((n) => (
            <div key={n.id} className="flex flex-col gap-1">
              <Textarea
                defaultValue={n.body}
                rows={2}
                aria-label="Edit note"
                disabled={edit.isPending && edit.variables?.id === n.id}
                onFocus={() => setSavedId(null)}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== n.body) edit.mutate({ id: n.id, body: v });
                }}
              />
              <span className="text-xs text-text-3" aria-live="polite">
                {new Date(n.updatedAt).toLocaleString()}
                {n.edited ? " · edited" : ""}
                {savedId === n.id ? " · Saved ✓" : ""}
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
