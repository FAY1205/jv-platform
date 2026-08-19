# WP-N1: Finish the task work layer (edit UI · assignee picker · C-44 · C-47)
Spec: TSK-01..11 (§6.21), PRN-08/12/13/14 · Phase: post-C · Tier: **A-review / B-merge**
(touches `lib/scope.ts` → full ceremony incl. audit-tenancy; no migration → merges on green)

Verified against code 2026-08-19: `editLeadTask` + `EditTaskSchema` + the PATCH field branch
are live (src/modules/tasks/tasks.ts:404, src/modules/tasks/schema.ts:50, src/app/api/tasks/[id]/route.ts:63);
TasksPanel has no edit affordance and no picker; `useCurrentUser.canDo` crashes on a
capabilities-less payload (src/lib/use-current-user.ts:24); the stream predicate exists in four
places (tasks.ts `sameStreamUsers`, scope.ts `noteWhere`/`taskWhere` ownAuthors, `statusAuthorOrg`).

## Goal
The server work layer shipped in WP-TSK-* / C-11; this WP finishes the client half and pays the
two hardening debts the C-11 audit minted.

## Definition of done

### 1. Task title/due-date edit UI (TSK-12, mint)
- [ ] Per-row **Edit** affordance on OPEN tasks in `TasksPanel` (canWrite-gated like Add; hidden
      on completed rows — TSK-04's permanence). Edit is stream-scoped, NOT author-only (matches
      `editLeadTask`'s contract, tasks.ts:399-403).
- [ ] Dismissible INLINE form (the AddTaskForm shape): title `Input` (TASK_TITLE_MAX mirror),
      `DatePicker` (clearable → explicit `null` clears the due date), assignee select (§2).
      PATCH `/api/tasks/[id]` sends ONLY changed fields (undefined = leave alone, null = clear —
      the EditTaskSchema semantics; never materialise absent keys).
- [ ] **House rule (CANDIDATES.md footer)**: focus returns to the row's Edit trigger on cancel
      AND success (the AddTaskForm `requestAnimationFrame` pattern, TasksPanel.tsx:206-209).
- [ ] 409 `task_closed` (raced completion) and 400 `invalid_assignee` surface as toasts +
      rollback; optimistic update per the toggle mutation's shape.
- [ ] All interactive states per DSN-03; no new deps.

### 2. C-46 assignee picker (TSK-13, mint; TSK-03 kept)
- [ ] New route `GET /api/tasks/assignees` — the caller's same-stream ACTIVE roster
      `{id, email, role}`: gated `requirePassthroughResponse(scope, "work.write")` + ToS like
      its `/api/tasks` siblings; query built ONLY from the promoted scope builder (§4) +
      `isNull(users.deactivatedAt)`; ordered `email asc` (deterministic). Least-exposure
      default: emails only (already served to these exact callers by the C-11 identity joins —
      no new PII class); no deactivated seats; no cross-stream rows ever (PRN-13).
- [ ] Assignee `Select` in BOTH the add form and the edit form. Default **"Me"** (omit the
      field → server defaults to creator, TSK-03). Display: email local-part, "Me" for self.
      PRN-14: text identity, never color alone.
- [ ] Server hardening (deliberate decision, reversible): `resolveAssignee` additionally
      requires `isNull(users.deactivatedAt)` — a nudge to a closed seat can never deliver
      (task-reminders.ts:145 already refuses them as recipients); refusal, not silent null
      (the existing InvalidAssigneeError posture). Test leg added.
- [ ] Portal parity: the partner's panel gets the same picker over their own-org roster
      (same endpoint — the scope decides the stream).

### 3. C-44 useCurrentUser hardening
- [ ] `canDo` = `query.data?.capabilities?.includes(cap) ?? false` — optional-chain, fail
      closed. Unit leg: a payload without `capabilities` renders canDo=false, no throw.

### 4. C-47 promote sameStreamUsers into lib/scope.ts
- [ ] ONE builder in scope.ts, e.g. `streamUsersWhere(t, stream, partnerId?)` (staff arm
      `ne(role,'partner')`; partner arm `and(eq(role,'partner'), eq(partnerId, me))`) +
      `sameStreamUsersWhere(scope, t)` = the caller's own arm. Consumed by ALL FOUR sites:
      tasks.ts `sameStreamUsers` (delete the local copy + its ⚠️ marker), `noteWhere`/`taskWhere`
      `ownAuthors` (partner arm), `statusAuthorOrg` (= `or(staffArm, partnerOrgArm)` — MUST stay
      raw-SQL-composable: portal latest-status subquery + analytics embed it in sql`` templates).
- [ ] SQL-equivalent refactor: zero behavior change. The existing scope suites
      (tasks-scope, tags-scope, isolation, rls-parity, portal-scope) stay green UNMODIFIED —
      they are the equivalence oracle. RLS untouched (0044/0047 already carry the twin).
- [ ] The proposed house rule (CANDIDATES.md footer) lands in ENGINEERING_STANDARDS §2:
      a stream-membership predicate is a scope builder.

## Out of scope
Assignee change notifications (candidate); roster caching beyond TanStack defaults; My Tasks
edit affordance (panel only — My Tasks rows deep-link to the lead); `assignedToUserId` in the
notes module (notes carry no assignee).

## Tests (TDD; names carry IDs)
- tests/unit/components/tasks-panel edit legs: "TSK-12: edit form pre-fills + sends only
  changed fields", "TSK-12: focus returns to trigger on cancel and success", "TSK-04: edit
  hidden on completed rows", "TSK-13: picker defaults to Me / omits field", read-only tier
  aria-disabled legs kept green.
- tests/unit/use-current-user.test: "C-44: capabilities-less payload fails closed".
- tests/integration/tasks-api.test.ts extend: "TSK-13: assignees roster is same-stream,
  active-only, cross-tenant empty", "TSK-03: deactivated assignee refused (invalid_assignee)".
- tests/integration/tasks-scope.test.ts: green unmodified (C-47 equivalence oracle).

## Self-check vs non-negotiables
PRN-08 (roster via scope builder only) · PRN-13 (stream wall in the one builder + tests) ·
PRN-12/14 (tokens, text-not-color) · ASN-02 (no partner special-case: the builder is symmetric) ·
PRN-15 (no server-state copies; TanStack only).
