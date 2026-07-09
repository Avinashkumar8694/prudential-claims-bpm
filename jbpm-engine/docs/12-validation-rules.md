# 12 — Validation Rules

The engine-native equivalent of jBPM/Business Central BPMN diagram validation, adapted to the nodejs
engine model. Implemented as a **rules module** on both sides:

- **Backend** (authoritative): `server/src/modules/validation/` — `rules.ts` (rule set + graph builder)
  and `service.ts` (facade + `assertValid`). Runs over an `EngineProcess`.
- **UI**: `app/.../features/builder/problems-panel.component.ts` + live `POST /api/validate`; shows a
  Problems strip, marks nodes with errors/warnings, and disables **Deploy** while errors exist.

## Enforcement
- **Errors block publish and deploy** — `VersionService.publish()` calls `assertValid()` and returns
  `422 VALIDATION_FAILED` with the error list. So an invalid / unconnected process is never published
  or deployed (i.e. "no unconnected nodes should be saved" into a runnable state).
- **Draft autosave is not blocked** (so work-in-progress isn't lost), but problems are surfaced live.
- **Warnings** are advisory (never block).

## Rules

| Rule id | Severity | jBPM/BPMN equivalent | What it checks |
|---------|----------|----------------------|----------------|
| `start-exists` | error | "Process has no start node" | ≥1 start node |
| `end-exists` | error | "Process has no end node" | ≥1 end node |
| `single-start` | warning | multiple start events | prefer one start |
| `unique-ids` | error | duplicate node id | node ids unique |
| `flow-endpoints` | error | dangling sequence flow | every connection links two existing nodes; self-loop warned |
| `flow-direction` | error | invalid sequence-flow direction | connection direction must respect each node's ports (no out where `maxOut:0`, no in where `maxIn:0`) |
| `connection-cardinality` | error | too many connections / mixed gateway | each node's `maxIn`/`maxOut` (declared in its `def.ts`) is enforced: tasks/events are 1-in/1-out, start 0/1, end (many)/0, boundary 0/1, gateways fan (1→many **or** many→1, never both) |
| `start-connections` | error | start must have outgoing, no incoming | start out ≥1, in = 0 |
| `end-connections` | error | end must have incoming, no outgoing | end in ≥1, out = 0 |
| `node-connected` | error | "node is not connected" | activities/gateways/events have both an incoming and an outgoing (boundary needs an outgoing handler path); **catches floating nodes** |
| `reachable` | error | unreachable node | every edged node is reachable from a start (catches disconnected islands) |
| `boundary-host` | error | boundary not attached | `boundary.on` references an existing host node |
| `node-config` | error | task/gateway missing config | script has code; http has url; call/forEach has process (+ collection); rule has ruleflowGroup or DMN; send/receive has message; gateway has mode |
| `event-trigger` | error | event with no definition | catch/throw/boundary define a trigger; timers have duration/cycle/date |
| `gateway-branching` | warning | gateway may not resolve | diverging exclusive/inclusive has a default or conditions; no multiple unconditional branches |
| `usertask-assignment` | warning | human task with no actors | user task has a group or assignee |
| `condition-lang` | warning | non-executable expression | flow condition dialect is `js` (java/mvel don't run in the Node runtime) |
| `node-name` | warning | unnamed node | nodes should be named |

## Extending

Add a `Rule` to `RULES` in `rules.ts`:
```ts
{ id: 'my-rule', description: '…', run: (ctx) => ctx.nodes
    .filter((n) => /* condition */)
    .map((n) => ({ rule: 'my-rule', severity: 'warning', message: '…', nodeId: n.id })) }
```
`GraphCtx` provides precomputed `byId`, `incoming`/`outgoing`, `starts`/`ends`, `reachable`, and
`boundaryByHost`. Tests live in `server/test/validation.test.ts`.

## Notes vs jBPM
- We validate the **engine model** (nodes/flows) directly — clearer, node/flow-id-referenced problems
  — rather than post-conversion BPMN. jBPM-only concerns (diagram coordinates, kjar packaging) are not
  errors here; the SDK synthesizes those on export.
- Nested sub-process graphs are validated at the top level in v1; deep nested-graph validation is a
  follow-up.
