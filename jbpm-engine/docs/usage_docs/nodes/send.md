# Send Task

**Category**: Tasks · **Ports**: 1 in, 1 out · **Palette**: Send Task

## Purpose

Sends a named message, then continues immediately — the task-shaped counterpart to a
[Throw](throw.md) signal event, and the send side of a [Receive](receive.md)/[Catch](catch.md) pair.

## Fields

| Field | Widget | Notes |
|---|---|---|
| `message` | assetRef → [messages](../assets/messages.md) | The message to send |
| `implementation` | select: `##WebService`, `Other` | Documentary — matches real jBPM's own field for how the message is technically delivered |
| `correlationKey` (Correlate to) | varRef (`$var`) | Narrow delivery to the one waiting instance whose own `correlationKey` matches; blank = every instance waiting on this name |

## Behavior

Broadcasts the message (`c.broadcast(message, correlationValue)`) — resolves any matching
[Receive](receive.md) or [Catch](catch.md) wait, targeted or session-wide per `correlationKey` — then
proceeds on its own outgoing flow without waiting for a response. If you need a request/response
round trip with an external system, that's an [HTTP task](http-service.md), not Send/Receive (which
model async messaging, not synchronous calls).

## Example

```json
{ "id": "notify", "type": "send", "message": "ClaimSubmitted", "correlationKey": "$claimId" }
```

## Gotchas

- Like [Throw](throw.md), if nothing is currently waiting on this message, the send is a silent no-op
  — there is no queue or later delivery.
