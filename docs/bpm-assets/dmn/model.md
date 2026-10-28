# DMN Decision — model (jBPM-side / escape hatch)

> This is the **jBPM-side** representation the SDK *produces* from the engine decision table
> ([scenarios.md §0](scenarios.md)), and the **escape hatch** for hand-authored DMN the table can't
> express (DRD graphs, boxed expressions, contexts, FEEL functions). To author a decision table, write
> the engine model in §0 — you rarely hand-build this tree.

`kind: "dmn"` uses the **generic XML tree** model (lossless, entity-safe, round-trip-stable):

```jsonc
{ "kind": "dmn", "model": { "xml": <ElementNode> } }
```
`ElementNode` (recursive):
| Field | Type | Meaning |
|-------|------|---------|
| `name` | string | element tag (namespaced kept verbatim, e.g. `definitions`) |
| `attrs` | object | attributes (values entity-decoded) |
| `children` | ElementNode[] | child elements (traverse/edit/add) |
| `text` | string | text content (entity-decoded) |
| `cdata` | string[] | CDATA sections (verbatim) |

Build serialises the tree back to XML (prepends the `<?xml?>` prolog). Not schema-validated —
Business Central / `kie-maven-plugin` validate at build.
