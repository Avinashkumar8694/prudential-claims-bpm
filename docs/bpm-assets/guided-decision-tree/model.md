# Guided Decision Tree — model (jBPM-side / escape hatch)

> The `GuidedDecisionTree` XML the SDK **produces** from an engine tree
> ([scenarios.md §0](scenarios.md)) — best-effort (well-formed; BC-load not verified) — and `parseAsset`
> recovers. Author the engine tree (`fact` + recursive `root`); hand-build this XML only for a tree you
> carry verbatim.

`kind: "guidedDecisionTree"` uses the **generic XML tree** model (lossless, entity-safe, round-trip-stable):

```jsonc
{ "kind": "guidedDecisionTree", "model": { "xml": <ElementNode> } }
```
`ElementNode` (recursive):
| Field | Type | Meaning |
|-------|------|---------|
| `name` | string | element tag (namespaced kept verbatim, e.g. `GuidedDecisionTree`) |
| `attrs` | object | attributes (values entity-decoded) |
| `children` | ElementNode[] | child elements (traverse/edit/add) |
| `text` | string | text content (entity-decoded) |
| `cdata` | string[] | CDATA sections (verbatim) |

Build serialises the tree back to XML (prepends the `<?xml?>` prolog). Not schema-validated —
Business Central / `kie-maven-plugin` validate at build.
