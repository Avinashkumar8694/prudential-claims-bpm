# Data Object — model

```jsonc
{ "kind": "dataObject", "model": { "package": "com.acme.model", "className": "Claim",
    "fields": [ { "name": "id", "type": "String" }, { "name": "amount", "type": "double" } ] } }
```
`buildAsset` emits `package …;`, the class, `private <type> <name>;` fields, and get/set accessors.
