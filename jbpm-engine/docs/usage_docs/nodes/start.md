# Start Event

**Category**: Events · **Ports**: 0 in, 1 out (exactly one outgoing flow) · **Palette**: Start, Start
(Signal), Start (Timer)

## Purpose

Begins a process instance. Every process needs exactly one reachable start per entry path.

## Fields

| Field | Widget | Notes |
|---|---|---|
| `on` (Start trigger) | select: `none`, `signal`, `message`, `timer`, `condition` | How instances of this process begin |
| `on.timer` (Timer / cron) | text | ISO duration (`PT1H`), a date, or a recurring cycle (`R/PT1H`) |

## Behavior

- **`none`** (the plain "Start" palette entry) — the ordinary case: an instance begins when something
  calls `POST /instances` ([Running instances](../06-running-and-monitoring-instances.md)). The node
  itself does nothing at runtime beyond marking the entry point — all the actual triggering logic for
  signal/message/timer starts is resolved at the moment an instance is started, not inside this node's
  handler.
- **`signal`/`message`** — a fresh instance is spawned when that signal/message is broadcast and no
  specific waiting instance claims it (a targeted [Send](send.md)/[Throw](throw.md) to an existing
  instance's `correlationKey` doesn't trigger a new start; an untargeted broadcast can).
- **`timer`** — a durable, cron-like schedule. The `TimerJob` for this is created when the
  **deployment is activated**, not merely deployed — see
  [Jobs, timers & scheduling](../08-jobs-timers-and-scheduling.md). Activating a new deployment
  cancels the previous one's start-timer and schedules this one's.

## Example

```json
{ "id": "s", "type": "start" }
```

Timer-triggered, every hour:

```json
{ "id": "s", "type": "start", "on": { "timer": "R/PT1H" } }
```

## Gotchas

- A `signal`/`timer` start only actually fires once its deployment is **active** — deploying alone
  isn't enough.
- If [`maxActiveInstances`](../10-security-and-quotas.md) is at capacity, a timer-triggered start
  simply skips that occurrence (and, since the fix for recurring schedules, still reschedules its
  next one) rather than raising a visible error anywhere — check
  [Execution Errors](../09-execution-errors-audit-and-notifications.md) won't show this; it only shows
  up as a gap in expected instance starts.
