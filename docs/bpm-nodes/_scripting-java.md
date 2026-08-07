# Java in jBPM — complete reference (scripts, conditions, type mapping)

Everything needed to write **Java** in a jBPM process for a real project: where it runs, the
`kcontext` API, how process-variable types map in/out (casting), building/parsing JSON for REST,
imports, and a production checklist. Dialect URI: `http://www.java.com/java`.

Java is jBPM's **default, always-available, best-performing** dialect (no runtime engine dependency,
unlike JavaScript). This project is 100% Java.

## 1. Where Java can be used
| Place | Element | Returns |
|-------|---------|---------|
| Script task | `<scriptTask scriptFormat="http://www.java.com/java">` | nothing (side effects via `kcontext`) |
| On-entry / on-exit | `drools:onEntry-script` / `onExit-script` | nothing |
| Gateway condition | outgoing `conditionExpression language="…/java"` | `return <boolean>;` |

The code is compiled by the `kie-maven-plugin` at build; access process variables via `kcontext`.

## 2. `kcontext` API (`org.kie.api.runtime.process.ProcessContext`)

The basics — read/write a variable, the current process instance's id, a session-wide signal:
```java
Object v = kcontext.getVariable("caseId");            // read (returns Object — cast it)
kcontext.setVariable("status", "PENDING");            // write
long piid = kcontext.getProcessInstance().getId();
kcontext.getKieRuntime();                              // globals, signalEvent, etc.
kcontext.getKieRuntime().signalEvent("Go", null);     // broadcast a signal
```

### 2.1 The full surface (verified against jBPM/Drools source — `ProcessInstance`/`NodeInstance`/`KieRuntime`)

`kcontext.getProcessInstance()` is statically typed `ProcessInstance` but the real runtime object is
always a `WorkflowProcessInstanceImpl` — MVEL/JS dialects (dynamic dispatch) can call its full surface
without a cast; Java dialect needs `((WorkflowProcessInstanceImpl) kcontext.getProcessInstance())` for
the impl-only extras below.

| Method | On | Notes |
|---|---|---|
| `getId()` | `ProcessInstance` | the running instance's id |
| `getProcessId()` / `getProcessName()` | `ProcessInstance` | the process *definition* id/name |
| `getState()` | `ProcessInstance` | int: `STATE_PENDING=0 / ACTIVE=1 / COMPLETED=2 / ABORTED=3 / SUSPENDED=4` |
| `getParentProcessInstanceId()` | `ProcessInstance` | `-1` (long) if no parent |
| `getVariable`/`setVariable` | `WorkflowProcessInstance` | same as `kcontext.getVariable` |
| `getVariables()` | impl only | all variables as a `Map` |
| `getNodeInstances()` / `getNodeInstances(boolean recursive)` | `NodeInstanceContainer` / impl | **every currently-active node instance** — a snapshot Collection, not a live view |
| `getCorrelationKey()` | impl only | not on the kie-api interface |
| `signalEvent(type, event)` | `ProcessInstance` (`implements EventListener`) | **self-scoped** — delivered to this instance only |
| `setState(int)` / `setState(int, outcome)` | impl only | e.g. `setState(ProcessInstance.STATE_ABORTED)` — a script-side abort |
| `getNode()` / `getNodeName()` / `getId()` (instance id, ≠ `getNode().getId()` definition id) / `getNodeInstanceContainer()` | `NodeInstance` | |
| `cancel()` / `trigger(...)` / `retrigger(boolean)` | impl only | |
| `startProcess(id[,params])` / `getProcessInstance(id)` / `getProcessInstances()` / `abortProcessInstance(id)` | `KieRuntime` (it *is* the live `KieSession`) | |
| `signalEvent(type, event, processInstanceId)` | `KieRuntime` | **targeted** — delivered to exactly that instance, unlike the untargeted form above |
| `insert`/`delete`/`update`/`getObjects()` | `KieRuntime` (`RuleRuntime`) | Drools working-memory fact operations |
| `getWorkItemManager()` | `KieRuntime` | |

**Two things real jBPM itself documents as unreliable from a script**, not just a this-engine gap:
`startProcess` from a script (Red Hat KB documents real NPEs doing this), and `getProcessInstances()`
enumeration (commonly returns empty — instances are persisted, not held live in the session; real
teams reach for the audit log / `RuntimeDataService` instead).

**Not reachable from `kcontext` at all, confirmed**: human task querying/management
(`TaskService`/`RuntimeDataService` are external REST/Java-client-only APIs — the one workaround,
reaching a `RuntimeManager` through the environment, is an unofficial community pattern, not upstream
behavior) and CMMN case data (`getCaseData()`/`getCaseAssignment()` exist on the interface but are
case-management-specific).

A common, real pattern worth knowing: `((WorkItemNodeInstance) kcontext.getNodeInstance()).
getWorkItem()` reaches the work item behind a service/human task — but **only in onExit**; it's
`null` in onEntry (the work item doesn't exist yet).

See `jbpm-engine/docs/15-scripting-and-jbpm-export.md` for exactly which of this the Node.js engine
implements (most of it) versus intentionally doesn't (documented there, with the reasoning for each).

### 2.2 Writing for the Node.js engine specifically: meta-locals instead of `kcontext` chains

Everything above is real jBPM API — required if this script needs to run inside an actual jBPM/KIE
server (via export, or because it was imported from one). If a script is being authored fresh and will
only ever run in the Node.js engine, it can use a handful of flat, read-only `String` locals instead —
this engine's own invention, NOT jBPM API, bound automatically (only when referenced, and only when
the name isn't already a declared process variable — a declared variable of the same name always wins):

| Bare local | Equivalent `kcontext` call |
|---|---|
| `instanceId` | `kcontext.getProcessInstance().getId()` |
| `processId` | `kcontext.getProcessInstance().getProcessId()` |
| `processName` | `kcontext.getProcessInstance().getProcessName()` |
| `correlationKey` | `kcontext.getProcessInstance().getCorrelationKey()` |
| `parentInstanceId` | `kcontext.getProcessInstance().getParentProcessInstanceId()` |
| `currentNodeId` | `kcontext.getNodeInstance().getNodeId()` |
| `currentNodeName` | `kcontext.getNodeInstance().getNodeName()` |

```java
kcontext.setVariable("summary", instanceId + "/" + currentNodeName);
```

No meta-local covers `getState()`/`getNodeInstances()`/`signalEvent`/`abortProcessInstance` — a Java
author is already expected to reach for the real `kcontext.getKieRuntime()`/`getProcessInstance()`
calls for those (see `jbpm-engine/docs/15-scripting-and-jbpm-export.md`'s "Two ways to write this"
section for why: Java has no object-literal syntax, so there's no clean way to bundle these into one
simple object the way the JS dialect's `instance`/`node` globals do).

**Exporting still works**: a script using one of these gets a matching local declaration (computed from
real `kcontext`, e.g. `String instanceId = kcontext.getProcessInstance().getId();`) prepended at export
time, so the exported text is plain, self-contained Java with zero dependency on this engine — verified
this session against a real `javac` compile. See `jbpm-engine/docs/15-scripting-and-jbpm-export.md`.

## 3. Type mapping — reading variables (getVariable returns `Object`; CAST it)
`getVariable` is untyped — always cast to the declared `structureRef` type.

| Variable `structureRef` | Cast to | Example |
|-------------------------|---------|---------|
| `String` | `String` | `String id = (String) kcontext.getVariable("caseId");` |
| `Integer` / `java.lang.Integer` | `Integer` | `Integer n = (Integer) kcontext.getVariable("count");` |
| `java.lang.Long` | `Long` | `Long x = (Long) kcontext.getVariable("x");` |
| `java.lang.Double` / `Float` | `Double`/`Float` | `Double a = (Double) kcontext.getVariable("amount");` |
| `java.lang.Boolean` | `Boolean` | `Boolean f = (Boolean) kcontext.getVariable("flag");` |
| `java.util.List` | `List<?>` | `java.util.List pols = (java.util.List) kcontext.getVariable("applicablePolicies");` |
| `java.util.Map` | `Map` | `java.util.Map m = (java.util.Map) kcontext.getVariable("data");` |
| `java.lang.Object` (parsed JSON) | `JsonNode` | `com.fasterxml.jackson.databind.JsonNode d = (…JsonNode) kcontext.getVariable("extractedData");` |
| `java.util.Date` | `Date` | `java.util.Date d = (java.util.Date) kcontext.getVariable("dateOfDeath");` |
| custom POJO (FQN) | your class | `com.acme.Claim c = (com.acme.Claim) kcontext.getVariable("claim");` |

Always null-check before casting/using (`if (v != null) …`).

## 4. Type mapping — writing variables (store the DECLARED type)
`setVariable` must receive a value matching the variable's `structureRef`, or downstream code / REST
mapping / rules break.

| Target `structureRef` | Store | Note |
|-----------------------|-------|------|
| `String` | `String` | `kcontext.setVariable("s", "x");` |
| `Integer` | `Integer` | `setVariable("n", Integer.valueOf(5))` — not a `long`/`double` |
| `java.lang.Long` | `Long` | `Long.valueOf(5L)` |
| `java.lang.Double` | `Double` | `Double.valueOf(5.0)` |
| `java.lang.Boolean` | `Boolean` | `Boolean.TRUE` / `root.get("x").asBoolean()` |
| `java.util.List` | `List` | `new java.util.ArrayList<>()` and `add(...)` |
| `java.util.Map` | `Map` | `new java.util.HashMap<>()` |
| `java.lang.Object` | any POJO / `JsonNode` | keep it consistent with what readers expect |
| `java.util.Date` | `Date` | `new java.util.Date()` or parsed |
| custom POJO | your class | `new com.acme.Claim()` |

## 5. JSON build & parse (Jackson) — the REST pattern used in this project
Build the request in **on-entry**, parse the response in **on-exit** (both Java):
```java
// on-entry: build reqPayload (a String var mapped to the REST ContentData)
com.fasterxml.jackson.databind.node.ObjectNode json =
    new com.fasterxml.jackson.databind.ObjectMapper().createObjectNode();
json.put("piid", String.valueOf(kcontext.getProcessInstance().getId()));
json.putPOJO("caseId", kcontext.getVariable("caseId"));
json.putPOJO("applicablePolicies", kcontext.getVariable("applicablePolicies"));
kcontext.setVariable("reqPayload", json.toString());

// on-exit: parse resPayload (String) and set typed outputs
String response = (String) kcontext.getVariable("resPayload");
if (response != null && !response.isEmpty()) {
    com.fasterxml.jackson.databind.JsonNode root =
        new com.fasterxml.jackson.databind.ObjectMapper().readTree(response);
    kcontext.setVariable("validationPassed", root.path("validationPassed").asBoolean());
    kcontext.setVariable("payoutAmount", root.path("payoutAmount").asDouble());   // -> java.lang.Double
    kcontext.setVariable("policyFlags", root.get("policyFlags"));                 // -> java.lang.Object (JsonNode)
}
```
`JsonNode` accessors: `path("f")` (null-safe) / `get("f")`, `asText()`, `asBoolean()`, `asInt()`,
`asDouble()`, `isArray()`, `size()`, `.elements()`.

## 6. Numbers & collections — pitfalls
- **Number widening from JSON:** `asInt()` → int/Integer, `asDouble()` → double/Double, `asLong()` →
  long. Match the variable type (`payoutAmount` = `java.lang.Double` → use `asDouble()`).
- **Comparisons:** unbox carefully; use `.equals()` for objects (`"DEATH".equals(claimType)` — null-safe
  because the literal is the receiver).
- **Collections:** build `java.util.ArrayList`; to store a JSON array as a var, either keep the
  `JsonNode` (Object) or convert to a `List`.
- **`BigDecimal` DOES survive across separate script/condition executions — but only if it's a
  DECLARED process variable.** Each script/condition call is a separate round trip through JSON (this
  engine's variable storage, unlike a real JVM-native jBPM session's in-memory typed objects), so a
  `BigDecimal` you `kcontext.setVariable(...)` in one node arrives back as a plain JSON number by the
  time a DIFFERENT node reads it — `kcontext.getVariable(name)` closes this gap by coercing the raw
  value to the variable's DECLARED type (`BigDecimal`/`BigInteger`/`Double`/`Float`/`Long`/`Integer`)
  on every read, so `(BigDecimal) kcontext.getVariable("fee")` in a later node works reliably as long
  as `fee` is declared `BigDecimal` on the process. **An undeclared variable gets no such coercion** —
  it's returned as whatever raw JSON-shaped value it was stored as, so a scratch/undeclared variable
  holding a computed `BigDecimal` still won't survive to a later node as one. `java.util.Date` and
  custom POJOs are NOT covered by this — re-derive those from a JSON-native representation in every
  node that needs them, same as before.
  This is specific to the Node.js engine — a real jBPM/KIE server keeps declared-typed variables as
  actual Java objects for the life of the session, so this pitfall doesn't apply there.

## 7. Imports
Use **fully-qualified class names** (`com.fasterxml.jackson.databind.ObjectMapper`,
`java.util.ArrayList`) in action code, or add types to the project imports (`project.imports`, which
guided editors also use). `java.lang.*` is implicit. FQN is safest and is what this project uses.

## 8. Conditions in Java (and bare-name variable binding — applies to scripts too)

Must `return` a boolean; declared process variables are in scope by bare name:
```java
return "DEATH".equals(claimType) && amount != null && amount > 100000;
```

**This isn't condition-specific.** Every declared process variable is bound as a bare, typed local
identifier in **script tasks and onEntry/onExit actions too**, via the identical build-time mechanism
conditions use (`JavaActionBuilder`/`JavaReturnValueEvaluatorBuilder`, both built on the same
`createVariableContext`/unbound-identifier analysis — verified against jBPM's own codegen templates,
`jbpm-flow-builder/.../dialect/java/javaRule.mvel`). An earlier draft of this doc said scripts don't
get this; that was wrong.

Two nuances worth knowing:
- **Read-only.** A bare name is a local copy pulled once via `getVariable(name)` at the start of the
  generated method. *Mutating the referenced object* (`personVar.setName(...)`, `list.add(...)`) is
  visible, because it's the same object. *Reassigning the bare name itself* (`personVar = new
  Person();`) is **not** written back — only an explicit `kcontext.setVariable(...)` persists a new
  value.
- **Only unbound identifiers.** A name already locally declared, or shadowed by an import, isn't
  auto-bound — `kcontext.getVariable(name)` always still works regardless.

## 9. Errors & signaling
- Throw a BPMN error by reaching an **error end event** (see `_error-handling-reference.md`); a
  work-item handler failure raises `org.jbpm.bpmn2.handler.WorkItemHandlerRuntimeException`.
- Signal from a script: `kcontext.getKieRuntime().signalEvent("SignalName", payload);`
- Wrap risky parsing in `try/catch` and set a safe default (as in on-exit above).

## 10. Real-project checklist
1. **Cast on read, store the declared type on write** (§3/§4) — the top source of runtime bugs.
2. Build request JSON in on-entry, parse response in on-exit; keep `reqPayload`/`resPayload` as `String`.
3. Match numeric accessor to the variable type (`asDouble` for `Double`, `asInt` for `Integer`).
4. Fully-qualify classes; null-check everything from `getVariable`/`get`.
5. No blocking I/O in scripts — use a REST service task; scripts run on the engine thread.
6. Keep action code straightforward; complex logic → a business-rule task (DRL/DMN) or a work-item
   handler. Advanced Java 8 syntax (lambdas/streams) support varies by jBPM/compiler version — prefer
   simple loops in scripts.

## SDK note
The SDK (`bpmn-sdk`) stores script/condition bodies as **opaque text** with the dialect preserved
(`scriptFormat`/`conditionLanguage`), so your Java survives export/round-trip byte-for-byte. The SDK
itself does not compile or run the code.

The **Node.js jbpm-engine**, however, does: it sends this same Java text (unmodified from the source
above) to a persistent JVM sidecar process, which compiles it with the JDK's own compiler and runs it
against a real `kcontext` binding — real Java, not a JavaScript transpile. Because it's an actual JVM,
the supported surface is effectively the real Java 8 language and JDK (lambdas, streams, `java.time`,
real `BigDecimal`, etc.), minus a short, deliberate safety denylist (reflection, threading, file/
process/raw-network access — the sidecar is one process shared by every script execution) and a
handful of environment limits (no third-party libraries beyond a Jackson shim, no custom application
classes, no syntax newer than Java 8). See `jbpm-engine/docs/15-scripting-and-jbpm-export.md` for the
full architecture, exactly what's supported, and how the round trip stays lossless in both directions.

## Related
`_scripting-javascript.md` (JS dialect + type mapping) · `_scripting-reference.md` (overview) ·
`_process-variables-reference.md` (structureRef types) · `_data-mapping-reference.md` (var↔port).
