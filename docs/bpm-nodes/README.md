# BPM Nodes Reference

Reference for every BPMN node type used by the prudential-claims processes, written for building
a custom BPM that can **generate** jBPM-compatible BPMN 2.0 files. jBPM/Business Central stores a
process as BPMN2 **XML** (not JSON); the `node.json` files here define a clean, engine-internal
**JSON model** for each node and show the exact XML it serialises to.

## Folder layout
Each node type has a folder with:
- `usage_guide.md` — (1) what the node is, (2) what it does at runtime, (3) how/when to use it.
- `node_properties.md` — every property, plus input/output data mapping.
- `node.json` — the **jBPM/SDK** model for the node + the BPMN XML it maps to (verbose: rest-executor
  call activities, REST ports, `scriptFormat` URIs, `structureRef` types).
- `engine.json` — the **engine-native** model (a clean Node-BPM JSON) that converts *to* `node.json`.
  See the spec + full conversion mapping in [`../engine-model/`](../engine-model/). This is what your
  own Node BPM engine would author; a `fromEngine()` converter (next step) maps it to the SDK model.

## Node catalogue
| Folder | BPMN element | Purpose |
|--------|--------------|---------|
| `start-event-none` | `startEvent` | On-demand process entry |
| `start-event-signal` | `startEvent` + signal | Reactive entry (hand-off target) |
| `end-event-none` | `endEvent` | End a branch |
| `end-event-terminate` | `endEvent` + terminate | Hard-stop the case |
| `end-event-signal-throw` | `endEvent` + signal | Hand off to another process |
| `end-event-error-throw` | `endEvent` + error | Abort sub-process to parent |
| `script-task` | `scriptTask` | In-engine Java logic |
| `service-task-rest` | `task` (Rest work item) | HTTP call (inside rest-executor) |
| `call-activity` | `callActivity` | Invoke reusable subprocess (all REST calls) |
| `call-activity-multi-instance` | `callActivity` + MI | Loop a collection, one child per item |
| `user-task` | `userTask` | Human task / wait |
| `exclusive-gateway` | `exclusiveGateway` | XOR routing / merge |
| `event-subprocess` | `subProcess` (triggeredByEvent) | Global error/terminate handling |
| `boundary-event-error` | `boundaryEvent` + error | Catch activity failure |
| `boundary-event-timer` | `boundaryEvent` + timer | Time-box / escalate an activity |
| `intermediate-catch-timer` | `intermediateCatchEvent` + timer | In-flow delay / back-off |
| `intermediate-throw-event` | `intermediateThrowEvent` | Throw signal/message/escalation mid-flow |
| `sequence-flow` | `sequenceFlow` | Connector (+ conditions) |
| `parallel-gateway` | `parallelGateway` | AND fork/join |
| `inclusive-gateway` | `inclusiveGateway` | OR fork/join (+ default) |
| `event-based-gateway` | `eventBasedGateway` | Race on catch events |
| `business-rule-task` | `businessRuleTask` | Rule/DMN decision |
| `send-task` | `sendTask` | Send a message |
| `receive-task` | `receiveTask` | Wait for a message |
| `manual-task` | `manualTask` | Offline human step |
| `event-message` | `messageEventDefinition` | Message start/catch/throw/end/boundary |
| `event-escalation` | `escalationEventDefinition` | Escalation throw/catch |
| `event-conditional` | `conditionalEventDefinition` | Data-condition start/catch |
| `subprocess-embedded` | `subProcess` | Inline grouped flow (recursive) |
| `subprocess-transaction` | `transaction` | Transactional scope |
| `data-object` | `dataObject` / `dataStoreReference` | Data modelling |
| `lane` | `laneSet` / `lane` | Role swimlanes |

## Cross-cutting references
- `_bpmn-assembly-guide.md` — **the master build doc**: how node JSON + process variables + flows
  serialise into a complete, importable BPMN 2.0 file (skeleton, ordering, type→element mapping,
  validation, worked example). Start here to generate BPMN back.
- `_mappings-reference.md` — **controlled vocabulary**: every reference/enumeration field
  (`errorRef`, `signalRef`, `structureRef`, `drools:taskName`, `Method`, `cancelActivity`,
  `gatewayDirection`, timer formats, `.from` kinds, …) with **all valid values** and what each
  applies to. The allowed-values dictionary for the model.
- `_process-variables-reference.md` — process variables: `itemDefinition` + `property`, type
  catalogue, scope/lifecycle, seeding, `kcontext`/`#{var}` access, the project's variable inventory,
  and the variable JSON model.
- `_all-bpmn-nodes-reference.md` — the **complete BPMN 2.0 palette** (researched: OMG spec, Camunda,
  jBPM) — every event trigger/position, task type, gateway, sub-process, data, lane, artifact — with
  jBPM support notes and which are used here. The full universe beyond the folders above.
- `_scripting-reference.md` — **code inside a process** (overview): the 4 places code runs (script
  task, on-entry/on-exit, gateway conditions), supported dialects, `kcontext`, escaping, dialect
  preservation. Then the two deep, per-language references:
  - `_scripting-java.md` — **Java** dialect: `kcontext` API, **type mapping in/out for every
    `structureRef`** (cast on read, store declared type on write), Jackson JSON build/parse, imports,
    conditions, errors/signals, real-project checklist. (This project is 100% Java.)
  - `_scripting-javascript.md` — **JavaScript** dialect: runtime/JDK requirements (Nashorn vs GraalVM),
    **type conversion in/out for every type** (JS number/array/object ≠ Java Integer/List/Map — how to
    convert), Java interop, JSON, conditions, and production checklist.
- `_error-handling-reference.md` — **local** (boundary catch on an activity) vs **global** (error
  event sub-process) handling, error declaration/matching, propagation, and this project's layered
  retry → back-off → `TERMINATE_CASE` → global-catch pattern.
- `_data-mapping-reference.md` — itemDefinition, property (process variable), ioSpecification,
  dataInput/OutputAssociation, and the two value styles (`#{var}` expression vs constant assignment).
- `_boundary-events-reference.md` — how boundary events attach, `cancelActivity`, and how attaching
  changes the host node.

## Project-level artifacts (kjar)
Everything *around* the `.bpmn` files — `pom.xml`, `kmodule.xml`, `kie-deployment-descriptor.xml`
(work-item handlers + env entries), `WorkDefinitions.wid`, DRL/DMN rules, custom Java handlers — is
documented in the sibling folder [`../bpm-project/`](../bpm-project/).

## Error handling (summary)
- **Local**: a `boundaryEvent` attached to one activity catches its failure and routes to a recovery
  path (e.g. `boundary-event-error/` on the REST task) — the case continues.
- **Global**: an `event-subprocess/` with an interrupting **error start** catches a propagated error
  (`TERMINATE_CASE`) anywhere in the process and terminates the case.
- Full detail, XML, and the layered pattern: `_error-handling-reference.md`.

## Engine JSON model (shared shape)
```jsonc
{
  "id": "_NODE",                 // unique element id
  "type": "callActivity",        // engine node type
  "subtype": "multiInstance",    // optional variant
  "bpmnElement": "callActivity", // BPMN element emitted
  "name": "…",
  "position": {"x":0,"y":0,"width":0,"height":0},
  "incoming": ["_f1"], "outgoing": ["_f2"],
  "properties": { /* element attrs + jBPM extensions */ },
  "dataInputs": [ {"name":"Url","from":"expression","value":"#{baseUrl}/v1/…"} ],
  "dataOutputs": [ {"name":"Result","to":"resPayload"} ],
  "scripts": {"onEntry":"…","onExit":"…"},
  "multiInstance": { /* only for MI */ },
  "boundaryEvents": [ {"ref":"_B1","eventType":"timer"} ],
  "definitionsScope": { "signals":[], "errors":[] }  // declared once per file
}
```

> Timer note: real 30-day SLAs use `P30D`; this project uses `PT1M`/`PT3M` as test stand-ins.
