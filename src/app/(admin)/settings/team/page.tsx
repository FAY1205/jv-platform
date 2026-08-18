"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiMutate } from "@/lib/api";
import { fmtDate } from "@/lib/dates";
import { useDirty } from "@/lib/use-dirty";
import { useCurrentUser } from "@/lib/use-current-user";
import { cn } from "@/lib/cn";
import {
  AvatarInitials,
  Badge,
  Button,
  Card,
  CardBody,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Input,
  QueryErrorState,
  RoleBadge,
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
import { SettingsSection } from "../settings-section";
import { LockGlyph, PermissionsCard } from "./permissions-card";
import {
  INVITABLE_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  TEAM_KEY,
  TEAM_PERMISSIONS_KEY,
  capabilitiesLost,
  capabilityLabel,
  useTeam,
  useTeamPermissions,
  type InvitableRole,
  type PermissionsView,
  type TeamInviteView,
  type TeamMemberView,
} from "./team-data";

// Settings → Team (team-page-spec, TM-01..13). The STAFF axis only — partners are managed on
// the Partners page and never appear here.
//
// Every gate below is CONVENIENCE: the server re-checks team.manage on each route and enforces
// the two owner invariants (only the workspace owner touches admin seats; nobody touches the
// owner). The UI mirrors them so the affordances don't lie, and follows §6's degradation rule —
// DISABLE + tooltip, never hide — with the route itself as the one whole-route exception.

export default function TeamSettingsPage() {
  const router = useRouter();
  const me = useCurrentUser();
  const allowed = me.canDo("team.manage");

  // §6's single exception: a route the role can never use hides its nav entry and redirects
  // direct navigation. Only once identity RESOLVES — `canDo` is false while loading.
  React.useEffect(() => {
    if (me.isSuccess && !allowed) router.replace("/settings/profile");
  }, [me.isSuccess, allowed, router]);

  return (
    <SettingsSection
      title="Team"
      description="People with access to this workspace. Partners are managed on the Partners page."
    >
      {allowed ? <TeamManager meEmail={me.data?.email ?? ""} /> : <Skeleton className="h-32" />}
    </SettingsSection>
  );
}

// ── Roster ───────────────────────────────────────────────────────────────────

type Row =
  | { kind: "member"; member: TeamMemberView }
  | { kind: "invite"; invite: TeamInviteView };

/** Owner first, then active members A→Z, then open invites, then deactivated seats last. */
function orderRows(members: TeamMemberView[], invites: TeamInviteView[]): Row[] {
  const byEmail = (a: TeamMemberView, b: TeamMemberView) => a.email.localeCompare(b.email);
  const owner = members.filter((m) => m.isOwner);
  const active = members.filter((m) => !m.isOwner && m.deactivatedAt === null).sort(byEmail);
  const off = members.filter((m) => !m.isOwner && m.deactivatedAt !== null).sort(byEmail);
  return [
    ...owner.map((member): Row => ({ kind: "member", member })),
    ...active.map((member): Row => ({ kind: "member", member })),
    ...invites.map((invite): Row => ({ kind: "invite", invite })),
    ...off.map((member): Row => ({ kind: "member", member })),
  ];
}

function countLine(members: number, invites: number): string {
  const seats = `${members} ${members === 1 ? "member" : "members"}`;
  if (invites === 0) return seats;
  return `${seats} · ${invites} ${invites === 1 ? "invite" : "invites"} pending`;
}

function TeamManager({ meEmail }: { meEmail: string }) {
  const teamQ = useTeam();
  const permsQ = useTeamPermissions();
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [roleTarget, setRoleTarget] = React.useState<TeamMemberView | null>(null);
  const [deactivateTarget, setDeactivateTarget] = React.useState<TeamMemberView | null>(null);
  const [reactivateTarget, setReactivateTarget] = React.useState<TeamMemberView | null>(null);
  const [revokeTarget, setRevokeTarget] = React.useState<TeamInviteView | null>(null);
  const [matrixOpen, setMatrixOpen] = React.useState(false);
  const matrixRef = React.useRef<HTMLDivElement>(null);

  const team = teamQ.data;
  const members = team?.members ?? [];
  const invites = team?.invites ?? [];
  // `/api/me` identifies by email (users has no name column); the roster carries the ids, so
  // "am I the workspace owner?" is my roster row's id against ownerUserId.
  const myId = members.find((m) => m.email === meEmail)?.id ?? null;
  const callerIsOwner = myId !== null && team?.ownerUserId === myId;

  const rows = React.useMemo(() => orderRows(team?.members ?? [], team?.invites ?? []), [team]);
  const isEmpty = members.length <= 1 && invites.length === 0;

  /** The matrix is the one canonical rendering of the grants; dialogs deep-link into it. */
  const openMatrix = () => {
    setMatrixOpen(true);
    requestAnimationFrame(() => matrixRef.current?.scrollIntoView({ block: "start" }));
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-2">
          {teamQ.isPending ? "Loading your team…" : countLine(members.length, invites.length)}
        </p>
        <Button variant="primary" onClick={() => setInviteOpen(true)} disabled={teamQ.isPending}>
          ＋ Invite member
        </Button>
      </div>

      <Card>
        {teamQ.error ? (
          <CardBody>
            <QueryErrorState title="Couldn't load your team" error={teamQ.error} onRetry={() => teamQ.refetch()} />
          </CardBody>
        ) : teamQ.isPending ? (
          <CardBody>
            <Skeleton className="h-32" />
          </CardBody>
        ) : (
          <>
            <Table ariaLabel="Team roster">
              <THead>
                <Tr>
                  <Th>Member</Th>
                  <Th fit>Role</Th>
                  <Th fit>Status</Th>
                  <Th fit>Joined</Th>
                  <Th fit align="right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </Tr>
              </THead>
              <TBody>
                {rows.map((row) =>
                  row.kind === "member" ? (
                    <MemberRow
                      key={row.member.id}
                      member={row.member}
                      isMe={row.member.email === meEmail}
                      callerIsOwner={callerIsOwner}
                      onChangeRole={() => setRoleTarget(row.member)}
                      onDeactivate={() => setDeactivateTarget(row.member)}
                      onReactivate={() => setReactivateTarget(row.member)}
                    />
                  ) : (
                    <InviteRow
                      key={row.invite.id}
                      invite={row.invite}
                      callerIsOwner={callerIsOwner}
                      onRevoke={() => setRevokeTarget(row.invite)}
                    />
                  ),
                )}
              </TBody>
            </Table>
            {isEmpty && (
              <CardBody>
                <EmptyState
                  title="It's just you so far"
                  description="Invite a teammate — they'll get an email link to set a password and sign in."
                  action={
                    <Button variant="primary" onClick={() => setInviteOpen(true)}>
                      Invite member
                    </Button>
                  }
                />
              </CardBody>
            )}
          </>
        )}
      </Card>

      <PermissionsCard expanded={matrixOpen} onToggle={() => setMatrixOpen((v) => !v)} cardRef={matrixRef} />

      {inviteOpen && (
        <InviteDialog
          canGrantAdmin={callerIsOwner}
          onClose={() => setInviteOpen(false)}
          onWhatCanRolesDo={() => {
            setInviteOpen(false);
            openMatrix();
          }}
        />
      )}
      {roleTarget && (
        <RoleDialog
          member={roleTarget}
          perms={permsQ.data}
          onClose={() => setRoleTarget(null)}
          onWhatCanRolesDo={() => {
            setRoleTarget(null);
            openMatrix();
          }}
        />
      )}
      {deactivateTarget && (
        <DeactivateDialog member={deactivateTarget} onClose={() => setDeactivateTarget(null)} />
      )}
      {reactivateTarget && (
        <ReactivateDialog member={reactivateTarget} onClose={() => setReactivateTarget(null)} />
      )}
      {revokeTarget && <RevokeDialog invite={revokeTarget} onClose={() => setRevokeTarget(null)} />}
    </>
  );
}

/** Invalidate everything a seat change can move: the roster, and the caller's own capability
 *  list (a role change elsewhere can alter what this session may see). PRN-15: re-read, never
 *  patch a cached row. */
function useTeamInvalidate() {
  const qc = useQueryClient();
  return React.useCallback(() => {
    qc.invalidateQueries({ queryKey: TEAM_KEY });
    qc.invalidateQueries({ queryKey: TEAM_PERMISSIONS_KEY });
    qc.invalidateQueries({ queryKey: ["me"] });
  }, [qc]);
}

function MemberRow({
  member,
  isMe,
  callerIsOwner,
  onChangeRole,
  onDeactivate,
  onReactivate,
}: {
  member: TeamMemberView;
  isMe: boolean;
  callerIsOwner: boolean;
  onChangeRole: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
}) {
  const { toast } = useToast();
  const off = member.deactivatedAt !== null;
  // TM-05/OQ-1: an admin seat is owner-only territory. Disable-don't-hide (§6).
  const blocked = member.role === "admin" && !callerIsOwner;

  return (
    <Tr className={off ? "opacity-70" : undefined}>
      <Td clamp clampTitle={member.email}>
        <span className="flex items-center gap-2.5">
          <AvatarInitials email={member.email} size="sm" />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className={cn("truncate text-sm font-semibold", off ? "text-text-2" : "text-text")}>
                {member.email}
              </span>
              {/* TM-01 */}
              {isMe && <Badge variant="zip">You</Badge>}
            </span>
          </span>
        </span>
      </Td>
      <Td fit>
        <span className="inline-flex items-center gap-1.5">
          <RoleBadge role={member.isOwner ? "owner" : member.role} />
          {/* TM-02: the owner's seat has no role affordance for anyone — a lock says why. */}
          {member.isOwner && (
            <Tooltip content="The workspace Owner can't be changed here.">
              <span
                tabIndex={0}
                className="inline-flex rounded outline-none focus-visible:ring-1 focus-visible:ring-brand-ink"
              >
                <LockGlyph />
                <span className="sr-only">Locked — the workspace Owner can&apos;t be changed here</span>
              </span>
            </Tooltip>
          )}
        </span>
      </Td>
      <Td fit>
        {off ? (
          <Badge variant="neutral" dot>
            Deactivated
          </Badge>
        ) : (
          <Badge variant="success" dot>
            Active
          </Badge>
        )}
      </Td>
      <Td fit>
        <span className="text-sm text-text-2" title={member.joinedAt}>
          {fmtDate(member.joinedAt)}
        </span>
      </Td>
      <Td fit align="right">
        {/* TM-01/TM-02: nothing on your own row is self-actionable, and the owner's seat is
            immutable — both render NO menu rather than a menu of dead items. */}
        {isMe || member.isOwner ? null : (
          <RowMenu
            label={member.email}
            items={
              off
                ? [{ key: "reactivate", label: "Reactivate…", onSelect: onReactivate }]
                : [
                    { key: "role", label: "Change role…", onSelect: onChangeRole },
                    { key: "deactivate", label: "Deactivate…", onSelect: onDeactivate, destructive: true },
                  ]
            }
            disabledReason={blocked ? "Only the workspace owner can manage Admins." : undefined}
            onBlocked={() => toast("Only the workspace owner can manage Admins.", "default")}
          />
        )}
      </Td>
    </Tr>
  );
}

function InviteRow({
  invite,
  callerIsOwner,
  onRevoke,
}: {
  invite: TeamInviteView;
  callerIsOwner: boolean;
  onRevoke: () => void;
}) {
  const { toast } = useToast();
  const invalidate = useTeamInvalidate();
  const blocked = invite.role === "admin" && !callerIsOwner;

  const resend = useMutation({
    mutationFn: () => apiMutate<{ code: string }>(`/api/admin/team/invites/${invite.id}`, "POST"),
    onSuccess: () => {
      invalidate();
      toast("Invite re-sent.", "success");
    },
    onError: (e: Error) => toast(e.message || "Couldn't re-send the invite.", "danger"),
  });

  const role = (INVITABLE_ROLES as readonly string[]).includes(invite.role)
    ? (invite.role as InvitableRole)
    : "member";

  return (
    <Tr className="opacity-90">
      <Td clamp clampTitle={invite.email}>
        <span className="flex items-center gap-2.5">
          <AvatarInitials email={invite.email} size="sm" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-text-2">{invite.email}</span>
            <span className="block truncate text-step-1 text-text-3">
              {invite.invitedByEmail ? `Invited by ${invite.invitedByEmail}` : "Invited"}
            </span>
          </span>
        </span>
      </Td>
      <Td fit>
        <RoleBadge role={role} />
      </Td>
      <Td fit>
        {/* Pills stay full-contrast on a de-emphasised row (PRN-14 / AA). */}
        {invite.expired ? (
          <Badge variant="warn" dot>
            Expired
          </Badge>
        ) : (
          <Badge variant="warn" dot>
            Invited
          </Badge>
        )}
      </Td>
      <Td fit>
        <span className="text-sm text-text-2" title={invite.expired ? invite.expiresAt : invite.createdAt}>
          {invite.expired ? `Expired ${fmtDate(invite.expiresAt)}` : `Invited ${fmtDate(invite.createdAt)}`}
        </span>
      </Td>
      <Td fit align="right">
        <RowMenu
          label={invite.email}
          items={[
            { key: "resend", label: "Resend invite", onSelect: () => resend.mutate() },
            { key: "revoke", label: "Revoke invite", onSelect: onRevoke, destructive: true },
          ]}
          disabledReason={blocked ? "Only the workspace owner can manage Admins." : undefined}
          onBlocked={() => toast("Only the workspace owner can manage Admins.", "default")}
        />
      </Td>
    </Tr>
  );
}

interface RowMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}

/** The ⋯ row menu. When the caller may not act on this seat the items render DISABLED with
 *  the reason (§6: disable-don't-hide) rather than vanishing. */
function RowMenu({
  label,
  items,
  disabledReason,
  onBlocked,
}: {
  label: string;
  items: RowMenuItem[];
  disabledReason?: string;
  onBlocked: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton aria-label={`Actions for ${label}`} className="ml-auto">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="19" cy="12" r="1.6" />
          </svg>
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {disabledReason && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-text-3">
            <LockGlyph />
            {disabledReason}
          </div>
        )}
        {items.map((item) => (
          <DropdownMenuItem
            key={item.key}
            destructive={item.destructive}
            disabled={Boolean(disabledReason)}
            onSelect={() => (disabledReason ? onBlocked() : item.onSelect())}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Role choice (shared by the invite + role-change dialogs) ──────────────────

/** Radio-cards: a page-local composite over the Radio semantics, per the spec's component
 *  map (promote to a primitive only if a second consumer appears). */
function RoleCards({
  value,
  onChange,
  disabledRoles,
  disabledReason,
  currentRole,
  disabled,
}: {
  value: InvitableRole;
  onChange: (role: InvitableRole) => void;
  disabledRoles?: readonly InvitableRole[];
  disabledReason?: string;
  currentRole?: InvitableRole;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Role" className="flex flex-col gap-2">
      {INVITABLE_ROLES.map((role) => {
        const blocked = Boolean(disabledRoles?.includes(role)) || Boolean(disabled);
        const checked = value === role;
        const card = (
          <div
            role="radio"
            aria-checked={checked}
            aria-disabled={blocked || undefined}
            tabIndex={blocked ? -1 : 0}
            onClick={() => !blocked && onChange(role)}
            onKeyDown={(e) => {
              if (!blocked && (e.key === " " || e.key === "Enter")) {
                e.preventDefault();
                onChange(role);
              }
            }}
            className={cn(
              "group flex min-h-11 items-start gap-2.5 rounded-md border p-3 outline-none transition-colors",
              "focus-visible:ring-1 focus-visible:ring-brand-ink",
              checked ? "border-brand bg-brand-soft" : "border-border bg-surface hover:border-brand-line",
              blocked ? "cursor-not-allowed opacity-60" : "cursor-pointer active:scale-[.99]",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border bg-surface",
                checked ? "border-brand" : "border-border",
              )}
            >
              {checked && <span className="h-2 w-2 rounded-full bg-brand" />}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-text">
                {ROLE_LABELS[role]}
                {currentRole === role && <span className="ml-1.5 font-medium text-text-3">· current</span>}
                {blocked && !disabled && <LockGlyph className="ml-1.5 inline" />}
              </span>
              <span className="block text-step-1 text-text-2">{ROLE_DESCRIPTIONS[role]}</span>
            </span>
          </div>
        );
        return blocked && disabledReason && !disabled ? (
          <Tooltip key={role} content={disabledReason}>
            {card}
          </Tooltip>
        ) : (
          <React.Fragment key={role}>{card}</React.Fragment>
        );
      })}
    </div>
  );
}

function WhatCanRolesDo({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="self-start rounded text-sm font-semibold text-brand-ink underline decoration-dotted outline-none hover:no-underline focus-visible:ring-1 focus-visible:ring-brand-ink"
    >
      What can each role do?
    </button>
  );
}

// ── Dialogs ──────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function InviteDialog({
  canGrantAdmin,
  onClose,
  onWhatCanRolesDo,
}: {
  canGrantAdmin: boolean;
  onClose: () => void;
  onWhatCanRolesDo: () => void;
}) {
  const { toast } = useToast();
  const invalidate = useTeamInvalidate();
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<InvitableRole>("member");
  const [touched, setTouched] = React.useState(false);
  const dirty = useDirty({ email, role });

  const send = useMutation({
    mutationFn: (v: { email: string; role: InvitableRole }) =>
      apiMutate<{ inviteId: string }>("/api/admin/team/invites", "POST", v),
    onSuccess: (_r, v) => {
      invalidate();
      toast(`Invite sent to ${v.email}.`, "success");
      onClose();
    },
    onError: (e: Error) => toast(e.message || "Couldn't send the invite.", "danger"),
  });

  const trimmed = email.trim();
  const invalid = touched && trimmed.length > 0 && !EMAIL_RE.test(trimmed);

  /** Shared by Enter-in-the-form and the footer button (the footer lives outside <form>). */
  const submit = () => {
    setTouched(true);
    if (!EMAIL_RE.test(trimmed)) return;
    send.mutate({ email: trimmed, role });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Invite a teammate"
      size="md"
      confirmClose={dirty && !send.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={send.isPending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={send.isPending} disabled={trimmed.length === 0}>
            Send invite
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        <Input
          label="Email address"
          type="email"
          autoComplete="off"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setTouched(true)}
          error={invalid ? "Enter a valid email address." : undefined}
          hint={invalid ? undefined : "They'll get a link to set a password and sign in."}
        />
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-text">Role</span>
          <RoleCards
            value={role}
            onChange={setRole}
            disabled={send.isPending}
            disabledRoles={canGrantAdmin ? undefined : ["admin"]}
            disabledReason="Only the workspace owner can grant the Admin role."
          />
        </div>
        <WhatCanRolesDo onClick={onWhatCanRolesDo} />
      </form>
    </Dialog>
  );
}

function RoleDialog({
  member,
  perms,
  onClose,
  onWhatCanRolesDo,
}: {
  member: TeamMemberView;
  perms: PermissionsView | undefined;
  onClose: () => void;
  onWhatCanRolesDo: () => void;
}) {
  const { toast } = useToast();
  const invalidate = useTeamInvalidate();
  const [role, setRole] = React.useState<InvitableRole>(member.role);

  const change = useMutation({
    mutationFn: (next: InvitableRole) =>
      apiMutate<{ code: string }>(`/api/admin/team/members/${member.id}`, "PATCH", { role: next }),
    onSuccess: (_r, next) => {
      invalidate();
      toast(`${member.email} is now ${ROLE_LABELS[next] === "Admin" ? "an" : "a"} ${ROLE_LABELS[next]}.`, "success");
      onClose();
    },
    onError: (e: Error) => toast(e.message || "Couldn't change the role.", "danger"),
  });

  // TM-08: what this move takes away, derived from the tenant's EFFECTIVE sets — not from a
  // tier ranking. A tenant may have granted its viewers more than its members.
  const lost = perms && role !== member.role ? capabilitiesLost(member.role, role, perms) : [];

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Change role for ${member.email}`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={change.isPending}>
            Cancel
          </Button>
          <Button
            variant={lost.length > 0 ? "danger" : "primary"}
            loading={change.isPending}
            disabled={role === member.role}
            onClick={() => change.mutate(role)}
          >
            Change to {ROLE_LABELS[role]}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <RoleCards
          value={role}
          onChange={setRole}
          currentRole={member.role}
          disabled={change.isPending}
        />
        {lost.length > 0 && (
          <div role="status" className="rounded-md border border-warn bg-warn-soft p-3 text-sm text-text">
            <p className="font-semibold">
              {member.email} will immediately lose: {lost.map(capabilityLabel).join(", ")}.
            </p>
            <p className="mt-1 text-text-2">Their notes, tasks, and history are unaffected.</p>
          </div>
        )}
        <WhatCanRolesDo onClick={onWhatCanRolesDo} />
      </div>
    </Dialog>
  );
}

function DeactivateDialog({ member, onClose }: { member: TeamMemberView; onClose: () => void }) {
  const { toast } = useToast();
  const invalidate = useTeamInvalidate();
  const run = useMutation({
    mutationFn: () => apiMutate<{ code: string }>(`/api/admin/team/members/${member.id}/deactivate`, "POST"),
    onSuccess: () => {
      invalidate();
      toast(`${member.email} deactivated.`, "success");
      onClose();
    },
    onError: (e: Error) => toast(e.message || "Couldn't deactivate the member.", "danger"),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Deactivate ${member.email}?`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={run.isPending}>
            Cancel
          </Button>
          <Button variant="danger" loading={run.isPending} onClick={() => run.mutate()}>
            Deactivate member
          </Button>
        </>
      }
    >
      <ul className="flex list-disc flex-col gap-2 pl-4 text-sm text-text-2">
        <li>{member.email} loses access immediately and is signed out on every device.</li>
        <li>
          Everything they created — notes, tasks, imports, and history — stays in place and stays
          attributed to them.
        </li>
        <li>You can reactivate them anytime.</li>
      </ul>
    </Dialog>
  );
}

function ReactivateDialog({ member, onClose }: { member: TeamMemberView; onClose: () => void }) {
  const { toast } = useToast();
  const invalidate = useTeamInvalidate();
  const run = useMutation({
    mutationFn: () => apiMutate<{ code: string }>(`/api/admin/team/members/${member.id}/reactivate`, "POST"),
    onSuccess: () => {
      invalidate();
      toast(`${member.email} reactivated.`, "success");
      onClose();
    },
    onError: (e: Error) => toast(e.message || "Couldn't reactivate the member.", "danger"),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Reactivate ${member.email}?`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={run.isPending}>
            Cancel
          </Button>
          <Button variant="primary" loading={run.isPending} onClick={() => run.mutate()}>
            Reactivate
          </Button>
        </>
      }
    >
      <p className="text-sm text-text-2">
        They return as {ROLE_LABELS[member.role] === "Admin" ? "an" : "a"} {ROLE_LABELS[member.role]} (their
        previous role) and can sign in with their existing password.
      </p>
    </Dialog>
  );
}

function RevokeDialog({ invite, onClose }: { invite: TeamInviteView; onClose: () => void }) {
  const { toast } = useToast();
  const invalidate = useTeamInvalidate();
  const run = useMutation({
    mutationFn: () => apiMutate<{ code: string }>(`/api/admin/team/invites/${invite.id}`, "DELETE"),
    onSuccess: () => {
      invalidate();
      toast("Invite revoked.", "success");
      onClose();
    },
    onError: (e: Error) => toast(e.message || "Couldn't revoke the invite.", "danger"),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Revoke the invite to ${invite.email}?`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={run.isPending}>
            Cancel
          </Button>
          <Button variant="danger" loading={run.isPending} onClick={() => run.mutate()}>
            Revoke invite
          </Button>
        </>
      }
    >
      <p className="text-sm text-text-2">
        The emailed link stops working immediately. You can invite them again later.
      </p>
    </Dialog>
  );
}
