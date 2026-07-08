# Lane / Lane Set — properties

| Property | XML | Notes |
|----------|-----|-------|
| laneSet id | `<bpmn2:laneSet>` | one per process (contains lanes) |
| lane id / name | `<bpmn2:lane>` | a role band |
| flowNodeRefs | `<bpmn2:flowNodeRef>` (repeat) | ids of nodes in the lane |

## SDK
`process.lanes: [{ id:"lane1", name:"Ops", flowNodeRefs:["_pg","_br"] }]`
