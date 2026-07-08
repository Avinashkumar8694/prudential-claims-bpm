# Form — usage guide

## 1. Details
Extension `.frm` (JSON) or `.form` (XML), SDK asset `kind: "form"`. UI for a user task. Two layers:
- **Engine form** (nodejs-native) — `{ name, type, fields:[{ bind, label?, widget?, … }] }`; widget
  derived from the bound type's field types. **This is what you author.** See **[scenarios.md §0](scenarios.md)**.
- **jBPM `.frm` JSON** (jBPM-side) — the form definition the SDK produces. See **[model.md](model.md)**.

## 2. Usage
Referenced by a user task (form binding). An engine `userTask` node with `form: "<name>"` wires the
task to the generated form (see `../../bpm-nodes/user-task/`).

## 3. How / when to use
**Author the engine form** (recommended): put `forms: [{ name, type, fields }]` on your
`EngineProject`. `fromEngineProject` runs `formToFrm` — resolves `type` → `model.className`, derives
each field's widget `code` from the bound type's field type (or your explicit `widget`), defaults
labels — and writes `src/main/resources/forms/<name>.frm`.

- `parseAsset("f.frm", text)` → `{ kind:"form", model:{ json } }` (or `{ xml }` for `.form`).
- `buildAsset({ kind:"form", model })` → the form file. Use the raw `{ json }`/`{ xml }` form only for
  a hand-authored form.
- **Runtime**: `../../../bpmn-sdk/examples/functions/form.mjs` — `renderModel(form, type)` (UI model
  with resolved widgets/labels) and `validateSubmission(form, data)` (required-field check).

> The SDK verifies the JSON is valid, not that Business Central will load it.

## 4. Tested
`../../../bpmn-sdk/test/form.test.mjs` (widget derivation + override, className resolution, flags,
default path, codec round-trip) + `../../../bpmn-sdk/test/form-runtime.test.mjs`. Example:
`../../../bpmn-sdk/examples/forms/`.
