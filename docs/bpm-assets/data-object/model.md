# Data Object — model (jBPM-side / escape hatch)

> The `{ package, className, fields }` the SDK **produces** from an engine type
> ([scenarios.md §0](scenarios.md)) and `parseDataObject` recovers from a hand-written `.java`. Author
> engine **types** (name + fields, no Java) — write this jBPM-side form only for a class you carry
> verbatim. `fields[].type` here is the **Java** type (e.g. `String`, `double`,
> `java.util.List<com.acme.model.LineItem>`), not the engine primitive.

```jsonc
{ "kind": "dataObject", "model": { "package": "com.acme.model", "className": "Claim",
    "fields": [ { "name": "id", "type": "String" }, { "name": "amount", "type": "double" } ] } }
```
`buildAsset` emits `package …;`, the class, `private <type> <name>;` fields, and get/set accessors.
