# Embedded Sub-Process — properties

| Property | XML | Notes |
|----------|-----|-------|
| id / name | attrs | |
| nodes (SDK) | child flow nodes | recursive |
| flows (SDK) | child sequence flows | recursive |
| boundary events | separate `boundaryEvent attachedToRef=<subProcess id>` | optional |

## Input / output mapping
Shares parent variables (no explicit ioSpecification needed).

## SDK
`{ "type":"subProcess", "subtype":"embedded", "nodes":[…], "flows":[…] }` — the serializer emits the
children inside the `<bpmn2:subProcess>` and lays out their DI shapes in the same plane.
