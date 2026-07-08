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

## Strict node interfaces (discriminated union)
`EngineNode` is a **discriminated union** keyed on `type` — every node shape is a distinct interface
(`EngineStart`, `EngineEnd`, `EngineScript`, `EngineHttp`, `EngineCall`, `EngineForEach`,
`EngineUserTask`, `EngineRule`, `EngineSend`, `EngineReceive`, `EngineManual`, `EngineGateway`,
`EngineCatch`, `EngineThrow`, `EngineBoundary`, `EngineSubprocess`, `EngineRaw`), all exported. So the
compiler forces `method`/`url` on an `http` node, `mode` on a `gateway`, `event` on a `boundary`, etc.,
and narrows correctly in a `switch (node.type)`. Supporting shapes are typed too: `HttpMethod`,
`GatewayMode`, `EventDef` (`{signal|message|error|escalation|condition|timer}`), `TimerSpec`, `Lang`.
`fromEngine` consumes this union; `toEngine` is best-effort and may emit partially-populated nodes.

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

## Type resolution — how a Node engine handles `className` / Java FQNs
A Node engine has **no Java classes**, so it never writes `com.acme.model.Claim` by hand. Instead it
**declares data types by name** and the converter resolves + materializes the Java side:

```jsonc
"types": [ { "name": "Claim", "package": "com.acme.model",
             "fields": [ { "name":"id","type":"string" }, { "name":"amount","type":"double" } ] } ]
```
Then:
- a variable `{ "name":"claim", "type":"Claim" }` → `structureRef = "com.acme.model.Claim"`;
- a form's `model.className`, or a rule fact, uses `resolveType("Claim")` → `"com.acme.model.Claim"`;
- the converter **auto-generates `src/main/java/com/acme/model/Claim.java`** (a POJO with getters/setters)
  from the schema and adds it to the kjar.

Resolution rules (`makeTypeResolver(types)`):
1. a **primitive** (`string`, `int`, `double`, `bool`, `list`, `map`, `date`, `object`) → its boxed
   `structureRef`;
2. a **declared type name** → its FQN (`package.Name`), and a `.java` is generated once;
3. anything **containing a dot** → treated as an already-qualified FQN (passthrough).

So the engine only ever references **names**; the SDK produces the FQNs, the `.java`, and the wiring.

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

## Conversion API (implemented)
```ts
import { fromEngine, fromEngineProject, toEngine, toEngineProject, makeTypeResolver, writeProject } from '@neutrinos/bpmn-sdk';

const model   = fromEngine(engineProcess);          // engine process -> jBPM ProcessModel
const project = fromEngineProject(engineProject);   // + vars/types(.java)/deployment/assets/lanes
writeProject(project, 'out');                        // -> deployable kjar
const back    = toEngine(model);                     // reverse: one process (best-effort)
const engine  = toEngineProject(project);            // reverse: whole project incl. assets + types
const resolve = makeTypeResolver(types);             // name -> FQN (for form className, rule facts)
```

## Asset conversion (both directions)
Assets flow through the **structured asset codecs** (`parseAsset`/`buildAsset`, see `../bpm-assets/`):

**engine → jBPM** (`fromEngineProject`):
- `types[]` → a generated `.java` POJO per type (via `buildAsset` `dataObject`), and the type name is
  resolved to a Java FQN everywhere jBPM needs one.
- `assets{ path: { kind, model } }` → `buildAsset(kind, model)` writes the real file at `path` in the
  kjar (DRL from a rule model, DMN from an XML tree, properties/enumeration/dsl/wid/form, …).

### Rules — write the simple engine ruleset, not DRL
An `EngineProject` has a `rulesets[]` field. You author **nodejs-native** rules — facts by **name**,
conditions as `field: {op: value}`, actions as `set`/`insert`/`delete`/`call` — with **no package, no
Java FQNs, no `modify($c)`, no `ruleflow-group`**:
```jsonc
"rulesets": [{ "group": "classify", "rules": [{
  "name": "High value open claim", "priority": 10,
  "when": [{ "fact": "Claim", "as": "c", "where": { "amount": { "gt": 100000 }, "status": "OPEN" } }],
  "then": [{ "set": "c", "fields": { "status": "HIGH" } }] }] }]
```
`fromEngineProject` runs `rulesToDrl(ruleset, resolve, pkg)` internally: fact **names** → imported FQNs
(from `types`), `group` → `ruleflow-group` + the `.drl` path (`<pkg>/<group>.drl`), package defaulted
from the process (`<pkg>.model` / `<pkg>.rules` — so `types` need no `package`), `priority` → Drools
`salience`. The rule **node** (`{ type:"rule", ruleflowGroup:"classify" }`) fires the matching group. The
same ruleset is the executable form for a Node rule engine (patterns → fact predicates, actions → fact
mutations). Exported: `EngineRuleset`, `EngineRuleDef`, `EngineWhen`, `EngineThen`, `CondOp`, and
`rulesToDrl`. Full catalogue + friendly-op table: `../bpm-assets/drl/scenarios.md` §0.

**Escape hatch:** for a Drools feature the simple ruleset doesn't cover, drop to the jBPM-side
`DrlModel` directly under `assets` (raw or structured `when`/`then`, functions, declares, queries,
accumulate/collect, …) — see `../bpm-assets/drl/model.md`.

**jBPM → engine** (`toEngineProject`):
- each `.java` in `descriptor.files` → an engine `type` (`parseAsset` `dataObject`, Java field types
  mapped back to engine primitives);
- every other non-scaffolding file → `assets[path] = { kind, model }` (structured, via `parseAsset`);
- `gav`/`deployment` recovered from the descriptor.

Round-trip `engine → jBPM → engine` keeps `types` and structured `assets` stable (tested in
`../../bpmn-sdk/test/engine-assets.test.mjs`).
`fromEngine` runs `autowire` (derive incoming/outgoing from flows, recursing sub-processes) and uses
the asset codecs (`buildAsset`) for `assets`. Working example + tests:
`../../bpmn-sdk/examples/engine-model/07-engine-to-jbpm.mjs`, `../../bpmn-sdk/test/engine.test.mjs`.

## Round-trip expectations
- `engine → jBPM → kjar`: exact, deployable (validated across the SDK's tests + 292 real files).
- `jBPM → engine` (`toEngine`): best-effort — jBPM-only details (DI positions, generated ids, raw
  nodes) are dropped or simplified; re-converting yields an equivalent process, not byte-identical.

## Status
**Implemented and tested.** `fromEngine`/`fromEngineProject`/`toEngine`/`makeTypeResolver` ship in the
SDK; example 07 authors an engine project (declared type → resolved FQN + generated POJO, `http`,
JS script + JS condition, `forEach`, `rule`, gateway, terminate end) → jBPM kjar, well-formed and
round-tripping. Per-node `engine.json` samples sit next to each `node.json` in `../bpm-nodes/`.
