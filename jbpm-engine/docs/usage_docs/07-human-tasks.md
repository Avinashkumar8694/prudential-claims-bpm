# Human Tasks

A task is created when an instance reaches a [User Task](nodes/user-task.md) node. It shows up in the
**Task Inbox** (`task:manage`) for anyone in its `group`, or directly to its `assignee` if one was set.

## Lifecycle

| Status | Meaning |
|---|---|
| `created` | Unclaimed, sitting in the group's shared queue |
| `reserved` | Claimed by a specific user, not yet started |
| `inprogress` | Claimed and started (`start`/`stop` toggle work-in-progress state) |
| `completed` | Submitted with outputs — the waiting token resumes |
| `skipped` | Skipped without outputs (only if the node's `skippable` field allows it) |
| `error` / `exited` | Terminal states from a cancelled host (e.g. an interrupting boundary fired on it) |

Actions, all requiring `task:manage` plus the [ownership rules](03-authentication-and-authorization.md#task-level-segregation-of-duties):

- **Claim / Release** — take or give back a `created` task.
- **Start / Stop** — mark work as actively in progress, without submitting yet.
- **Complete** (`outputs`) — submits the task's output data, matching the node's own `outputs`
  mapping (task field → process variable) — the waiting token resumes and the instance continues.
- **Skip** — only if the node was authored with `skippable: true`.
- **Save outputs** — persist partial form data without completing (resumable draft).
- **Delegate** (to a specific user) / **Forward** (to a user or a different group) — reassign without
  completing.
- **Update** — priority or due date, e.g. escalating urgency without touching task content.
- **Remind** — nudges the current assignee/group via an in-app notification.

`businessAdmin` (set on the node) can claim/complete/reassign regardless of group membership or
`excludedOwners` — the designated escape hatch for a stuck task.

## Forms

If the node's `form` field references a [Form asset](assets/forms.md), the Task Detail page's **Work**
tab renders that form instead of a raw JSON editor — see the form asset doc for how fields map to task
inputs/outputs.

## Comments & audit

**Comments tab** — a running discussion thread on the task (`listComments`/`addComment`/
`deleteComment` — author or `businessAdmin` only). **Logs tab** — every action taken on this task
(claim, complete, delegate, …) via the shared audit trail (`GET /tasks/:id/events`).

## SLA

A task's `dueAt` (from the node's `dueDate` field, or set later via Update) drives the SLA indicator:
on-track until the **SLA warning threshold** System Setting's percentage of elapsed time, then
at-risk, then breached after `dueAt` passes. This is presentation/notification only — it does not
change task behavior or block completion.

## Scopes in the inbox

The Task Inbox filters by `assignee`, `group`, `status`, and an `overdue` flag — matching the
mockup's "My Tasks" / "Group Tasks" / "All" / "Overdue" views. A task only appears in a scope the
current user is actually eligible for (claim-eligibility, not just visibility).
