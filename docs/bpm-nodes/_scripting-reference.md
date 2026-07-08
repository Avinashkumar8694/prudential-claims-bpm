# Scripting in BPMN / jBPM — reference

Answers: does the BPM use JS? Where does code run in a process? Which languages? How is it written,
and how does the SDK capture it?

## Does THIS project use JavaScript?
**No.** Every script and condition in this project is **Java** (dialect `http://www.java.com/java`) —
92 script blocks + 43 gateway conditions, 0 JavaScript. The code you see (`kcontext.getVariable(...)`,
Jackson `ObjectMapper`, etc.) is Java executed inside the jBPM engine.

The **SDK** (`bpmn-sdk/`) is written in TypeScript/Node — that JS/TS is the tooling that reads/writes
the `.bpmn` files. It is unrelated to the code *inside* the process. Don't confuse the two:
- **Process code** (inside `.bpmn`): runs in the jBPM/KIE server (Java by default here).
- **SDK code** (Node): runs at build time to generate/parse `.bpmn`.

## Where code runs in a process (4 places)
| Place | Element | Purpose |
|-------|---------|---------|
| Script task | `<bpmn2:scriptTask scriptFormat=…>` `<script>` | standalone in-flow logic |
| On-entry script | `drools:onEntry-script` in a node's `extensionElements` | run just before a node executes (used on REST calls to build `reqPayload`) |
| On-exit script | `drools:onExit-script` | run just after a node (used to parse `resPayload`) |
| Sequence-flow condition | `<conditionExpression language=…>` on a gateway's outgoing flow | boolean routing decision |

All four have direct access to process variables and to `kcontext`.

## Supported languages (dialects)
jBPM supports multiple dialects for script tasks, on-entry/exit scripts, and conditions:
| Dialect | `scriptFormat` / condition `language` URI | Notes |
|---------|-------------------------------------------|-------|
| **Java** | `http://www.java.com/java` | must be valid Java; used throughout this project |
| **MVEL** | `http://www.mvel.org/2.0` | Java-superset expression language; `person.name` == `person.getName()`; convenient for business logic |
| **JavaScript** | `http://www.javascript.com/javascript` (a.k.a. dialect "JavaScript") | supported since jBPM 6.3 via JSR-223; same access to variables/globals/`kcontext`. Groovy/Python also possible via JSR-223 but not default |

> The engine picks the interpreter from `scriptFormat` (scripts) or the flow `language` (conditions).
> jBPM's default and most robust choice is **Java**; MVEL is common for terse expressions;
> JavaScript works but is less used and depends on a script engine being on the classpath.

### JavaScript dialect — can you write JS? (yes, with caveats)
You *can* select JavaScript for script tasks, on-entry/exit scripts, and conditions; you get direct
access to process variables, globals, and `kcontext`. But:
- **Server-side only** — runs in the KIE engine, not a browser. No DOM, no `npm`, no `fetch`/async.
  For HTTP use a REST service task. Objects are Java objects (call Java methods on them).
- **Runtime is JDK-dependent (the big one):** JS executes via a JSR-223 engine.
  JDK 8/11 → **Nashorn** (built in) works. **JDK 15+ removed Nashorn** (JEP 372) → JS scripts
  **fail at runtime** unless a JS engine is on the KIE-server classpath (e.g. **GraalVM JS**, which
  registers under the name `JavaScript`/`js`, or standalone `nashorn-core`). The modeler letting you
  *select* JS does not guarantee it will *execute*.
- **Secondary dialect** — Java/MVEL are always-available and better-performing. Prefer Java (this
  project is 100% Java) unless you have a specific reason.
- **SDK**: preserves the JS dialect (`scriptFormat="http://www.javascript.com/javascript"`) on
  round-trip; it stores the body as opaque text and does not execute it.

## The `kcontext` object (available in every script/condition)
`kcontext` is a `org.kie.api.runtime.process.ProcessContext`. Common uses:
```java
kcontext.getVariable("caseId");                 // read a process variable
kcontext.setVariable("status", "PENDING_REQ");  // write a process variable
kcontext.getProcessInstance().getId();          // the piid
kcontext.getKieRuntime();                        // engine handle (globals, signals)
```
In conditions and MVEL/JS the variables are also accessible directly by name (e.g. `claimType`).

## Examples (from this project — all Java)
Script task (bootstrap):
```java
String url = System.getProperty("INTEGRATION_LAYER_URL");
if (url == null || url.isEmpty()) url = "http://localhost:3000";
kcontext.setVariable("baseUrl", url);
```
On-entry (build request JSON for a REST call):
```java
com.fasterxml.jackson.databind.node.ObjectNode json =
    new com.fasterxml.jackson.databind.ObjectMapper().createObjectNode();
json.putPOJO("caseId", kcontext.getVariable("caseId"));
kcontext.setVariable("reqPayload", json.toString());
```
On-exit (parse response):
```java
com.fasterxml.jackson.databind.JsonNode root =
    new com.fasterxml.jackson.databind.ObjectMapper().readTree((String) kcontext.getVariable("resPayload"));
kcontext.setVariable("anyContestable", root.path("policyFlags").path("isContestable").asBoolean());
```
Gateway condition (Java, returns boolean):
```java
return "DEATH".equals(claimType);
```
Same condition in **MVEL**: `claimType == "DEATH"` · in **JavaScript**: `claimType == "DEATH"`.

## Escaping (critical for a generator)
Script bodies are wrapped in `<![CDATA[ … ]]>`, so `&&`, `<`, `>` are literal inside. **Outside**
CDATA they must be escaped (`&amp;&amp;`, `&lt;`, `&gt;`). Always emit script/condition bodies in CDATA.

## How the SDK captures scripts
- `scriptTask` → `{ script: "<code>", scriptFormat: "<dialect URI>" }` — **dialect preserved**
  (Java/MVEL/JavaScript round-trip intact).
- REST call activity → `{ onEntry, onExit }` (Java by default in this project).
- sequence flow → `{ condition, conditionLanguage }` — condition dialect preserved.
Script contents are treated as **opaque text**: the SDK preserves them exactly but does not parse or
execute them (they run only in the jBPM engine). See `../../bpmn-sdk/`.

## When to use which place
- Prefer **on-entry/on-exit** for shaping a service call's request/response (keeps the REST node self-contained).
- Use a **script task** for standalone transformations/aggregations between nodes.
- Use **conditions** only on diverging-gateway outgoing flows.
- Never do blocking I/O (HTTP, DB) in a script — use a REST service task; scripts run on the engine thread.

## Deep dives (per language, with full type mapping)
- `_scripting-java.md` — Java dialect: `kcontext`, casting on read / storing the declared type on
  write for **every** `structureRef`, Jackson JSON build/parse, imports, conditions, errors, checklist.
- `_scripting-javascript.md` — JavaScript dialect: runtime/JDK requirements, and how to convert JS
  values to Java types for **every** `structureRef` (number→Integer, array→List, object→Map/POJO, …).

## Sources
- jBPM Processes (ch.7) — https://docs.jbpm.org/7.0.0.Beta1/jbpm-docs/html/ch07.html
- JavaScript as process dialect — http://kverlaen.blogspot.com/2015/09/new-feature-javascript-as-process.html
- Red Hat JBoss BPM Suite — Process Designer — https://access.redhat.com/documentation/en-us/red_hat_jboss_bpm_suite/6.4/html/user_guide/chap_process_designer
