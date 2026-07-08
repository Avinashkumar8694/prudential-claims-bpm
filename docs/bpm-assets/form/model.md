# Form — model
```jsonc
// JSON form (.frm)
{ "kind": "form", "model": { "json": { "id": "review-form", "name": "review",
    "model": { "className": "com.acme.model.Claim" },
    "fields": [ { "id": "amount", "code": "DoubleBox", "binding": "amount" } ] } } }
// XML form (.form) -> { "kind":"form", "model": { "xml": <ElementNode> } }
```
