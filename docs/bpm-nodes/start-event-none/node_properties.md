# Start Event (None) — properties

| Property | XML | Required | Notes |
|----------|-----|:--------:|-------|
| id | `id` | yes | Unique element id (e.g. `_START`) |
| name | `name` | no | Display label |
| elementname | `drools:metaData name="elementname"` | no | jBPM label kept in extensionElements |
| outgoing | `<bpmn2:outgoing>` | yes | Exactly one; id of the sequence flow leaving |

## Input / output mapping
None. A none-start has no `ioSpecification`, no data inputs/outputs.
Process variables are seeded by the **caller** (start-process variable map), not by this node.

## Cardinality
Exactly 1 per executable top-level process. (Event sub-processes use a typed start instead.)
