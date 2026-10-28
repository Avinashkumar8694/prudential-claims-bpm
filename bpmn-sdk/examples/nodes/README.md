# Node examples

One runnable example per BPMN node the SDK models. Each authors the node as nodejs-supported engine
JSON, converts it to jBPM (`fromEngine`), validates + serializes BPMN, and round-trips it back
(`toEngine`). The `node` export mirrors the matching `docs/bpm-nodes/<folder>/engine.json`.

Run one: `node examples/nodes/user-task.mjs`  ·  run all: `node examples/nodes/run-all.mjs`

- [Start event (none)](start-event-none.mjs) — A plain start with no trigger — the process is started explicitly (API / manual).
- [Start event (signal)](start-event-signal.mjs) — A signal start — a broadcast signal spins up a new instance.
- [End event (none)](end-event-none.mjs) — A plain end — this path finishes; other tokens keep running.
- [End event (terminate)](end-event-terminate.mjs) — A terminate end — cancels every other token and ends the whole instance.
- [End event (signal throw)](end-event-signal-throw.mjs) — A signal-throwing end — finishes the path and broadcasts a signal to start downstream work.
- [End event (error throw)](end-event-error-throw.mjs) — An error-throwing end — aborts the path with an error the caller/boundary can catch.
- [Script task](script-task.mjs) — Runs inline code against the kcontext API (here: resolve a base URL into a process variable).
- [Service task (REST)](service-task-rest.mjs) — A REST call via the pru-rest-executor — the SDK builds the request payload and parses the response back into variables.
- [User task](user-task.mjs) — A human task assigned to a group, bound to a form, non-skippable.
- [Manual task](manual-task.mjs) — An offline task the engine only tracks — no work item is executed.
- [Business rule task](business-rule-task.mjs) — Fires a DRL ruleflow-group to classify the claim. (Swap `ruleflowGroup` for `dmn:{...}` to evaluate a DMN decision instead.)
- [Send task](send-task.mjs) — Sends a message to a downstream system.
- [Receive task](receive-task.mjs) — Waits for an inbound message before continuing.
- [Call activity (reusable)](call-activity.mjs) — Calls a reusable sub-process, mapping a variable in and a result out.
- [Call activity (multi-instance)](call-activity-multi-instance.mjs) — Runs a child process once per item in a collection (parallel), collecting each result.
- [Exclusive gateway](exclusive-gateway.mjs) — Takes exactly one branch — the first flow whose condition is true, else the default.
- [Parallel gateway](parallel-gateway.mjs) — Forks into concurrent paths (Diverging) and later joins them (Converging).
- [Inclusive gateway](inclusive-gateway.mjs) — Takes every branch whose condition is true (plus the default), then joins.
- [Event-based gateway](event-based-gateway.mjs) — Waits for whichever event fires first (a message or a timeout) and follows that path.
- [Intermediate catch (timer)](intermediate-catch-timer.mjs) — Pauses the token for a fixed duration before continuing.
- [Intermediate throw (signal)](intermediate-throw-event.mjs) — Broadcasts a signal mid-flow, then continues.
- [Intermediate catch (message)](event-message.mjs) — Waits mid-flow for a named message to arrive.
- [Intermediate catch (conditional)](event-conditional.mjs) — Waits until a data condition becomes true.
- [Intermediate throw (escalation)](event-escalation.mjs) — Raises an escalation mid-flow (handled by an outer boundary/event sub-process) and continues.
- [Boundary event (error)](boundary-event-error.mjs) — An interrupting error boundary on a call activity — on error, cancels the host and runs the error path.
- [Boundary event (timer)](boundary-event-timer.mjs) — A non-interrupting timer boundary on a user task — fires a reminder after 30 days while the task stays open.
- [Embedded sub-process](subprocess-embedded.mjs) — An inline sub-process with its own start/script/end — shares the parent variables.
- [Transaction sub-process](subprocess-transaction.mjs) — A transactional sub-process — its work commits or compensates as a unit.
- [Event sub-process](event-subprocess.mjs) — An error-triggered event sub-process — runs cleanup whenever the given error is thrown anywhere in the parent. Not connected by sequence flow.
- [Data object](data-object.mjs) — Process-scoped typed variables (data objects) — including a collection.
- [Lane](lane.mjs) — Swimlanes group nodes by the role that performs them.
- [Sequence flow](sequence-flow.mjs) — A connection between nodes; with `when`+`lang` it becomes a conditional branch on a gateway.
