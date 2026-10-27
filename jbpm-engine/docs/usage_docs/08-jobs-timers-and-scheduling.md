# Jobs, Timers & Scheduling

## How timers work

Every timer (a [Catch/Timer event](nodes/catch.md), a [Timer boundary](nodes/boundary.md), or a
**Start (Timer)** event's schedule) is backed by a durable `TimerJob` row — not an in-memory
`setTimeout`. A background poller (`TimerService.tick`, every **Executor interval (seconds)** — default
5s) scans for jobs whose `dueAt` has passed and fires them. Because it's a poll over persisted rows,
restarting the server never loses a pending timer.

- A **duration** timer (`PT5M`, `P1D`) fires once, `dueAt` computed from when the wait began.
- A **cycle** timer (`R3/PT1H` = 3 times, `R/PT1H` = unbounded) reschedules itself for the next
  occurrence after firing — up to its repeat count, if any.
- A timer belonging to a **suspended** instance is left scheduled rather than fired/consumed — it
  fires (or can be manually triggered) once the instance is resumed.

## The Jobs & Timers screen

`Jobs & Timers` in the sidebar (`workflow:view` to list, `workflow:run`-equivalent to act):

- **List** — every job for the tenant, scheduled-and-soonest-due first, then everything else
  newest-first. Filter by status, instance, or kind.
- **Cancel** — stops a `scheduled` job before it fires (only valid on `scheduled`).
- **Trigger** — fires a job right now instead of waiting for `dueAt` ("run it now"). Refused on a
  suspended instance's job, same as the automatic poller would refuse.
- **Reschedule** — move a job's `dueAt`; also revives a previously cancelled job back to `scheduled`.

## Timer-driven process starts

A **Start (Timer)** node's schedule is created when its deployment is **activated** (not when
deployed) — see [Deployments](05-deployments-and-environments.md#activate). Activating a new
deployment cancels the previously-active deployment's start-timers and schedules this one's, so you
never get two competing schedules for the same environment.

## Quota interaction

If [`maxActiveTimers`](10-security-and-quotas.md) is set and the tenant is at capacity when a new
timer needs scheduling, that node fails with a catchable `QUOTA_EXCEEDED` error (same as any other
node failure — add an error catch if you want a specific recovery path instead of the instance
failing outright). A recurring start-timer that hits this on one occurrence still reschedules its next
occurrence — a transient quota bump never permanently kills a cron schedule.

## Retries vs. timers

The **Default job retries** System Setting is about the executor's own retry policy for a job it
couldn't process (not about your process's business logic) — after that many attempts a job is marked
failed and surfaced in [Execution Errors](09-execution-errors-audit-and-notifications.md). For
business-level retry (e.g. "try this HTTP call again"), model it explicitly in the process — a boundary
timer + a loop-back flow, or an [error catch](nodes/boundary.md) that retries the same node.
