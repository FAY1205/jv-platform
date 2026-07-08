"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { csrfHeaders } from "@/lib/csrf-client";
import { Card, CardHeader, CardTitle, CardBody } from "./Card";
import { Button } from "./Button";

// NTS/PRN-13: one lead-note stream (the caller's — admin OR partner; the API scopes
// it). Append-with-edit: existing notes save on blur with a saved indicator (NTS-02).
interface Note {
  id: string;
  body: string;
  authorRole: string;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
}

const box =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-3 focus:border-brand focus:outline-none";

export function NotesPanel({ leadRef, title }: { leadRef: string; title: string }) {
  const qc = useQueryClient();
  const key = ["lead-notes", leadRef];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => apiGet<{ notes: Note[] }>(`/api/leads/${leadRef}/notes`),
  });
  const [draft, setDraft] = React.useState("");
  const [savedId, setSavedId] = React.useState<string | null>(null);

  const add = useMutation({
    mutationFn: async (body: string) => {
      const res = await fetch(`/api/leads/${leadRef}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) throw new Error("Could not add note.");
    },
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: key });
    },
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
    onSuccess: (_d, v) => {
      setSavedId(v.id);
      qc.invalidateQueries({ queryKey: key });
    },
  });

  const notes = data?.notes ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        {isLoading ? (
          <p className="text-sm text-text-3">Loading…</p>
        ) : notes.length === 0 ? (
          <p className="text-sm text-text-3">No notes yet.</p>
        ) : (
          notes.map((n) => (
            <div key={n.id} className="flex flex-col gap-1">
              <textarea
                defaultValue={n.body}
                rows={2}
                className={box}
                aria-label="Edit note"
                onFocus={() => setSavedId(null)}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== n.body) edit.mutate({ id: n.id, body: v });
                }}
              />
              <span className="text-xs text-text-3">
                {new Date(n.updatedAt).toLocaleString()}
                {n.edited ? " · edited" : ""}
                {savedId === n.id ? " · Saved ✓" : ""}
              </span>
            </div>
          ))
        )}

        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a note…"
            rows={2}
            className={box}
            aria-label="Add a note"
          />
          <Button
            variant="secondary"
            size="sm"
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
