# Guided Rule — model (jBPM-side / escape hatch)

> The `RuleModel` `.rdrl` XML the SDK **produces** from an engine guided rule
> ([scenarios.md §0](scenarios.md)) — best-effort (well-formed; BC-load not verified) — and `parseAsset`
> recovers. Author `guidedRules: [{ name, when, then }]` (same as a DRL ruleset rule); hand-build this
> XML only for a rule you carry verbatim.

`kind: "guidedRule"` uses the **generic XML tree** model (lossless, entity-safe, round-trip-stable):

```jsonc
{ "kind": "guidedRule", "model": { "xml": <ElementNode> } }
```
`ElementNode` (recursive):
| Field | Type | Meaning |
|-------|------|---------|
| `name` | string | element tag (namespaced kept verbatim, e.g. `rule`) |
| `attrs` | object | attributes (values entity-decoded) |
| `children` | ElementNode[] | child elements (traverse/edit/add) |
| `text` | string | text content (entity-decoded) |
| `cdata` | string[] | CDATA sections (verbatim) |

Build serialises the tree back to XML (prepends the `<?xml?>` prolog). Not schema-validated —
Business Central / `kie-maven-plugin` validate at build.
