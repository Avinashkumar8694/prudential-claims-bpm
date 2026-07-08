# Start Event (Signal) — properties

| Property | XML | Required | Notes |
|----------|-----|:--------:|-------|
| id | `id` | yes | e.g. `_START` |
| name | `name` | no | Label |
| signalRef | `signalEventDefinition/@signalRef` | yes | Points to a `<bpmn2:signal>` id |
| signal name | `<bpmn2:signal @name>` | yes | The broadcast name matched at runtime |
| outgoing | `<bpmn2:outgoing>` | yes | Exactly one |

## Definitions-scope declaration (required)
```xml
<bpmn2:signal id="_sig_StartSystemClaim" name="StartSystemClaim"/>
```

## Input / output mapping
A signal MAY carry a payload; jBPM maps it to a process variable via the start event's
data output (optional). In this project no payload is mapped — the started process reads
`caseId`/`claimId` from its own start variables.
