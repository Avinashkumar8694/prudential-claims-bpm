# Test Scenario (new) — model (jBPM-side / escape hatch)

> The `ScenarioSimulationModel` `.scesim` XML the SDK **produces** from an engine test suite
> ([scenarios.md §0](scenarios.md)) — best-effort (well-formed; BC-load not verified) — and `parseAsset`
> recovers. Author `tests: [{ target, cases: [{ given, expect }] }]`; the cases also **run in Node**.

`kind: "testScenario"` uses the **generic XML tree** model (lossless, entity-safe, round-trip-stable):

```jsonc
{ "kind": "testScenario", "model": { "xml": <ElementNode> } }
```
`ElementNode` (recursive):
| Field | Type | Meaning |
|-------|------|---------|
| `name` | string | element tag (namespaced kept verbatim, e.g. `ScenarioSimulationModel`) |
| `attrs` | object | attributes (values entity-decoded) |
| `children` | ElementNode[] | child elements (traverse/edit/add) |
| `text` | string | text content (entity-decoded) |
| `cdata` | string[] | CDATA sections (verbatim) |

Build serialises the tree back to XML (prepends the `<?xml?>` prolog). Not schema-validated —
Business Central / `kie-maven-plugin` validate at build.
