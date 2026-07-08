# Boundary Event (Error) — usage guide

## 1. Details
BPMN element: `<bpmn2:boundaryEvent attachedToRef="<hostId>">` with `<bpmn2:errorEventDefinition>`.
Attached to the border of an **activity** (task / call activity). Catches a BPMN error thrown by
that activity and diverts the token out of the boundary's outgoing flow.

## 2. Usage
In `pru-rest-executor`, `Catch REST Failure` is attached to the REST task and catches
`WorkItemHandlerRuntimeException` (thrown when `HandleResponseErrors=true` and the HTTP call
fails), routing to the retry/error-handler path.

## 3. How / when to use
- Use to handle failure of a specific activity locally (retry, compensate, alternate path).
- `cancelActivity="true"` (interrupting, default) = the host activity is cancelled when the error
  fires; `false` (non-interrupting) = host keeps running and a parallel token is spawned.
- The host activity gains an **extra outgoing path** (via the boundary) in addition to its normal
  success outgoing.

## HOW ATTACHING AFFECTS THE HOST (important for a BPMN generator)
1. The boundary event is a **separate element** with `attachedToRef="<hostId>"` — the host's own
   XML does NOT list the boundary in its `<outgoing>`; the boundary carries its own `<outgoing>`.
2. On the diagram, the boundary shape is docked on the host's border (`drools:dockerinfo`,
   and its `dc:Bounds` sits on the host edge).
3. At runtime: normal completion -> host's own outgoing flow; error -> token leaves via the
   boundary's outgoing flow (and, if interrupting, the host work is cancelled).
4. To generate: emit the host normally, then emit the boundary element referencing the host id,
   then add a sequence flow FROM the boundary id to the handler node.
