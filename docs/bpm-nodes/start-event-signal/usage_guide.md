# Start Event (Signal) — usage guide

## 1. Details
BPMN element: `<bpmn2:startEvent>` containing `<bpmn2:signalEventDefinition signalRef="...">`.
A top-level `<bpmn2:signal id name>` must be declared at definitions scope and referenced by name.
Starts a **new** process instance whenever a signal of the matching name is broadcast.

## 2. Usage
Used for cross-process hand-off. In this project `pru-system-claim-process` begins with a
signal-start listening for `StartSystemClaim`; `pru-verification-process` throws that signal
from its Promote branch (see `end-event-signal-throw`). Signal matching is by **name**.

## 3. How / when to use
- Use to launch a process reactively from another process/event without a direct API call.
- The signal must be broadcast in a scope the engine delivers to (same KIE container / signal bus).
- Pair with a throwing signal end/intermediate event that uses the same signal name.
