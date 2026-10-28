# Manual Task

**Category**: Tasks · **Ports**: 1 in, 1 out · **Palette**: Manual Task

## Purpose

A marker for work that happens **offline** — the engine only records that this step exists in the
process diagram/history; it has no operation to run and does not wait for anything.

## Fields

Only the shared General section (`name`, `documentation`) — no type-specific fields.

## Behavior

Its handler is a pure no-op: the token passes straight through in the same execution tick, exactly
like a script task that does nothing. **It does not create a task, and it does not pause the
instance** — if you need the process to actually wait for a human, use a [User Task](user-task.md)
instead.

## Example

```json
{ "id": "phoneCall", "type": "manual", "name": "Call the applicant to confirm" }
```

## Gotchas

- This is the single most common point of confusion when composing a test process: a chain of
  `manual` nodes all execute synchronously in one step, with nothing to claim or complete anywhere.
  If you want a pausable checkpoint, that's [User Task](user-task.md).
