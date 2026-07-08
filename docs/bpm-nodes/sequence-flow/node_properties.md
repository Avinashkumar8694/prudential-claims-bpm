# Sequence Flow — properties

| Property | XML | Required | Notes |
|----------|-----|:--------:|-------|
| id | `id` | yes | referenced by node incoming/outgoing |
| sourceRef | `@sourceRef` | yes | source node id |
| targetRef | `@targetRef` | yes | target node id |
| name | `@name` | no | label |
| elementname | `drools:metaData` | no | jBPM label |
| conditionExpression | child | no | Java expr; only on gateway outgoings |

## Symmetry rule (must hold)
For every flow F: `F.sourceRef` node must list F in its `<outgoing>`, and `F.targetRef` node must
list F in its `<incoming>`. A generator should assert this before serialising.

## Diagram
Each flow needs a `<bpmndi:BPMNEdge bpmnElement="F">` with `>=2` `<di:waypoint>` points.
