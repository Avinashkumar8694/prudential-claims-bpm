# Service Task (REST Work Item) — usage guide

## 1. Details
BPMN element: `<bpmn2:task drools:taskName="Rest">` bound to jBPM's `RESTWorkItemHandler`
(registered in `kie-deployment-descriptor.xml`: name `Rest`). Performs a real HTTP call.
In THIS project the raw REST task lives inside the reusable `pru-rest-executor`; business
processes never place a raw Rest task — they call `pru-rest-executor` via a `call-activity`
(see that folder). This node documents the underlying work item.

## 2. Usage
Takes `Url`, `Method`, `ContentData`, `ContentType`, `HandleResponseErrors`, timeouts, auth as
data inputs; returns the response body as `Result`. On a non-2xx (when HandleResponseErrors=true)
it throws `WorkItemHandlerRuntimeException`, caught by a boundary error event.

## 3. How / when to use
- Use (directly) only inside a REST wrapper subprocess; elsewhere reuse the wrapper.
- Always set `HandleResponseErrors=true` and attach a boundary error event for retry/handling.
- Build the request JSON in an on-entry script into a var, map it to `ContentData`.
