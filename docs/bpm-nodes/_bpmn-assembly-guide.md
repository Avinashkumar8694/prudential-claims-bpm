# BPMN Assembly Guide — from node JSON + process variables → BPMN 2.0 file

How a custom BPM engine turns its model (a list of **node JSON** objects + **process variable**
defs + flows) into a valid, jBPM-importable BPMN 2.0 XML file. This documents the exact structure
and ordering used to generate this project's processes.

> Storage reality: jBPM persists a process as BPMN2 **XML**, not JSON. Your engine keeps JSON as its
> working model; **serialisation** = JSON → XML (this guide). **Parsing** = XML → JSON (the inverse).

---

## 1. The model you assemble from
```jsonc
{
  "process": { "id": "prudential-claims-submission.pru-verification-process",
               "name": "pru-verification-process", "packageName": "org.jbpm", "isExecutable": true },
  "variables": [ /* see _process-variables-reference.md §8 */ ],
  "declarations": { "signals": [{"id":"_sig_StartSystemClaim","name":"StartSystemClaim"}],
                    "errors":  [{"id":"TERMINATE_CASE","errorCode":"TERMINATE_CASE"}],
                    "messages": [] },
  "nodes": [ /* node.json objects — see each <folder>/node.json */ ],
  "flows": [ /* sequence-flow node.json objects */ ]
}
```

## 2. Output file skeleton (order matters)
```xml
<?xml version="1.0" encoding="UTF-8"?>
<bpmn2:definitions … namespaces … id="_defX" targetNamespace="http://www.omg.org/bpmn20">
  <!-- A --> …itemDefinitions…            (types: variables + per-node ports + errors)
  <!-- B --> …signal / error / message declarations…
  <bpmn2:process id="…" drools:packageName="org.jbpm" isExecutable="true" processType="Public">
    <!-- C --> …properties…               (one per process variable)
    <!-- D --> …sequenceFlows…            (with conditionExpression where needed)
    <!-- E --> …flow nodes…               (events, tasks, gateways, sub-processes, boundaries)
  </bpmn2:process>
  <!-- F --> <bpmndi:BPMNDiagram>…BPMNPlane with BPMNShape per node + BPMNEdge per flow…</bpmndi:BPMNDiagram>
</bpmn2:definitions>
```
(jBPM tolerates flows before nodes; ids just need to resolve.)

### Definitions header (copy verbatim, vary only `id`)
```xml
<bpmn2:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns="http://www.omg.org/bpmn20" xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  xmlns:drools="http://www.jboss.org/drools" id="_def1"
  xsi:schemaLocation="http://www.omg.org/spec/BPMN/20100524/MODEL BPMN20.xsd http://www.jboss.org/drools drools.xsd http://www.omg.org/spec/DD/20100524/DC DC.xsd http://www.omg.org/spec/DD/20100524/DI DI.xsd "
  exporter="jBPM Process Modeler" exporterVersion="2.0" targetNamespace="http://www.omg.org/bpmn20">
```

---

## 3. Assembly algorithm (step by step)

**Step A — collect & emit `itemDefinition`s** (all at definitions scope):
1. one per process variable: `<itemDefinition id="_<var>Item" structureRef="<type>"/>`
2. per **REST service call** (call activity to rest-executor): 16 port items + 1 result item:
   `__<nodeId>_<Param>InputXItem` for the 16 REST params, `__<nodeId>_ResultOutputXItem`.
3. per **user task**: `__<nodeId>_TaskNameInputXItem`, `_SkippableInputXItem`, `_GroupIdInputXItem`.
4. per **error** used: `<bpmn2:error id="TERMINATE_CASE" errorCode="TERMINATE_CASE"/>` (this is a
   sibling of itemDefinition, emitted in this block).

**Step B — emit declarations**: `<bpmn2:signal id name/>` per signal; `<bpmn2:message>` per message.

**Step C — open process & emit `property`** per variable (see variables ref §1).

**Step D — emit `sequenceFlow`s** from `flows[]`:
```xml
<bpmn2:sequenceFlow id="_fdeath" name="Death" sourceRef="_XG_TYPE" targetRef="_SC_PEND">
  <bpmn2:conditionExpression xsi:type="bpmn2:tFormalExpression"
    language="http://www.java.com/java"><![CDATA[return "DEATH".equals(claimType);]]></bpmn2:conditionExpression>
</bpmn2:sequenceFlow>
```

**Step E — emit each flow node** from its node.json (see §4 mapping). For each node emit its
`<incoming>`/`<outgoing>` from the model, its `ioSpecification` + associations from
`dataInputs`/`dataOutputs`, `extensionElements` from `scripts`, and type-specific children.

**Step F — emit boundary events** (they reference a host; emit after hosts). Add each boundary's
flow to the handler's `<incoming>` — NOT the host's `<outgoing>` (see `_boundary-events-reference.md`).

**Step G — emit BPMNDI**: one `<bpmndi:BPMNShape bpmnElement="<nodeId>">` with `<dc:Bounds>` from
`position`, one `<bpmndi:BPMNEdge bpmnElement="<flowId>">` with `>=2 <di:waypoint>` per flow.
Boundary shapes dock on the host border. MI/embedded sub-process shapes use `isExpanded="true"`
if you render inner nodes.

---

## 4. Node JSON `type` → BPMN element mapping
| JSON `type` (+subtype) | BPMN element | Required children / attrs |
|------------------------|--------------|---------------------------|
| `startEvent` none | `startEvent` | `outgoing` |
| `startEvent` signal | `startEvent` | `signalEventDefinition signalRef` |
| `startEvent` error (event sub-proc) | `startEvent isInterrupting="true"` | `errorEventDefinition errorRef` |
| `endEvent` none | `endEvent` | `incoming` |
| `endEvent` terminate | `endEvent` | `terminateEventDefinition` |
| `endEvent` signalThrow | `endEvent` | `signalEventDefinition signalRef` |
| `endEvent` errorThrow | `endEvent` | `errorEventDefinition errorRef` |
| `scriptTask` | `scriptTask scriptFormat=…java` | `<script><![CDATA[…]]>` |
| `serviceTask` rest | `task drools:taskName="Rest"` | ioSpecification(16 inputs+Result)+associations |
| `callActivity` reusable | `callActivity calledElement=…` | onEntry/onExit scripts + ioSpec + associations |
| `callActivity` multiInstance | `callActivity` + `multiInstanceLoopCharacteristics` | loopDataInputRef/OutputRef + input/outputDataItem |
| `userTask` | `userTask` | ioSpec(TaskName,Skippable,GroupId)+assignments |
| `exclusiveGateway` | `exclusiveGateway gatewayDirection=…` | incoming/outgoing; conditions on flows |
| `subProcess` event | `subProcess triggeredByEvent="true"` | inner start(error)+end(terminate)+flow |
| `boundaryEvent` error | `boundaryEvent attachedToRef=… cancelActivity=…` | `errorEventDefinition` + outgoing |
| `boundaryEvent` timer | `boundaryEvent attachedToRef=…` | `timerEventDefinition/timeDuration` + outgoing |
| `intermediateCatchEvent` timer | `intermediateCatchEvent` | `timerEventDefinition` + in/out |
| `sequenceFlow` | `sequenceFlow sourceRef targetRef` | optional `conditionExpression` |

## 5. Data mapping rules
From `dataInputs[]`/`dataOutputs[]` in node.json:
- `{"from":"variable","value":"reqPayload"}` → `dataInputAssociation sourceRef=reqPayload → port`
- `{"from":"constant","value":"POST"}` or `{"from":"expression","value":"#{baseUrl}/v1/…"}`
  → `dataInputAssociation` with `assignment from=<![CDATA[value]]> to=port`
- `{"to":"resPayload"}` on an output → `dataOutputAssociation sourceRef=port → resPayload`
- `{"from":"loopItem"}` / `{"from":"loopOutputItem"}` → provided by MI loop, **no** association
Full XML: `_data-mapping-reference.md`.

## 6. ID & convention rules
- Element ids: unique, start with `_`. itemDefinition for a var = `_<var>Item`; REST port items =
  `__<nodeId>_<Param>InputXItem`.
- Every `sequenceFlow` id appears in exactly one source `<outgoing>` and one target `<incoming>`.
- URL/expression values use `#{var}`; constants are plain text; both inside `<![CDATA[…]]>`.
- REST URL pattern: `#{baseUrl}/v1/<path>`; `Method` constant; `ContentType`=`application/json`;
  `HandleResponseErrors`=`true`; `ContentData`←`reqPayload`; `Result`→`resPayload`.

## 7. Pre-write validation (run before serialising)
1. **Well-formed XML** (xmllint --noout).
2. **Flow endpoints exist**: every `sourceRef`/`targetRef` is a node id.
3. **Incoming/outgoing symmetry**: node `<incoming>`/`<outgoing>` sets exactly match the flows.
4. **DI coverage**: every node has a `BPMNShape`; every flow a `BPMNEdge`.
5. **Reference integrity**: every `signalRef`/`errorRef`/`itemSubjectRef`/`calledElement` resolves.
6. **MI**: `loopDataInputRef` port has an association to a `java.util.List` variable; item vars declared.

## 8. Worked example (call-activity/node.json → BPMN)
Model (abridged):
```json
{ "id":"_V_ASSIGN","type":"callActivity","subtype":"reusable",
  "calledElement":"prudential-claims-submission.pru-rest-executor",
  "incoming":["_f3"],"outgoing":["_f4"],
  "scripts":{"onEntry":"…build reqPayload…","onExit":"…set verifierId…"},
  "dataInputs":[{"name":"ContentData","from":"variable","value":"reqPayload"},
                {"name":"ContentType","from":"constant","value":"application/json"},
                {"name":"HandleResponseErrors","from":"constant","value":"true"},
                {"name":"Method","from":"constant","value":"POST"},
                {"name":"Url","from":"expression","value":"#{baseUrl}/v1/claims/verification/assign"}],
  "dataOutputs":[{"name":"Result","to":"resPayload"}] }
```
Emits (structure): itemDefinitions `__ _V_ASSIGN_<16 params>InputXItem` + `__ _V_ASSIGN_ResultOutputXItem`
→ a `<callActivity calledElement="…pru-rest-executor">` with `extensionElements` (onEntry/onExit),
`ioSpecification` (16 dataInputs + Result output + input/outputSets), 5 `dataInputAssociation`s
(ContentData from var; ContentType/HandleResponseErrors/Method/Url via assignment), and a
`dataOutputAssociation` Result→resPayload. Plus a `BPMNShape` at its `position` and edges for `_f3`/`_f4`.
The full emitted block is what you see in `src/main/resources/org/jbpm/pru-verification-process.bpmn`.

## 9. Deploying the generated file
Drop the `.bpmn` under `src/main/resources` (kmodule auto-discovers). Ensure work-item handlers
(`Rest`) and env entries (`INTEGRATION_LAYER_URL`) are in `META-INF/kie-deployment-descriptor.xml`,
then build the kjar (`kie-maven-plugin`) / import into Business Central. Reusable child processes
(rest-executor, single-claim, nigo, api-error-handler) must be deployed in the same container so
`calledElement` resolves.

## Related
- `_all-bpmn-nodes-reference.md` — full element set · `_data-mapping-reference.md` — associations ·
  `_process-variables-reference.md` — variables · `_boundary-events-reference.md` — boundaries ·
  `_error-handling-reference.md` — local/global handling · each `<node>/node.json` — per-node model.
