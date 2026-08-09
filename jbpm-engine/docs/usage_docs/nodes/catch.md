# Catch (Intermediate Catch Event)

**Category**: Events · **Ports**: 1 in, 1 out · **Palette**: Timer, Catch Message

## Purpose

Pauses the path mid-flow until a timer elapses, or a message/signal/condition arrives — the
in-the-middle-of-a-flow counterpart to [Boundary](boundary.md) (attached to another node) and
[Receive](receive.md) (message-only, with an `implementation` field for external-system wiring).

## Fields

| Field | Widget | Notes |
|---|---|---|
| `event` (Catch) | event: `timer`, `message`, `signal`, `condition` | What this node waits for |

Depending on `event`'s kind, the underlying data is `event.timer` (duration/date/cycle), `event.message`
(message name), or `event.signal` (signal name). `condition` waits on a generic condition wait —
resolved externally (e.g. by a signal targeting this token), not evaluated on a poll.

## Behavior

- **Timer** — creates a durable `TimerJob`; survives a server restart; fires via the same poller
  covered in [Jobs, timers & scheduling](../08-jobs-timers-and-scheduling.md). Subject to
  [`maxActiveTimers`](../10-security-and-quotas.md) if you've set that quota.
- **Message / Signal / Escalation** — waits for a matching broadcast (from a [Throw](throw.md)/
  [Send](send.md)/[End](end.md) throw, or the `POST /instances/:id/signal` API) targeting this
  instance.
- **Condition** — a generic wait, resolved by whatever mechanism your process design uses to resume
  this specific token (e.g. targeted signal by instance id).

## Example

Wait 5 minutes:

```json
{ "id": "wait", "type": "catch", "event": { "timer": { "duration": "PT5M" } } }
```

Wait for a signal:

```json
{ "id": "wait", "type": "catch", "event": { "signal": "DocumentsReceived" } }
```

## Gotchas

- A catch-timer on a **suspended** instance is left scheduled rather than fired — it resolves once
  the instance is resumed, it doesn't silently get skipped.
- Unlike [Boundary](boundary.md), a catch has no "interrupting" concept — it *is* the path; there's
  nothing else running on this branch to interrupt.
