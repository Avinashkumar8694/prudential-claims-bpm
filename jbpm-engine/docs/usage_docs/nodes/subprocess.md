# Sub-process

**Category**: Sub-process · **Ports**: 1 in, 1 out · **Palette**: Sub-process

## Purpose

An embedded sub-process — its own mini node graph, nested inside this node, sharing the parent's
variable scope. The same node type also models the **event sub-process** idiom (a process-wide global
error handler) when given `on.error` instead of a normal place in the sequence flow.

## Fields

| Field | Widget | Notes |
|---|---|---|
| `nodes` / `flows` | (canvas-nested) | The embedded graph, authored inside this node on the canvas |
| `transaction` | bool | Documentary marker — matches real jBPM's transaction sub-process concept |
| `on.error` (Event sub-process on error) | text | Error code that triggers this as an event sub-process instead |

## Behavior — embedded (normal placement in the flow)

Runs its own `nodes`/`flows` as a nested child instance of a synthetic composite process
(`<parentProcess>::<nodeId>`), **sharing** the parent's full variable scope both ways: the child starts
with a copy of every parent variable, and on completion **every** child variable merges back (not just
a declared subset — contrast with [Call Activity](call-activity.md)'s isolated, declared-outputs-only
mapping). If the embedded graph waits on something (e.g. its own [User Task](user-task.md)), the
parent token waits too, resuming when the child completes. An empty `nodes` array is a harmless
pass-through.

## Behavior — event sub-process (`on.error` set)

The other common "global error handler" idiom in real jBPM, alongside a [Boundary](boundary.md) with
`on: '*'`. It has **no incoming/outgoing sequence flow at all** by design — it's never reached
normally, only triggered when its declared error code (or a catch-all, `on: { error: '' }`) is raised
anywhere in the process. Always global and interrupting. It runs as a real nested child instance —
its own node visits live in that child's own history, findable via
[Related instances](../06-running-and-monitoring-instances.md#diagram-history-and-related-instances).

## Example — embedded

```json
{
  "id": "reviewSub", "type": "subprocess", "name": "Manager review",
  "nodes": [
    { "id": "s", "type": "start" },
    { "id": "review", "type": "userTask", "group": "managers" },
    { "id": "e", "type": "end" }
  ],
  "flows": [{ "id": "f1", "from": "s", "to": "review" }, { "id": "f2", "from": "review", "to": "e" }]
}
```

## Example — event sub-process (global error handler)

```json
{
  "id": "errSub", "type": "subprocess", "name": "Global error handler", "on": { "error": "" },
  "nodes": [
    { "id": "s2", "type": "start" },
    { "id": "cleanup", "type": "manual", "name": "Cleanup" },
    { "id": "e2", "type": "end" }
  ],
  "flows": [{ "id": "ef1", "from": "s2", "to": "cleanup" }, { "id": "ef2", "from": "cleanup", "to": "e2" }]
}
```

## Gotchas

- An event sub-process node is **exempt** from the normal "every node must be
  reachable/connected" validation rule — don't try to wire a sequence flow into or out of it; it
  doesn't take one.
- `on: { error: '' }` (empty string) is a legitimate catch-all, same convention as a global
  [Boundary](boundary.md) — not "unconfigured."
- **Ad-hoc sub-processes** (no fixed sequence flow among the nested nodes at all — a fundamentally
  different, unstructured execution model) are **not supported** here; every embedded sub-process
  needs real, structured `flows`.
