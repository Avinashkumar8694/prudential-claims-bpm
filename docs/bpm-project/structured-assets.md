# Structured JSON for assets — `parseAsset` / `buildAsset`

> Per-asset docs (folder-per-asset, like `../bpm-nodes/`): **[`../bpm-assets/`](../bpm-assets/)** —
> each has `usage_guide.md`, `model.md`, and a sample `model.json`. Working example:
> `../../bpmn-sdk/examples/assets/06-generate-assets.mjs`.

Beyond carrying assets as verbatim text, the SDK exposes **structured JSON codecs** so your engine can
**generate and edit** every asset type programmatically, then serialize back to the on-disk format.
One efficient mechanism covers the majority (a generic XML tree), plus small typed models for the rest.

```ts
import { parseAsset, buildAsset, assetKind } from '@fabrixly/bpmn-sdk';

const asset = parseAsset('rules/classify.drl', drlText);  // -> { kind:'drl', model:{...} }
asset.model.rules.push({ name:'New', attributes:['ruleflow-group "classify"'], when:'$c: Claim()', then:'…' });
const drlText2 = buildAsset(asset);                        // model -> DRL text
```
Every codec is **round-trip stable**: `buildAsset` is idempotent and re-parses to the same model.

## Kind → model
| Ext(s) | `kind` | model shape |
|--------|--------|-------------|
| `.dmn`, `.gdst`, `.gdt`, `.rdrl`/`.rdslr`, `.template`, `.scgd`, `.scesim`, `.scenario`, `*.solver.xml`, `.xml` | `dmn` / `guidedDecisionTable` / `guidedDecisionTree` / `guidedRule` / `guidedRuleTemplate` / `scoreCard` / `testScenario` / `testScenarioLegacy` / `solver` / `xml` | `{ xml: <ElementNode tree> }` — a **generic, lossless XML tree** (`{name, attrs, children[], text, cdata[]}`) you can traverse/edit/generate |
| `.drl` | `drl` | `{ package, imports[], globals[], rules:[{ name, attributes[], when, then }] }` (best-effort) |
| `.java` | `dataObject` | `{ package, className, fields:[{ name, type }] }` → rebuilds a POJO with getters/setters (best-effort) |
| `.wid` | `workItemDefinition` | `{ definitions: WorkItemDefinition[] }` |
| `.properties` | `properties` | `{ props: { key: value } }` |
| `.enumeration` | `enumeration` | `{ enums: { 'Fact.field': [values] } }` |
| `.dsl` | `dsl` | `{ entries: [{ scope, nl, mapping }] }` |
| `.frm`/`.form` | `form` | `{ json }` (BC JSON form) or `{ xml }` (XML form) |
| anything else | `text` | `{ text }` |

## Why a generic XML tree for the rule/decision assets
DMN, guided decision tables/trees/rules/templates, score cards, and test scenarios are all XML with
large, BC-specific schemas. Rather than hand-code a fragile model per schema, the SDK gives you the
**structured element tree** (attributes + children + text, entity-safe), which is:
- **lossless** (round-trips), **traversable/editable** (walk `children`, set `attrs`, add nodes), and
- **enough to generate alternatives** — your engine emits the tree it wants and `buildAsset` writes it.
Author the canonical files in Business Central once to learn the shape, then generate variants.

## Two layers, your choice
- **Verbatim** (`descriptor.files`): exact bytes, zero interpretation — safest for hand-authored assets.
- **Structured** (`parseAsset`/`buildAsset`): a JSON model your engine generates/edits, then serialize
  and place the result into `descriptor.files` for `writeProject`.

```ts
// generate an asset from your engine's model, then package it
const drl = buildAsset({ kind: 'drl', model: { package:'com.acme', imports:['com.acme.Claim'],
  globals:[], rules:[{ name:'r', attributes:['ruleflow-group "g"'], when:'$c: Claim()', then:'…' }] } });
project.descriptor.files['src/main/resources/com/acme/g.drl'] = drl;
```

## Honest limits
- **DRL / Java** models are **best-effort** (regex-based): they capture package/imports/rules and
  fields, and rebuild valid files, but complex DRL (accumulate, eval, complex LHS) or rich Java
  (annotations, methods) won't be fully modeled — for those, keep the file verbatim.
- The XML tree is **structural, not schema-typed** — it won't validate against the DMN/GDST schema;
  Business Central / the `kie-maven-plugin` do that at build.
- Spreadsheet decision tables & score cards (`.xls`/`.xlsx`) are **binary** — not covered.
