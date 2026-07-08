# Mappings & Enumerations Reference (controlled vocabulary)

Every reference / enumeration field used in the node JSON models and the emitted BPMN, with **all
possible values**, what each means, and **what it applies to**. Use this as the allowed-values
dictionary when building/validating an engine model.

Legend: **[used]** = a value actually present in this project · **jBPM** = supported by jBPM.

---

## 1. `type` (engine node type) → `bpmnElement`
| `type` | `bpmnElement` (XML) | Applies as |
|--------|---------------------|-----------|
| startEvent **[used]** | `startEvent` | process / event-subprocess entry |
| endEvent **[used]** | `endEvent` | branch/process end |
| scriptTask **[used]** | `scriptTask` | in-engine logic |
| serviceTask **[used]** | `task` (+`drools:taskName`) or `serviceTask` | automated work item |
| userTask **[used]** | `userTask` | human task |
| callActivity **[used]** | `callActivity` | invoke reusable process |
| exclusiveGateway **[used]** | `exclusiveGateway` | XOR route/merge |
| parallelGateway | `parallelGateway` | AND fork/join |
| inclusiveGateway | `inclusiveGateway` | OR fork/join |
| eventBasedGateway | `eventBasedGateway` | race on events |
| complexGateway | `complexGateway` | custom (avoid in jBPM) |
| subProcess **[used]** | `subProcess` | embedded / event / transaction / adhoc |
| boundaryEvent **[used]** | `boundaryEvent` | attached catcher |
| intermediateCatchEvent **[used]** | `intermediateCatchEvent` | in-flow wait/catch |
| intermediateThrowEvent | `intermediateThrowEvent` | in-flow throw |
| sequenceFlow **[used]** | `sequenceFlow` | connector |
| sendTask / receiveTask / manualTask / businessRuleTask | resp. elements | message/human/rules |
| adHocSubProcess / transaction | `adHocSubProcess` / `subProcess` | unordered / ACID scope |

## 2. `subtype` (per type)
| type | allowed `subtype` |
|------|-------------------|
| startEvent | none **[used]**, signal **[used]**, message, timer, conditional, error **[used, in event-subprocess]**, escalation, compensation, multiple, parallelMultiple |
| endEvent | none **[used]**, terminate **[used]**, signalThrow **[used]**, errorThrow **[used]**, message, escalation, cancel, compensation, multiple |
| intermediateCatchEvent | timer **[used]**, message, signal, conditional, link, escalation, compensation |
| intermediateThrowEvent | none, message, signal, link, escalation, compensation |
| boundaryEvent | error **[used]**, timer **[used]**, message, signal, conditional, escalation, cancel, compensation |
| callActivity | reusable **[used]**, multiInstance **[used]** |
| subProcess | embedded, event **[used]**, transaction, adhoc |
| serviceTask | rest **[used]**, webservice, email, log, custom |

---

## 3. Event definition — `eventType` → element + reference field + valid positions
| `eventType` | `*EventDefinition` | reference field | valid at (start / int-catch / int-throw / end / boundary) |
|-------------|--------------------|-----------------|-----------------------------------------------------------|
| none | (none) | — | S / — / throw(pass) / E / — |
| message | `messageEventDefinition` | `messageRef` (+`<message>`) | S / C / T / E / B |
| timer **[used]** | `timerEventDefinition` | (timeDuration/Cycle/Date) | S / C / — / — / B |
| signal **[used]** | `signalEventDefinition` | `signalRef` (+`<signal>`) | S / C / T / E / B |
| error **[used]** | `errorEventDefinition` | `errorRef` (+`<error>`) | S(event-subproc) / — / — / E(throw) / B(catch) |
| escalation | `escalationEventDefinition` | `escalationRef` (+`<escalation>`) | S(event-subproc) / — / T / E / B |
| conditional | `conditionalEventDefinition` | `<condition>` expr | S / C / — / — / B |
| compensation | `compensateEventDefinition` | activityRef | S(event-subproc) / — / T / E / B |
| cancel | `cancelEventDefinition` | — | — / — / — / E / B (transaction only) |
| link | `linkEventDefinition` | `name` (pairs) | — / C / T / — / — |
| terminate **[used]** | `terminateEventDefinition` | — | — / — / — / E / — |
| multiple / parallelMultiple | several defs | multiple refs | S / C / T(mult) / E / B |

---

## 4. `errorRef` / errorCode — ALL possible values & applicability
`errorRef` points at a `<bpmn2:error id errorCode>` (matched by **errorCode**; `drools:erefname`
mirrors it). Applies to: **error boundary event** (catch), **error end event** (throw),
**error start event** in an event sub-process (catch/global).

| Value | Kind | Meaning | Where to use |
|-------|------|---------|--------------|
| `org.jbpm.bpmn2.handler.WorkItemHandlerRuntimeException` **[used]** | jBPM built-in | Auto-thrown when a **work-item handler fails** (e.g. `RESTWorkItemHandler` on non-2xx with `HandleResponseErrors=true`, timeout, connection error) | **Boundary error** on a service task / call activity that wraps a work item (as in `pru-rest-executor`) |
| `TERMINATE_CASE` **[used]** | custom business error | Project's global "kill the case" signal | Thrown by an **error-end**; caught by the **global error event sub-process** |
| `REST_API_FAILURE` **[used]** | custom business error | Named REST failure category | Throw/catch where you want a specific business handler |
| _any user-defined code_ | custom | Whatever your domain needs (e.g. `POLICY_LOCKED`, `PVS_MISMATCH`) | Declare `<bpmn2:error id="X" errorCode="X"/>`, then throw/catch by `errorRef="X"` |
| _absent / empty_ `errorRef` | catch-all | A boundary/start error event with **no** `errorRef` catches **any** error | Generic fallback handler |

Related (not an `errorRef`, but error handling):
- `org.kie.api.runtime.process.ProcessWorkItemHandlerException` (jBPM ≥ 7.13) — a handler throws this
  to request a **strategy**: `COMPLETE` | `RETRY` | `ABORT` | `RETHROW` (with a retry count) instead
  of wiring a boundary. Configured in code, not BPMN.

Rules: the thrown `errorCode` must equal a caught `errorCode` (or the catcher is a catch-all).
Errors **propagate** from a child call activity/sub-process up to the first matching catcher; if
none, the instance faults. See `_error-handling-reference.md`.

---

## 5. `signalRef` / `messageRef` / `escalationRef`
| Field | Points to | Values | Applies to |
|-------|-----------|--------|-----------|
| `signalRef` **[used]** | `<bpmn2:signal id name>` | user-defined names — here `StartSystemClaim`, `PaymentProcess`, `ClaimExaminer`; matched by **name**; broadcast to all listeners | signal start/catch/throw/end/boundary |
| `messageRef` | `<bpmn2:message id name>` | user-defined; **point-to-point** (one sender→one receiver) | message events, send/receive tasks |
| `escalationRef` | `<bpmn2:escalation id escalationCode>` | user-defined codes | escalation throw/boundary/end/event-subproc |

---

## 6. `structureRef` (variable / item types)
Applies to `itemDefinition` (→ `property`, `dataInput`, `dataOutput`).
| Value | Java | Notes |
|-------|------|------|
| `String` **[used]** / `java.lang.String` **[used]** | String | ids, statuses, JSON strings |
| `Integer` **[used]** / `java.lang.Integer` / `java.lang.Long` | Integer/Long | counters |
| `java.lang.Boolean` **[used]** / `Boolean` **[used]** | Boolean | flags |
| `java.lang.Double` **[used]** / `Float` / `java.lang.Float` | floating point | amounts |
| `Object` **[used]** / `java.lang.Object` **[used]** | Object | parsed JSON / POJO |
| `java.util.List` **[used]** | List | collections (MI input/output) |
| `java.util.Map` / `java.util.Set` / `java.util.Date` | resp. | maps / sets / dates |
| _`""` (empty)_ **[used]** | untyped | used for node **port** item defs (`__<node>_<Param>InputXItem`) |
| _`<any FQCN>`_ | custom class | must be on the kjar classpath |

---

## 7. Script / condition language dialects
| Field | Values | Applies to |
|-------|--------|-----------|
| `scriptFormat` | `http://www.java.com/java` **[used]**, `http://www.mvel.org/2.0` (MVEL) | `scriptTask`, `drools:onEntry-script`, `drools:onExit-script` |
| conditionExpression `language` | `http://www.java.com/java` **[used]**, `http://www.mvel.org/2.0`, (FEEL in DMN contexts) | outgoing sequence-flow conditions |
| expression `xsi:type` | `bpmn2:tFormalExpression` **[used]** | conditionExpression, assignment from/to, timeDuration/Cycle/Date |

Java condition returns a boolean: `return "DEATH".equals(claimType);`. MVEL is expression-only.

---

## 8. Timer definition (choose exactly one)
Applies to timer events (start/intermediate/boundary).
| Sub-element | Format | Examples |
|-------------|--------|----------|
| `timeDuration` **[used]** | ISO-8601 duration `PnYnMnDTnHnMnS` | `P30D` (30 days), `PT15M`, `PT1M` **[used, test]**, `PT3M` |
| `timeCycle` | repeating `Rn/<duration>` or cron | `R5/PT10M`, `0 0/5 * * * ?` |
| `timeDate` | ISO-8601 datetime | `2026-07-08T10:00:00Z` |

---

## 9. Boolean / enum attributes (with defaults)
| Attribute | Values (default **bold**) | Applies to |
|-----------|---------------------------|-----------|
| `cancelActivity` | **true** (interrupting) / false (non-interrupting) | boundaryEvent |
| `isInterrupting` | **true** / false | event-subprocess start event |
| `isSequential` (MI) | true (sequential) / **false** (parallel) **[used=false]** | multiInstanceLoopCharacteristics |
| `drools:independent` | true / false — **[used: true on REST calls, false on MI]** | callActivity |
| `drools:waitForCompletion` | **true** **[used]** / false | callActivity |
| `triggeredByEvent` | true (event sub-proc) **[used]** / **false** | subProcess |
| `gatewayDirection` | Unspecified / Converging **[used]** / Diverging **[used]** / Mixed | gateways |
| `processType` | None / Public **[used]** / Private | process |
| `isCollection` | true / **false** | dataObject (true for list data) |
| sequenceFlow `isImmediate` | true / false | sequenceFlow |
| gateway `default` | a flow id | diverging gateway (else-branch) |

---

## 10. `drools:taskName` (service work-item type)
Applies to `task`/`serviceTask`. Registered set (WorkDefinitions.wid + deployment descriptor):
| Value | Handler | Purpose |
|-------|---------|---------|
| `Rest` **[used]** | `RESTWorkItemHandler` | HTTP call |
| `WebService` | WS handler | SOAP/JAX-WS |
| `Email` | email handler | send email |
| `Log` | log handler | log a message |
| `Milestone` | milestone | case milestone marker |
| `BusinessRuleTask` | Drools | rule evaluation (DRL) |
| `DecisionTask` | DMN | DMN decision |
| _custom_ | your registered handler | anything (must be in kie-deployment-descriptor + .wid) |

---

## 11. REST work-item data inputs (values) — `service-task-rest` / rest-executor call
| Port | Allowed values |
|------|----------------|
| `Url` | string / `#{var}` expression — here `#{baseUrl}/v1/...` |
| `Method` | GET / POST **[used]** / PUT **[used]** / DELETE / PATCH / HEAD / OPTIONS |
| `ContentData` | request body string (usually `reqPayload` var) |
| `ContentType` | application/json **[used]** / application/xml / text/plain / application/x-www-form-urlencoded / multipart/form-data |
| `ContentTypeCharset` | e.g. `UTF-8` |
| `HandleResponseErrors` | true **[used]** / false (true → throw on non-2xx) |
| `Headers` | `k1:v1;k2:v2` string |
| `ConnectTimeout` / `ReadTimeout` | milliseconds (string) |
| `ResultClass` | FQCN to deserialize into (else raw String) |
| `AcceptHeader` / `AcceptCharset` | content negotiation |
| `AuthType` | NONE / BASIC / FORM_BASED (handler-specific) |
| `AuthUrl` / `Username` / `Password` | auth params |
| output `Result` | response body → mapped to `resPayload` |

---

## 12. User-task data inputs (values) — `user-task`
| Port | Allowed values |
|------|----------------|
| `TaskName` **[used]** | logical/form name (string) |
| `Skippable` **[used]** | true / false |
| `GroupId` **[used]** | role/queue — here `Verifier`, `System`, `ClaimsExaminer` |
| `ActorId` | specific user id(s) |
| `Priority` | integer (string) |
| `Comment` / `Description` / `Content` | text |
| `NotStartedReassign` / `NotCompletedReassign` | deadline reassignment expr |
| `Locale` | e.g. `en-UK` |

---

## 13. Engine dataInput/output `.from` / `.to` (model-level)
| Value | Meaning | Emits |
|-------|---------|-------|
| `from: "variable"` **[used]** | value from a process var | `dataInputAssociation sourceRef=var → port` |
| `from: "constant"` **[used]** | literal | `assignment from=<![CDATA[value]]> → port` |
| `from: "expression"` **[used]** | MVEL `#{...}` | `assignment` with `#{var}` text |
| `from: "loopItem"` **[used]** | MI per-iteration element | no association (bound by `inputDataItem`) |
| `from: "loopOutputItem"` **[used]** | MI per-iteration output | no association (bound by `outputDataItem`) |
| output `to: "<var>"` **[used]** | write port to var | `dataOutputAssociation port → var` |

---

## 14. Multi-instance loop characteristics
| Field | Values | Notes |
|-------|--------|------|
| `isSequential` | true / false (**false=parallel** here) | ordering |
| `loopDataInputRef` | a dataInput id | the collection to iterate |
| `loopDataOutputRef` | a dataOutput id | collection to gather results |
| `inputDataItem` (id,name) | var name (`currentPolicy`) | per-iteration element → child input |
| `outputDataItem` (id,name) | var name (`claimResult`) | child output collected |
| `completionCondition` | boolean expr | optional early exit |

---

## 15. Artifacts / misc
| Field | Values | Applies to |
|-------|--------|-----------|
| `associationDirection` | None / One / Both | association |
| callActivity `calledElement` | a deployed process id | must resolve in the same container |
| `implementation` | `##WebService` / `##unspecified` | serviceTask/message |

## Related
`_all-bpmn-nodes-reference.md` (element set) · `_process-variables-reference.md` (types/scope) ·
`_data-mapping-reference.md` (association XML) · `_error-handling-reference.md` (error semantics) ·
`_bpmn-assembly-guide.md` (how these fields serialise into a file).
