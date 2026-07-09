# Properties — model (jBPM-side)

> The per-file `{ props }` model the SDK **produces** from engine `properties`
> ([scenarios.md §0](scenarios.md)). Author `properties: { <path>: { key: value } }`.
```jsonc
{ "kind": "properties", "model": { "props": { "review.title": "Review claim", "review.amount": "Claim amount" } } }
```
Lines `key=value` (or `key:value`); `#`/`!` comments ignored on parse.
