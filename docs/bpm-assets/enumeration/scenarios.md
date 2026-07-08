# Enumeration — every scenario (engine enums → jBPM `.enumeration`)

An enumeration is a set of **allowed values for a data-object field** — the source of a dropdown's
options. It's what turns a free-text `status` into a picklist (`NEW`, `OPEN`, `APPROVED`, …). Forms,
guided decision tables, and the Business Central data modeler all read enumerations to render dropdowns
and constrain values.

## Two layers — which one to write
1. **Engine enums (nodejs-native)** — §0 below. A list of `{ type, field, values }`. No `'Fact.field'`
   string keys, no quoting. **This is what you author.**
2. **`Record<'Type.field', string[]>` (jBPM-side)** — [model.md](model.md). The `.enumeration` map the
   SDK **produces** and `parseEnumeration` recovers.

Everything here is tested in [`../../../bpmn-sdk/test/enumeration.test.mjs`](../../../bpmn-sdk/test/enumeration.test.mjs).

---

## 0. Engine enums — the simple form (what you write)
```jsonc
// an EngineProject holds: { "types": [ … ], "enumerations": [ … ], "forms": [ … ], "processes": [ … ] }
{
  "enumerations": [
    { "type": "Claim", "field": "status", "values": ["NEW", "OPEN", "APPROVED", "REJECTED"] },
    { "type": "Claim", "field": "type",   "values": ["DEATH", "TI"] }
  ]
}
```
generates `src/main/resources/enumerations.enumeration`:
```drl
'Claim.status' : ['NEW', 'OPEN', 'APPROVED', 'REJECTED']
'Claim.type' : ['DEATH', 'TI']
```
Each entry keys a **type + field** to its allowed `values`; the SDK builds the `'Type.field' : [ … ]`
lines (quoting handled for you).

### Complete field reference
```jsonc
{
  "enumerations": [{
    "type":   "Claim",       // required. the data object (a declared type name)
    "field":  "status",      // required. the field these values constrain
    "values": ["NEW", "OPEN"]// required. allowed values (strings; use "KEY=Label" for a display label)
  }]
}
```
| Field | Meaning | Maps to |
|-------|---------|---------|
| `type` + `field` | which data-object field | the `'Type.field'` key |
| `values[]` | the allowed options | the `[ '…', '…' ]` list |

**Display labels:** a value `"NEW=New claim"` shows "New claim" in the dropdown but stores `NEW` —
Business Central's `'key=label'` convention, passed through as-is.

### How it's used (the pairing)
- **Forms** — a form field bound to `Claim.status` renders as a **dropdown** whose options are this
  enumeration (Business Central links a `ListBox` to the enum by the `Type.field` name).
- **Guided decision tables** — a condition/action cell on `Claim.status` offers these as a picklist.
- **Data modeler** — constrains the field's values in the UI.

### How a Node engine uses enums at runtime
Populate dropdowns and validate input. Reference helper
[`../../../bpmn-sdk/examples/functions/enumeration.mjs`](../../../bpmn-sdk/examples/functions/enumeration.mjs):
- `optionsFor(enums, "Claim", "status")` → `["NEW","OPEN","APPROVED","REJECTED"]` (the dropdown options);
- `isAllowed(enums, "Claim", "status", value)` → `true/false` (validate a submitted value).

---

The jBPM-side `.enumeration` map is in [model.json](model.json) / [model.md](model.md); the tested
example is `../../../bpmn-sdk/examples/enumerations/`.
