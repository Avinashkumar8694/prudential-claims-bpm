# 08 — Execution Engine

A Node token-based interpreter that runs the SDK **engine JSON** directly. Deterministic core (clock &
IDs injected), durable (persist after each committed step), resumable (wait states rehydrate).

## 1. Token semantics

- An **instance** starts with one token on the (a) start node.
- A token is **advanced** by the handler for its node's `type`. Advancing yields zero or more
  **outgoing tokens** placed on target nodes (per outgoing flows), or a **wait**.
- The engine runs a **step loop**: pop a runnable (active) token → run its handler → apply effects
  (new tokens / waits / variable writes / events) → persist → repeat until no active tokens remain
  (instance is `waiting`, `completed`, `aborted`, or `failed`).
- Parallelism (parallel gateway, event subprocess, boundary) = multiple concurrent tokens.

## 2. Node handlers (one per engine `type`)

| type | Behavior |
|------|----------|
| `start` | Seed variables; if triggered (signal/message/timer/conditional) it's the correlation entry; emit token on outgoing |
| `end` | Consume token. `result:'terminate'` → cancel all tokens & complete. `throw` → raise signal/error/escalation/message |
| `script` | `lang:'js'` → run sandboxed against a `kcontext` shim (get/setVariable). `java`/`mvel` → **not executed**; recorded as skipped (export-only) |
| `http` | Build request from `body`/`$var`, call `env.INTEGRATION_LAYER_URL + url`, map `resultTo` (JSONPath) → variables |
| `rule` | `ruleflowGroup` → run **rule-engine** over matching facts; `dmn` → **dmn-engine** decision; write results back |
| `call` | Start a child instance of `process`; map `inputs`; on child complete map `outputs`; parent token waits |
| `forEach` | Multi-instance: start a child per item in `over`; `parallel` → concurrent, else sequential; collect `itemResult` → `collectInto` |
| `userTask` | Create a **Task**; token **waits** until the task is completed (outputs → variables) |
| `send` | Emit a message onto the SignalBus (and/or external) |
| `receive` | Token **waits** for a matching message |
| `manual` | No work item; auto-complete (tracked only) |
| `gateway` | `exclusive`→first true condition else default; `parallel`→fork/join (join waits for all incoming); `inclusive`→all true + default, join waits for the matching set; `event`→wait for first downstream catch; `complex`→pluggable rule |
| `catch` | Wait for the event (`timer`→TimerJob; `message`/`signal`→SignalBus; `condition`→re-eval on var change) |
| `throw` | Raise signal/message/escalation immediately, then continue |
| `boundary` | Attached to a host node; interrupting cancels the host token & routes to the boundary flow; non-interrupting spawns a parallel token; timer/error/message/signal/conditional/escalation |
| `subprocess` | Embedded: run nested nodes/flows in a child scope (shares vars). Transaction: same + compensation hook. Event: not on the main flow; triggered by its start event (e.g. error) |

Handler contract:
```ts
interface HandlerResult {
  next?: { flowId?: string; nodeId: string }[];   // tokens to create
  wait?: WaitSpec;                                 // this token waits
  vars?: Record<string, unknown>;                  // variable writes
  events?: EngineEvent[];                           // signals/messages/audit
  end?: 'complete' | 'terminate' | 'error';
}
type Handler = (ctx: NodeCtx) => Promise<HandlerResult>;
```

## 3. Wait states & resume

| Wait | Persisted as | Resumed by |
|------|--------------|-----------|
| user task | `Task` + token `waitFor:{kind:'task'}` | `POST /tasks/:id/complete` |
| timer / boundary-timer | `TimerJob` | scheduler when `dueAt` ≤ now |
| catch message / receive | token `waitFor:{kind:'message', ref}` | matching message on SignalBus |
| catch signal | token `waitFor:{kind:'signal', ref}` | matching signal |
| catch conditional | token `waitFor:{kind:'condition'}` | variable change re-evaluates the expr |
| call/forEach child | parent token `waitFor:{kind:'child'}` | child instance completes |

Resume = load instance → place event → re-enter the step loop → persist.

## 4. Determinism & persistence

- Injected `clock()` and `newId()`; the step function never calls `Date.now()`/`Math.random()`.
- After each committed step the instance (+ new tasks/timers) are written in one store transaction.
- Crash-safe: on boot, the scheduler re-loads `scheduled` timers and `running` instances with runnable
  tokens and resumes.

## 5. Timers

- `TimerService` polls `timers` where `status='scheduled' AND dueAt<=now` (or uses a min-heap in
  memory backed by the store). Fires → resume token → for cycles, reschedule next `dueAt`.
- Durations `PTnMnS`/`PnD`, cycles `R/PT1H` / `R5/PT10M`, and absolute dates supported.

## 6. Scripts & expressions (safety)

- `js` scripts and `js`/`mvel` flow conditions run in a **sandbox** (`node:vm` context or
  `isolated-vm`) with only a `kcontext`/vars shim, no `require`, no globals, a CPU/time budget.
- `java`/`mvel` scripts are **not executed** (no JVM); the node is recorded `skipped` with a warning
  and the value is preserved for **export**. Authors targeting Node-execution should use `js`.
- Flow conditions: `js` → sandbox eval to boolean; unsupported dialects → treated as `false` unless a
  default flow exists (validation warns).

## 7. Errors & compensation

- A handler throwing → nearest **interrupting error boundary** on an enclosing scope catches it; else
  the instance goes `failed` with `error{nodeId,message}`; operator can **retry the node** or abort.
- `end.throw.error` propagates like a thrown error (to boundaries / event subprocess).
- Transaction sub-process: on failure runs registered compensation (v1: hook + manual; auto-comp P2).

## 8. Events & observability

- Emits `instance.started/updated/completed/failed`, `node.entered/exited`, `token.moved`,
  `task.created/completed`, `timer.scheduled/fired`, `signal.sent`, `message.received`.
- Every event → **audit** (redacted) + **WS hub** (live UI). The instance `history` (NodeVisit[]) is
  the backing data for the **per-instance detail** view and the **canvas live-highlight**.

## 9. Testing hooks

- `ExecutionEngine.runToQuiescence(instance)` advances until all tokens wait/finish — deterministic.
- Fake clock + manual `tick(dueAt)` to fire timers in tests.
- Golden traces: assert the ordered `history` for a given input (matches the SDK round-trip tests'
  spirit).
