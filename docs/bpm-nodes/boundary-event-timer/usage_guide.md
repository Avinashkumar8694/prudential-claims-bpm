# Boundary Event (Timer) — usage guide

## 1. Details
BPMN element: `<bpmn2:boundaryEvent attachedToRef="<hostId>">` with `<bpmn2:timerEventDefinition>`
(`timeDuration` ISO-8601 like `P30D`/`PT1M`, or `timeCycle`). Fires when the timer elapses while
the host activity is still active.

## 2. Usage
`pru-system-claim-process` attaches "Day 30, Status = Pending" (`PT1M` test stand-in for 30 days)
to the `Update followup to 30 days` user task. If docs arrive first the task completes normally
(-> AI reclassify loop); if the timer fires first -> assign to examiner.

## 3. How / when to use
- Use to bound how long an activity (usually a user/receive task) may stay open, and escalate.
- `cancelActivity="true"` (interrupting) cancels the host when the timer fires; `false` lets the
  host continue and spawns a parallel escalation token.
- Use `timeDuration` `P30D` for a real 30-day SLA; `PT1M` etc. for testing.

## HOW ATTACHING AFFECTS THE HOST
Same mechanics as the error boundary: separate element with `attachedToRef`; host keeps its own
"happy path" outgoing (docs uploaded), the timer adds the escalation exit. Interrupting timer
cancels the waiting task on fire.
