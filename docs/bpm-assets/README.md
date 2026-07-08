# BPM Assets — structured-JSON codec reference

Per-asset docs for the SDK's `parseAsset` / `buildAsset` codecs (structured JSON your engine can
generate/edit, then serialize back to the file format). Same folder style as `../bpm-nodes/`:
each asset has `usage_guide.md`, `model.md` (the JSON model), and `model.json` (a sample).

See also: `../bpm-project/structured-assets.md` (overview) · `../bpm-project/asset-types.md`
(what each asset is + how it ties to a process) · `../../bpmn-sdk/examples/06-generate-assets.mjs`.

## Catalogue
| Folder | Ext | kind | Model |
|--------|-----|------|-------|
| `drl` | `.drl` | `drl` | typed (package/imports/globals/rules) |
| `dmn` | `.dmn` | `dmn` | generic XML tree |
| `dsl` | `.dsl` | `dsl` | typed (entries) |
| `enumeration` | `.enumeration` | `enumeration` | typed (enums map) |
| `guided-decision-table` | `.gdst` | `guidedDecisionTable` | generic XML tree |
| `guided-decision-tree` | `.gdt` | `guidedDecisionTree` | generic XML tree |
| `guided-rule` | `.rdrl`/`.rdslr` | `guidedRule` | generic XML tree |
| `guided-rule-template` | `.template` | `guidedRuleTemplate` | generic XML tree |
| `score-card` | `.scgd` | `scoreCard` | generic XML tree |
| `test-scenario` | `.scesim` | `testScenario` | generic XML tree |
| `test-scenario-legacy` | `.scenario` | `testScenarioLegacy` | generic XML tree |
| `solver` | `*.solver.xml` | `solver` | generic XML tree |
| `xml-generic` | `.xml` | `xml` | generic XML tree |
| `form` | `.frm`/`.form` | `form` | JSON or XML tree |
| `data-object` | `.java` | `dataObject` | typed (package/class/fields) |
| `work-item-definition` | `.wid` | `workItemDefinition` | typed (definitions) |
| `properties` | `.properties` | `properties` | typed (key/value) |

All codecs are round-trip stable (`buildAsset` idempotent, re-parses to the same model). DRL/Java
are best-effort; the generic XML tree is lossless but not schema-validated.
