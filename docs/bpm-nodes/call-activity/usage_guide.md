# Call Activity — usage guide

## 1. Details
BPMN element: `<bpmn2:callActivity calledElement="<process id>">`. Synchronously invokes another
deployed process and (with `waitForCompletion="true"`) waits for it to finish. Variables are
passed in/out via data input/output associations.

## 2. Usage
This is the backbone of every REST call in the business processes: each service node is a call
activity to `prudential-claims-submission.pru-rest-executor`, passing `Url`/`Method`/`ContentData`
etc. and receiving `Result` back into `resPayload`. Also used to invoke NIGO and single-claim.

## 3. How / when to use
- Use to reuse a subprocess (REST wrapper, NIGO, single-claim) instead of duplicating nodes.
- Set `drools:independent="false"` when the child's lifecycle is tied to the parent;
  `waitForCompletion="true"` to block until it returns.
- Build the request payload in an on-entry script, parse the response in an on-exit script.
- Attach a boundary error event if the child can throw (e.g. `TERMINATE_CASE`).
