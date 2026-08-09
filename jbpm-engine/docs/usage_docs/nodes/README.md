# Node Reference

Every node type the engine can execute, one document each. Each doc covers: what it's for, its
palette entries, every field, its runtime behavior, a worked example, and gotchas worth knowing before
you rely on it.

## By category (matches the canvas palette)

**Events**
- [Start](start.md) — begins an instance (plain, signal-triggered, or timer/cron-scheduled)
- [Catch](catch.md) — intermediate wait for a timer, message, signal, or condition
- [Throw](throw.md) — intermediate broadcast of a signal/message/escalation, or run compensation
- [Boundary](boundary.md) — attached to another node (or process-global); catches error/timer/
  message/signal/escalation/compensation, interrupting or not
- [End](end.md) — completes a path (normal, terminate-the-instance, or throw-on-the-way-out)

**Tasks**
- [User Task](user-task.md) — a human task, claimed/completed from the Task Inbox
- [Script](script.md) — runs JavaScript (or, from a real jBPM import, real compiled Java) against `kcontext`
- [HTTP / Service Task](http-service.md) — a real outbound REST call
- [Business Rule](rule.md) — evaluates DRL, DMN, a decision tree, or a scorecard
- [Send](send.md) / [Receive](receive.md) — message send/wait, for correlating with an external system
- [Manual](manual.md) — a no-op marker for offline/manual work
- [Work Item](work-item.md) — Email/SMS/DB/Compute/Log operation handlers

**Gateways**
- [Gateway](gateway.md) — exclusive, parallel, inclusive, event-based, or complex branching/joining

**Sub-process**
- [Call Activity](call-activity.md) — invoke another deployed process as a child instance
- [Multi-Instance (forEach)](for-each.md) — run a process once per item in a collection, parallel or sequential
- [Sub-process](subprocess.md) — an embedded (shared-scope) sub-process, or an event sub-process (global error handler)

## Cross-cutting conventions, common to many nodes

- **`$name` reads a process variable.** Any field documented as "value or `$var`" treats a string
  starting with `$` as "read this process variable," and anything else as a literal — the same
  convention on [HTTP](http-service.md), [Work Item](work-item.md), [Call Activity](call-activity.md),
  and [User Task](user-task.md) input mappings.
- **Error codes are fixed per node type**, not author-chosen: a script always raises `SCRIPT_ERROR`, an
  HTTP task `SERVICE_ERROR`, a rule task `RULE_ERROR`, a call activity `CALL_ERROR`, a sub-process
  `SUBPROCESS_ERROR`, multi-instance `MULTIINSTANCE_ERROR`, and anything else `RUNTIME_ERROR` — see
  [Boundary](boundary.md) for how a catch matches these. A catch **attached to one specific host**
  matches any error from that host regardless of the name you gave it (useful when mechanically
  importing a real jBPM process whose custom error names mean nothing to this runtime); a **global**
  catch (`on: '*'`, or an event sub-process) still respects a specific declared code if you gave it
  one.
- **Escalation and signal share one delivery mechanism.** An escalation throw/catch resolves through
  the exact same broadcast-matching path a plain signal does — there's no separate "escalation" wait
  kind internally, just a different BPMN vocabulary for the same thing.
- **Correlation** (`correlationKey` on End/Throw/Send): narrows delivery to only the instance(s) whose
  *own* `correlationKey` (set at [instance start](../06-running-and-monitoring-instances.md)) matches
  a `$variable`'s value — blank delivers to every instance currently waiting on that name.
