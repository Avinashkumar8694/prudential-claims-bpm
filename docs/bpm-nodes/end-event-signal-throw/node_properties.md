# End Event (Signal Throw) — properties

| Property | XML | Required | Notes |
|----------|-----|:--------:|-------|
| id | `id` | yes | e.g. `_END_PROMOTE` |
| name | `name` | no | Label |
| signalRef | `signalEventDefinition/@signalRef` | yes | -> `<bpmn2:signal>` id |
| signal name | `<bpmn2:signal @name>` | yes | Broadcast name |
| incoming | `<bpmn2:incoming>` | yes | |

## Input / output mapping
Optional data input mapped to the signal payload (`dataInputAssociation`). Not used here.
