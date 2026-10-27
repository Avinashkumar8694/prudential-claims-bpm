# @fabrixly/bpmn-sdk

Round-trip a **jBPM BPM project** (BPMN 2.0 `.bpmn` files) ↔ a clean, typed **JSON model**, and
generate importable BPMN from JSON. Written in **TypeScript**, ships **ESM + CJS + type
declarations**, **zero runtime dependencies**. Usable in any Node ≥ 16 app.

Grounded in the specs under [`../docs/bpm-nodes/`](../docs/bpm-nodes/): the JSON model matches the
documented `node.json` shapes and the field vocabulary in `_mappings-reference.md`.

## Install
```bash
npm install @fabrixly/bpmn-sdk
```
> Rename `name` in `package.json` to your own scope/registry before publishing (`npm publish`).

## Use in an app
```ts
import { parseBpmn, serializeProcess, parseProject, writeProject, validateModel } from '@fabrixly/bpmn-sdk';
import type { ProcessModel } from '@fabrixly/bpmn-sdk';
import fs from 'node:fs';

// BPMN -> JSON
const model: ProcessModel = parseBpmn(fs.readFileSync('proc.bpmn', 'utf8'));

// JSON -> BPMN
fs.writeFileSync('proc.bpmn', serializeProcess(model));

// Whole project (bpmn + kjar scaffolding)
const project = parseProject('/path/to/prudential-claims-bpm'); // { descriptor, processes: [...] }
writeProject(project, '/path/to/out');            // writes .bpmn + pom.xml + kmodule + deployment descriptor
writeProject(project, '/path/to/out', { scaffold: false }); // .bpmn only

// Validate
const { ok, errors, warnings } = validateModel(model);
```
CommonJS works too: `const { parseBpmn } = require('@fabrixly/bpmn-sdk');`

### Generate a COMPLETE deployable project from JSON
`writeProject` emits the whole kjar, not just `.bpmn` — `pom.xml`, `META-INF/kmodule.xml`, and
`META-INF/kie-deployment-descriptor.xml` (work-item handlers like `Rest` + environment entries like
`INTEGRATION_LAYER_URL`). Provide a `descriptor` and your processes:
```ts
writeProject({
  root: 'out',
  descriptor: {
    gav: { groupId: 'com.acme', artifactId: 'my-claims-bpm', version: '1.0.0-SNAPSHOT', kieVersion: '7.73.0.Final' },
    deployment: {
      runtimeStrategy: 'SINGLETON',
      workItemHandlers: [{ name: 'Rest', resolver: 'mvel', identifier: 'new org.jbpm.process.workitem.rest.RESTWorkItemHandler(classLoader)' }],
      environmentEntries: [{ name: 'INTEGRATION_LAYER_URL', resolver: 'mvel', identifier: '"http://localhost:3000"' }],
    },
  },
  processes: [ /* ProcessModel[] */ ],
}, 'out');
// -> out/pom.xml, out/src/main/resources/META-INF/{kmodule,kie-deployment-descriptor}.xml, out/src/main/resources/org/jbpm/*.bpmn
```
Round-tripping an existing project captures its real `descriptor` (gav + deployment + verbatim
`pom.xml`/`.wid`/`project.imports`/`project.repositories`) and regenerates all of it. The result is
`mvn`-buildable / Business-Central-importable.

## CLI
Installed as `bpmn-sdk` (or `npx bpmn-sdk`):
```bash
bpmn-sdk to-json <projectDir> project.json    # BPM project -> JSON model
bpmn-sdk to-bpm  project.json <projectDir>     # JSON model -> .bpmn files
bpmn-sdk parse   process.bpmn model.json       # one file -> JSON
bpmn-sdk build   model.json   process.bpmn     # one process JSON -> .bpmn
bpmn-sdk validate <file.bpmn | projectDir>     # structural validation
```

## API
| Export | Signature |
|--------|-----------|
| `parseBpmn(xml)` | `(string) => ProcessModel` |
| `serializeProcess(model)` | `(ProcessModel) => string` (BPMN XML) |
| `parseProject(dir)` | `(string) => Project` |
| `writeProject(project, dir)` | `(Project, string) => string[]` |
| `validateModel(model)` | `(ProcessModel) => { ok, errors, warnings }` |
| `constants` | namespaces, REST param list, enums |
| types | `ProcessModel, Node, Flow, Variable, MultiInstance, …` |

## Model shape (typed)
```ts
interface ProcessModel {
  id: string; name: string; packageName?: string; processType?: 'Public'|'Private'|'None';
  sourcePath?: string;
  declarations?: { signals: {id,name}[]; errors: {id,errorCode}[] };
  variables?: { name: string; type: string }[];      // type = structureRef
  nodes: Node[];
  flows: { id; name?; sourceRef; targetRef; condition?; waypoints? }[];
}
```
Node types: `startEvent` · `endEvent` · `scriptTask` · `userTask` · `callActivity`
(subtypes `rest` | `reusable` | `multiInstance`) · `exclusiveGateway` · `boundaryEvent`
(`error`|`timer`) · `intermediateCatchEvent` · `subProcess` (event) · `raw`. Full field reference:
`../docs/bpm-nodes/` (per-node folders) and `_mappings-reference.md` (allowed values).

## Round-trip fidelity
- **Semantic, not byte-identical.** Output re-imports to the same model and is well-formed, but
  attribute order / generated ids / whitespace differ from a Business Central export.
- **`raw` nodes**: any element not modeled semantically (raw `task` work items, `businessRuleTask`,
  parallel/inclusive gateways, embedded `subProcess`, `intermediateThrowEvent`, …) is captured as
  `{ type: 'raw', bpmnLocal, raw }` and re-emitted verbatim — nothing is lost. Promote a `raw` type
  to first-class by adding a case in `src/parse.ts` + `src/serialize.ts`.
- Diagram `position` (BPMNShape) and flow `waypoints` (BPMNEdge) are preserved; missing positions
  are auto-placed and flagged by `validateModel`.

Verified: all 8 processes in this repo round-trip (identical node ids/types, flows, variables) and
every regenerated file is well-formed XML. Always also run Business Central import for full
jBPM-schema validation.

**Validated against real jBPM projects.** `scripts/validate-external.mjs <dir>` runs the SDK over any
folder of `.bpmn`/`.bpmn2` files (parse → JSON → serialize → `xmllint` → re-parse, asserting node/flow
id sets survive). Run against the **entire `jbpm-bpmn2` test suite from the official `kiegroup/jbpm` repo — all 292
`.bpmn2` files** (gateways, event sub-processes, boundary/conditional/timer/signal/escalation events,
call activities, multi-instance, ad-hoc, transactions, inclusive-gateway loops, service/receive/
business-rule/send/user tasks, data objects, lanes, multi-process files, id-less elements):
**292 ok · 0 id-diff · 0 error** — every file parsed to JSON, re-serialized to well-formed BPMN, and
structurally preserved (unmodeled constructs carried via `raw`; id-less elements get generated ids;
`parseBpmnAll` handles multiple processes per file).
```bash
node scripts/validate-external.mjs /path/to/any/bpmn-files
```
And the reverse direction is covered too: the SDK's own **exported** projects are parsed **back to
JSON** (`test/generated-to-json.test.mjs`).

## Develop
```bash
npm install
npm run build        # tsup -> dist/ (ESM + CJS + .d.ts)
npm run typecheck    # tsc --noEmit
npm test             # builds, then node --test (round-trips this project)
npm run example      # JSON -> demo-hello.bpmn
```

## Publish to npm
```bash
# 1) set a name you own (scope or unscoped) + bump version in package.json
# 2) log in
npm login
# 3) publish (prepublishOnly runs the build; `files` ships only dist + bin + README + LICENSE)
npm publish --access public
```
Package layout: `main` = CJS (`dist/index.js`), `module`/`import` = ESM (`dist/index.mjs`),
`types` = `dist/index.d.ts`, `bin.bpmn-sdk` = `bin/bpmn-sdk.js`.

## Design / alternatives
Zero-dependency by design — exact control over jBPM `drools:` extension output and offline use.
If you prefer an ecosystem library: [`bpmn-moddle`](https://github.com/bpmn-io/bpmn-moddle)
(canonical BPMN read/write; needs a moddle extension for the `drools` namespace) or
[`fast-xml-parser`](https://www.npmjs.com/package/fast-xml-parser) (generic XML↔JSON; you supply
the semantic layer this SDK provides).
