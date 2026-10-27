# Lane / Lane Set — usage guide

## 1. Details
`<bpmn2:laneSet>` with `<bpmn2:lane>` children partitions a process into roles/responsibility bands.
Each lane lists the ids of the flow nodes it contains (`<bpmn2:flowNodeRef>`).

## 2. Usage
Visually assign nodes to a role (e.g. Verifier, System, Examiner). Lanes are organisational; they
don't change execution.

## 3. How / when to use
- Use to show who/what owns each step (matches the swimlanes in the source diagram).
- SDK: `process.lanes[] = [{ id, name, flowNodeRefs[] }]`; emitted as the first child of the process.
- Pools (`participant`/`collaboration`, cross-process) are a broader construct — not modeled here.
