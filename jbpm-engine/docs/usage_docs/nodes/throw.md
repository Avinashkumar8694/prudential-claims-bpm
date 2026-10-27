# Throw (Intermediate Throw Event)

**Category**: Events · **Ports**: 1 in, 1 out · **Palette**: Throw Signal, Compensate

## Purpose

Broadcasts a signal/message/escalation to any waiting listener, or runs compensation — then
**continues** on its own outgoing flow (unlike an [End](end.md) throw, which ends the path).

## Fields

| Field | Widget | Notes |
|---|---|---|
| `event` (Throw) | event: `signal`, `message`, `escalation`, `compensation` | What to throw |
| `event.ref` (Compensate activity) | text | Host node id to compensate; blank = compensate every completed activity |
| `event.correlationKey` (Correlate to) | varRef (`$var`) | Narrow delivery to the one waiting instance whose own `correlationKey` matches; blank = every instance waiting on this name |

## Behavior

- **Signal / message / escalation** — broadcasts (`c.broadcast(name, correlationValue)`), resolving any
  matching [Catch](catch.md)/[Boundary](boundary.md)/[Receive](receive.md) wait anywhere it's targeted,
  then proceeds. Escalation and signal share the exact same delivery mechanism internally — there's no
  behavioral difference beyond the BPMN vocabulary you're using.
- **Compensation** — runs every recorded compensation handler in reverse completion order (or just the
  one named by `event.ref`), merges their variable changes back, then proceeds.

## Example

```json
{ "id": "notify", "type": "throw", "event": { "signal": "ReviewComplete" } }
```

Compensate one specific earlier activity:

```json
{ "id": "undo", "type": "throw", "event": { "compensation": true, "ref": "reserveInventory" } }
```

## Gotchas

- If nothing is currently waiting on the name you throw, the broadcast is simply a no-op — there's no
  error, no queue, no "delivered later." Timing matters: the catcher needs to already be waiting.
- Compensation only affects activities that actually **completed** — nothing to compensate for a
  branch that never ran.
