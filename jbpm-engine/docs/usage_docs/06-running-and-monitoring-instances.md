# Running & Monitoring Instances

## Starting an instance

**Instances → Start New Instance**, or `POST /api/instances` (`workflow:run`) with:

```json
{ "workflowId": "...", "environment": "prod", "variables": { "amount": 500 }, "correlationKey": "CLAIM-123" }
```

- Omit `deploymentId` to resolve the environment's currently **active** deployment; pass it explicitly
  to pin a specific (e.g. rolled-back) one instead.
- `processId` picks which process, if the project has more than one.
- `correlationKey` lets a later signal/message target *this* instance specifically — see
  [Send/Receive](nodes/send.md) and [Throw/Catch](nodes/throw.md).
- If [`maxActiveInstances`](10-security-and-quotas.md) is set and the tenant is at capacity, this
  returns `429 QUOTA_EXCEEDED`.

## Instance status

| Status | Meaning |
|---|---|
| `running` | Actively executing a step right now |
| `waiting` | Parked at a wait point — a task, timer, signal, message, or condition |
| `suspended` | Paused: no task/signal/timer does anything until resumed (see below) |
| `completed` | Reached a normal end |
| `aborted` | Manually stopped |
| `failed` | An unhandled error — no matching error catch anywhere in the process |

## Managing a running instance

All under `workflow:run`, from the Instance Detail page or the API:

- **Signal** (`POST /instances/:id/signal`) — deliver a named signal/message to this specific instance,
  resuming any token waiting on it.
- **Suspend / Resume** — pauses/resumes the *whole tree* (this instance and every descendant
  sub-process/call-activity child) — a task, timer, or signal on a suspended tree is refused until
  resumed, not silently dropped.
- **Abort** — stops the instance and its whole subtree; no orphaned children left running. Aborting a
  child also unblocks a parent that was waiting on it.
- **Retry** (`POST /instances/:id/retry` with a `nodeId`) — re-attempts a failed node in place, useful
  after fixing an external dependency (e.g. the service an [HTTP task](nodes/http-service.md) called
  was down). Blocked on a terminal instance — there's nothing left to retry.
- **Update variables** (`PUT /instances/:id/variables`) — only when the
  **"Allow variable edits on running instances"** System Setting is on; every change is recorded
  (`GET /instances/:id/variable-history`) with who changed what, from what, to what, when.

Signal/suspend/resume/abort are all blocked on an already-terminal instance (`completed`/`aborted`) —
there's nothing left to act on, and silently no-op'ing behind a success toast would be misleading.
`failed` is also blocked for signal (the waiting token is already gone) but not for retry (that's
exactly what retry is for).

## Diagram, history, and related instances

- **Diagram tab** — live view of the process graph with active/visited nodes highlighted (`GET
  /instances/:id/diagram-state` / `/graph`), same rendering the builder canvas uses.
- **Logs / History tab** — every node visit (`enteredAt`/`exitedAt`/`outcome`), including any
  `console.log` output from a [Script task](nodes/script.md).
- **Related tab** — parent instance and every child (call activity, embedded/event sub-process, or
  multi-instance fan-out) — `GET /instances/:id/related`.

## Timer-driven and signal-driven starts

An instance can also begin without a direct API call: a **Start (Timer)** node fires on its schedule
(`startedBy: 'timer'`), or a **Start (Signal)** node fires when that signal is broadcast to no specific
instance (a fresh instance is spawned per broadcast) — see the [Start event](nodes/start.md) doc and
[Jobs, timers & scheduling](08-jobs-timers-and-scheduling.md).
