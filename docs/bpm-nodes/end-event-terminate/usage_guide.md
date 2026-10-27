# End Event (Terminate) — usage guide

## 1. Details
BPMN element: `<bpmn2:endEvent>` containing `<bpmn2:terminateEventDefinition/>`.
A **hard stop**: reaching it immediately cancels every other active token/activity in the
process instance and completes the instance.

## 2. Usage
In this project it terminates the whole case when a branch decides to stop (e.g. verification
Close after the closure notification), and inside the Global Terminate event sub-process that
catches the `TERMINATE_CASE` error.

## 3. How / when to use
- Use when a single outcome must end the entire case regardless of parallel work in flight.
- Do NOT use where sibling branches should keep running — use a none-end there.
