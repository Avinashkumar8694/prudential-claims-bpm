# 15 — Scripting & how JavaScript maps to exported jBPM

Script tasks and flow conditions are authored in **JavaScript** (the only language the Node runtime
executes). This documents what happens to that JS when you **export a jBPM (kjar) project**.

## What the Node runtime does
- Script tasks run as JS in a sandbox (`node:vm`) against the **`kcontext`** binding:
  `kcontext.getVariable(name)` / `kcontext.setVariable(name, value)`.
- Flow/gateway conditions are JS expressions evaluated to a boolean.

## What export produces
`fromEngine` writes BPMN with the **JavaScript script format** on every script task and condition:
- script task → `scriptFormat="http://www.javascript.com/javascript"`, body = your JS verbatim.
- conditional flow → `conditionExpression language="http://www.javascript.com/javascript"`.

The **`kcontext` API is identical** in jBPM — in a jBPM/Kogito script task, `kcontext` is the
`ProcessContext`, and `kcontext.getVariable/setVariable` are the same calls. So a script like
`kcontext.setVariable("tier", amount >= 100000 ? "HIGH" : "STANDARD");` is portable **as-is**.

## Will it run in jBPM? — yes, with a JS script engine
BPMN script tasks are executed by a JSR-223 **ScriptEngine** matching the `scriptFormat`. For
JavaScript that means:
- **GraalVM JS** (`org.graalvm.js:js`) on the classpath (recommended; works on modern JDKs), or
- **Nashorn** on JDK 8–14 (removed in JDK 15+).

So the exported kjar runs the JS **provided the jBPM/KIE runtime has a JS engine available**. The
engine emits the correct `scriptFormat`, so no code change is needed — only the runtime dependency.

## Options & guidance
| You want… | Do this |
|-----------|---------|
| Run in **this** Node engine | Author JS (default) — always executes here |
| Export to jBPM **and** run JS there | Add GraalJS to the KIE runtime; JS runs unchanged (`kcontext` compatible) |
| Export to a **zero-extra-dependency** jBPM | Keep task logic in **Service (REST) / Business Rule / DMN** nodes (which export to native jBPM work items / DRL / DMN) and keep scripts minimal |

**Recommendation:** prefer **Service tasks, Business Rules, and DMN** for real logic (they map to
first-class jBPM assets with no scripting-engine dependency), and use JS scripts for small glue
(variable shaping). That keeps the exported kjar portable while the Node engine runs everything today.

## Non-script languages
The engine no longer offers Java/MVEL authoring (JS only). If you must emit Java/MVEL script tasks for
a specific jBPM target, that's a future export option; today all scripts export as JavaScript.
