# Event Sub-Process — properties

| Property | XML | Notes |
|----------|-----|-------|
| id / name | attrs | e.g. `_GLOBAL_TERMINATE_SUBPROCESS` |
| triggeredByEvent | `@triggeredByEvent="true"` | marks it an event sub-process |
| (child) start event | `<bpmn2:startEvent isInterrupting="true">` + `errorEventDefinition` | trigger |
| (child) end event | terminate/none | outcome |
| (child) sequence flow | connects start->end | |

## Trigger declaration
```xml
<bpmn2:startEvent id="_START_TERMINATE_EVENT" isInterrupting="true">
  <bpmn2:errorEventDefinition drools:erefname="TERMINATE_CASE" errorRef="TERMINATE_CASE"/>
</bpmn2:startEvent>
```

## Input / output mapping
Inherits parent process variables (same scope). No explicit ioSpecification.
