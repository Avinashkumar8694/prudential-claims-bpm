# Process Variables Reference

Everything about process variables — the state a process instance carries — and how they are
declared, typed, scoped, seeded, read/written, and mapped to node data ports. Required knowledge
for generating BPMN back from an engine model.

---

## 1. What a process variable is
A named, typed value stored on the process instance. Two XML parts:
1. a **type** — `<bpmn2:itemDefinition>` at definitions scope, and
2. a **variable** — `<bpmn2:property>` inside `<bpmn2:process>` that references the itemDefinition.

```xml
<!-- definitions scope -->
<bpmn2:itemDefinition id="_caseIdItem" structureRef="String"/>
<!-- inside <bpmn2:process> -->
<bpmn2:property id="caseId" itemSubjectRef="_caseIdItem" name="caseId"/>
```
`kcontext.getVariable("caseId")` / `#{caseId}` resolve this at runtime.

---

## 2. Type catalogue (`structureRef`)
| structureRef | Java type | Use |
|--------------|-----------|-----|
| `String` | String | ids, statuses, JSON strings |
| `Integer` | Integer | counters (`maxRetryCount`) |
| `java.lang.Boolean` | Boolean | flags (`anyContestable`, `caseStpEligible`) |
| `java.lang.Double` | Double | amounts (`payoutAmount`) |
| `java.lang.Object` | Object | parsed JSON nodes / POJOs (`extractedData`, `claimResult`) |
| `java.util.List` | List | collections (`applicablePolicies`, `claimResults`) |
| `<FQCN>` | any registered class | custom domain objects |

Rule: **every `property` must reference an existing `itemDefinition`**; unresolved `itemSubjectRef`
breaks import.

---

## 3. Scope & lifecycle
| Scope | Where declared | Visible to |
|-------|----------------|-----------|
| Process | `<property>` in the top-level `<process>` | all nodes, scripts, conditions |
| Sub-process | `<property>` inside an embedded `<subProcess>` | that sub-process (inherits parent too) |
| Task data input/output | `dataInput`/`dataOutput` in a node `ioSpecification` | that node only (a port, not a var) |
| MI loop item | `inputDataItem` / `outputDataItem` on `multiInstanceLoopCharacteristics` | one iteration (`currentPolicy`, `claimResult`) |

Lifecycle: created when first set (or seeded at start), live for the instance, discarded on
completion. Transient working vars (`reqPayload`, `resPayload`) are normal process vars reused
per node — nothing special in BPMN, just convention.

---

## 4. How variables get their values (seeding)
| Mechanism | How |
|-----------|-----|
| Start variable map | Caller passes a map on `POST .../processes/{id}/instances` → seeds process vars (e.g. `caseId`, `applicablePolicies`, `claimType`) |
| Signal payload | Signal start/catch can map the signal data to a var (optional) |
| Call activity in/out | Parent maps its vars into the child (`dataInputAssociation`) and back (`dataOutputAssociation`) |
| MI loop | Per iteration the collection element is bound to `inputDataItem`; each child output collected into the output collection |
| Script/service result | `kcontext.setVariable(...)` in a script or on-exit; REST `Result` → var |

---

## 5. Reading & writing at runtime
- In **scripts** (`scriptTask`, on-entry/on-exit): `kcontext.getVariable("x")`,
  `kcontext.setVariable("x", value)`.
- In **data input assignments** and **URLs**: MVEL interpolation `#{x}` (e.g.
  `#{baseUrl}/v1/claims/mrx-check`).
- In **gateway conditions**: the variable name is in scope directly, e.g.
  `return "DEATH".equals(claimType);`.

---

## 6. Variable ↔ node data port mapping
A node exposes **ports** (`dataInput`/`dataOutput`); associations connect ports to variables:
- into a port from a var: `dataInputAssociation` `sourceRef=var → targetRef=port`
- into a port from a constant/expression: `assignment` `from=<![CDATA[...]]> → to=port`
- out of a port to a var: `dataOutputAssociation` `sourceRef=port → targetRef=var`

Full XML in `_data-mapping-reference.md`.

---

## 7. This project's variable inventory (per process)
**Common (all processes):** `caseId:String`, `claimId:String`, `baseUrl:String`,
`reqPayload:String` (transient request JSON), `resPayload:String` (transient response JSON),
`maxRetryCount:Integer`.

**pru-verification-process:** `verifierId:String`, `externalVerificationResult:Object`,
`verificationDecision:String` (PROMOTE|HOLD|CLOSE — set by the Update Decision user task),
`notificationStatus:String`.

**pru-system-claim-process:** `applicablePolicies:List`, `claimType:String`,
`anyContestable:Boolean`, `mrxDiscrepancyFlag:Boolean`, `caseStpEligible:Boolean`,
`outcome:String` (STP|PENDING_REQ|EXAMINER), `currentPolicy:String` (MI item),
`claimResult:Object` (MI child output), `claimResults:List` (collected).

**pru-process-single-claim (child):** `currentPolicy:String` (input), `caseId`, `claimId`,
`claimStpEligible:Boolean`, `claimResult:Object` (output).

---

## 8. Engine JSON model for a variable
Keep variables alongside nodes in your model so serialisation can emit both the itemDefinition
and the property:
```json
{
  "name": "applicablePolicies",
  "type": "java.util.List",
  "scope": "process",
  "transient": false,
  "seededBy": "startVariableMap",
  "description": "All eligible policy numbers for the case"
}
```
Serialises to:
```xml
<bpmn2:itemDefinition id="_applicablePoliciesItem" structureRef="java.util.List"/>
<bpmn2:property id="applicablePolicies" itemSubjectRef="_applicablePoliciesItem" name="applicablePolicies"/>
```
Convention: `itemDefinition` id = `_<name>Item`.

---

## 9. Gotchas for a generator
- Declare an `itemDefinition` for **every** variable AND for every MI item var referenced by
  `inputDataItem`/`outputDataItem`.
- The `name` used in `kcontext`, `#{...}`, and conditions must equal the `property` `name`.
- Collections used by a multi-instance loop must be `java.util.List`.
- `reqPayload`/`resPayload` are ordinary `String` vars — declare them even though they're transient.
- Don't collide variable names with BPMN reserved data-input names on a node (e.g. a task's
  `TaskName` port is not a process variable).
