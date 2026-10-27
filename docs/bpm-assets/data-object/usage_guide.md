# Data Object (Java POJO) — usage guide

## 1. Details
Extension `.java`, SDK asset `kind: "dataObject"`. A fact/data type. Two representations, like DRL/DMN:
- **Engine type** (nodejs-native) — a schema: `{ name, fields:[{ name, type, list? }] }`. No Java, no
  package, no getters. You reference it **by name** everywhere. **This is what you author.** See
  **[scenarios.md §0](scenarios.md)**.
- **`DataObjectModel`** (jBPM-side) — `{ package, className, fields }` the SDK produces and
  `parseDataObject` recovers from a hand-written `.java`. See **[model.md](model.md)**.

## 2. Usage
Referenced as a process-variable `type`, a DRL rule `fact`, a DMN input type, and a form `className`
— always **by name**; the SDK resolves it to a Java FQN and generates the POJO.

## 3. How / when to use
**Author engine types** (recommended): put `types: [{ name, fields }]` on your `EngineProject`.
`fromEngineProject` generates a `.java` POJO per type (getters/setters), defaults the package to
`<process package>.model`, maps field types to Java (incl. nested declared types and `list: true` →
`java.util.List<…>`), and resolves the name to an FQN wherever jBPM needs one.

- `parseAsset("Claim.java", src)` → `{ kind:"dataObject", model:{ package, className, fields } }`.
- `buildAsset({ kind:"dataObject", model })` regenerates the POJO. Use this jBPM-side form only for a
  hand-written class you carry verbatim.
- **Runtime** (schema over plain objects):
  `../../../bpmn-sdk/examples/functions/data-object.mjs` — `instantiate(type)` (defaults) and
  `validate(type, obj)` (field JS-type check).

## 4. Tested
`../../../bpmn-sdk/test/data-object.test.mjs` (every field-type mapping, nested, typed collections,
default package, codec round-trip) + `../../../bpmn-sdk/test/data-object-runtime.test.mjs`. Example:
`../../../bpmn-sdk/examples/data-objects/`.
