# examples/functions — reusable helper modules

Small, category-wise modules shared across the examples so each example stays focused on *what it
demonstrates*, not boilerplate. Import them from any example with `../functions/<module>.mjs`.

| Module | Exports | Used by |
|--------|---------|---------|
| [`rule-engine.mjs`](rule-engine.mjs) | `run`, `match`, `OPS` — the reference runtime rule engine (match → resolve → act, property reactivity, `noLoop`). Pure JS, no SDK dependency. | `rules-runtime/08`, `rules-runtime/09` |
| [`dmn-engine.mjs`](dmn-engine.mjs) | `evaluateDecision`, `evaluateModel`, `testMatch` — the reference DMN decision-table evaluator (match rows → hit policy → outputs). Pure JS. | `decisions/11` |
| [`data-object.mjs`](data-object.mjs) | `instantiate`, `validate` — use an engine TYPE as a runtime schema over plain objects (default instance; field JS-type check). Pure JS. | `data-objects/12` |
| [`guided-table.mjs`](guided-table.mjs) | `evaluateGuidedTable` — apply a guided decision table (tabular ruleset) to a fact: match rows → apply set-actions (later overrides). Pure JS. | `guided/13` |
| [`decision-tree.mjs`](decision-tree.mjs) | `evaluateDecisionTree` — walk a guided decision tree over a fact: first matching branch per node → leaf actions or recurse. Pure JS. | `guided/17` |
| [`rule-template.mjs`](rule-template.mjs) | `expandTemplate` — expand a guided rule template (skeleton + rows) into concrete rules (`{param}` substitution) for the rule engine. Pure JS. | `guided/19` |
| [`properties.mjs`](properties.mjs) | `resolve`, `labelsFor` — resolve i18n labels from engine `messages` by locale, with fallback to `default`. Pure JS. | `project-assets/16` |
| [`scorecard.mjs`](scorecard.mjs) | `evaluateScorecard` — additive scoring: baseline + first matching band's points per characteristic → the score field. Pure JS. | `guided/20` |
| [`test-scenario.mjs`](test-scenario.mjs) | `runScenarios`, `assertScenarios` — run engine test cases (given/expect) against any evaluator; real pass/fail in Node. Pure JS. | `tests/21` |
| [`form.mjs`](form.mjs) | `renderModel`, `validateSubmission` — use an engine FORM at runtime: build a UI render model (widgets derived from the type) and validate a submission. Pure JS. | `forms/14` |
| [`enumeration.mjs`](enumeration.mjs) | `optionsFor`, `labeledOptionsFor`, `isAllowed` — dropdown options + value validation from engine enums (`"KEY=Label"` aware). Pure JS. | `enumerations/15` |
| [`io.mjs`](io.mjs) | `isMain(metaUrl)` (run-guard), `outDir(metaUrl, name)` (default output dir) | all project-export examples (01–07) |
| [`report.mjs`](report.mjs) | `printFacts(label, facts, type?)`, `printTrace(trace, label?)`, `printWritten(label, dir, written)` | 01/02/04/05, 08, 09 |

These are example utilities, not part of the published SDK API. `rule-engine.mjs` is the one you'd
lift into your own Node engine — it executes the same engine-ruleset JSON the SDK compiles to DRL.
