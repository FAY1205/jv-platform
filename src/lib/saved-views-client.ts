"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiMutate } from "@/lib/api";
import type { SavedViewFilters } from "@/modules/saved-views/schema";

// WP-SV-1 (SV-02/SV-03) — the client side of saved views. The roster query and the three
// mutations live together for the same reason the tags ones do: one query key, one
// invalidation set, so nothing can drift between the menu and a write.
//
// §6.17: server data lives in the query cache only. The menu copies NOTHING into component
// state except which view is currently APPLIED (an id — a UI selection, not server data) and
// the drafts inside its dialogs.

export interface SavedViewRow {
  id: string;
  name: string;
  filters: SavedViewFilters;
  /** ISO — the menu's ordering key (most recently saved first), server-computed. */
  updatedAt: string;
}

export const SAVED_VIEWS_KEY = ["saved-views"] as const;

/** The caller's OWN saved views. Per-user on the server; there is no "all views" read. */
export function useSavedViews(enabled = true) {
  return useQuery({
    queryKey: SAVED_VIEWS_KEY,
    queryFn: () => apiGet<{ views: SavedViewRow[] }>("/api/saved-views"),
    enabled,
  });
}

export interface CreateSavedViewVars {
  name: string;
  filters: SavedViewFilters;
}
export interface UpdateSavedViewVars {
  id: string;
  name?: string;
  filters?: SavedViewFilters;
}

/**
 * Create / overwrite / delete. Deliberately NOT optimistic: a save can fail on the
 * duplicate-name 409 the DB alone can decide, so the honest sequence is "write, then re-read"
 * — a view that appeared in the menu and then vanished would read as a bug.
 *
 * Only the saved-views roster is invalidated: a view is a bookmark over filters, so saving one
 * changes nothing about the leads, the board or the tag roster.
 */
export function useSavedViewMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: SAVED_VIEWS_KEY });

  const create = useMutation({
    mutationFn: (v: CreateSavedViewVars) => apiMutate<{ id: string; name: string }>("/api/saved-views", "POST", v),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, ...patch }: UpdateSavedViewVars) =>
      apiMutate<{ code: string }>(`/api/saved-views/${id}`, "PATCH", patch),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiMutate<{ code: string }>(`/api/saved-views/${id}`, "DELETE"),
    onSuccess: invalidate,
  });

  return { create, update, remove, busy: create.isPending || update.isPending || remove.isPending };
}
