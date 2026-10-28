# All BPMN 2.0 Nodes — Complete Reference

Researched against the OMG BPMN 2.0 spec, the Camunda BPMN symbol reference, and jBPM docs.
This is the **full palette** a custom BPM engine may need to model/generate — broader than the
subset this project uses. Legend: **[USED]** = present in the prudential-claims processes (has a
dedicated folder here); **jBPM** = supported by the jBPM/Business Central engine.

---

## 1. Events

An event is drawn as a circle; its **trigger** is the inner icon and its **type** is the border
style. In BPMN XML an event is `startEvent` / `intermediateCatchEvent` / `intermediateThrowEvent`
/ `endEvent` / `boundaryEvent`, and the trigger is a child `*EventDefinition`.

### 1.1 Trigger × position matrix
| Trigger | Start | Intermediate Catch | Intermediate Throw | End | Boundary (int / non-int) | jBPM |
|---------|:-----:|:------------------:|:------------------:|:---:|:-------------------------:|:----:|
| None | ✓ **[USED]** | — | ✓ (pass-through) | ✓ **[USED]** | — | ✓ |
| Message | ✓ | ✓ | ✓ | ✓ | ✓ / ✓ | ✓ |
| Timer | ✓ | ✓ **[USED]** | — | — | ✓ **[USED]** / ✓ | ✓ |
| Signal | ✓ **[USED]** | ✓ | ✓ **[USED]** | ✓ **[USED]** | ✓ / ✓ | ✓ |
| Error | ✓ (event sub-proc) **[USED]** | — | — | ✓ **[USED]** | ✓ **[USED]** / — | ✓ |
| Escalation | ✓ (event sub-proc) | — | ✓ | ✓ | ✓ / ✓ | ✓ |
| Conditional | ✓ | ✓ | — | — | ✓ / ✓ | ✓ |
| Compensation | ✓ (event sub-proc) | — | ✓ | ✓ | ✓ / — | partial |
| Cancel | — | — | — | ✓ (transaction) | ✓ / — (transaction) | partial |
| Link | — | ✓ | ✓ | — | — | ✓ |
| Terminate | — | — | — | ✓ **[USED]** | — | ✓ |
| Multiple | ✓ | ✓ | ✓ | ✓ | ✓ / ✓ | partial |
| Parallel Multiple | ✓ | ✓ | — | — | ✓ / ✓ | partial |

### 1.2 Event definition XML (child of the event element)
| Trigger | `*EventDefinition` element |
|---------|----------------------------|
| Message | `messageEventDefinition` (+ `<message>` decl) |
| Timer | `timerEventDefinition` (`timeDuration`/`timeCycle`/`timeDate`) |
| Signal | `signalEventDefinition` (+ `<signal>` decl) |
| Error | `errorEventDefinition` (+ `<error>` decl) |
| Escalation | `escalationEventDefinition` (+ `<escalation>` decl) |
| Conditional | `conditionalEventDefinition` (`<condition>`) |
| Compensation | `compensateEventDefinition` |
| Cancel | `cancelEventDefinition` |
| Link | `linkEventDefinition` (name pairs catch/throw) |
| Terminate | `terminateEventDefinition` |

> Semantics that matter for a generator: **Error** interrupts/propagates to a catching handler;
> **Signal** is broadcast and lets flow continue; **Escalation** is like signal but attachable to
> boundaries and non-interrupting-capable; **Terminate** kills the whole instance; **Message** is
> point-to-point (one sender/one receiver); **Timer** waits/schedules.

---

## 2. Activities

### 2.1 Task types — `<bpmn2:<taskType>>`
| Task | Element | jBPM binding | When to use | Here |
|------|---------|--------------|-------------|:----:|
| Service | `serviceTask` / `task` + `drools:taskName` | Work item handler (e.g. `Rest`, `WebService`, `Email`, `Log`) | Automated call (HTTP, email, log) | **[USED]** (Rest) |
| Script | `scriptTask` | In-engine Java/MVEL | Cheap in-memory logic, var mapping | **[USED]** |
| User | `userTask` | Human task API | Human decision/input; waits | **[USED]** |
| Business Rule | `businessRuleTask` | Drools DMN/DRL (`DecisionTask`) | Delegate a decision to rules | registered in .wid |
| Send | `sendTask` | Message send | Fire-and-forget message | ✓ |
| Receive | `receiveTask` | Message wait | Block for an incoming message | ✓ |
| Manual | `manualTask` | none (offline work) | Work done outside the system | ✓ |
| Undefined/Abstract | `task` | none | Placeholder / abstract step | ✓ |

Task **markers**: `standardLoopCharacteristics` (loop while/until), `multiInstanceLoopCharacteristics`
(`isSequential` true/false) **[USED on call activity]**, compensation marker, ad-hoc.

### 2.2 Sub-processes & call
| Kind | Element | Notes | Here |
|------|---------|-------|:----:|
| Embedded sub-process | `subProcess` | Inline scope; own start/end; shares parent vars | ✓ |
| Event sub-process | `subProcess triggeredByEvent="true"` | Triggered by its start event; not sequence-wired | **[USED]** (global terminate) |
| Transaction | `subProcess` + transaction/cancel | ACID-ish scope with cancel/compensation | partial |
| Ad-hoc | `adHocSubProcess` | Unordered tasks, `completionCondition` | ✓ |
| Call activity | `callActivity calledElement=...` | Invoke a reusable process/global task | **[USED]** (+ MI) |

---

## 3. Gateways — `<bpmn2:<gatewayType>>`
| Gateway | Element | Split behaviour | Merge behaviour | Here |
|---------|---------|-----------------|-----------------|:----:|
| Exclusive (XOR) | `exclusiveGateway` | exactly one path (first true cond / default) | pass-through (no wait) | **[USED]** |
| Parallel (AND) | `parallelGateway` | all paths | waits for all incoming | ✓ |
| Inclusive (OR) | `inclusiveGateway` | all paths whose cond is true | waits for all active incoming | ✓ |
| Event-based | `eventBasedGateway` | routes to whichever catch-event fires first | — | ✓ |
| Parallel event-based (instantiating) | `eventBasedGateway` + attrs | start on first of several events | — | partial |
| Complex | `complexGateway` | custom `activationCondition` | custom | rarely; avoid in jBPM |

Conditions live on the **outgoing sequence flows** (`conditionExpression`), not the gateway.

---

## 4. Data
| Element | XML | Purpose | Here |
|---------|-----|---------|:----:|
| Process variable | `property` (+ `itemDefinition`) | engine state; `kcontext` reads these | **[USED]** |
| Data Object | `dataObject` / `dataObjectReference` | modelled data flowing between nodes | ✓ |
| Data Input / Output | `dataInput` / `dataOutput` (in `ioSpecification`) | node-level ports | **[USED]** |
| Data Store | `dataStore` / `dataStoreReference` | persistent external store | ✓ |
| Data Association | `dataInputAssociation` / `dataOutputAssociation` | move values var↔port | **[USED]** |
| Collection | dataObject with `isCollection="true"` | list data (MI input/output) | **[USED]** (applicablePolicies) |

See `_data-mapping-reference.md` for the mapping XML.

---

## 5. Swimlanes & connections
| Element | XML | Purpose | Here |
|---------|-----|---------|:----:|
| Pool (participant) | `participant` / `collaboration` | a process participant | diagram lanes in source PNG |
| Lane | `lane` / `laneSet` | role/responsibility band within a pool | ✓ (Verifier/System/Examiner) |
| Sequence Flow | `sequenceFlow` | control-flow order (+ condition/default) | **[USED]** |
| Message Flow | `messageFlow` | message between pools | ✓ |
| Association | `association` | link artifact to element | ✓ |
| Data Association | `dataInputAssociation`/`dataOutputAssociation` | data movement | **[USED]** |

## 6. Artifacts
| Element | XML | Purpose |
|---------|-----|---------|
| Text Annotation | `textAnnotation` | comment/label (the grey callouts in the diagram) |
| Group | `group` | visual grouping, no runtime effect |

---

## 7. jBPM support notes (for a generator targeting jBPM)
- Fully supported and safe: none/signal/timer/error/terminate events; user/script/service(Rest,
  WebService, Email, Log, BusinessRule) tasks; exclusive/parallel/inclusive/event-based gateways;
  embedded/event sub-process; call activity incl. multi-instance; sequence flow with conditions.
- Use with care / partial: complex gateway, cancel/compensation & transaction sub-process,
  multiple/parallel-multiple events — supported unevenly across versions; prefer explicit modelling.
- jBPM extensions on top of BPMN: `drools:taskName` (work-item selection), `drools:packageName`,
  `drools:onEntry-script`/`onExit-script`, `drools:independent`/`waitForCompletion` on call activity,
  `drools:erefname` on error definitions.

## Sources
- Camunda BPMN 2.0 symbol reference — https://camunda.com/bpmn/reference/
- jBPM Exception Management (ch.23) — https://docs.jbpm.org/7.0.0.Beta1/jbpm-docs/html/ch23.html
- OMG BPMN 2.0 specification — https://www.omg.org/spec/BPMN/2.0/
