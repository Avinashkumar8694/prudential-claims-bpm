# Receive Task

**Category**: Tasks · **Ports**: 1 in, 1 out · **Palette**: Receive Task

## Purpose

Waits for a named message to arrive — the task-shaped counterpart to a [Catch](catch.md) message
event, and the receiving side of a [Send](send.md)/[Throw](throw.md) pair.

## Fields

| Field | Widget | Notes |
|---|---|---|
| `message` | assetRef → [messages](../assets/messages.md) | The message to wait for |
| `implementation` | select: `##WebService`, `Other` | Documentary, matches real jBPM's own field |

## Behavior

Parks the token on `wait: { kind: 'message', ref: message }` until a matching broadcast arrives — from
a [Send](send.md)/[Throw](throw.md)/[End](end.md) throw elsewhere, or the
`POST /instances/:id/signal` API.

## Example

```json
{ "id": "awaitDocs", "type": "receive", "message": "DocumentsReceived" }
```

## Gotchas

- No timeout by itself — pair it with a [Boundary](boundary.md) timer if you need "give up waiting
  after N hours."
