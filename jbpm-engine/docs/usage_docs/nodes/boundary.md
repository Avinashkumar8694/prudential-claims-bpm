# Boundary Event

**Category**: Events · **Ports**: 0 in, 1 out (no incoming flow — it's attached to a host node, not
wired into the sequence flow) · **Palette**: Error Catch, Timer Catch, Compensation

## Purpose

Attaches to one or more other nodes (or the whole process) and catches an error/timer/message/signal/
escalation/condition that occurs while its host is active — the mechanism behind both "catch this
specific task's failure" and "process-wide error handler."

## Fields

| Field | Widget | Notes |
|---|---|---|
| `on` (Catch from) | nodes | Pick specific node id(s), or `'*'` for a process-wide (global) handler |
| `event` (Trigger) | event: `error`, `timer`, `message`, `signal`, `escalation`, `condition` | What triggers it |
| `interrupting` | bool | Whether it cancels the host activity when it fires |

## Behavior

- **Error, attached to a specific host** — matches **any** error from that host regardless of the
  error code/name (an http node can only ever raise `SERVICE_ERROR`, so a catch on that host doesn't
  need to know or match a specific name — useful when a mechanically-imported real jBPM process has
  its own custom error names that mean nothing to this runtime).
- **Error, global (`on: '*'`)** — still respects a **specific** declared code if you gave it one
  (`event.error: 'VALIDATION'` only catches that code); leave it empty/`'*'`/`'ANY'` for a true
  catch-all.
- **Timer** — a durable, cyclable wait alongside the host (see
  [Jobs, timers & scheduling](../08-jobs-timers-and-scheduling.md)) — e.g. an SLA reminder
  (non-interrupting, `cycle: 'R3/PT1H'`) or a hard deadline (interrupting, `duration: 'P1D'`).
- **Message / signal / escalation** — waits alongside the host for a broadcast, same delivery as
  [Catch](catch.md).
- **Interrupting** (default) — when it fires, the host activity is cancelled (its task exited, its
  timers cancelled) before this node's own outgoing flow runs.
- **Non-interrupting** — the host keeps running; this boundary's flow runs as a parallel side-effect
  (e.g. "send a reminder, but don't cancel the task").
- **The other error-catch idiom**: an **event sub-process** with `on: { error: ... }` (see
  [Sub-process](subprocess.md)) is recognized by the exact same matching logic as a boundary — it's
  always global/interrupting, running as its own nested child instance rather than a simple flow
  continuation.

## Example

Interrupting error catch on a specific HTTP task:

```json
{ "id": "onErr", "type": "boundary", "on": ["callApi"], "event": { "error": "*" }, "interrupting": true }
```

Non-interrupting SLA reminder every hour, up to 3 times:

```json
{ "id": "sla", "type": "boundary", "on": ["review"], "interrupting": false, "event": { "timer": { "cycle": "R3/PT1H" } } }
```

Process-wide catch-all:

```json
{ "id": "global", "type": "boundary", "on": ["*"], "event": { "error": "*" } }
```

## Gotchas

- A boundary node has **no incoming sequence flow** — connect its *outgoing* flow to the recovery
  path; leave `on` pointing at the host(s) it should watch.
- `event: { error: '' }` (empty string) is a legitimate catch-all, not "unconfigured" — don't mistake
  an empty field for a missing one when reading an existing process.
- [`maxActiveTimers`](../10-security-and-quotas.md) applies to timer boundaries the same as
  [Catch](catch.md) timers.
