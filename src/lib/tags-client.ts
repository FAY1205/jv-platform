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

/**
 * TAG-09: the bounded roster payload. `tags` carries at most `limit` rows; `total` is the
 * tenant's true tag count, so an overflow is visible instead of silently clamped. `limit` is
 * the SERVER's cap — no surface here duplicates the constant.
 */
export interface TagsResponse {
  tags: TagRow[];
  total: number;
  limit: number;
}

export const TAGS_KEY = ["tags"] as const;

/** The tenant's tag roster + usage counts. Shared by the picker and the manager. */
export function useTags(enabled = true) {
  return useQuery({
    queryKey: TAGS_KEY,
    queryFn: () => apiGet<TagsResponse>("/api/tags"),
    enabled,
  });
}

/**
 * TAG-08: true once the roster is LOADED and at/over the server's cap — the one predicate the
 * picker, the leads rows, the board cards and Settings all read, so they cannot disagree
 * about when creating is off. Deliberately `false` while loading or on error: never lock a
 * create affordance on data you don't have — the server's 409 is the backstop.
 */
export const atTagLimit = (d?: { total: number; limit: number }): boolean => !!d && d.total >= d.limit;

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

/** The half-done state of create-inline: the tag WAS created, only the attach failed. A
 *  distinct type (not just a string) so the hook can also refresh the roster on this path. */
export class CreateAndAttachPartialError extends Error {
  constructor(name: string) {
    super(`“${name}” was created but couldn't be added to this lead — pick it from the list.`);
    this.name = "CreateAndAttachPartialError";
  }
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

  /**
   * TAG-04 create-inline is TWO calls behind ONE gesture, so it has a partial-failure state
   * the other mutations don't: the tag can be created and the attach still fail. Reporting
   * "Couldn't create the tag" there is simply FALSE — the tag exists, it is in the picker,
   * and the operator's next click would hit a duplicate-name 409 (pr-review F-2).
   *
   * So: retry the attach ONCE with the id we already hold (attach is idempotent, so a retry
   * is free and cannot double-attach), and if it still fails, throw a distinct error naming
   * the real state. `CreateAndAttachPartialError` carries that message to onError, which is
   * why onError reports `e.message` rather than one blanket string.
   */
  const createAndAttach = useMutation({
    mutationFn: async (v: CreateAndAttachVars) => {
      // The color is chosen SERVER-side (next palette slot, round-robin) so the client never
      // invents one off-palette.
      const tag = await apiMutate<{ id: string }>("/api/tags", "POST", { name: v.name });
      const attach = () =>
        apiMutate<{ attached: boolean }>(`/api/leads/${v.refId}/tags`, "POST", { tagId: tag.id });
      try {
        await attach();
      } catch {
        try {
          await attach();
        } catch {
          throw new CreateAndAttachPartialError(v.name);
        }
      }
      return tag;
    },
    // The roster is refreshed on BOTH paths: after a partial failure the tag really does
    // exist, so the picker must show it (otherwise create-inline is the only way back to it,
    // and that now 409s).
    onSuccess: (_d, v) => invalidateTagSurfaces(qc, v.refId),
    onError: (e: Error) => {
      if (e instanceof CreateAndAttachPartialError) invalidateTagSurfaces(qc);
      toast(e.message || "Couldn't create the tag.", "danger");
    },
  });

  return {
    attach,
    detach,
    createAndAttach,
    busy: attach.isPending || detach.isPending || createAndAttach.isPending,
  };
}
