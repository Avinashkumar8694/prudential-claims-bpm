# End Event (Signal Throw) — usage guide

## 1. Details
BPMN element: `<bpmn2:endEvent>` containing `<bpmn2:signalEventDefinition signalRef="...">`.
Ends this branch AND broadcasts a named signal that other processes' signal-start / signal-catch
events can react to.

## 2. Usage
Hand-off mechanism. `pru-verification-process` Promote branch throws `StartSystemClaim`
(launches the system-claim process). `pru-system-claim-process` throws `PaymentProcess`
and `ClaimExaminer` to hand off to those downstream flows.

## 3. How / when to use
- Use to trigger a separate process/flow at the end of a branch.
- The receiving side needs a signal-start (new instance) or signal intermediate-catch (running instance).
- Declare the `<bpmn2:signal>` once at definitions scope; reference by the same name on both ends.
