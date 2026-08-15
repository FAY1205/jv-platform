"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiMutate } from "@/lib/api";
import { useToast } from "@/components";

// WP-TAG-1 (TAG-04/TAG-06) — the client side of tags, in ONE place. The roster and the
// attach/detach/create mutations are needed by three surfaces (the leads list, the board
// card, and Settings → Tags); duplicating the query keys and invalidation set across them is
// exactly how two views start disagreeing about what a lead is tagged with.
//
// §6.17: server data lives in the query cache only — nothing here copies a tag into
// component state. Every mutation invalidates the surfaces that render tags, so the list,
// the board, the lead dialog, and the manager all re-read from Postgres (PRN-15).

export interface TagRow {
  id: string;
  name: string;
  color: string;
  /** Live usage count (TAG-06) — attachments on non-recalled leads. */
  leadCount: number;
}

export const TAGS_KEY = ["tags"] as const;

/** The tenant's tag roster + usage counts. Shared by the picker and the manager. */
export function useTags(enabled = true) {
  return useQuery({
    queryKey: TAGS_KEY,
    queryFn: () => apiGet<{ tags: TagRow[] }>("/api/tags"),
    enabled,
  });
}

/** Everything a tag write must refresh. The roster's counts move on attach/detach too, so
 *  it is in the set for every mutation — one list, no per-call guessing. */
function invalidateTagSurfaces(qc: ReturnType<typeof useQueryClient>, refId?: string) {
  qc.invalidateQueries({ queryKey: TAGS_KEY });
  qc.invalidateQueries({ queryKey: ["leads"] });
  qc.invalidateQueries({ queryKey: ["leads-board"] });
  if (refId) qc.invalidateQueries({ queryKey: ["lead", refId] });
}

export interface AttachVars {
  refId: string;
  tagId: string;
}
export interface CreateAndAttachVars {
  refId: string;
  name: string;
}

/**
 * Attach / detach / create-then-attach for ONE lead. Deliberately NOT optimistic: a tag
 * chip's truth includes a server-assigned color (create-inline) and a server-side
 * idempotence outcome, so the honest sequence is "write, then re-read" — a chip that
 * appeared and then changed color would read as a bug. The mutations' `isPending` drives
 * the row's `busy` state instead.
 */
export function useLeadTagMutations() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const attach = useMutation({
    mutationFn: (v: AttachVars) => apiMutate<{ attached: boolean }>(`/api/leads/${v.refId}/tags`, "POST", { tagId: v.tagId }),
    onSuccess: (_d, v) => invalidateTagSurfaces(qc, v.refId),
    onError: (e: Error) => toast(e.message || "Couldn't add the tag.", "danger"),
  });

  const detach = useMutation({
    mutationFn: (v: AttachVars) => apiMutate<{ detached: boolean }>(`/api/leads/${v.refId}/tags/${v.tagId}`, "DELETE"),
    onSuccess: (_d, v) => invalidateTagSurfaces(qc, v.refId),
    onError: (e: Error) => toast(e.message || "Couldn't remove the tag.", "danger"),
  });

  const createAndAttach = useMutation({
    mutationFn: async (v: CreateAndAttachVars) => {
      // Two calls, one gesture (TAG-04 create-inline). The color is chosen SERVER-side
      // (next palette slot, round-robin) so the client never invents one off-palette.
      const tag = await apiMutate<{ id: string }>("/api/tags", "POST", { name: v.name });
      await apiMutate<{ attached: boolean }>(`/api/leads/${v.refId}/tags`, "POST", { tagId: tag.id });
      return tag;
    },
    onSuccess: (_d, v) => invalidateTagSurfaces(qc, v.refId),
    onError: (e: Error) => toast(e.message || "Couldn't create the tag.", "danger"),
  });

  return {
    attach,
    detach,
    createAndAttach,
    busy: attach.isPending || detach.isPending || createAndAttach.isPending,
  };
}
