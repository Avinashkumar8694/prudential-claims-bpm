# Execution Errors, Audit Log & Notifications

## Execution Errors

Every instance that ends in `failed` lands exactly **one** row in the Execution Errors queue
(`ErrorService.record`), regardless of how many times the same failure recurs — a node retried 40
times and failing every time is one row with `occurrences: 40`, not 40 rows. Only the **first**
occurrence pings a bell notification to whoever started the instance (never for `system`/`timer`-driven
starts) — you're not spammed on every retry.

Each row carries the instance, workflow, deployment, process, the failing node (id/name/type), and the
error message/stack. Actions:

- **Acknowledge** (single or bulk) — marks it reviewed; doesn't fix anything or touch the instance.
- **Summary** (`GET /errors/summary`) — total, unacknowledged count, and last-24h count, for the
  dashboard tile.

To actually recover a failed instance, use **Retry** on the Instance Detail page (see
[Running & monitoring instances](06-running-and-monitoring-instances.md)) — Execution Errors is a
queue for *visibility and triage*, not the recovery action itself.

## Audit Log

`Admin → Audit Log` (`admin:iam`) — an append-only record of every consequential action across the
system: auth events, permission denials, version publish, deploy/activate/rollback, instance lifecycle
transitions, task actions, and admin/settings/secret changes. Each entry has an actor, a timestamp,
and a `kind` (e.g. `instance.aborted`, `settings.updated`, `job.triggered`). `GET /audit/facets`
returns the distinct kinds/actors currently present, for filter dropdowns — no hardcoded list to keep
in sync.

Audit rows are pruned by the same scheduled retention job as instance history, per the
**Audit retention (days)** System Setting (default 365).

## Notifications

The bell icon (top bar) shows in-app notifications for the logged-in user:
`task-assigned`, `sla-at-risk`, `sla-breached`, `instance-failed`, `deployment-succeeded`,
`deployment-failed`, `task-reminder`. Each links straight to the relevant instance/task/deployment.
Mark one read, or **mark all read**. Notifications persist (they survive a reload) — this is real
state, not a client-side toast.

Email delivery for the same events is available but off by default — turn on **Email delivery** under
Settings → System and configure SMTP details; in-app notifications work regardless.
