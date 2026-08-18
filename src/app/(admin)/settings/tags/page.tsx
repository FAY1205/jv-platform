"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiMutate } from "@/lib/api";
import { TAG_PALETTE } from "@/lib/tokens/tokens";
import { tagDotClass } from "@/lib/tag-chip";
import { cn } from "@/lib/cn";
import { useTags, TAGS_KEY, atTagLimit, type TagRow } from "@/lib/tags-client";
import {
  Button, Card, CardBody, CardHeader, CardTitle, Dialog, EmptyState, IconButton, Input,
  QueryErrorState, Skeleton, Table, TBody, Td, Th, THead, Tr, TagChip, useToast,
} from "@/components";
import { SettingsSection } from "../settings-section";

// TAG-06 — Settings → Tags: the tenant's tag manager. Usage counts, rename, recolor from the
// fixed palette, and a confirm-gated delete that says how many leads it will detach.
//
// DM-08 is N/A here (recorded in the module header too): tags are tenant-editable workflow
// labels, not RULES — no rules snapshot is produced by a rename/recolor/delete, because
// nothing about routing or MLS verdicts depends on a tag.
//
// §6.17: every row is server data read from the query cache — nothing is copied into
// component state except the row currently being EDITED (a draft, which is UI state).

/** Ties the at-cap explanation to the name input (aria-describedby). */
const TAG_LIMIT_HELP_ID = "tag-limit-help";

export default function TagsSettingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const tagsQ = useTags();
  const tags = tagsQ.data?.tags ?? [];
  // TAG-08/TAG-09: the cap and the tenant's true count both come from the roster payload —
  // this page never hardcodes the number it prints.
  const atLimit = atTagLimit(tagsQ.data);
  // A legacy/raced overflow (total > what the LIMIT returned) is stated rather than hidden.
  const clamped = tagsQ.data ? tagsQ.data.total > tags.length : false;

  /** The row whose name is being edited, plus its draft text. null = nothing in edit mode. */
  const [editing, setEditing] = React.useState<{ id: string; name: string } | null>(null);
  /** The row queued for deletion — the dialog reads its live usage count from this row. */
  const [confirmDelete, setConfirmDelete] = React.useState<TagRow | null>(null);
  const [newName, setNewName] = React.useState("");
  /** Chosen create colour, or null = "Auto" (server assigns the next palette slot, round-robin). */
  const [newColor, setNewColor] = React.useState<(typeof TAG_PALETTE)[number] | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: TAGS_KEY });
    // A rename/recolor/delete changes what every leads surface renders (PRN-15: re-read,
    // never patch a cached chip).
    qc.invalidateQueries({ queryKey: ["leads"] });
    qc.invalidateQueries({ queryKey: ["leads-board"] });
  };

  const create = useMutation({
    // An omitted color lets the server pick the next palette slot (round-robin); a chosen one
    // is passed through (POST /api/tags already accepts an optional palette-key `color`).
    mutationFn: (v: { name: string; color: (typeof TAG_PALETTE)[number] | null }) =>
      apiMutate<{ id: string }>("/api/tags", "POST", v.color ? { name: v.name, color: v.color } : { name: v.name }),
    onSuccess: () => {
      setNewName("");
      setNewColor(null);
      invalidate();
      toast("Tag created.", "success");
    },
    onError: (e: Error) => toast(e.message || "Couldn't create the tag.", "danger"),
  });

  const update = useMutation({
    mutationFn: (v: { id: string; name?: string; color?: string }) =>
      apiMutate<{ code: string }>(`/api/tags/${v.id}`, "PATCH", v.name !== undefined ? { name: v.name } : { color: v.color }),
    onSuccess: () => {
      setEditing(null);
      invalidate();
      toast("Tag updated.", "success");
    },
    onError: (e: Error) => toast(e.message || "Couldn't update the tag.", "danger"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiMutate<{ code: string }>(`/api/tags/${id}`, "DELETE"),
    onSuccess: () => {
      setConfirmDelete(null);
      invalidate();
      toast("Tag deleted.", "success");
    },
    onError: (e: Error) => toast(e.message || "Couldn't delete the tag.", "danger"),
  });

  const busy = create.isPending || update.isPending || remove.isPending;
  /** TAG-08: at the cap the whole create form goes inert. `busy` already disabled every
   *  control here, so this reuses the existing disabled states — no new component state. */
  const createDisabled = busy || atLimit;

  const commitRename = () => {
    if (!editing) return;
    const name = editing.name.trim();
    const original = tags.find((t) => t.id === editing.id);
    if (!name || name === original?.name) return setEditing(null); // nothing to save
    update.mutate({ id: editing.id, name });
  };

  return (
    <SettingsSection
      title="Tags"
      description="Workflow labels you attach to leads. Admin-only — partners never see them."
    >
      <Card>
        <CardHeader>
          <CardTitle>New tag</CardTitle>
        </CardHeader>
        <CardBody>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) create.mutate({ name: newName.trim(), color: newColor });
            }}
          >
            <div className="w-full max-w-[280px]">
              <Input
                value={newName}
                maxLength={40}
                disabled={createDisabled}
                aria-describedby={atLimit ? TAG_LIMIT_HELP_ID : undefined}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Probate"
                aria-label="New tag name"
              />
            </div>
            {/* WP-UX-7: pick a colour up front (the same fixed palette the rows recolor from),
                or leave it on "Auto" for the round-robin next slot. Each swatch carries its
                palette key as its accessible name, so the choice is never colour-only (PRN-14). */}
            <div className="flex items-center gap-1.5" role="group" aria-label="New tag colour">
              <button
                type="button"
                aria-pressed={newColor === null}
                disabled={createDisabled}
                onClick={() => setNewColor(null)}
                className={cn(
                  "rounded-md border px-2 py-0.5 text-step-0 font-semibold outline-none transition-colors",
                  "focus-visible:ring-1 focus-visible:ring-brand-ink disabled:cursor-not-allowed disabled:opacity-50",
                  newColor === null ? "border-brand-line bg-brand-soft text-brand-ink" : "border-border bg-surface text-text-3 hover:text-text-2",
                )}
              >
                Auto
              </button>
              {TAG_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  aria-pressed={newColor === c}
                  disabled={createDisabled}
                  onClick={() => setNewColor(c)}
                  className={cn(
                    "h-5 w-5 rounded-sm outline-none transition-transform",
                    tagDotClass(c),
                    "hover:scale-110 focus-visible:ring-1 focus-visible:ring-brand-ink active:scale-95",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                    newColor === c ? "ring-2 ring-text-2 ring-offset-1 ring-offset-surface" : "",
                  )}
                />
              ))}
            </div>
            <Button type="submit" disabled={!newName.trim() || createDisabled} loading={create.isPending}>
              Add tag
            </Button>
            {/* TAG-08: the reason the form is inert, stated where the form is — and tied to
                the name input by aria-describedby so it is not a sighted-only explanation. */}
            {atLimit && (
              <p id={TAG_LIMIT_HELP_ID} className="w-full text-step-0 text-text-3">
                This workspace has reached its limit of {tagsQ.data?.limit} tags. Delete a tag below to create a
                new one.
              </p>
            )}
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          {/* TAG-09: the roster's size against the cap, so an operator can see how much room
              is left without counting rows. Plain "All tags" until the query resolves. */}
          <CardTitle>{tagsQ.data ? `All tags · ${tagsQ.data.total} of ${tagsQ.data.limit}` : "All tags"}</CardTitle>
        </CardHeader>
        {clamped && (
          <CardBody>
            <p className="text-step-0 text-text-3">
              Showing {tags.length} of {tagsQ.data?.total} — the workspace is over the tag limit.
            </p>
          </CardBody>
        )}
        {tagsQ.error ? (
          <CardBody>
            <QueryErrorState title="Couldn't load tags" error={tagsQ.error} onRetry={() => tagsQ.refetch()} />
          </CardBody>
        ) : tagsQ.isPending ? (
          <CardBody>
            <Skeleton className="h-32" />
          </CardBody>
        ) : tags.length === 0 ? (
          <CardBody>
            <EmptyState title="No tags yet" description="Create one above, or from the ＋ on any lead." />
          </CardBody>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Tag</Th>
                <Th>Color</Th>
                <Th align="right">Leads</Th>
                <Th align="right">Actions</Th>
              </Tr>
            </THead>
            <TBody>
              {tags.map((t) => (
                <Tr key={t.id}>
                  <Td>
                    {editing?.id === t.id ? (
                      <div className="max-w-[240px]">
                        <Input
                          autoFocus
                          value={editing.name}
                          maxLength={40}
                          aria-label={`Rename ${t.name}`}
                          disabled={update.isPending}
                          onChange={(e) => setEditing({ id: t.id, name: e.target.value })}
                          onBlur={commitRename}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                            else if (e.key === "Escape") { e.preventDefault(); setEditing(null); }
                          }}
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Rename ${t.name}`}
                        disabled={busy}
                        onClick={() => setEditing({ id: t.id, name: t.name })}
                        className="rounded outline-none transition-opacity hover:opacity-80 focus-visible:ring-1 focus-visible:ring-brand-ink active:scale-[.98] disabled:opacity-50"
                      >
                        <TagChip name={t.name} color={t.color} />
                      </button>
                    )}
                  </Td>
                  <Td>
                    {/* Recolor: the fixed palette as swatches. Each carries its palette key as
                        the accessible name, so the choice is never color-only (PRN-14). */}
                    <div className="flex items-center gap-1.5" role="group" aria-label={`Color for ${t.name}`}>
                      {TAG_PALETTE.map((c) => (
                        <button
                          key={c}
                          type="button"
                          aria-label={c}
                          aria-pressed={t.color === c}
                          disabled={busy}
                          onClick={() => t.color !== c && update.mutate({ id: t.id, color: c })}
                          className={cn(
                            "h-4 w-4 rounded-sm outline-none transition-transform",
                            tagDotClass(c),
                            "hover:scale-110 focus-visible:ring-1 focus-visible:ring-brand-ink active:scale-95",
                            "disabled:cursor-not-allowed disabled:opacity-50",
                            t.color === c ? "ring-2 ring-text-2 ring-offset-1 ring-offset-surface" : "",
                          )}
                        />
                      ))}
                    </div>
                  </Td>
                  <Td align="right">
                    {/* UXF-11.1: the count was inert text — the obvious next question ("which
                        leads?") had no answer here. It is now the leads list pre-filtered to
                        this tag: `?tags=` is a csv of tag IDS, the same shape the filter bar
                        and both leads endpoints already agree on (modules/tags/schema.ts).
                        Zero is NOT a link — there is nothing to go and look at. */}
                    {t.leadCount > 0 ? (
                      <Link
                        href={`/leads?tags=${t.id}`}
                        aria-label={`View ${t.leadCount} ${t.leadCount === 1 ? "lead" : "leads"} tagged ${t.name}`}
                        className="num rounded text-xs tabular-nums text-text-2 underline-offset-2 outline-none transition-colors hover:text-brand-ink hover:underline focus-visible:ring-1 focus-visible:ring-brand-ink"
                      >
                        {t.leadCount}
                      </Link>
                    ) : (
                      <span className="num text-xs tabular-nums text-text-3">{t.leadCount}</span>
                    )}
                  </Td>
                  <Td align="right">
                    <IconButton
                      aria-label={`Delete ${t.name}`}
                      disabled={busy}
                      onClick={() => setConfirmDelete(t)}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                      </svg>
                    </IconButton>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {/* TAG-03/TAG-06: the confirmation is a CLIENT concern and it states the blast radius —
          deleting detaches the tag from every lead that carries it, in one transaction. */}
      <Dialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={confirmDelete ? `Delete “${confirmDelete.name}”?` : ""}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)} disabled={remove.isPending}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => confirmDelete && remove.mutate(confirmDelete.id)}
            >
              Delete tag
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-2">
          {confirmDelete?.leadCount
            ? `This removes the tag from ${confirmDelete.leadCount} ${confirmDelete.leadCount === 1 ? "lead" : "leads"}. The leads themselves are not affected.`
            : "This tag isn't on any leads."}
        </p>
      </Dialog>
    </SettingsSection>
  );
}
