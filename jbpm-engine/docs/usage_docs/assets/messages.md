# Messages

**Key**: `messages` · **Name field**: `name` · **Used by**: [Send](../nodes/send.md), [Receive](../nodes/receive.md), [Throw](../nodes/throw.md), [Catch](../nodes/catch.md)

## Purpose

A named message — nothing more than a name to correlate a sender and a receiver by. Declaring it as
an asset (rather than just typing a string on each node) keeps the name consistent and gives you one
place to see every message a project uses.

## Shape

```json
{ "name": "DocumentsReceived" }
```

## Wiring

- A [Send task](../nodes/send.md) or [Throw](../nodes/throw.md) signal/message broadcasts this name.
- A [Receive task](../nodes/receive.md) or [Catch](../nodes/catch.md) message waits for this name.
- Optionally narrow delivery to one specific instance via `correlationKey` on the sending side — see
  the [node reference overview](../nodes/README.md#cross-cutting-conventions-common-to-many-nodes).

## Gotchas

- There's no payload schema attached to a message asset — whatever data needs to travel with it goes
  through process variables (mapped in/out around the send/receive), not the message definition
  itself.
