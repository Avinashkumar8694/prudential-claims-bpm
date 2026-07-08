# Boundary Event (Error) — properties

| Property | XML | Required | Notes |
|----------|-----|:--------:|-------|
| id | `id` | yes | e.g. `_B_ERROR` |
| name | `name` | no | Label |
| attachedToRef | `@attachedToRef` | yes | host activity id |
| cancelActivity | `@cancelActivity` | no | default `true` (interrupting) |
| errorRef | `errorEventDefinition/@errorRef` | yes | which error to catch |
| drools:erefname | `errorEventDefinition/@drools:erefname` | jBPM | error name |
| outgoing | `<bpmn2:outgoing>` | yes | to the handler node |
| drools:dockerinfo | attr | DI | dock position on host border |

## Effect on host activity properties
- Host keeps its normal single success `<outgoing>`.
- Boundary adds an alternate exit; NO change to host's `<incoming>`/`<outgoing>` XML.
- If `cancelActivity=true`, firing the boundary cancels the host work item.

## Input / output mapping
The caught error's data can be mapped to a variable via the boundary's dataOutputAssociation
(not used here; the handler reads existing vars like `failedContext`).
