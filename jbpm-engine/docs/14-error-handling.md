# 14 — Error Handling (Error Catch / Boundary / Global)

A single, simple **Error Catch** node covers jBPM's two error-handling shapes — **boundary error events**
(attached to specific activities) and a **process-wide error handler** (event sub-process) — chosen by
*which nodes it catches from*.

## 1. Model (engine JSON)

An error catch is a `boundary` node:
```jsonc
{
  "type": "boundary",
  "on": ["taskA", "taskB"],   // node id(s) to catch from; ["*"] = ALL nodes (process-wide handler)
  "event": { "error": "*" },  // error code to match; "*" or "" = any error
  "interrupting": true         // cancel the caught activity (error boundaries are interrupting)
}
```
- `on` — a single id, a **list of ids** (boundary on each), or `["*"]` (global/process-wide).
- `event.error` — a specific **error code**, or `*`/blank for **any** error.
- The node's **outgoing flow is the recovery path** — connect it to the nodes that handle the error.
- When caught, the variable **`errorInfo` = `{ code, node, message }`** is set for the recovery path.

**Selecting all nodes ⇒ a global error handler for the process.** Selecting specific nodes ⇒ per-node
boundary catches. One node concept, both behaviors — configured in the Properties panel with a node
checklist + an “All nodes (process-wide)” toggle.

## 2. Error taxonomy (what can be caught)

| Code | Raised when |
|------|-------------|
| `SCRIPT_ERROR` | a Script task throws |
| `SERVICE_ERROR` | a Service (REST) task fails — non-2xx / network / timeout *(when HTTP exec lands)* |
| `RULE_ERROR` | a Business Rule / DMN evaluation fails *(when rule exec lands)* |
| `CALL_ERROR` | a called sub-process errors or isn't deployed |
| `RUNTIME_ERROR` | any other handler exception |
| *custom* | an **error-throw End** (`end.throw.error = "MY_CODE"`) or a coded error you raise |

A catch with `event.error = "SCRIPT_ERROR"` matches only that; `*`/blank matches **any** of the above.
The set of built-ins is exported from the engine (`ENGINE_ERRORS`) and shown as suggestions in the UI.

## 3. Runtime behavior (matching + routing)

When a node raises an error, the engine finds the **best** matching error catch, in order:
1. attached to the failing node **and** code matches
2. attached to the failing node, **any**-error
3. global (`*`) **and** code matches
4. global, **any**-error

If found: the failing token is cancelled, `errorInfo` is set, and a token is placed on the catch →
its recovery flow runs. A **global** catch is process-interrupting (cancels all other tokens). If **no**
catch matches, the instance goes `failed` (unchanged behavior). Fully covered by
`server/test/engine-errors.test.ts`.

## 4. Validation (Phase 7 rules)

- `boundary-host` — an error catch must attach to existing node(s) or `*`; else error.
- `node-connected` — the catch must have an outgoing (recovery) connection.
- `reachable` — node-attached catches are reachable via their host; global (`*`) catches are always
  reachable. So an error catch with no recovery path or a dangling attach blocks publish.

## 5. Export to jBPM (capability)

`fromEngine` expands an error catch to standard BPMN on export:
- **single host** → one boundary error event on that activity (as today).
- **multiple hosts** → **one boundary event per host**, each sharing the catch's recovery flow.
- **global (`*`)** → a boundary event on **every activity** except the catch's own recovery path
  (a valid BPMN approximation of a process-wide handler). *Follow-up:* emit a true **event
  sub-process with an error start event** for the global case (cleaner kjar); tracked in the checklist.

Error codes become BPMN `<error errorCode=…>` declarations and `errorRef`s; `*`/blank ⇒ a catch-all
boundary (no errorRef). Verified by `bpmn-sdk/test/engine-error-catch.test.mjs`.

## 6. UI

Palette: **Error Catch** (red ⚠). Properties → *Catch from*: a checklist of the process's nodes plus
**All nodes (process-wide handler)**; *Trigger*: error with a code field (blank/`*` = any, with
built-in code suggestions); *Interrupting*. Draw the catch's outgoing flow to the recovery nodes.
Multiple error catches per process are allowed (different nodes / codes).
