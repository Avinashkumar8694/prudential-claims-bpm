# Enumeration — model (jBPM-side / escape hatch)

> The `Record<'Type.field', string[]>` map the SDK **produces** from engine enums
> ([scenarios.md §0](scenarios.md)) and `parseEnumeration` recovers. Author `enumerations:
> [{ type, field, values }]` — write this raw map only for a file you carry verbatim.

```jsonc
{ "kind": "enumeration", "model": { "enums": { "Claim.status": ["NEW","REVIEW","HIGH","STANDARD","DONE"], "Claim.type": ["DEATH","TI"] } } }
```
Each entry serialises to `'Fact.field' : [ 'A', 'B' ]`.
