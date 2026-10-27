# End Event

**Category**: Events · **Ports**: unlimited in, 0 out · **Palette**: End, End (Terminate)

## Purpose

Completes a path through the process. A process can have multiple ends; several paths may converge
into the same one.

## Fields

| Field | Widget | Notes |
|---|---|---|
| `result` | select: `(normal)`, `terminate` | `terminate` cancels every other active token and ends the whole instance, not just this path |
| `throw` (Throw event) | event: `none`, `signal`, `error`, `escalation`, `message` | Fire something on the way out |
| `throw.correlationKey` | varRef (`$var`) | Narrow delivery to the one waiting instance whose own `correlationKey` matches; blank = every instance waiting on this name |

## Behavior

- **Normal end** — this token simply completes; the instance as a whole completes once every token
  has reached an end (or been cancelled).
- **Terminate** — ends the *entire instance* immediately, regardless of what else is still running in
  parallel branches. Use this for "abort everything the moment X happens," not a normal completion.
- **Throw: error** — raises an error exactly like any other node failure, routed to a matching
  [Boundary](boundary.md)/event-sub-process catch if one exists; unhandled, the instance fails. The
  code comes from the error name you type; an empty code defaults to `ERROR`.
- **Throw: signal / escalation / message** — broadcasts before completing (same delivery as an
  intermediate [Throw](throw.md)), then this path ends — the broadcast and the completion happen
  together, not the broadcast-then-continue behavior an intermediate throw has.
- **Compensation** — (available when a compensation event is configured) runs every recorded
  compensation handler in reverse order before completing.

## Example

Plain end:

```json
{ "id": "e", "type": "end" }
```

Terminate the whole instance:

```json
{ "id": "e", "type": "end", "result": "terminate" }
```

Throw a named error on the way out (catchable by a boundary/global handler):

```json
{ "id": "e", "type": "end", "throw": { "error": "VALIDATION_FAILED" } }
```

## Gotchas

- Picking "error" from the throw dropdown writes `throw: { error: '' }` immediately, before you type a
  code — that's intentional and still a valid error-throw (empty code → `ERROR`), not "no error
  configured."
- `terminate` is process-wide, including any embedded sub-process/multi-instance children currently
  running under this instance — don't reach for it if you only meant to stop one parallel branch (use
  a normal end on that branch, or a boundary/interrupting event instead).
