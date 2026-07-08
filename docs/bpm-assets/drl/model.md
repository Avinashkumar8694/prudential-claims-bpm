# DRL — model

```jsonc
{ "kind": "drl", "model": {
    "package": "com.acme.rules",
    "imports": ["com.acme.model.Claim"],
    "globals": [],
    "rules": [ { "name": "…", "attributes": ["ruleflow-group \"classify\""], "when": "…", "then": "…" } ]
} }
```
| Field | Meaning |
|-------|---------|
| package | rule package (`package X;`) |
| imports[] | `import …;` |
| globals[] | `global …;` |
| rules[].name | rule name |
| rules[].attributes[] | attribute lines (`ruleflow-group "g"`, `salience 10`, `no-loop`, …) |
| rules[].when / .then | LHS / RHS bodies (raw text) |
