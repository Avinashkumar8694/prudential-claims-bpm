# examples/functions — reusable helper modules

Small, category-wise modules shared across the examples so each example stays focused on *what it
demonstrates*, not boilerplate. Import them from any example with `../functions/<module>.mjs`.

| Module | Exports | Used by |
|--------|---------|---------|
| [`rule-engine.mjs`](rule-engine.mjs) | `run`, `match`, `OPS` — the reference runtime rule engine (match → resolve → act, property reactivity, `noLoop`). Pure JS, no SDK dependency. | `rules-runtime/08`, `rules-runtime/09` |
| [`dmn-engine.mjs`](dmn-engine.mjs) | `evaluateDecision`, `evaluateModel`, `testMatch` — the reference DMN decision-table evaluator (match rows → hit policy → outputs). Pure JS. | `decisions/11` |
| [`data-object.mjs`](data-object.mjs) | `instantiate`, `validate` — use an engine TYPE as a runtime schema over plain objects (default instance; field JS-type check). Pure JS. | `data-objects/12` |
| [`guided-table.mjs`](guided-table.mjs) | `evaluateGuidedTable` — apply a guided decision table (tabular ruleset) to a fact: match rows → apply set-actions (later overrides). Pure JS. | `guided/13` |
| [`form.mjs`](form.mjs) | `renderModel`, `validateSubmission` — use an engine FORM at runtime: build a UI render model (widgets derived from the type) and validate a submission. Pure JS. | `forms/14` |
| [`io.mjs`](io.mjs) | `isMain(metaUrl)` (run-guard), `outDir(metaUrl, name)` (default output dir) | all project-export examples (01–07) |
| [`report.mjs`](report.mjs) | `printFacts(label, facts, type?)`, `printTrace(trace, label?)`, `printWritten(label, dir, written)` | 01/02/04/05, 08, 09 |

These are example utilities, not part of the published SDK API. `rule-engine.mjs` is the one you'd
lift into your own Node engine — it executes the same engine-ruleset JSON the SDK compiles to DRL.
