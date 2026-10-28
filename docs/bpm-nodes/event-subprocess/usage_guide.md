# Event Sub-Process — usage guide

## 1. Details
BPMN element: `<bpmn2:subProcess triggeredByEvent="true">` containing an interrupting typed
**start event** (here: error start on `TERMINATE_CASE`). It is not wired by sequence flows to
the main flow; it activates when its start event fires anywhere in the process.

## 2. Usage
The `Global Terminate Subprocess` in every business process: an error start
(`isInterrupting=true`, error `TERMINATE_CASE`) -> terminate end. When any REST call (via
rest-executor) throws `TERMINATE_CASE`, this catches it and hard-stops the case.

## 3. How / when to use
- Use for cross-cutting handling (global error/terminate, compensation) without cluttering the
  main flow with boundary events on every node.
- Interrupting error start cancels the enclosing process scope; pair with a terminate end.
