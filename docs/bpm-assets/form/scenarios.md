# Form — every scenario (engine form → jBPM `.frm`)

A form is the **UI for a user task**: it edits the fields of a data object. In the engine model you
write a form that references a `type` and lists which of its fields to show; the widget for each field
is **derived from that field's type** (a `string` → text box, a `number` → numeric box, …), exactly
like guided-table columns. The SDK generates the Business Central form definition (`.frm` JSON).

## Two layers — which one to write
1. **Engine form (nodejs-native)** — §0 below. `{ name, type, fields:[{ bind, label?, widget?, … }] }`.
   No form JSON, no widget codes, no className. **This is what you author.**
2. **jBPM `.frm` JSON / `.form` XML (jBPM-side)** — [model.md](model.md). The form definition the SDK
   **produces** (and `parseForm` recovers). The escape hatch for a hand-authored form.

Everything here is tested in [`../../../bpmn-sdk/test/form.test.mjs`](../../../bpmn-sdk/test/form.test.mjs).

---

## 0. Engine form — the simple form (what you write)
```jsonc
// an EngineProject holds: { "types": [ … ], "forms": [ <form> ], "processes": [ … ] }
{
  "types": [                       // Claim is defined ONCE (same as everywhere)
    { "name": "Claim", "fields": [
      { "name": "amount", "type": "double" }, { "name": "status", "type": "string" },
      { "name": "urgent", "type": "boolean" } ] }
  ],
  "forms": [{
    "name": "ClaimReview",
    "type": "Claim",               // the data object this form edits (-> className FQN)
    "fields": [                    // which of Claim's fields to show; widget derived from each field's type
      { "bind": "amount", "label": "Claim amount", "readOnly": true },
      { "bind": "status", "label": "Status", "required": true },
      { "bind": "urgent" }
    ]
  }]
}
```
generates `src/main/resources/forms/ClaimReview.frm`:
```json
{
  "id": "ClaimReview", "name": "ClaimReview",
  "model": { "name": "ClaimReview", "className": "com.acme.model.Claim" },
  "fields": [
    { "id": "amount", "binding": "amount", "label": "Claim amount", "code": "DoubleBox", "readOnly": true },
    { "id": "status", "binding": "status", "label": "Status", "code": "TextBox", "required": true },
    { "id": "urgent", "binding": "urgent", "label": "Urgent", "code": "CheckBox" }
  ]
}
```
`amount` (double) → `DoubleBox`, `status` (string) → `TextBox`, `urgent` (boolean) → `CheckBox` — all
**derived** from the `Claim` field types; `label` defaults to the humanized field name.

### Complete field reference
```jsonc
{
  "name":   "ClaimReview",         // required. form id/name (+ default .frm file name)
  "type":   "Claim",               // optional but recommended. data object edited -> model.className (FQN);
                                   //   also drives widget derivation. Omit for a form with no bound model.
  "path":   "src/main/resources/forms/ClaimReview.frm",  // optional. default src/main/resources/forms/<name>.frm
  "fields": [{
    "bind":        "amount",       // required. the model field this input edits (-> binding + id)
    "label":       "Claim amount", // optional. default = humanized `bind`
    "widget":      "number",       // optional. default derived from the field's type (see tables)
    "required":    true,           // optional
    "readOnly":    true,           // optional
    "placeholder": "e.g. 5000"     // optional
  }]
}
```

### `widget` — friendly name → jBPM field `code`
| `widget` | jBPM `code` |
|----------|-------------|
| `text` | `TextBox` |
| `textarea` | `TextArea` |
| `integer` | `IntegerBox` |
| `number` / `decimal` | `DoubleBox` |
| `checkbox` / `boolean` | `CheckBox` |
| `dropdown` / `select` | `ListBox` |
| `radio` | `RadioGroup` |
| `date` | `DatePicker` |

### Widget **derived** from the bound field's `type` (when `widget` omitted)
| field `type` | derived `code` |
|--------------|----------------|
| `string` | `TextBox` |
| `int` / `integer` / `long` | `IntegerBox` |
| `double` / `float` / `number` | `DoubleBox` |
| `bool` / `boolean` | `CheckBox` |
| `date` | `DatePicker` |
| (unknown) | `TextBox` |

So you normally write just `{ "bind": "amount" }`; set `widget` only to override (e.g. a `string`
field you want as a `dropdown`).

### Wiring the form to a user task
A `userTask` node references the form by name — the SDK sets the task's form binding:
```jsonc
{ "type": "userTask", "name": "Review claim", "group": "ClaimsExaminer", "form": "ClaimReview" }
```

### How a Node engine uses a form at runtime
A form is **UI metadata** — your engine renders it and validates input. The reference helper
[`../../../bpmn-sdk/examples/functions/form.mjs`](../../../bpmn-sdk/examples/functions/form.mjs) turns
a form + its type into a **render model** (`renderModel(form, type)` → `[{ bind, label, widget,
required, readOnly }]` with widgets resolved) and validates submitted data
(`validateSubmission(form, data)` → missing-required errors).

---

The jBPM-side `.frm` this produces is in [model.json](model.json) / [model.md](model.md); the tested
example is `../../../bpmn-sdk/examples/forms/`.
