# ADR-0044: Lead tasks are two-stream and do not follow re-routes

- **Status:** Accepted (owner, 2026-08-15)
- **Date:** 2026-08-15
- **Phase / WP:** CRM-1 / WP-TSK series

## Context

CRM slice 1 adds tasks to leads. Three visibility models were possible, and the choice
is load-bearing because lead ownership MOVES on manual re-route (`partnerOwnsLead`):
a naive "tasks on leads I own" predicate would hand the previous partner's tasks to the
new owner — the exact leak `noteWhere` already defends against for notes (PRN-13,
R-01/R-22). Admin and partners are different companies; a task is an org's private
work item, not a shared field of the lead.

## Decision

Tasks copy the lead-notes visibility model, not the status-history model:

- `author_role ∈ {admin, partner}`; the two streams are mutually invisible (PRN-13
  symmetry). An admin never sees partner tasks; a partner never sees admin tasks.
- A partner reads only tasks authored by their own org on leads they currently own —
  `taskWhere()` reuses `noteWhere`'s shape (own-leads ∩ own-org-authors). On re-route,
  the prior org's tasks vanish from the new owner's view and the prior owner loses the
  lead entirely; no task row is deleted or rewritten.
- Assignee (`assigned_to_user_id`, nullable FK→users) must belong to the author's
  stream; defaults to the creator. Picker hidden until a stream has >1 eligible user.
- Delete is author-only and open-tasks-only, audit-logged; a completed task is a
  permanent timeline fact (append-only discipline, PRN-05 spirit).

Alternatives rejected:
- **Shared tasks (both roles see all):** leaks each company's internal workflow to the
  other; violates PRN-13's boundary logic. One line: wrong trust model.
- **Status-history hybrid (R-22: own org + admin entries visible):** status is one
  shared field of the lead; a task list is not — sharing admin to-dos with partners
  invites partners to treat them as commitments.

## Consequences

Easier: WP-TSK-1 copies a proven predicate (`noteWhere`) instead of inventing one; RLS
mirrors an existing policy shape; the §6 checklist's PRN-13 line extends naturally to
tasks. Harder: a lead's full task history spans streams no single user can see (accepted
— same is true of notes today; the audit log remains the omniscient record). Reopened
if: multi-seat partner orgs land (assignee picker activates — no schema change), or a
future "shared checklist" feature genuinely needs cross-company tasks (new ADR).

Load-bearing invariant (audit-tenancy F-10, 2026-08-15): org membership
(`users.partner_id`) is the visibility key for BOTH tasks and notes at read time —
"authored by my org" means "authored by someone *currently* in my org". No code path
mutates `users.partner_id` today, and none may: transferring a user to another partner
org would retroactively migrate their entire task/note history into the new org's view.
A future user-transfer feature must create a NEW user row, never re-point this column.
