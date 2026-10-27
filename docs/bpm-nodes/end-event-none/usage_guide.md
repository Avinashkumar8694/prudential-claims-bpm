# End Event (None) — usage guide

## 1. Details
BPMN element: `<bpmn2:endEvent>` with no event definition.
Ends the token's path. When **all** tokens in a process instance reach an end (and no other
active work remains) the instance completes normally.

## 2. Usage
Consumes the incoming token and does nothing else. Multiple none-ends may exist (one per branch);
the process instance completes only when no active tokens remain.

## 3. How / when to use
- Use to terminate a normal branch (e.g. the Hold branch of verification).
- Use `end-event-terminate` instead when reaching the end must **kill all** other active
  tokens (hard stop) rather than just ending this branch.
