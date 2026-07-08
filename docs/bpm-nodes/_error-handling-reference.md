# Error Handling Reference — Local & Global (Catch)

How to model error handling in BPMN/jBPM for a generator: **local** handlers (boundary events on a
specific activity) and **global** handlers (error event sub-process at process scope), how errors
are declared, propagated, and **caught**, and the layered pattern this project uses.

---

## 1. Core concepts (error vs signal vs escalation)
| Trigger | Interrupts? | Propagates to caller? | Continue after handling? | Use for |
|---------|:-----------:|:---------------------:|:------------------------:|---------|
| **Error** | yes | yes (bubbles child → parent) | no — instance aborts after the error sub-process | genuine failures that must stop/handle the case |
| **Signal** | no | broadcast (all listeners) | yes — flow continues | notify / hand off; recoverable events |
| **Escalation** | optional (non-interrupting possible) | yes (to a boundary/handler) | depends | raise attention while continuing (e.g. SLA warning) |

Key rule (jBPM): **an Error interrupts and aborts** once its handler runs; **a Signal lets the
process continue**. Choose accordingly.

---

## 2. Declaring & matching errors
Errors are declared once at definitions scope and matched by code/name between throw and catch:
```xml
<bpmn2:error id="TERMINATE_CASE" errorCode="TERMINATE_CASE"/>
```
- Thrower: `errorEndEvent` / work-item failure → `errorRef="TERMINATE_CASE"`.
- Catcher: boundary error event or error start event → `errorRef="TERMINATE_CASE"`.
- jBPM also matches on `drools:erefname="TERMINATE_CASE"` on the event definition.
- The special jBPM error `org.jbpm.bpmn2.handler.WorkItemHandlerRuntimeException` is thrown by a
  work-item handler (e.g. `RESTWorkItemHandler` when `HandleResponseErrors=true` and HTTP fails).

---

## 3. LOCAL error handling — boundary event on an activity
Attach a boundary error event to the **specific** activity that can fail. On failure the token
leaves via the boundary's outgoing flow (the activity is cancelled if interrupting).

```xml
<!-- host activity (unchanged) -->
<bpmn2:task id="_REST_TASK" drools:taskName="Rest" name="REST Execution"> … </bpmn2:task>
<!-- local catcher attached to it -->
<bpmn2:boundaryEvent id="_B_ERROR" attachedToRef="_REST_TASK" drools:boundaryca="true"
                     name="Catch REST Failure">
  <bpmn2:outgoing>_F3</bpmn2:outgoing>
  <bpmn2:errorEventDefinition drools:erefname="org.jbpm.bpmn2.handler.WorkItemHandlerRuntimeException"
                              errorRef="org.jbpm.bpmn2.handler.WorkItemHandlerRuntimeException"/>
</bpmn2:boundaryEvent>
<!-- handler path -->
<bpmn2:sequenceFlow id="_F3" sourceRef="_B_ERROR" targetRef="_BUILD_CTX"/>
```
Used in `pru-rest-executor`: the boundary catches the HTTP failure and routes to the retry /
error-handler path. See `boundary-event-error/` and `_boundary-events-reference.md`.

**When to use local:** the failure is specific to one activity and has a bespoke recovery
(retry this call, use a fallback, ask an admin) that should NOT abort the whole case.

---

## 4. GLOBAL error handling — error event sub-process
Define an event sub-process (`triggeredByEvent="true"`) with an **error start event** at process
scope. It catches any matching error that isn't handled locally and propagates up; after it runs,
the instance ends (aborted).

```xml
<bpmn2:subProcess id="_GLOBAL_TERMINATE_SUBPROCESS" name="Global Terminate Subprocess"
                  triggeredByEvent="true">
  <bpmn2:startEvent id="_START_TERMINATE_EVENT" isInterrupting="true">
    <bpmn2:outgoing>_F_TERM</bpmn2:outgoing>
    <bpmn2:errorEventDefinition drools:erefname="TERMINATE_CASE" errorRef="TERMINATE_CASE"/>
  </bpmn2:startEvent>
  <bpmn2:endEvent id="_END_TERMINATE_EVENT" name="Terminate Case">
    <bpmn2:incoming>_F_TERM</bpmn2:incoming>
    <bpmn2:terminateEventDefinition/>
  </bpmn2:endEvent>
  <bpmn2:sequenceFlow id="_F_TERM" sourceRef="_START_TERMINATE_EVENT" targetRef="_END_TERMINATE_EVENT"/>
</bpmn2:subProcess>
```
Present in every business process here (`pru-verification-process`, `pru-system-claim-process`,
`pru-process-single-claim`, main). See `event-subprocess/`.

**When to use global:** a cross-cutting failure that should end the whole case regardless of which
node raised it (e.g. an examiner/admin decides to terminate → throw `TERMINATE_CASE`).

> jBPM note: use an **event sub-process with an error start event** OR a **boundary event on a
> regular (none-start) sub-process** — do not put a boundary event on an event sub-process.

---

## 5. Local vs Global — at a glance
| | Local (boundary) | Global (error event sub-process) |
|--|------------------|----------------------------------|
| Scope | one specific activity | whole process instance |
| XML | `boundaryEvent attachedToRef=host` | `subProcess triggeredByEvent=true` + error start |
| Catches | error thrown by that activity | any matching error not caught locally |
| Outcome | alternate path; case continues | runs handler then aborts instance |
| Use | retry/fallback for that call | terminate/compensate the case |

---

## 6. Propagation & the project's layered pattern
Errors bubble from a **child** (call activity / sub-process) to the **parent** until caught:

```
REST call fails (RESTWorkItemHandler, HandleResponseErrors=true)
  └─ LOCAL boundary error on the REST task (inside pru-rest-executor)
        └─ calls pru-api-error-handler  (retry loop)
              ├─ Timer_1mWait  (back-off: intermediate catch timer, PT1M ~ 15m)
              ├─ retry the API (dynamic REST)
              ├─ Success? → resume the caller
              └─ retries exhausted / admin says stop
                    └─ throw errorEnd  TERMINATE_CASE
                          └─ propagates to the caller process
                                └─ GLOBAL error event sub-process catches TERMINATE_CASE
                                      └─ terminate end → whole case aborts
```
So every business REST node gets automatic retry (local) and a single global kill-switch
(`TERMINATE_CASE`). Files: `pru-rest-executor.bpmn` (local boundary + call to handler),
`pru-api-error-handler.bpmn` (retry/back-off/admin), the Global Terminate event sub-process in
each business process.

---

## 7. Alternatives to hard errors
- **Signal**: convert a technical exception into a signal (jBPM `SignallingTaskHandlerDecorator`)
  so the process **continues** on a chosen path instead of aborting.
- **Escalation** (`escalationEventDefinition`): attach a **non-interrupting** boundary to raise a
  side-action (reminder, notify supervisor) while the activity keeps running.
- **`ProcessWorkItemHandlerException`** (jBPM ≥ 7.13): a handler can request a strategy —
  `COMPLETE`, `RETRY`, `ABORT`, or `RETHROW` — with a retry count, instead of manual boundary wiring.

---

## 8. Generator checklist
1. Declare each `<bpmn2:error id errorCode>` once at definitions scope.
2. **Local**: emit `boundaryEvent attachedToRef=<host> cancelActivity=true` + `errorEventDefinition`
   + a flow from the boundary to the handler (add to handler's `<incoming>`, NOT host's `<outgoing>`);
   emit docked DI shape + edge.
3. **Global**: emit one `subProcess triggeredByEvent="true"` with an interrupting error start event
   (`isInterrupting="true"`) → terminate/none end; wire an internal flow.
4. Ensure thrown `errorRef` values match a declared error and a catcher; otherwise the error escapes
   and faults the instance.
5. Decide interrupt semantics: error/interrupting-timer = cancel host; signal/escalation
   non-interrupting = parallel side-path.

## Sources
- jBPM Exception Management (ch.23) — https://docs.jbpm.org/7.0.0.Beta1/jbpm-docs/html/ch23.html
- Red Hat JBoss BPM Suite — Working with Processes — https://access.redhat.com/documentation/en-us/red_hat_jboss_bpm_suite/6.4/html/development_guide/chap_working_with_processes
- Handle service exceptions via subprocess (M. Świderski) — https://mswiderski.blogspot.com/2018/10/handle-service-exceptions-via-subprocess.html
- Camunda BPMN 2.0 reference — https://camunda.com/bpmn/reference/
