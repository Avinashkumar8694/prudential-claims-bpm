# Reports & Analytics

**Reports & Analytics** in the sidebar (`query:read`), backed by `QueryService` — cross-project,
read-only views over what's already recorded (no separate analytics pipeline to configure).

## What's available

- **Process analytics** — per-process instance counts by status, throughput over time.
- **Task analytics** — completion counts and cycle time by user/group.
- **Process definitions / instances / signals** — a jBPM-style query surface: list every deployed
  process definition, every instance of a given process (optionally filtered by status), and the
  signals a given process can receive (useful when wiring up an external system to
  [send/throw](nodes/send.md) into it).
- **Per-user / per-group task views** — `tasksForUser`, `tasksCompletedByUser`, `tasksForGroup` — the
  same data the Task Inbox uses, exposed for reporting rather than action.
- **Summary** — the dashboard tile numbers (active instances, open tasks, unacknowledged errors, etc.).
- **Jobs** — the same data as [Jobs & Timers](08-jobs-timers-and-scheduling.md), filterable by status,
  for a reporting view rather than an operational one.

## Notes

Everything here reads from the same store as the operational pages (Instances, Tasks, Jobs) — there
is no separate warehouse or batch ETL, so figures are always current, not "as of last night's job."
Retention (`instanceRetentionDays`/`auditRetentionDays` System Settings) determines how far back
history-based reports can see once pruning is enabled.
