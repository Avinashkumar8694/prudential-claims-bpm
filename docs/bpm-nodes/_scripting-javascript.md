# JavaScript in jBPM — complete reference (scripts, conditions, type mapping)

Everything needed to write **JavaScript** in a jBPM process for a real project: where it runs, the
runtime you need, how process-variable types map in/out of JS (the part that bites people), and
production checklist. Dialect URI: `http://www.javascript.com/javascript`.

> The SDK preserves JS bodies + dialect verbatim (`scriptFormat="…/javascript"`); it does not run
> them. Execution is a KIE-server concern — read "Runtime" below before committing to JS.

## 1. Where JS can be used
| Place | Element | Returns |
|-------|---------|---------|
| Script task | `<scriptTask scriptFormat="…/javascript">` | nothing (side effects via `kcontext`) |
| On-entry / on-exit | `drools:onEntry-script` / `onExit-script` (dialect JS) | nothing |
| Gateway condition | outgoing `conditionExpression language="…/javascript"` | boolean |

All have direct access to **process variables by name**, to **globals**, and to **`kcontext`**
(`org.kie.api.runtime.process.ProcessContext`).

## 2. Runtime (READ THIS FIRST)
JS runs server-side through a JSR-223 engine — jBPM ships **no** engine of its own.
`org.jbpm.process.instance.impl.JavaScriptAction` (script tasks / onEntry / onExit) and
`JavaScriptReturnValueEvaluator` (gateway conditions) both do exactly:
```java
ScriptEngineManager factory = new ScriptEngineManager();
ScriptEngine engine = factory.getEngineByName("JavaScript");
engine.put("kcontext", context);   // no null-check on `engine` first
```
- **JDK 8 / 11** → Nashorn (built in) → works out of the box.
- **JDK 15+** → Nashorn **removed** (JEP 372) → `getEngineByName("JavaScript")` returns `null`, and
  the very next line throws a bare, unhelpful `NullPointerException` — **not** a clean "no JS engine
  found" error. Fix by putting a JS engine on the KIE-server classpath — **GraalVM JS** (registers as
  `JavaScript` / `js` / `graal.js`) or standalone `nashorn-core`.
- A **fresh `ScriptEngineManager` is constructed on every single execution** (not cached/reused) —
  a real per-call cost, independent of which engine ends up handling it.
- **GraalVM JS is "secure by default"** — Java host access must be enabled for `kcontext`/Java interop
  (via the ScriptEngine's `polyglot.js.allowHostAccess` / `allowAllAccess`, configured on the server).
- **JavaScript cannot be used for data-assignment expressions** (dataInputAssociation/
  dataOutputAssociation `from`/`to` mappings) — `JavaScriptProcessDialect.getAssignmentBuilder()`/
  `.getProcessClassBuilder()` throw `UnsupportedOperationException`. It's valid only for actions
  (scripts) and constraints (conditions), never for a data mapping expression.
- No generic JSR-223 dialect registry exists — jBPM's `ProcessDialectRegistry` hardcodes exactly
  four dialects (java, mvel, JavaScript, FEEL). Groovy/Python/Ruby are **not** available without
  implementing and registering a custom `ProcessDialect` yourself.

Verify on your target JDK before using JS. Java/MVEL have none of these constraints.

## 3. `kcontext` from JavaScript
```js
var caseId = kcontext.getVariable("caseId");         // read a process variable
kcontext.setVariable("status", "PENDING");           // write a process variable
var piid = kcontext.getProcessInstance().getId();
```
Process variables are also visible **directly by name** in conditions and scripts (e.g. `claimType`).

### 3.1 `instance`/`node`: the Node.js-engine-only alternative to `kcontext` chains

`kcontext` above is real jBPM API — needed if this script runs (or might one day run) inside an actual
jBPM/KIE server, via import or export. If a script is being authored fresh for the Node.js engine only,
two plain objects cover the same ground with no `kcontext` at all — this engine's own invention, not
jBPM API:

```js
vars.status = "seen:" + vars.claimType;      // vars: process variables (see docs/bpm-nodes, "vars object")
kcontext.setVariable("pid", instance.processId);
```

| `instance.*` | Equivalent `kcontext` call |
|---|---|
| `instance.id` | `kcontext.getProcessInstance().getId()` |
| `instance.processId` / `.processName` | `.getProcessId()` / `.getProcessName()` |
| `instance.correlationKey` | `.getCorrelationKey()` |
| `instance.parentId` | `.getParentProcessInstanceId()` |
| `instance.state` | `.getState()` — but as THIS engine's own status string (`"running"`/`"waiting"`/`"completed"`/`"aborted"`/`"suspended"`), not jBPM's `STATE_*` int |
| `instance.variables` | `.getVariables()` |
| `instance.activeNodes` | `.getNodeInstances()` — plain array of `{id, nodeId, name}` |
| `instance.signal(type, payload)` | `kcontext.getKieRuntime().signalEvent(type, payload, kcontext.getProcessInstance().getId())` (self) |
| `instance.signalOther(id, type, payload)` | `kcontext.getKieRuntime().signalEvent(type, payload, id)` (targeted) |
| `instance.broadcast(type, payload)` | `kcontext.getKieRuntime().signalEvent(type, payload)` (untargeted) |
| `instance.abort()` / `.abortOther(id)` | `kcontext.getKieRuntime().abortProcessInstance(...)` (self / targeted) |
| `node.id` / `.nodeId` / `.name` | `kcontext.getNodeInstance().getId()` / `.getNodeId()` / `.getNodeName()` |

Mix freely with `kcontext` in the same script — both read/write the identical underlying data and
queue into the identical pending-action list, so e.g. `instance.signal(...)` and `kcontext.
getKieRuntime().signalEvent(...)` behave identically. Exporting a script that uses `instance`/`node`
still produces plain, real-jBPM-runnable JS: bpmn-sdk prepends a small ES5 preamble (only when the name
is actually referenced) that computes the same object from real `kcontext` — verified this session
against a real Nashorn engine, not just this engine's own tests. See `jbpm-engine/docs/
15-scripting-and-jbpm-export.md`'s "Two ways to write this" section for the full reference and the
`instance.state` caveat (it's always `"running"` for an active instance on the exported/reverse path,
since jBPM's own `ACTIVE` state doesn't distinguish "running" from "blocked at a node" either).

## 4. Type mapping — reading process variables INTO JavaScript
A process variable's `structureRef` is a **Java type**; in JS you receive the **Java object** (not a
native JS value). Operators auto-coerce for primitives; objects expose Java methods.

| Variable `structureRef` | What you get in JS | How to use it |
|-------------------------|--------------------|---------------|
| `String` | Java String | use as JS string; `s.length`, `+` concat, `==` compare |
| `Integer` / `java.lang.Integer` | Java Integer | arithmetic works; `n > 5` ok |
| `java.lang.Long` | Java Long | arithmetic; beware precision past 2^53 |
| `java.lang.Double` / `Float` | Java Double/Float | arithmetic ok |
| `java.lang.Boolean` | Java Boolean | `if (flag)` ok |
| `java.util.List` | Java List | `list.size()`, `list.get(i)` — **NOT** a JS array (no `.map/.forEach` unless converted) |
| `java.util.Map` | Java Map | `map.get("k")`, `map.put("k",v)` |
| `java.lang.Object` (parsed JSON) | Jackson `JsonNode` or POJO | `node.get("f").asText()` / `pojo.getX()` |
| `java.util.Date` | Java Date | `d.getTime()` |
| custom POJO (FQN) | the POJO | `claim.getAmount()` (or `claim.amount` bean access in Nashorn) |

Iterate a Java List in JS:
```js
var items = kcontext.getVariable("applicablePolicies");   // java.util.List
for (var i = 0; i < items.size(); i++) { print(items.get(i)); }
```

## 5. Type mapping — writing values FROM JavaScript (the pitfalls)
`setVariable` stores whatever you pass. If it doesn't match the declared `structureRef`, downstream
Java code / rules / REST mapping breaks. **JS native values are not Java types** — convert explicitly.

| Target `structureRef` | WRONG (native JS) | RIGHT (convert to Java) |
|-----------------------|-------------------|-------------------------|
| `String` | `"ok"` ✅ (fine) | `"ok"` |
| `Integer` | `5` (JS number = double!) | `java.lang.Integer.valueOf(5)` or `Math.round(x)` |
| `java.lang.Long` | `5` | `java.lang.Long.valueOf(5)` |
| `java.lang.Double` | `5.0` ✅ (fine) | `5.0` |
| `java.lang.Boolean` | `true` ✅ | `true` |
| `java.util.List` | `[1,2,3]` (JS array ≠ List) | `var l=new java.util.ArrayList(); l.add(1); l.add(2);` |
| `java.util.Map` / `java.lang.Object` | `{a:1}` (JS object ≠ Map) | `var m=new java.util.HashMap(); m.put("a",1);` |
| `java.util.Date` | `new Date()` (JS Date ≠ java.util.Date) | `new java.util.Date()` |
| custom POJO | `{amount:1}` | `var c=new com.acme.Claim(); c.setAmount(1);` |

Access Java classes:
```js
// Nashorn: direct
var list = new java.util.ArrayList();
// GraalVM (and Nashorn): explicit type handle
var ArrayList = Java.type("java.util.ArrayList");
var list2 = new ArrayList();
```

## 6. JSON in JavaScript
JS has native `JSON`. The REST wrapper stores request/response as **String** process variables, so:
```js
// build a request string (String var -> fine for ContentData)
kcontext.setVariable("reqPayload", JSON.stringify({ caseId: kcontext.getVariable("caseId") }));
// parse a response string
var res = JSON.parse(kcontext.getVariable("resPayload"));   // resPayload is a Java String
kcontext.setVariable("eligible", !!res.eligible);
```
(If a variable is typed `java.lang.Object` and other **Java** code reads it as a Jackson `JsonNode`,
prefer building it in Java — mixing a JS object into a Java-typed var is the #1 source of
`ClassCastException`.)

## 7. Conditions in JavaScript
Return/emit a boolean; variables are in scope by name:
```js
claimType == "DEATH" && amount != null && amount > 100000
```

## 8. Real-project checklist
1. Confirm the KIE server JDK: **≤ 11** (Nashorn) or **15+ with GraalVM JS** on the classpath.
2. On GraalVM, enable Java host access for `kcontext`/interop.
3. For every `setVariable`, **match the variable's `structureRef`** — convert JS numbers/arrays/objects
   to Java `Integer`/`ArrayList`/`HashMap`/POJO as in §5.
4. Keep numbers explicit: JS math is `double`; round/convert before storing to `Integer`/`Long`.
5. Never do blocking I/O (HTTP/DB) in JS — use a REST service task.
6. Unit-test the process on the **target runtime** (dialect availability differs by JDK).
7. Prefer Java/MVEL for anything critical or portable; reserve JS for teams that specifically want it.

## 9. Gotchas
- **Nashorn removed on JDK 15+** — the most common production failure.
- **JS array ≠ `java.util.List`**, **JS object ≠ Map/POJO**, **JS number = double** — convert.
- GraalVM secure-by-default blocks host access until enabled.
- No modules/npm; standard library only + Java interop.

## Related
`_scripting-java.md` (the Java dialect + type mapping) · `_scripting-reference.md` (overview) ·
`_process-variables-reference.md` (structureRef types) · `_data-mapping-reference.md`.
