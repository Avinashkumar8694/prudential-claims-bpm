# Examples — build your own BPM in JS, export to jBPM

Author processes/rules in your own JavaScript BPM engine, then export a jBPM-deployable project
(BPMN + kjar) — or run rules directly in Node. Examples are grouped by concern:

| Folder | What it shows |
|--------|---------------|
| [`jbpm-project/`](jbpm-project/) | Build jBPM projects directly with the SDK's `ProcessModel`/`Project` (01–04) |
| [`assets/`](assets/) | Package & generate Business Central assets (05–06) |
| [`engine-model/`](engine-model/) | The clean **engine model** → jBPM via `fromEngineProject` (07) |
| [`rules-runtime/`](rules-runtime/) | A reference **rule engine** that executes the engine ruleset on data (08–09) |
| [`decisions/`](decisions/) | Engine **decision tables** → DMN + a reference DMN evaluator (10–11) |
| [`functions/`](functions/) | Reusable helper modules imported by the examples — `rule-engine`, `dmn-engine`, `io`, `report` |

```bash
npm run build                                                      # compile the SDK once
node examples/jbpm-project/01-basic-jbpm-project.mjs               # writes to <this file>/out/basic
node examples/rules-runtime/09-comprehensive-rules.mjs             # prints a runtime trace
```
Each project example writes a complete kjar under its own `out/` (git-ignored); pass a dir to override.

## jbpm-project/
- **01-basic-jbpm-project** — claims-intake process in JS (start → Java bootstrap → REST validate →
  exclusive gateway → calculate/manual review → ends + global error sub-process) → `.bpmn` + kjar
  (GAV, `Rest` handler, `INTEGRATION_LAYER_URL`). The minimal end-to-end path.
- **02-complex-js-project** — full toolbox + the **JavaScript dialect**: JS script task & JS gateway
  condition, parallel fork/join, multi-instance call activity → reusable child, a 30-day boundary
  timer, signal-throw ends, global error sub-process, a custom `WorkDefinitions.wid`.
- **03-all-nodes-project** — a **6-process** project exercising the entire palette: all gateways, all
  tasks, all call-activity subtypes, embedded/transaction/event sub-processes, every start/end/
  intermediate/boundary event, data objects, a data store, lanes, and all declarations. Uses
  `autowire` (derives `incoming`/`outgoing` from `flows`).
- **04-js-scripts** — a process whose logic **is JavaScript**: three JS-dialect script tasks + two JS
  gateway conditions, emitted verbatim in `<![CDATA[…]]>` with the JS `scriptFormat`/`language`.

> JS dialect runs server-side in the KIE engine (Nashorn on JDK 8/11; GraalVM JS on JDK 15+). Export
> is always correct; whether it *runs* depends on the server. See `../../docs/bpm-nodes/_scripting-reference.md`.

## assets/
- **05-all-assets-project** — a JS-scripted Business Process + **one sample of every other asset type**
  (Data Object, DRL, DMN, DSL, Enumeration, Guided Rule/Template/Decision-Table, Score Card, Test
  Scenario new+legacy, Form, Solver, WID) in a single kjar. Others carried verbatim via `descriptor.files`.
- **06-generate-assets** — uses the asset codecs (`buildAsset`/`parseAsset`) to **generate** a DRL, a
  DMN (XML tree), a Java data object, an enumeration, a DSL, `.properties`, and a `.wid` from JSON
  models, then packages them with a `businessRuleTask`-driven process. See `../../docs/bpm-assets/`.

## engine-model/
- **07-engine-to-jbpm** — authors in the clean **engine model** and converts via `fromEngineProject`.
  Shows **type resolution** (declared type `Claim` → Java FQN + form `className` + generated
  `Claim.java`), `http`, JS script + JS gateway condition, `forEach`, `rule`, terminate end, and the
  reverse `toEngine`. See `../../docs/engine-model/`.

## rules-runtime/
- **08-run-engine-rules** — a ~90-line reference **rule engine** that executes the engine ruleset JSON
  against plain objects (match → resolve → act loop, with property reactivity + `noLoop`). Minimal
  2-rule scenario (match, join, negation, priority, `set`).
- **09-comprehensive-rules** — **one ruleset exercising every construct**: all 12 operators, every
  `where` form (literal/array/range/`{ref}` join/`{op:{ref}}`), `exists:false`+`exists:true`,
  `priority`, `noLoop` (with vs without), forward chaining, and all `then` actions. Prints a full
  before/trace/after. See `../../docs/bpm-assets/drl/scenarios.md` §0.

## decisions/
- **10-decision-to-dmn** — author a DMN **decision table** in the engine model (columns
  `inputs`/`outputs`, rows `rules` with `when`/`then`) and convert via `fromEngineProject`. The SDK
  synthesizes the DMN 1.2 file (FEEL cells, typeRefs, hitPolicy, namespace); a `rule` node's
  `dmn:{model,decision}` fires it. Prints the generated `.dmn`.
- **11-comprehensive-decision** — a model exercising **every** input-cell form (literal/any/set/
  `gt..lte`/`between`/`not`/`{feel}`) and hit policies (UNIQUE, COLLECT+SUM), then **evaluates it on
  data** with the reference evaluator. See `../../docs/bpm-assets/dmn/scenarios.md` §0.

## Verified
Every example is covered by the test suite (`npm test`): projects re-parse/validate/round-trip and
preserve the JS dialect; generated `.bpmn`/`.xml` pass `xmllint`; the rule engine's outcomes are
asserted (`test/engine-rules-runtime.test.mjs`).

## Using the SDK from your own app
Replace the relative `../../dist/index.mjs` import with the package name:
```js
import { writeProject, fromEngineProject } from '@neutrinos/bpmn-sdk';
```
Build the `ProcessModel`/`Project` (or engine model) however your designer produces it, then
`writeProject(project, dir)`.
