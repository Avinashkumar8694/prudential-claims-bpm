# Guided Rule Template — model (jBPM-side / escape hatch)

> The `TemplateModel` `.template` XML the SDK **produces** from an engine template
> ([scenarios.md §0](scenarios.md)) — best-effort (well-formed; BC-load not verified) — and `parseAsset`
> recovers. Author `guidedRuleTemplates: [{ name, when, then, rows }]`; hand-build this XML only for a
> template you carry verbatim.

`kind: "guidedRuleTemplate"` uses the **generic XML tree** model (lossless, entity-safe, round-trip-stable):

```jsonc
{ "kind": "guidedRuleTemplate", "model": { "xml": <ElementNode> } }
```
`ElementNode` (recursive):
| Field | Type | Meaning |
|-------|------|---------|
| `name` | string | element tag (namespaced kept verbatim, e.g. `templateModel`) |
| `attrs` | object | attributes (values entity-decoded) |
| `children` | ElementNode[] | child elements (traverse/edit/add) |
| `text` | string | text content (entity-decoded) |
| `cdata` | string[] | CDATA sections (verbatim) |

Build serialises the tree back to XML (prepends the `<?xml?>` prolog). Not schema-validated —
Business Central / `kie-maven-plugin` validate at build.
