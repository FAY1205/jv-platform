"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiMutate } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { Capability } from "@/lib/authz";
import {
  Button,
  Card,
  CardBody,
  Checkbox,
  Dialog,
  QueryErrorState,
  Skeleton,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tooltip,
  Tr,
  useToast,
} from "@/components";
import {
  CONFIGURABLE_TIERS,
  ROLE_LABELS,
  TEAM_PERMISSIONS_KEY,
  capabilityLabel,
  inCatalogOrder,
  useTeamPermissions,
  type ConfigurableTier,
  type PermissionsView,
} from "./team-data";

// team-page-spec §5 + ADR-0049 §11.4 — "What each role can do", collapsed by default and
// EDITABLE. Three bands, one table: the always-on floor (fixed ✓), the tenant-editable band
// (member/viewer toggles), and the admin-locked band (never grantable). The admin column and
// the locked rows carry a lock glyph + tooltip. PRN-14 throughout: every cell is a glyph
// whose SHAPE differs (check / dash / box) plus sr-only text — never a colour alone.
//
// Save model is the house per-card pattern (verified against the notifications + AI settings
// pages): a draft seeded during render (FEP-01), Save disabled until dirty, invalidate on
// success. No optimistic rollback — with an explicit Save it buys nothing.

type Draft = Record<ConfigurableTier, Capability[]>;

/** The EDITABLE selection only: the always-on floor is re-unioned server-side at read time,
 *  and the PATCH body Zod-rejects anything outside the editable band. */
function seedDraft(view: PermissionsView): Draft {
  const editable = new Set(view.editable);
  const pick = (tier: ConfigurableTier) => inCatalogOrder(view.effective[tier].filter((c) => editable.has(c)));
  return { member: pick("member"), viewer: pick("viewer") };
}

export function PermissionsCard({
  expanded,
  onToggle,
  cardRef,
}: {
  expanded: boolean;
  onToggle: () => void;
  cardRef?: React.Ref<HTMLDivElement>;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const permsQ = useTeamPermissions();
  const data = permsQ.data;

  // Seed the draft from server truth on first load and after every invalidation —
  // adjusting state during render, the React-recommended alternative to an effect.
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [baseline, setBaseline] = React.useState<string>("");
  const [seededFrom, setSeededFrom] = React.useState<PermissionsView | null>(null);
  if (data && data !== seededFrom) {
    const seed = seedDraft(data);
    setSeededFrom(data);
    setDraft(seed);
    setBaseline(JSON.stringify(seed));
  }

  const [resetTier, setResetTier] = React.useState<ConfigurableTier | null>(null);
  const dirty = draft !== null && JSON.stringify(draft) !== baseline;

  // R-54 spirit for a non-dialog surface: an unsaved matrix is a security decision the
  // owner believes they made — warn before a tab-close/navigation discards it.
  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = useMutation({
    mutationFn: (body: { member?: Capability[] | null; viewer?: Capability[] | null }) =>
      apiMutate<PermissionsView>("/api/admin/team/permissions", "PATCH", body),
    onSuccess: (_res, body) => {
      // The client capability list can gate chrome elsewhere, so re-read identity too.
      qc.invalidateQueries({ queryKey: TEAM_PERMISSIONS_KEY });
      qc.invalidateQueries({ queryKey: ["me"] });
      setResetTier(null);
      const reset = CONFIGURABLE_TIERS.find((t) => body[t] === null);
      toast(reset ? `${ROLE_LABELS[reset]} permissions reset to defaults.` : "Permissions saved.", "success");
    },
    onError: (e: Error) => toast(e.message || "Couldn't save permissions.", "danger"),
  });

  const toggle = (tier: ConfigurableTier, cap: Capability) =>
    setDraft((d) => {
      if (!d) return d;
      const has = d[tier].includes(cap);
      return { ...d, [tier]: inCatalogOrder(has ? d[tier].filter((c) => c !== cap) : [...d[tier], cap]) };
    });

  return (
    <div ref={cardRef} id="role-permissions">
    <Card>
      <div className="flex items-center gap-2.5 border-b border-border-soft px-5 py-4">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls="role-permissions-body"
          className={cn(
            "flex min-h-11 flex-1 items-center gap-2 rounded-md text-left text-sm font-semibold text-text outline-none",
            "transition-colors hover:text-brand-ink focus-visible:ring-1 focus-visible:ring-brand-ink",
          )}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
            className={cn("shrink-0 text-text-3 transition-transform", expanded && "rotate-90")}
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
          What each role can do
        </button>
      </div>

      {expanded && (
        <CardBody id="role-permissions-body">
          {permsQ.error ? (
            <QueryErrorState
              title="Couldn't load permissions"
              error={permsQ.error}
              onRetry={() => permsQ.refetch()}
            />
          ) : permsQ.isPending || !draft || !data ? (
            <Skeleton className="h-32" />
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-text-2">
                Admins always hold everything. Choose what Members and Viewers can do — changes
                take effect on their next request.
              </p>

              <Table ariaLabel="What each role can do">
                <THead>
                  <Tr>
                    <Th>Capability</Th>
                    <Th fit>
                      <span className="inline-flex items-center gap-1">
                        Admin
                        <Tooltip content="Admins always have full access — this column can't be edited.">
                          <span tabIndex={0} className="inline-flex rounded outline-none focus-visible:ring-1 focus-visible:ring-brand-ink">
                            <LockGlyph />
                            <span className="sr-only">Locked</span>
                          </span>
                        </Tooltip>
                      </span>
                    </Th>
                    <Th fit>Member</Th>
                    <Th fit>Viewer</Th>
                  </Tr>
                </THead>
                <TBody>
                  {inCatalogOrder(data.alwaysOn).map((cap) => (
                    <Tr key={cap}>
                      <Td>
                        <span className="text-text">{capabilityLabel(cap)}</span>
                        <span className="ml-2 text-step-1 text-text-3">Always on</span>
                      </Td>
                      <Td fit className="text-center"><AllowedGlyph /></Td>
                      <Td fit className="text-center"><AllowedGlyph /></Td>
                      <Td fit className="text-center"><AllowedGlyph /></Td>
                    </Tr>
                  ))}

                  {inCatalogOrder(data.editable).map((cap) => (
                    <Tr key={cap}>
                      <Td><span className="text-text">{capabilityLabel(cap)}</span></Td>
                      <Td fit className="text-center"><AllowedGlyph /></Td>
                      {CONFIGURABLE_TIERS.map((tier) => (
                        <Td key={tier} fit className="text-center">
                          <span className="grid h-11 place-items-center">
                            <Checkbox
                              checked={draft[tier].includes(cap)}
                              onCheckedChange={() => toggle(tier, cap)}
                              disabled={save.isPending}
                              ariaLabel={`${capabilityLabel(cap)} for ${ROLE_LABELS[tier]}`}
                            />
                          </span>
                        </Td>
                      ))}
                    </Tr>
                  ))}

                  {inCatalogOrder(data.adminLocked).map((cap) => (
                    <Tr key={cap}>
                      <Td>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-text">{capabilityLabel(cap)}</span>
                          <Tooltip content="Only admins can hold this.">
                            <span
                              tabIndex={0}
                              className="inline-flex rounded outline-none focus-visible:ring-1 focus-visible:ring-brand-ink"
                            >
                              <LockGlyph />
                              <span className="sr-only">Admins only — can&apos;t be granted</span>
                            </span>
                          </Tooltip>
                        </span>
                      </Td>
                      <Td fit className="text-center"><AllowedGlyph /></Td>
                      <Td fit className="text-center"><DeniedGlyph /></Td>
                      <Td fit className="text-center"><DeniedGlyph /></Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>

              <p className="text-step-1 text-text-3">
                Admins can invite and manage Members and Viewers. Only the workspace owner can
                grant the Admin role or manage Admins.
              </p>

              <div className="flex flex-wrap items-center justify-end gap-2">
                {CONFIGURABLE_TIERS.map((tier) => (
                  <Button
                    key={tier}
                    variant="ghost"
                    disabled={!data.configured[tier] || save.isPending}
                    onClick={() => setResetTier(tier)}
                  >
                    Reset {ROLE_LABELS[tier]} to defaults
                  </Button>
                ))}
                <Button
                  variant="primary"
                  disabled={!dirty}
                  loading={save.isPending && resetTier === null}
                  onClick={() => draft && save.mutate({ member: draft.member, viewer: draft.viewer })}
                >
                  Save permissions
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      )}

      <Dialog
        open={resetTier !== null}
        onClose={() => setResetTier(null)}
        title={resetTier ? `Reset ${ROLE_LABELS[resetTier]} permissions?` : ""}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetTier(null)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={save.isPending && resetTier !== null}
              onClick={() => resetTier && save.mutate({ [resetTier]: null })}
            >
              Reset to defaults
            </Button>
          </>
        }
      >
        {resetTier && data && (
          <div className="flex flex-col gap-2 text-sm text-text-2">
            <p>
              {ROLE_LABELS[resetTier]}s go back to the built-in defaults:{" "}
              <span className="text-text">
                {inCatalogOrder(data.defaults[resetTier]).map(capabilityLabel).join(", ")}
              </span>
              .
            </p>
            <p>Any unsaved edits in this card are discarded.</p>
          </div>
        )}
      </Dialog>
    </Card>
    </div>
  );
}

// ── Matrix glyphs (PRN-14): shape carries the meaning, sr-only text carries the word. ──

function AllowedGlyph() {
  return (
    <span className="inline-flex items-center justify-center text-success">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" />
      </svg>
      <span className="sr-only">Yes</span>
    </span>
  );
}

function DeniedGlyph() {
  return (
    <span className="inline-flex items-center justify-center text-text-3">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
        <path d="M5 12h14" />
      </svg>
      <span className="sr-only">No</span>
    </span>
  );
}

export function LockGlyph({ className }: { className?: string }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("shrink-0 text-text-3", className)}
    >
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
