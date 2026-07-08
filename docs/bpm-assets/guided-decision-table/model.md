# Guided Decision Table — model (jBPM-side / escape hatch)

> The `decision-table52` XML tree the SDK **produces** from an engine guided table
> ([scenarios.md §0](scenarios.md)) and `parseAsset` recovers from an existing `.gdst`. Author the
> engine table (fact + conditions + actions + rows) — hand-build this tree only for a guided table you
> carry verbatim.

`kind: "guidedDecisionTable"` uses the **generic XML tree** model (lossless, entity-safe, round-trip-stable):

```jsonc
{ "kind": "guidedDecisionTable", "model": { "xml": <ElementNode> } }
```
`ElementNode` (recursive):
| Field | Type | Meaning |
|-------|------|---------|
| `name` | string | element tag (namespaced kept verbatim, e.g. `decision-table52`) |
| `attrs` | object | attributes (values entity-decoded) |
| `children` | ElementNode[] | child elements (traverse/edit/add) |
| `text` | string | text content (entity-decoded) |
| `cdata` | string[] | CDATA sections (verbatim) |

Build serialises the tree back to XML (prepends the `<?xml?>` prolog). Not schema-validated —
Business Central / `kie-maven-plugin` validate at build.
