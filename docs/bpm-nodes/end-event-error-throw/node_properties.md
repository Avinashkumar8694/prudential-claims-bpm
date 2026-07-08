# End Event (Error Throw) — properties

| Property | XML | Required | Notes |
|----------|-----|:--------:|-------|
| id | `id` | yes | e.g. `_END_ERROR_TERMINATE` |
| name | `name` | no | Label |
| errorRef | `errorEventDefinition/@errorRef` | yes | -> `<bpmn2:error>` id |
| drools:erefname | `errorEventDefinition/@drools:erefname` | jBPM | Error name jBPM matches on |
| incoming | `<bpmn2:incoming>` | yes | |

## Definitions-scope declaration (required)
```xml
<bpmn2:error id="TERMINATE_CASE" errorCode="TERMINATE_CASE"/>
```

## Input / output mapping
None (an error payload can be attached in full BPMN; not used here).
