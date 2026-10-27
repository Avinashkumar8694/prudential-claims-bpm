# DSL — model (jBPM-side)

> The `.dsl` model the SDK **produces** from engine `dsl` ([scenarios.md §0](scenarios.md)).
> Author `dsl: [{ scope, nl, mapping }]` — this is the generated `[scope]phrase=mapping` form.
```jsonc
{ "kind": "dsl", "model": { "entries": [
  { "scope": "when", "nl": "There is a claim over {amount}", "mapping": "$c : Claim( amount > {amount} )" },
  { "scope": "then", "nl": "Set claim status to {status}",   "mapping": "modify( $c ) { setStatus( \"{status}\" ) };" } ] } }
```
`scope` ∈ `when` | `then` | `*` | `keyword`.
