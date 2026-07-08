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
JS runs server-side through a JSR-223 engine:
- **JDK 8 / 11** → Nashorn (built in) → works out of the box.
- **JDK 15+** → Nashorn **removed** (JEP 372). JS scripts **fail at runtime** unless a JS engine is on
  the KIE-server classpath — **GraalVM JS** (registers as `JavaScript` / `js` / `graal.js`) or
  standalone `nashorn-core`.
- **GraalVM JS is "secure by default"** — Java host access must be enabled for `kcontext`/Java interop
  (via the ScriptEngine's `polyglot.js.allowHostAccess` / `allowAllAccess`, configured on the server).

Verify on your target JDK before using JS. Java/MVEL have none of these constraints.

## 3. `kcontext` from JavaScript
```js
var caseId = kcontext.getVariable("caseId");         // read a process variable
kcontext.setVariable("status", "PENDING");           // write a process variable
var piid = kcontext.getProcessInstance().getId();
```
Process variables are also visible **directly by name** in conditions and scripts (e.g. `claimType`).

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
