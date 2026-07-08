# Enumeration — usage guide

## 1. Details
Extension `.enumeration`, SDK asset `kind: "enumeration"`. Allowed values per data-object field — the
source of dropdown options. Two layers:
- **Engine enums** (nodejs-native) — `[{ type, field, values }]`. **This is what you author.** See
  **[scenarios.md §0](scenarios.md)**.
- **`Record<'Type.field', string[]>`** (jBPM-side) — the `.enumeration` map the SDK produces. See
  **[model.md](model.md)**.

## 2. Usage
Read wherever a field needs a picklist: **form** dropdowns, **guided decision table** cells, the data
modeler. Business Central links a dropdown to the enumeration by the `Type.field` name.

## 3. How / when to use
**Author engine enums** (recommended): put `enumerations: [{ type, field, values }]` on your
`EngineProject`. `fromEngineProject` writes a single `src/main/resources/enumerations.enumeration`
(`'Type.field' : [ 'A', 'B' ]`). Use `"KEY=Label"` for a display label (shows the label, stores KEY).

- `parseAsset("e.enumeration", text)` → `{ kind:"enumeration", model:{ enums } }`.
- `buildAsset({ kind:"enumeration", model:{ enums } })` → the `.enumeration` file.
- **Runtime**: `../../../bpmn-sdk/examples/functions/enumeration.mjs` — `optionsFor` / `labeledOptionsFor`
  (dropdown options) and `isAllowed` (validate a value).

## 4. Tested
`../../../bpmn-sdk/test/enumeration.test.mjs` (conversion, generated file, round-trip) +
`../../../bpmn-sdk/test/enumeration-runtime.test.mjs`. Example: `../../../bpmn-sdk/examples/enumerations/`.
