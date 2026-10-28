# Guided Score Card — model (jBPM-side / escape hatch)

> The `ScoreCardModel` `.scgd` XML the SDK **produces** from an engine scorecard
> ([scenarios.md §0](scenarios.md)) — best-effort (well-formed; BC-load not verified) — and `parseAsset`
> recovers. Author `scorecards: [{ fact, score, baseline?, characteristics }]`; hand-build this XML only
> for a scorecard you carry verbatim.

`kind: "scoreCard"` uses the **generic XML tree** model (lossless, entity-safe, round-trip-stable):

```jsonc
{ "kind": "scoreCard", "model": { "xml": <ElementNode> } }
```
`ElementNode` (recursive):
| Field | Type | Meaning |
|-------|------|---------|
| `name` | string | element tag (namespaced kept verbatim, e.g. `scoreCard`) |
| `attrs` | object | attributes (values entity-decoded) |
| `children` | ElementNode[] | child elements (traverse/edit/add) |
| `text` | string | text content (entity-decoded) |
| `cdata` | string[] | CDATA sections (verbatim) |

Build serialises the tree back to XML (prepends the `<?xml?>` prolog). Not schema-validated —
Business Central / `kie-maven-plugin` validate at build.
