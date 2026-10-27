# End Event (Error Throw) — usage guide

## 1. Details
BPMN element: `<bpmn2:endEvent>` containing `<bpmn2:errorEventDefinition errorRef="...">`.
Throws a named BPMN error. Inside a call activity / sub-process the error propagates to the
caller where a matching boundary error event or error event sub-process handles it.

## 2. Usage
In `pru-rest-executor`, when the admin decides to terminate, the flow reaches an error-throw
end that raises `TERMINATE_CASE`; the parent process's Global Terminate event sub-process
(error start on `TERMINATE_CASE`) catches it and terminates the case.

## 3. How / when to use
- Use to abort a sub-process and signal the parent that a specific business error occurred.
- Declare `<bpmn2:error id errorCode>` at definitions scope; reference by `errorRef`.
- Pair with `boundary-event-error` (on a call activity) or an error event sub-process in the parent.
