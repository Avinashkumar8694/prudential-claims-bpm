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
```java
Object v = kcontext.getVariable("caseId");            // read (returns Object — cast it)
kcontext.setVariable("status", "PENDING");            // write
long piid = kcontext.getProcessInstance().getId();
kcontext.getKieRuntime();                              // globals, signalEvent, etc.
kcontext.getKieRuntime().signalEvent("Go", null);     // broadcast a signal
```

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

## 7. Imports
Use **fully-qualified class names** (`com.fasterxml.jackson.databind.ObjectMapper`,
`java.util.ArrayList`) in action code, or add types to the project imports (`project.imports`, which
guided editors also use). `java.lang.*` is implicit. FQN is safest and is what this project uses.

## 8. Conditions in Java
Must `return` a boolean; variables are in scope by name:
```java
return "DEATH".equals(claimType) && amount != null && amount > 100000;
```

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
The SDK stores script/condition bodies as **opaque text** with the dialect preserved
(`scriptFormat`/`conditionLanguage`), so your Java survives export/round-trip byte-for-byte. It does
not compile or run the code — that happens in the KIE engine.

## Related
`_scripting-javascript.md` (JS dialect + type mapping) · `_scripting-reference.md` (overview) ·
`_process-variables-reference.md` (structureRef types) · `_data-mapping-reference.md` (var↔port).
