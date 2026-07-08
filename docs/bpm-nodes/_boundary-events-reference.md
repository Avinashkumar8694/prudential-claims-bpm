# Boundary Events Reference

How boundary events attach to a host activity and how attaching changes behaviour — essential for
a BPMN-generating engine.

## What a boundary event is
A catch event docked on the **border** of an activity (task, call activity, sub-process). It listens
for a trigger (error, timer, signal, message, escalation, …) while the host is active. This project
uses **error** and **timer** boundaries.

## Attachment model (how it is stored)
1. The boundary is a **separate top-level element** inside the process, NOT a child of the host:
   ```xml
   <bpmn2:boundaryEvent id="_SC_TIMER" attachedToRef="_SC_AWAIT" cancelActivity="true">
     <bpmn2:outgoing>_ftimer</bpmn2:outgoing>
     <bpmn2:timerEventDefinition><bpmn2:timeDuration xsi:type="bpmn2:tFormalExpression">P30D</bpmn2:timeDuration></bpmn2:timerEventDefinition>
   </bpmn2:boundaryEvent>
   ```
2. `attachedToRef` points at the host id. **The host's own XML is unchanged** — it does not list the
   boundary in its `<incoming>`/`<outgoing>`. The boundary carries its OWN `<outgoing>` to the handler.
3. A sequence flow goes FROM the boundary id to the handler node.
4. Diagram: the boundary shape is docked on the host border. jBPM adds `drools:boundaryca="true"`
   and often `drools:dockerinfo="x^y|"`; the `dc:Bounds` sits on the host's edge.

## How attaching affects the host node's behaviour
| Aspect | Effect |
|--------|--------|
| Normal completion | Host still leaves via its **own** success `<outgoing>` (unchanged). |
| Trigger fires | Token additionally/alternatively leaves via the **boundary's** `<outgoing>`. |
| `cancelActivity="true"` (interrupting, default) | When the trigger fires, the host work item is **cancelled**; only the boundary path continues. |
| `cancelActivity="false"` (non-interrupting) | Host keeps running; a **parallel** token is spawned down the boundary path. |
| Host `<incoming>` | Never changed by attaching. |
| Host `<outgoing>` | Never changed; the alternate exit lives on the boundary, not the host. |

## Generator checklist (attaching a boundary)
1. Emit the host activity normally (with its normal success outgoing).
2. Emit `<bpmn2:boundaryEvent attachedToRef="<hostId>" cancelActivity="true|false">` with the
   event definition (`errorEventDefinition` / `timerEventDefinition`) and one `<outgoing>`.
3. Emit a `<bpmn2:sequenceFlow>` from the boundary id to the handler node; add it to the handler's
   `<incoming>`. Do NOT add it to the host's `<outgoing>`.
4. Emit DI: a `BPMNShape` for the boundary docked on the host border, and a `BPMNEdge` for its flow.
5. Declare referenced `<bpmn2:error>` at definitions scope (error boundary).

## Examples in this project
| Boundary | Host | Trigger | cancelActivity | On fire |
|----------|------|---------|:--------------:|---------|
| `_B_ERROR` (error) | `_REST_TASK` (rest-executor) | `WorkItemHandlerRuntimeException` | true | cancel REST task -> error-handler path |
| `_SC_TIMER` (timer) | `_SC_AWAIT` user task | `P30D` (PT1M test) | true | cancel wait -> assign to examiner |

## Interrupting vs non-interrupting — choosing
- Interrupting (`true`): the activity must stop when the event happens (timeout that abandons the
  wait, failure that aborts the call). Default and used here.
- Non-interrupting (`false`): fire a side-action while the activity continues (e.g. send a reminder
  at day 15 but keep waiting). Emit a second, parallel path.
