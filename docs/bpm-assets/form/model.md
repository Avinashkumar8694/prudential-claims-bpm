# Form — model (jBPM-side / escape hatch)

> The form definition the SDK **produces** from an engine form ([scenarios.md §0](scenarios.md)) and
> `parseForm` recovers. Author the engine form (`type` + bound `fields`, widgets derived) — write this
> raw form only for one you carry verbatim.

```jsonc
// JSON form (.frm)
{ "kind": "form", "model": { "json": { "id": "review-form", "name": "review",
    "model": { "className": "com.acme.model.Claim" },
    "fields": [ { "id": "amount", "code": "DoubleBox", "binding": "amount" } ] } } }
// XML form (.form) -> { "kind":"form", "model": { "xml": <ElementNode> } }
```
