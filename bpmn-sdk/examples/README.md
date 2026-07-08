# Examples — build your own BPM in JS, export to jBPM

The goal these examples prove: **author processes in your own JavaScript BPM engine (as a
`ProcessModel` JSON), then export a jBPM-deployable project** — jBPM-format BPMN + a full kjar
(pom.xml, kmodule.xml, kie-deployment-descriptor.xml, WorkDefinitions.wid). After export you run
`mvn clean install` and deploy the kjar to a KIE server / Business Central.

```
your JS designer ──▶ ProcessModel (JSON) ──▶ writeProject() ──▶ jBPM kjar ──▶ mvn install ──▶ KIE server
```

## Run
```bash
npm run build                                   # compile the SDK once
node examples/01-basic-jbpm-project.mjs  examples/out/basic
node examples/02-complex-js-project.mjs  examples/out/complex
```
Each writes a complete project under the given directory.

## 01 — basic complete project (`01-basic-jbpm-project.mjs`)
A claims-intake process built entirely in JS: start → bootstrap (Java script) → REST validate →
exclusive gateway (Death vs other) → calculate / manual review → ends, plus a global error
sub-process. Exports the process `.bpmn` **and** the kjar scaffolding (GAV `com.acme:claims-intake-bpm`,
`Rest` handler, `INTEGRATION_LAYER_URL`). Shows the minimal end-to-end path.

## 02 — complex project with JavaScript code (`02-complex-js-project.mjs`)
Exercises the full toolbox and the **JavaScript script dialect**:
- a **JavaScript** script task (`scriptFormat = …/javascript`) and a **JavaScript** gateway condition,
- parallel fork/join, an exclusive Outcome gateway,
- a **multi-instance** call activity looping `applicablePolicies` into a reusable **child process**,
- a user task with a **30-day boundary timer**, signal-throw ends, and a global error sub-process,
- a custom `workDefinitions` entry → generates `global/WorkDefinitions.wid`.

> JS dialect note: the exported BPMN keeps `scriptFormat="http://www.javascript.com/javascript"`.
> That code runs **server-side** in the KIE engine and needs a JS script engine on the classpath
> (Nashorn on JDK 8/11; GraalVM JS on JDK 15+). Prefer Java for portability — see
> `../../docs/bpm-nodes/_scripting-reference.md`.

## 03 — every node type, multi-process (`03-all-nodes-project.mjs`)
A **6-process** project that exercises the entire modeled palette in one export:
- **all gateways**: exclusive, parallel, inclusive (+ default), event-based, complex;
- **all tasks**: script (Java + JavaScript), user, business-rule, send, receive, manual;
- **call activities**: reusable, REST, multi-instance (→ a reusable child process);
- **sub-processes**: embedded (with children), transaction, event (error → terminate);
- **all start triggers** (none/signal/message/timer/conditional, one per process),
  **all ends** (none/terminate/signal/error/message/escalation),
  **intermediate catch** (timer/message/signal/conditional) and **throw** (signal/message),
  **boundary events** (error/timer/message/signal/conditional/escalation, interrupting + non-interrupting);
- **data objects**, a **data store**, **lanes**, and signal/error/message/escalation declarations.

It uses `autowire(process)` — the SDK derives every node's `incoming`/`outgoing` from the flow list
(recursing sub-processes), so you only declare `flows`. Run:
```bash
node examples/03-all-nodes-project.mjs examples/out/coverage
```

## 04 — JavaScript as the process logic (`04-js-scripts.mjs`)
The core-goal proof: a process whose logic **is JavaScript** — three JS-dialect script tasks
(bootstrap, a multiline classify with `if/else`, `&&`, `>`, string concat, and a notify) plus **two
JS-dialect gateway conditions** — exported to jBPM. Run:
```bash
node examples/04-js-scripts.mjs examples/out/js
```
Emitted verbatim inside `<![CDATA[…]]>` with `scriptFormat="http://www.javascript.com/javascript"`
and `language="http://www.javascript.com/javascript"` on the conditions.

> Runtime: this JS executes on the KIE server (Nashorn on JDK 8/11; GraalVM JS on JDK 15+). The
> export is always correct and the dialect is preserved; whether it *runs* depends on the server's
> JS engine. See `../../docs/bpm-nodes/_scripting-reference.md`.

## 05 — every Business Central asset type in one kjar (`05-all-assets-project.mjs`)
Packages a **JS-scripted Business Process** (JavaScript script node + a `businessRuleTask` bound to a
DRL + a form user task) together with **one sample of every other asset type** — Data Object (Java),
DRL, DMN, DSL, Enumeration, Guided Rule/Template/Decision-Table, Guided Score Card, Test Scenario
(new + legacy), Form, Solver config, Work Item definition — into a single deployable project.
```bash
node examples/05-all-assets-project.mjs examples/out/assets
```
The SDK authors the BPMN + kjar scaffolding + `.wid`; every other asset is carried **verbatim** via
`descriptor.files` (see `../../docs/bpm-project/asset-types.md`). It does not generate rule/decision
internals — the `kie-maven-plugin` compiles those on build.

## 06 — generate assets from structured JSON (`06-generate-assets.mjs`)
Uses the asset codecs (`buildAsset`/`parseAsset`) to **generate** a DRL, a DMN (built as an XML tree),
a Java data object, an enumeration, a DSL, a `.properties`, and a `WorkDefinitions.wid` — all from
JSON models — then packages them into a kjar with a `businessRuleTask`-driven process.
```bash
node examples/06-generate-assets.mjs examples/out/generated
```
Per-asset model reference: `../../docs/bpm-assets/`.

## Verified
Both examples are covered by `../test/examples.test.mjs` (part of `npm test`): the output re-parses,
validates, round-trips, and preserves the JavaScript dialect on both the script task and the
condition. All generated `.bpmn`/`.xml` pass `xmllint`.

## Using the SDK from your own app
Replace the relative `../dist/index.mjs` import with the package name:
```js
import { writeProject, validateModel } from '@neutrinos/bpmn-sdk';
```
Build the `ProcessModel`/`Project` however your designer produces it, then `writeProject(project, dir)`.
