# End Event (Terminate) — properties

| Property | XML | Required | Notes |
|----------|-----|:--------:|-------|
| id | `id` | yes | e.g. `_END_CLOSE` / `_END_TERMINATE_EVENT` |
| name | `name` | no | Label |
| incoming | `<bpmn2:incoming>` | yes | |
| terminateEventDefinition | child element | yes | Marks it terminating |

## Input / output mapping
None. Side effect: cancels all active work in the instance.
