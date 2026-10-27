# 15 — Scripting: JavaScript and Java, both directions, and how they map to exported jBPM

Script tasks and flow conditions can be authored in **JavaScript** (native V8, always executes) or
**Java** (jBPM's own default dialect — compiled and executed by a **real JVM**, not transpiled to
JavaScript). This is symmetric: a real jBPM project's Java scripts convert to engine JSON and run
here **unmodified**, and an engine-JSON process (Java or JS) exports back to jBPM XML with script
bodies preserved byte-for-byte in either direction. See `jbpm-engine/java-runtime/` for the JVM
sidecar, `src/engine/java-sidecar.ts` for the Node-side client/process manager, `src/engine/
java-compat.ts` for the fast safety pre-check, and `src/modules/validation/rules.ts` (rule
`java-support`) for the publish-time gate described below.

## Why a real JVM, not a transpiler

An earlier version of this engine ran Java by rewriting it to JavaScript with a regex-based
transpiler plus a hand-built runtime shim. That approach is gone. It worked for the common cases but
was fundamentally a *second, incomplete implementation* of the Java language and the JDK — every gap
(lambdas, streams, `java.time`, real `BigDecimal`/int-truncation semantics, arbitrary JDK classes)
was a permanent, growing maintenance burden, and "supported" always meant "supported by this specific
hand-rolled subset," not "supported by Java." Running actual Java in an actual JVM instead means the
supported surface is **the real language and the real JDK**, not a subset someone remembered to shim.

## Architecture: a persistent JVM sidecar, not a kjar/Maven build

`jbpm-engine/java-runtime/` is a small, dependency-free Java project (JDK's own tools only — no
Maven, no external jars) with two parts:

- **A source-compatible Jackson shim** (`com.fasterxml.jackson.databind.*` / `.node.*` / `.core.type.
  TypeReference`) — real Jackson isn't fetchable here (no Maven), so this hand-written package
  matches its actual class/method names and behavior (including returning the real polymorphic
  `ObjectNode`/`ArrayNode` subtypes from `JsonNode.get()`/`.path()`, and implementing
  `Iterable<JsonNode>` so `for (JsonNode x : arrayNode)` works) closely enough that unmodified real
  scripts compile against it.
- **`bpmscript.*`** — `KContext` (the real `kcontext` binding: `getVariable`/`setVariable`/
  `getProcessInstance().getId()`/`getNodeInstance().getNodeId()/.getNodeName()`/`getKieRuntime().
  getEnvironment().get(k)`/`.signalEvent(name, payload)`), `ScriptRunner` (compiles a script snippet
  in memory via `javax.tools.ToolProvider.getSystemJavaCompiler()` — no `javac` subprocess, no disk
  writes — caches the compiled class by a hash of the exact script text, and only ever compiles the
  one snippet actually being run, never the whole project), and `Server` (a minimal HTTP server on
  the JDK's built-in `com.sun.net.httpserver.HttpServer`, no framework).

The Node.js server spawns this as **one persistent child process** (`java -cp <java-runtime>/out
bpmscript.Server 0` — port 0 so the OS picks a free ephemeral port; the sidecar prints
`BPMSCRIPT_LISTENING <port>` once ready, see `java-sidecar.ts`), lazily on first use, and reuses it
for the life of the server. If it dies mid-session, the next call respawns it. This is deliberately
**not** the traditional kjar/`kie-maven-plugin` model — nothing is precompiled into a jar ahead of
time; a script is compiled once, the first time it's actually executed (or validated — see below),
and the compiled class is reused after that. The Node engine remains the orchestrator: it owns
process lifecycle, deployment, instances, and every non-Java node type; the JVM only ever runs the
Java text a script/condition/exitScript node actually carries.

Process variables cross the Node↔JVM boundary as plain JSON (the wire format for every `/execute`
request/response) — the same constraint this engine already has everywhere else (instances persist
as JSON between steps), not something new introduced by the sidecar. A script may build and use real
`JsonNode`/POJO objects freely within its own execution; anything meant to survive to a *later*
node must be stored via `kcontext.setVariable` as a plain value, exactly the pattern real jBPM Java
scripts already use (build a request as a `String`, parse a response `String` into a fresh
`JsonNode`, store only the extracted primitive results) — this project's own scripts follow that
convention throughout, so nothing about it is new for a converted process.

## What actually runs where

| Place | How | Notes |
|---|---|---|
| Script task (`lang:'java'`) | `POST /execute` — compiles (if not cached) + runs, statements only, no return value | matches real jBPM's script task exactly |
| onEntry/onExit, ANY activity node (`node.onEntry`/`.onExit` + `.onEntryLang`/`.onExitLang`) | same `/execute` path, executed by `execution-engine.ts`'s `runLifecycle()` — onEntry right before the node's own handler runs; onExit exactly once, when the node instance actually completes (immediately for a synchronously-completing node, or on `resumeToken()` for one that waited, e.g. a userTask) | real jBPM's generic `drools:onEntry-script`/`drools:onExit-script` action hooks, attachable to any activity — NOT just the http/REST wrapper's own `exitScript` (a separate, older mechanism, kept for its auto-generated request/response body). Never fires on an error/abort path. |
| REST call activity's own `exitScript` (`n.exitScript`, `lang:'java'`) | same `/execute` path | the entry-side "build the request" logic is a declarative `body` mapping done in plain TypeScript (no script execution needed for that half); only a trailing custom `exitScript`, if present, runs in the JVM. Distinct from the generic onEntry/onExit above — this is the REST node's own pre-existing, narrower mechanism. |
| Gateway / sequence-flow condition (`lang:'java'`) | `POST /execute` with `mode:'condition'` — compiled as `boolean run(KContext)` instead of `void run(KContext)`; a bare boolean expression (no `return`) is auto-wrapped exactly like the JS condition path does | real jBPM Java conditions are just as often a bare expression as an explicit `return` — see below for variable binding |
| Publish-time validation | `POST /execute` with `mode:'validate'` — compiles (and caches) without executing | real compiler diagnostics, not a heuristic — see below |

### Conditions AND scripts/onEntry/onExit all bind every declared variable by bare name

Real jBPM's Java dialect exposes every **declared** process variable as a bare, typed local
identifier — confirmed directly against this project's own real conditions, e.g.
`pru-api-error-handler.bpmn`'s `return retryCount < maxRetryCount;` and `pru-nigo-followup.bpmn`'s
`return "DEATH".equals(claimType);`, neither of which ever calls `kcontext.getVariable(...)`. This is
**not** condition-specific — real jBPM's `JavaActionBuilder` binds the identical way for scripts and
onEntry/onExit too (an earlier draft of this doc claimed otherwise; that was wrong — see
`docs/bpm-nodes/_scripting-java.md` §8 for the correction and its source citation).

The sidecar replicates this uniformly: `gateway/handler.ts`/`script/handler.ts`/`execution-engine.ts`'s
`runLifecycle()` all build the same `varTypes` map (name → declared
`structureRef`, from `EngineProcess.vars`) and passes it to `executeJavaCondition`/`validateJava`,
which prepend a typed local declaration for each bindable name (a valid Java identifier, not a
keyword) ahead of the condition body — `Integer retryCount = (Integer) kcontext.getVariable
("retryCount");` and so on, always a boxed/reference type so a null value still compiles cleanly. An
undeclared type, or a custom project-specific POJO FQN (never resolvable on this classpath), falls
back to `Object` rather than failing to compile the whole condition. `kcontext.getVariable(...)`
still always works too — the binding is additive, not a replacement. Because the compiled class
depends on this variable-type shape as well as the condition text, the sidecar's compile cache keys
on both together.

**A confirmed, now-fixed bug in this binding**: it used to bind EVERY declared process variable
unconditionally, regardless of whether the condition/script text actually referenced it as a bare
word. Since a variable's value can arrive with a runtime type that doesn't exactly match its declared
`structureRef` — e.g. a variable declared `double` whose value is a whole number, which this engine's
own JSON parser stores as `Integer`, not `Double` (see `JsonIO.Parser.parseNumber`'s preference order)
— the auto-generated `(Double) kcontext.getVariable("amount")` cast could throw `ClassCastException`
at runtime, **even in a condition/script that never mentions `amount` as a bare identifier at all**
(only as the string argument to `kcontext.getVariable("amount")`). For a condition this was silently
swallowed to `false` by `evalCondition`'s catch-all; for a script it surfaced as an opaque
`SCRIPT_ERROR` — both totally independent of whether that code actually used the variable. Fixed by
gating the binding on real usage: `withVarBindings` now blanks string/char literals and comments
before scanning for the bare word (mirroring `java-compat.ts`'s denylist scanner), so a name appearing
only inside a string literal no longer counts as "referenced". bpmn-sdk's export-time twin
(`javaBareNamePreamble`) already gated on usage this way — this was strictly an execution-side gap.

**A related, deeper limitation — now also fixed**: any Java type that isn't JSON-native (`BigDecimal`,
`java.util.Date`, a custom POJO) doesn't survive a round trip through this engine's variable storage
across SEPARATE `/execute` calls purely from *storage* — each call serializes the full variable set to
JSON and back, so a `BigDecimal` a script computed and stored via `kcontext.setVariable(...)` would
come back as a plain number the next time a DIFFERENT script/condition reads it. Confirmed and
reproduced this session. Fixed for **declared** numeric types (`BigDecimal`, `BigInteger`, `Double`,
`Float`, `Long`, `Integer`) by having `kcontext.getVariable(name)` itself coerce the raw JSON-shaped
value to the variable's DECLARED type on every read (`KContext.coerce`, using the same `varTypes` map
bare-name binding already relies on — now also carrying `BigDecimal`/`BigInteger` entries in
`STRUCTURE_REF_TO_JAVA`, which previously fell back to `Object`). This makes `(BigDecimal)
kcontext.getVariable("fee")` reliable across separate nodes as long as `fee` is a **declared** process
variable — matching what real jBPM's own `kcontext` effectively guarantees (a declared variable is
always its declared type there, since real jBPM keeps it as a live typed Java object for the session).
An **undeclared** variable (not in the process's own variable list) has no declared type to coerce to,
so it's still returned as whatever raw JSON-shaped value it was stored as — the same as before, and
the same limitation real jBPM doesn't have either (every variable there is declared, by construction —
there's no such thing as an undeclared process variable in real jBPM, so this isn't a new gap relative
to it). `java.util.Date` and custom POJOs are NOT covered by this fix (only the numeric types above) —
still re-derive those from a JSON-native representation in every node that needs them.

## Supported — in practice, "real Java 8"

Because this is an actual JVM compiling actual Java source, the supported surface is **the Java
language itself plus the full JDK class library** (subject to the installed JDK's own version — this
environment runs JDK 8, so syntax newer than that doesn't parse; see below), not a hand-picked list:

- **Language**: lambdas, method references, the Stream API, try-with-resources, anonymous inner
  classes, varargs, multi-catch, local classes, annotations — all real, all just work.
- **Numbers**: real `int`/`long`/`double` semantics (int division genuinely truncates — no shim
  divergence), real `java.math.BigDecimal`/`BigInteger`, real boxed-type statics.
- **Date/time**: `java.time.*`, `Calendar`, `SimpleDateFormat`, `DateTimeFormatter` — all real JDK
  classes, fully functional (this used to be an unsupported category under the transpiler; it no
  longer is).
- **Collections**: any `java.util.*` collection, not just the handful the old shim covered.
- **`kcontext`**: process/node introspection and control (`getProcessInstance()`, `getNodeInstance()`,
  `getKieRuntime()`) — see the dedicated section below for the full method reference, usage examples,
  and wire format.
- **JSON**: the source-compatible Jackson shim's `ObjectMapper`/`JsonNode`/`ObjectNode`/`ArrayNode`/
  `TypeReference` — `createObjectNode/createArrayNode/readTree/convertValue/readValue/
  writeValueAsString`, `get/path/has/asText/asBoolean/asInt/asLong/asDouble/isNull/isMissingNode/
  isArray/isObject/isTextual/isNumber/isBoolean/size/fieldNames/elements/put/putPOJO/set/remove/
  toString`, with `get()`/`path()` returning the real `ObjectNode`/`ArrayNode` subtype (so
  `(ArrayNode) node.get("items")` and `for (JsonNode x : items)` both work exactly like real Jackson).
- **`System.out.println`, `System.getenv`, `System.getProperty`** — real `java.lang.System`, no shim
  needed; a script's `System.out` output is captured per-request and returned as that execution's
  logs (see the concurrency note below).

## `kcontext`: process/node introspection and control — full reference

Source-verified this session against real jBPM/Drools (`kie-api`'s `ProcessContext`/`ProcessInstance`/
`NodeInstance`/`ProcessRuntime`, and `WorkflowProcessInstanceImpl`/`NodeInstanceImpl`). Same method
shapes in **both dialects** (Java below; JS mirrors it exactly — see `docs/bpm-nodes/
_scripting-javascript.md`), built from the same data (`sandbox.ts`'s `buildKcontext` / `java-runtime/
src/bpmscript/KContext.java`), threaded from `HandlerCtx` via `src/engine/nodes/kcontext-info.ts`.

### Two ways to write this: real jBPM `kcontext`, or this engine's own `instance`/`node`

Everything below (`kcontext.getProcessInstance()`/`.getNodeInstance()`/`.getKieRuntime()`) is **real
jBPM API** — the exact same thing a script would call inside an actual jBPM/KIE server. Writing scripts
against it means those scripts are *already* real jBPM Java/JS, no conversion needed either direction —
this is what makes importing a real jBPM project just work, unmodified.

But nothing about this engine *requires* thinking in those terms, even for process/node introspection.
Exactly like `vars.caseId` is this engine's own simpler alternative to `kcontext.getVariable("caseId")`
(see "Supported" above), there's a second, Node-idiomatic surface for everything on this page:

| Instead of... | write... |
|---|---|
| `kcontext.getProcessInstance().getId()` | **JS:** `instance.id` &nbsp; **Java:** `instanceId` |
| `kcontext.getProcessInstance().getProcessId()` | **JS:** `instance.processId` &nbsp; **Java:** `processId` |
| `kcontext.getProcessInstance().getProcessName()` | **JS:** `instance.processName` &nbsp; **Java:** `processName` |
| `kcontext.getProcessInstance().getCorrelationKey()` | **JS:** `instance.correlationKey` &nbsp; **Java:** `correlationKey` |
| `kcontext.getProcessInstance().getParentProcessInstanceId()` | **JS:** `instance.parentId` &nbsp; **Java:** `parentInstanceId` |
| `kcontext.getProcessInstance().getState()` (jBPM's `STATE_*` int) | **JS only:** `instance.state` — this engine's OWN status string (`"running"`/`"waiting"`/`"completed"`/`"aborted"`/`"suspended"`), not the jBPM int |
| `kcontext.getProcessInstance().getVariables()` | **JS only:** `instance.variables` |
| `kcontext.getProcessInstance().getNodeInstances()` | **JS only:** `instance.activeNodes` — plain array of `{id, nodeId, name}` |
| `kcontext.getNodeInstance().getId()` | **JS:** `node.id` &nbsp; **Java:** no meta-local (rare enough in practice that it wasn't worth adding — use `kcontext.getNodeInstance().getId()`) |
| `kcontext.getNodeInstance().getNodeId()` | **JS:** `node.nodeId` &nbsp; **Java:** `currentNodeId` |
| `kcontext.getNodeInstance().getNodeName()` | **JS:** `node.name` &nbsp; **Java:** `currentNodeName` |
| `kcontext.getKieRuntime().signalEvent(type, payload, selfId)` (self) | **JS only:** `instance.signal(type, payload)` |
| `kcontext.getKieRuntime().signalEvent(type, payload, otherId)` (targeted) | **JS only:** `instance.signalOther(otherId, type, payload)` |
| `kcontext.getKieRuntime().signalEvent(type, payload)` (broadcast) | **JS only:** `instance.broadcast(type, payload)` |
| `kcontext.getKieRuntime().abortProcessInstance(selfId)` (self) | **JS only:** `instance.abort()` |
| `kcontext.getKieRuntime().abortProcessInstance(otherId)` (targeted) | **JS only:** `instance.abortOther(otherId)` |

**`instance`/`node` are NOT jBPM concepts — this engine invented them.** They exist purely so a script
author who doesn't want to think in jBPM terms doesn't have to, even for this. Mix freely with
`kcontext` in the same script (they're backed by the exact same underlying data and the exact same
pending-action queue — `instance.signal(...)` and `kcontext.getKieRuntime().signalEvent(...)` resolve
identically). Why the Java column stops short of matching JS's full `instance` object: Java has no
object-literal syntax, so the Java "simple way" is a handful of flat, read-only `String` locals
(see `ScriptRunner.java`'s `META_LOCALS`) rather than one object with methods — control actions
(signal/abort) have no Java meta-local equivalent, since real jBPM's own `kcontext.getKieRuntime()`
call is already about as simple as it gets in a statically-typed language, and a Java author targeting
jBPM export is already expected to be comfortable with that idiom.

**Exporting a script that uses `instance`/`node`/a meta-local still produces plain, real-jBPM-runnable
text** — same strategy as `vars`: bpmn-sdk prepends a small preamble (only when the name is actually
referenced) that computes the identical value from real `kcontext`, so the exported script has zero
runtime dependency on this engine (see `bpmn-sdk/src/engine.ts`'s `jsInstanceNodePreamble`/
`javaMetaLocalsPreamble` — independently verified this session against a real Nashorn engine and a
real `javac` compile, not just this engine's own tests). One caveat specific to `instance.state`: since
it's derived from jBPM's own `STATE_*` int on the reverse/export path, and jBPM's `ACTIVE` state
doesn't distinguish "running" from "blocked waiting at a node", an exported condition/script always
reads `instance.state` back as `"running"` for an active instance — check `instance.activeNodes.length`
if you need to know whether it's actually blocked on something.

### `kcontext.getProcessInstance()`

| Method | Returns | Example |
|---|---|---|
| `getId()` | `String` | `String piid = kcontext.getProcessInstance().getId();` |
| `getProcessId()` | `String` | the process *definition* id, e.g. `"claims.process"` |
| `getProcessName()` | `String` | the process definition's display name |
| `getState()` | `int` | `ProcessInstance.STATE_ACTIVE` (1) while running/waiting, `STATE_COMPLETED` (2), `STATE_ABORTED` (3), `STATE_SUSPENDED` (4) |
| `getParentProcessInstanceId()` | `String` or `null` | `null` for a root (non-call-activity) instance |
| `getCorrelationKey()` | `String` or `null` | whatever correlation key the instance was started with |
| `getVariables()` | `Map<String,Object>` | the live variables map — mutating it has the same effect as `setVariable` per key |
| `getNodeInstances()` | `List<NodeInstance>` | every **currently-active** node instance, a snapshot at call time (not a live view — matches real jBPM's own Collection-snapshot semantics for this method) |
| `signalEvent(type, event)` | — | **self-scoped**: delivered to this instance only (real jBPM: `ProcessInstance implements EventListener`) |

```java
// on-entry / script — tag every audit log line with process + instance identity
System.out.println("[" + kcontext.getProcessInstance().getProcessId() + "] "
  + kcontext.getProcessInstance().getId() + ": starting validation");

// react to how many parallel branches are still in flight
int active = kcontext.getProcessInstance().getNodeInstances().size();
if (active > 3) { kcontext.setVariable("highConcurrency", true); }
```

### `kcontext.getNodeInstance()`

| Method | Returns | Notes |
|---|---|---|
| `getId()` | `String` | the node **instance** id (a generated id — this session's own tests catch a real bug where an earlier pass conflated this with `getNodeId()`) |
| `getNodeId()` | `String` | the node **definition** id, as declared in the process (`n.id` in engine JSON) |
| `getNodeName()` | `String` | the node's display name |

```java
System.out.println("entering node " + kcontext.getNodeInstance().getNodeName()
  + " (definition " + kcontext.getNodeInstance().getNodeId()
  + ", instance " + kcontext.getNodeInstance().getId() + ")");
```

### `kcontext.getKieRuntime()`

| Method | Behavior |
|---|---|
| `getEnvironment().get(key)` | a deployment environment entry, e.g. `INTEGRATION_LAYER_URL` |
| `signalEvent(type, event)` | **session-wide broadcast** — delivered to whichever *other* instances are currently waiting on that signal type |
| `signalEvent(type, event, processInstanceId)` | **targeted** — delivered to exactly that one instance, no-op if the id doesn't resolve (not an error — a script/condition kcontext call has no result to fail loudly against) |
| `abortProcessInstance(processInstanceId)` | aborts that instance (self or any other id) — reuses the exact same abort path the REST API's operator-triggered abort uses (cancels timers, aborts the whole subtree) |

```java
// self-targeted signal — the idiomatic way to signal "myself", matching real jBPM's own documented
// convention (kcontext.getKieRuntime().signalEvent(type, data, kcontext.getProcessInstance().getId()))
kcontext.getKieRuntime().signalEvent("ClaimUpdated", claimId, kcontext.getProcessInstance().getId());

// signal the PARENT process instance (a common real pattern — reporting a child's outcome upward)
String parentId = kcontext.getProcessInstance().getParentProcessInstanceId();
if (parentId != null) kcontext.getKieRuntime().signalEvent("ChildDone", result, parentId);

// abort THIS instance from a script (e.g. a validation script that decides the case can't proceed)
if (!valid) kcontext.getKieRuntime().abortProcessInstance(kcontext.getProcessInstance().getId());
```

### Wire format (the JVM sidecar's `/execute` request/response — see `java-sidecar.ts`)

The Node side sends everything a script/condition might need in one request; the sidecar sends back
variable writes plus any queued signal/abort **actions** for the Node side to actually carry out (the
sidecar has no store access of its own — see the concurrency note above for why actions are queued,
not executed synchronously, mid-script).

```jsonc
// POST /execute request
{
  "code": "...",                    // the exact script/condition text, unmodified
  "vars": { "caseId": "C-1" },      // current process variables
  "env": { "INTEGRATION_LAYER_URL": "http://..." },
  "instanceId": "abc123", "nodeInstanceId": "tok456", "nodeId": "n1", "nodeName": "Validate",
  "processId": "claims.process", "processName": "Claims", "correlationKey": "CORR-1",
  "parentInstanceId": null, "state": "running",
  "activeNodeInstances": [ { "id": "tok456", "nodeId": "n1", "nodeName": "Validate" } ],
  "varTypes": { "caseId": "String" },   // declared types, for bare-name binding (Java only)
  "mode": "condition"                   // omit for a script; "validate" for a publish-time dry-compile
}
```
```jsonc
// response (script/condition — validate mode returns just {"ok":true} or {"ok":false,"error":...})
{
  "ok": true,
  "vars": { "caseId": "C-1", "status": "DONE" },
  "logs": "computed total=15.75\n",
  "pendingActions": [
    { "kind": "signal", "type": "ChildDone", "payload": "result", "targetInstanceId": "parent-1" },
    { "kind": "abort", "type": null, "payload": null, "targetInstanceId": "abc123" }
  ]
}
```

### Behavior notes

- **Tenant scoping**: a targeted `signalEvent`/`abortProcessInstance` silently no-ops if the target id
  belongs to a different tenant — same "no error, just doesn't happen" contract as an id that doesn't
  exist at all.
- **Self-targeting is special-cased for correctness, not just convenience**: a self-targeted signal or
  abort mutates the exact same in-memory instance object the engine's stepping loop is already
  processing, rather than re-fetching a separate copy from the store. This isn't cosmetic — a real
  test caught this: mutating a freshly-fetched copy gets silently overwritten when the stepping loop
  persists its own reference afterward. `getKieRuntime().abortProcessInstance(selfId)` genuinely
  aborts the instance immediately (no further nodes execute after the aborting script/node), matching
  what an operator-triggered abort via the REST API does.
- **`getNodeInstances()` is a snapshot**, not a live view — exactly like real jBPM's own Collection
  return value for this method. It reflects whichever tokens are `active` at the moment the method is
  called from within a node's handler, including sibling branches from an earlier parallel fork that
  haven't been processed yet in the same step.

### Deliberately not implemented (Tier 2) — and why

Trying to call any of these anyway fails the same way any unsupported API would: `kcontext`/
`getKieRuntime()`/etc. simply don't have the method, so it's a compile-time "cannot find symbol"
error — caught by the publish-time dry-compile validator (same mechanism that catches any other typo
or unsupported call), not a runtime surprise.

| Real jBPM capability | Why not here |
|---|---|
| `startProcess(id, params)` from a script | Real jBPM itself documents NPEs doing this (Red Hat KB) — not a capability worth out-engineering past what real jBPM's own users route around |
| `getProcessInstances()` (enumerate all running instances) | Real jBPM commonly returns empty here too (instances are persisted, not held live in the session) — real teams use the audit log/`RuntimeDataService` instead |
| Cross-instance **read** (`getProcessInstance(id).getVariable(...)`) | Same reasoning as above — live cross-instance reads aren't a reliable real-jBPM pattern either |
| `((WorkItemNodeInstance) kcontext.getNodeInstance()).getWorkItem()` | A deep, node-instance-subtype-specific cast pattern; zero confirmed usage across all 89 real scripts + 42 conditions swept this session |
| Human task querying (`TaskService`/`RuntimeDataService`) | Confirmed **not reachable from real jBPM's `kcontext` either** — these are external REST/Java-client-only APIs; the one workaround (a `RuntimeManager` environment lookup) is an unofficial community pattern, not upstream behavior |
| Drools working-memory fact ops (`insert`/`update`/`retract`) | Tied to the Drools rule engine's working memory, which this engine has no concept of at all |
| `getCaseData()`/`getCaseAssignment()` (CMMN) | Case management isn't a concept this engine implements |
| `kcontext.getKieRuntime().getLogger()` | An earlier planning draft floated this; it doesn't correspond to any real method on `org.kie.api.runtime.KieRuntime` — Drools' logging facility (`KieRuntimeLogger`) is an external audit-trail logger attached to a session from outside, never a script-scope API. Correctly left unimplemented; noted here so the gap is explicit rather than a silent drop from the original plan. `System.out.println`/`console.log` (captured into this engine's own log sink) already cover script-side logging. |

## What's genuinely NOT supported, and why

Two different kinds of limits, worth telling apart:

**1. Environment limits (not a design choice — just what's actually available here):**
- No arbitrary third-party libraries. Only `java.*`/`javax.*` (the JDK itself) and the hand-written
  Jackson shim are on the classpath — there's no Maven in this environment to fetch a real
  third-party jar. A script that `import`s anything else fails to compile, with a real
  "package does not exist" diagnostic.
- No custom application classes — each script compiles standalone; it can't reference another class
  from the wider project.
- Newer-than-Java-8 syntax (switch expressions/`yield`, records, `var`, text blocks) fails to
  compile — the installed JDK's `javac` is Java 8. This isn't enforced by a denylist; the real
  compiler simply rejects it, with its own precise diagnostic.

**2. Deliberate safety limits** (`src/engine/java-compat.ts`'s `DENYLIST`) — the sidecar is **one
persistent process shared by every script execution** on this server (across every process/instance,
not a fresh sandbox per script), so a small, specific set of constructs is blocked because they'd be
operationally unsafe here even though they're perfectly valid Java:
- **Reflection that loads/instantiates arbitrary classes or bypasses access control**:
  `Class.forName`, `.setAccessible(...)`, `java.lang.reflect.*`. (Plain `.getClass()` — e.g.
  `e.getClass().getName()` in a catch block — is left alone; it's harmless.)
- **Threading/concurrency**: `new Thread(...)`, `Thread.sleep`/`.currentThread`, `synchronized`/
  `volatile`, `Executors.*`/`ExecutorService`/`CompletableFuture`. The sidecar assumes scripts run
  synchronously, one at a time (see the concurrency note below) — a script spawning or blocking a
  thread would break that assumption for every other in-flight script, not just its own.
- **Filesystem access**: `java.io.*`, `java.nio.*`, `FileInputStream`/`FileOutputStream`, `Files.*`,
  `Paths.get`.
- **Process control**: `Runtime.getRuntime()`, `ProcessBuilder`, `System.exit`/`.halt` — the last of
  these would kill the shared sidecar process outright, aborting every in-flight script across every
  running instance, not just the offending one.
- **Raw network access**: `java.net.*`, `HttpURLConnection` — use an HTTP/REST task node instead
  (audited, retried, timed out by the engine), not an ad-hoc connection from inside a script.

Everything else — lambdas, streams, `Optional`, try-with-resources, `java.time`, anonymous classes,
varargs, multi-catch, annotations — is real Java 8 and fully supported; none of it is blocked anymore
(the old transpiler-era denylist blocked most of this list not because it was unsafe, but because the
hand-rolled JS shim simply didn't implement it — that reason no longer applies).

## The publish-time validator — two layers, cheapest first

1. **Fast, synchronous denylist scan** (`validateJavaSupport`, `java-compat.ts`) — the safety list
   above, checked with no network call and no JVM involvement. String/comment contents are blanked
   out first so incidental text (a log message, a comment) never false-positives.
2. **Real dry compile** (`validateJava`, `java-sidecar.ts`) — only runs if step 1 passes. Sends the
   *exact* script text to the sidecar with `mode:'validate'`, which compiles it with the identical
   wrapper shape execution uses and reports the real compiler's own diagnostics on failure. This
   can never drift out of sync with what running the script actually does, because it *is* what
   running the script does, minus the final invocation — and it shares the sidecar's compile cache,
   so validating a script and then actually running it never compiles it twice.

Both layers run for every `lang:'java'` script/condition/exitScript node, including ones nested
inside embedded or event sub-processes (rule `java-support` in `src/modules/validation/rules.ts`
recurses into nested nodes/flows). Any failure is a publish-blocking **error** naming the specific
problem — a denylist message, or the real `javac` diagnostic (e.g. "cannot find symbol: variable
xyz (line 4)").

## Concurrency: the sidecar runs requests in real parallel, not one-at-a-time

**This used to be genuinely blocking** — `HttpServer` had no custom `Executor`, so the JDK's default
handled every `/execute` call one at a time on a single dispatch thread, and `ScriptRunner` swapped
the process-wide `System.out` in and out per call to capture logs (only safe single-threaded).
Confirmed and fixed this session, with real measurements: 10 concurrent ~200ms Java script calls took
~2000ms before the fix (fully serialized) and ~400ms after it. At 100 concurrent calls, this matters —
request #100 used to wait behind all 99 others before even starting.

**How it works now**: `Server.java` runs a real thread-pool `Executor` (`Math.max(4, availableProcessors())`
threads), so multiple `/execute` calls genuinely run on different OS threads at once. Two things had to
change in `ScriptRunner.java` to make that safe:
- **Log capture is thread-local, not a per-call `System.out` swap.** A single dispatching `PrintStream`
  is installed as `System.out` exactly once (a static initializer, before anything else touches the
  class), and its writes fan out to a per-thread buffer via a `ThreadLocal`. Two scripts running
  concurrently on different threads each fill only their own buffer — there's no shared mutable
  "current capture" to race on. Verified with a real test: 20 concurrent scripts, each printing a
  unique marker, each got back exactly its own line — zero cross-thread leakage.
- **Compilation (a cache miss) is serialized behind a lock; invocation of an already-cached class is
  not.** Not because concurrent `javax.tools.JavaCompiler.getTask(...).call()` invocations are known
  to be unsafe, but because it isn't documented as safe either, and because two threads racing to
  define the identical new class would throw `LinkageError: duplicate class definition`. This only
  affects a script's first-ever compile for the sidecar's lifetime — every later call for that same
  script/varTypes shape hits the cache and never touches the lock, so many instances concurrently
  stepping through an already-published (already-compiled) process see full parallelism.

**"Compile once at deploy time" is now actually true for scripts, not just conditions.** The compiled-
class cache key depends on both the code text AND the `varTypes` shape (declared variable types) —
see `classNameFor`. The publish-time validator (`rules.ts`'s `java-support` rule) dry-compiles every
Java script/condition/onEntry/onExit via the identical path execution uses; an earlier version of that
rule passed the real `varTypes` for conditions but `undefined` for scripts, computing a *different*
cache key than real execution — so the dry-compile still caught genuine compile errors, but silently
failed to pre-warm the cache, and the first real instance to hit that script recompiled it from
scratch anyway. Fixed by passing the same `varTypes` (and, for the REST node's `exitScript`, the same
synthesized `resPayload: 'String'` entry `http/handler.ts` always adds) at validate time as execution
time. Verified: after `validate()`, a real `run()` call for the same script/shape took ~14ms; a
genuinely never-validated script took ~125ms — confirming the cache was actually hit, not recompiled.
onEntry/onExit on the generalized activity node types (userTask, businessRuleTask, etc.) are now also
included in this publish-time dry-compile — they weren't checked at all before this session's
onEntry/onExit generalization work.

**Threading/concurrency constructs stay denylisted regardless** — not primarily for the log-capture
reason anymore (a script-spawned thread's writes would land in ITS OWN unread ThreadLocal buffer now,
silently lost rather than corrupting another script's output), but because the sidecar is still one
shared, persistent process for the server's entire lifetime: unsupervised background work a script
spawns and never joins is a resource leak and an unbounded-lifetime risk with no supervision, timeout,
or error-reporting path back to the caller — a fundamentally different hazard than concurrent
*request handling*, which is now fully supported.

Real script/condition execution is still normally sub-millisecond once compiled and cached — the
concurrency fix matters for CPU-bound outliers and for raw request-count scale (100+ concurrent
instances), not because typical script execution was ever slow.

## Round-trip: this is genuinely two-way, not "convert once"

- **jBPM → engine JSON**: `toEngine` carries a scriptTask's Java source through **byte-for-byte**
  (`code: n.script`, `lang` derived from `scriptFormat`) — nothing is rewritten at conversion time.
  The same applies to `onEntry`/`onExit` on ANY activity node (userTask, businessRuleTask, sendTask,
  receiveTask, manualTask, subProcess, reusable/multi-instance call activity, generic work-item task) —
  bpmn-sdk's `parse.ts` extracts `drools:onEntry-script`/`onExit-script` uniformly for all of them via
  one shared helper, not just the REST call activity's own separate `exitScript` wrapper.
- **engine JSON → jBPM**: `fromEngine` writes that same original Java text straight back into the
  generated `<scriptTask scriptFormat="http://www.java.com/java">`, or the matching `onEntry-script`/
  `onExit-script` extensionElements for whichever activity node carries them. A process authored fresh
  in engine JSON with `lang:'java'` round-trips the same way.
- Net effect: a real jBPM project with Java scripts converts to engine JSON, **executes here
  unmodified** (compiled and run by a real JVM), and converts back to jBPM XML with the original Java
  intact — no lossy re-translation in either direction, and no requirement to hand-port scripts to
  JavaScript first.
- **This engine's own additive names** (`vars`, `instance`, `node`, the Java meta-locals) round-trip
  too, just via a different mechanism: since real jBPM has never heard of them, `fromEngine` prepends a
  small preamble (only when the name is actually referenced) that computes the identical value from
  real `kcontext` — so the exported text is plain, self-contained jBPM script/condition source with no
  runtime dependency on this engine at all. `toEngine` (jBPM → engine JSON) never needs to strip this
  preamble back out — a real jBPM project simply never contains it in the first place, since it's this
  engine's own invention, not something jBPM projects author.

## Choosing JS vs Java when authoring fresh

They are no longer symmetric in mechanism, only in outcome:

- **JavaScript** runs natively in this process's own V8 (`node:vm`) — no external process, no startup
  cost, no extra dependency to have installed.
- **Java** runs in the JVM sidecar — requires a JDK (not just a JRE — `javax.tools.ToolProvider.
  getSystemJavaCompiler()` needs a real compiler) reachable on `PATH`, and a small first-call latency
  per distinct script while it compiles (cached after that).

Match the dialect of the surrounding jBPM project if this is a converted process (so scripts stay
byte-identical on export); for a process authored fresh in this engine, JS is the simpler default —
see `docs/bpm-nodes/_scripting-javascript.md` for what real jBPM's own JavaScript dialect supports,
which is a **different** execution model again (Nashorn/GraalVM JS, Java-object semantics) from this
engine's native-V8 JS — that gap is tracked separately, not yet closed.

## Non-JS-non-Java languages

Only `js` and `java` execute. Any other declared dialect (e.g. `mvel`) is structurally preserved
through conversion (so it still round-trips to valid jBPM XML) but is **not** evaluated at runtime —
the script/handler.ts result is `{ outcome: 'skipped-nonjs' }`, and a flow condition in any other
language always evaluates to `false`.

## Related

`docs/bpm-nodes/_scripting-java.md` (the general jBPM/BPMN Java reference — kcontext, type mapping,
JSON build/parse — everything there is what this engine now executes, not just documents) ·
`docs/bpm-nodes/_scripting-javascript.md` · `docs/bpm-nodes/_scripting-reference.md` ·
`14-error-handling.md` (how a script's thrown error maps to `SCRIPT_ERROR` and gets caught).
