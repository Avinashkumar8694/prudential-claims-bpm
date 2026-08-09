# Multi-Instance (forEach)

**Category**: Sub-process · **Ports**: 1 in, 1 out · **Palette**: Multi-Instance

## Purpose

Runs a **deployed process** once per item in a collection variable — parallel or sequential — and
collects each run's result. This engine's equivalent of BPMN's multi-instance sub-process, modeled as
a call to a separate process per item (not an inline node loop).

## Fields

| Field | Widget | Notes |
|---|---|---|
| `process` | processRef | Run once per item, on any process behind an active deployment |
| `over` (Collection variable) | varRef (own) | This process's own array variable to iterate |
| `as` (Item variable) | text | New variable name on the **child**, set to the current item each run |
| `collectInto` | varRef (own) | This process's variable to collect every child's item result into, as an array |
| `itemResult` | varRef (called) | Which variable on the **child** holds its one result, read into `collectInto` |
| `parallel` | bool | Run all items concurrently vs. one at a time |
| `pass` (Pass-through variables) | stringlist (own) | This process's own variables copied unchanged into every child run |

## Behavior

- **Parallel** (`parallel: true`) — every item's child instance starts together (`Promise.all`);
  the parent waits for all of them, then fails with `MULTIINSTANCE_ERROR` if **any** sibling failed,
  otherwise collects every result into `collectInto` and continues.
- **Sequential** (default) — starts the next item's child only after the previous one **settles**
  (completes or fails) — never starts item 2 while item 1 is still running. If every item happens to
  complete synchronously, the whole loop runs in one step with no visible "waiting" state in between;
  if any item actually waits (e.g. its process has a [User Task](user-task.md)), the parent parks
  until that item settles before starting the next.
- Each child gets its own isolated variable scope (`as` sets the current item there); only
  `itemResult` (via `collectInto`) and `pass`-through variables cross the boundary.

## Example

```json
{
  "id": "reviewEachPolicy", "type": "forEach", "process": "policy-review.process",
  "over": "applicablePolicies", "as": "currentPolicy",
  "itemResult": "reviewOutcome", "collectInto": "reviewResults",
  "parallel": false, "pass": ["claimId"]
}
```

## Gotchas

- `over` must already be an array by the time this node runs — populate it (e.g. via a
  [Script task](script.md) or [Rule task](rule.md)) before reaching this node.
- Sequential mode's "settle-before-next" behavior means a failing item **stops the loop** at that
  point (rather than running every item regardless) — same effect as parallel mode's
  `MULTIINSTANCE_ERROR`, just discovered one item earlier instead of all at once.
