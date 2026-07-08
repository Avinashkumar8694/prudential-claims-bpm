# Engine model — a Node-native BPM JSON that converts to jBPM

This is the **JSON your own Node.js BPM engine authors in** — clean, editor-friendly, and free of
jBPM boilerplate. A conversion layer maps it to the SDK's jBPM-oriented `ProcessModel`, which then
`serializeProcess`/`writeProject` turns into a deployable jBPM project.

```
your engine JSON (this spec) ──fromEngine()──▶ jBPM ProcessModel (SDK) ──writeProject()──▶ jBPM kjar
                            ◀──toEngine()──── (reverse, best-effort)
```

Every jBPM node folder in `../bpm-nodes/` now carries **two** JSON files:
- `node.json` — the **jBPM/SDK** model (verbose: rest-executor call activities, 16 REST ports,
  `scriptFormat` URIs, `structureRef` Java types, DI, …).
- `engine.json` — the **engine-native** model (this spec: `http`, `script{lang}`, `gateway{mode}`, …).
`engine.json` → `node.json` is exactly what `fromEngine()` does per node.

## Why a separate model
The jBPM model is faithful but noisy: a REST call is a `callActivity` → `pru-rest-executor` with 16
data inputs + on-entry/on-exit JSON scripts; a variable type is `java.util.List`; a script dialect is
a URI. Your designer shouldn't hand-build that. The engine model expresses **intent** —
`{ type:"http", method:"POST", url:"/v1/claims/status" }` — and the converter fills in the jBPM detail.

## Engine process schema
```jsonc
{
  "id": "com.acme.claims", "name": "claims", "package": "org.jbpm",
  "vars": [ { "name": "caseId", "type": "string" } ],   // simple types (see mapping) or a Java FQN
  "lanes": [ { "name": "Ops", "nodes": ["rules","review"] } ],
  "data":  [ { "name": "Document", "type": "object", "collection": false } ],
  "nodes": [ /* EngineNode[] — see below */ ],
  "flows": [ { "from": "a", "to": "b", "when": "…", "lang": "js" } ],
  "signals": ["Go"], "errors": ["TERMINATE_CASE"], "messages": ["MSG"], "escalations": ["ESC"],
  "deployment": { "runtime": "SINGLETON", "env": { "INTEGRATION_LAYER_URL": "http://localhost:3000" }, "handlers": ["Rest"] },
  "assets": { "src/main/resources/x.drl": { "kind":"drl", "model": { /* … */ } } }  // via buildAsset
}
```
Ids on nodes are optional — the converter/`autowire` fills `incoming`/`outgoing` from `flows`.

## Engine node types → jBPM node
| Engine `type` | Shape (key fields) | Converts to jBPM `node.json` |
|---------------|--------------------|------------------------------|
| `start` | `{ on?: {signal|message|timer|conditional} }` | `startEvent` (subtype/eventType) |
| `end` | `{ result?: "terminate", throw?: {signal|error|message|escalation} }` | `endEvent` (subtype/eventType) |
| `script` | `{ lang: "js"|"java"|"mvel", code }` | `scriptTask` (`scriptFormat` URI) |
| `http` | `{ method, url, headers?, body?/bodyFrom?, resultTo? }` | `callActivity` subtype `rest` (→ `pru-rest-executor`, builds `reqPayload`/parses `resPayload`) |
| `call` | `{ process, inputs?, outputs? }` | `callActivity` subtype `reusable` |
| `forEach` | `{ process, over, as, collectInto?, itemResult?, parallel?, pass? }` | `callActivity` subtype `multiInstance` |
| `userTask` | `{ name, group?/assignee?, form?, skippable? }` | `userTask` (`TaskName`/`GroupId`/`Skippable`) |
| `rule` | `{ ruleflowGroup? } \| { dmn: {namespace,model,decision} }` | `businessRuleTask` |
| `send` / `receive` | `{ message }` | `sendTask` / `receiveTask` |
| `manual` | `{ name }` | `manualTask` |
| `gateway` | `{ mode: "exclusive"|"parallel"|"inclusive"|"event"|"complex", default? }` | `exclusiveGateway`/`parallelGateway`/… |
| `catch` | `{ event: {timer|message|signal|conditional} }` | `intermediateCatchEvent` |
| `throw` | `{ event: {signal|message|escalation} }` | `intermediateThrowEvent` |
| `boundary` | `{ on: hostId, event: {error|timer|message|signal|conditional|escalation}, interrupting? }` | `boundaryEvent` |
| `subprocess` | `{ transaction?/on?, nodes, flows }` | `subProcess` embedded/transaction/event |

## Variable type mapping (engine → `structureRef`)
| engine `type` | jBPM `structureRef` |
|---------------|---------------------|
| `string` | `String` |
| `int` | `Integer` |
| `long` | `java.lang.Long` |
| `double` / `float` | `java.lang.Double` |
| `bool` | `java.lang.Boolean` |
| `object` | `java.lang.Object` |
| `list` | `java.util.List` |
| `map` | `java.util.Map` |
| `date` | `java.util.Date` |
| `<FQN>` (contains `.`) | passthrough |

## Flow & condition mapping
`{ from, to, when?, lang? }` → `sequenceFlow { sourceRef, targetRef, condition?, conditionLanguage? }`
where `lang: "js"` → `http://www.javascript.com/javascript`, `"java"` (default) → `…/java`,
`"mvel"` → `http://www.mvel.org/2.0`. Script `lang` maps the same way to `scriptFormat`.

## The `http` node — what the converter generates
`{ type:"http", method:"POST", url:"/v1/claims/status", body:{status:"X"}, resultTo:{status:"$.status"} }`
becomes a `callActivity` (subtype `rest`) to `pru-rest-executor` with:
- `url` = `#{baseUrl}` + url, `method`, `ContentType=application/json`, `HandleResponseErrors=true`;
- an **on-entry** script that builds `reqPayload` from `body` (constants + `$var` refs);
- an **on-exit** script that parses `resPayload` and assigns `resultTo` targets (JSONPath-ish → vars);
- ensures `baseUrl`/`reqPayload`/`resPayload` process vars exist.
Your engine never sees the 16 REST ports — that's the converter's job.

## Conversion API (to implement next)
```ts
fromEngine(engineProcess): ProcessModel      // engine JSON  -> jBPM SDK model
fromEngineProject(engineProject): Project     // + vars/deployment/assets/lanes
toEngine(processModel): EngineProcess          // reverse (best-effort; jBPM-specific detail simplified)
```
Then the existing `serializeProcess` / `writeProject` produce the kjar. `fromEngine` uses `autowire`
(derive incoming/outgoing from flows) and the asset codecs (`buildAsset`) for `assets`.

## Round-trip expectations
- `engine → jBPM → kjar`: exact, deployable (validated across the SDK's tests + 292 real files).
- `jBPM → engine` (`toEngine`): best-effort — jBPM-only details (DI positions, generated ids, raw
  nodes) are dropped or simplified; re-converting yields an equivalent process, not byte-identical.

## Status
**Design + per-node `engine.json` samples are in the docs now.** The `fromEngine`/`toEngine`
converter is the next implementation step (it's a thin mapping layer on top of the existing SDK —
no new BPMN logic).
