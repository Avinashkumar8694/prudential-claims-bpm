# Business Central asset types — full list & SDK handling

Every asset the Business Central "Add Asset" palette can create, and how this SDK treats it.

## Scope in one line
The SDK **natively models Business Processes (BPMN)**. Every other asset is an authored
Drools / DMN / OptaPlanner artifact — the SDK **carries it verbatim** inside the kjar via
`descriptor.files` (text assets are auto-captured on parse and re-written on export). It does **not**
generate the internal content of rules/decisions/score-cards/etc. — that is Drools/DMN authoring,
outside a BPMN SDK's job, and the engine (`kie-maven-plugin`) compiles those files at build time.

Legend — **SDK**: `modeled` (first-class JSON model) · `verbatim` (carried in `descriptor.files`) ·
`binary` (spreadsheet — copy the file into the project yourself, not text-captured).

| Asset (palette) | Category | Extension | Purpose | SDK |
|-----------------|----------|-----------|---------|-----|
| **Business Process** | Process | `.bpmn` | executable workflow | **modeled** (`ProcessModel`) |
| Data Object | Model | `.java` | custom fact / data type (POJO) | verbatim; use its FQN as a variable `type` |
| Decision Table (Spreadsheet) | Decision | `.xls` / `.xlsx` | rules as a spreadsheet | **binary** |
| DMN | Decision | `.dmn` | DMN decision model | verbatim; call via `businessRuleTask` (DMN impl) |
| DRL file | Decision | `.drl` | Drools rules | verbatim; call via `businessRuleTask` `ruleFlowGroup` |
| DSL definition | Decision | `.dsl` | domain-specific rule language | verbatim |
| Enumeration | Model | `.enumeration` | value lists for guided editors | verbatim |
| Form | Form | `.frm` / `.form` | task / process forms | verbatim; referenced by user tasks |
| Global Variable(s) | Decision | (kmodule / rules) | globals shared with rules | via `kmodule.xml` / rules — not a standalone file |
| Guided Decision Table | Decision | `.gdst` | table-authored rules | verbatim |
| Guided Decision Table Graph | Decision | `.gdst` (+graph) | linked decision tables | verbatim |
| Guided Decision Tree | Decision | `.gdt` | tree-authored rules | verbatim |
| Guided Rule | Decision | `.rdrl` / `.rdslr` | guided single rule | verbatim |
| Guided Rule Template | Decision | `.template` | parameterised rule template | verbatim |
| Guided Score Card | Decision | `.scgd` | scorecard model | verbatim |
| Package | Others | (namespace) | groups assets | n/a — set `packageName` on the process |
| Score Card (Spreadsheet) | Decision | `.sxls` / `.xls` | scorecard as spreadsheet | **binary** |
| Solver configuration | Optimization | `*.solver.xml` | OptaPlanner solver config | verbatim |
| Test Scenario | Decision | `.scesim` | rule/decision test scenarios | verbatim |
| Test Scenario (Legacy) | Decision | `.scenario` | legacy test scenarios | verbatim |
| Work Item definition | Others | `.wid` | work-item palette definitions | **modeled** (`descriptor.workDefinitions`) + verbatim |

## How to include an asset in an SDK-built project
Text assets are round-tripped automatically. To add one from scratch, put it in `descriptor.files`
keyed by its path in the kjar:
```jsonc
"descriptor": {
  "files": {
    "src/main/resources/com/acme/rules/validate.drl": "package com.acme.rules;\nrule \"r\" ruleflow-group \"validate\" when then end\n",
    "src/main/resources/com/acme/Eligibility.dmn": "<definitions …>…</definitions>",
    "src/main/java/com/acme/Claim.java": "package com.acme;\npublic class Claim { public double amount; }",
    "src/main/resources/forms/review.frm": "<form …/>"
  }
}
```
`writeProject` writes every entry verbatim; `parseProject` re-captures them. Binary spreadsheets
(`.xls`/`.xlsx`) are not text-safe — copy those files into the output project directly.

## What ties assets to the process
- **DRL / DMN / Guided rules & tables / Score cards** → invoked by a **`businessRuleTask`**
  (`ruleFlowGroup` for DRL, DMN metadata for DMN). See `rules-drl-and-dmn.md`.
- **Data Object (`.java`)** → referenced as a process-variable `type` (FQN) and as rule facts.
- **Form** → referenced by a **user task** (task form key).
- **Work Item definition** → the modeler palette for **service tasks**. See `work-definitions-wid.md`.
- **Enumeration / DSL / Test Scenario / Solver** → design-time / test / optimization assets, compiled
  or used by their respective engines; carried in the kjar.

## What each asset is, how it's used, and where to see real content
Realistic samples of all of these (same `Claim` domain) are in
`../../bpmn-sdk/examples/05-all-assets-project.mjs` (`ASSET_FILES`), exported into a single kjar.

- **Data Object (`.java`)** — a POJO fact/data type. *Used as* a process-variable `type` (its FQN,
  e.g. `com.acme.model.Claim`) and as a rule fact. Sample: `Claim` with `id/amount/status`.
- **DRL (`.drl`)** — Drools rules (`when … then …`). *Used by* a `businessRuleTask` whose
  `ruleFlowGroup` matches the rule's `ruleflow-group`. Sample fires "HIGH"/"STANDARD" on `amount`.
- **DMN (`.dmn`)** — a decision model (inputs → decisions via boxed expressions). *Used by* a
  `businessRuleTask` with the DMN implementation + namespace/model/decision. Sample: `isEligible`.
- **DSL (`.dsl`)** — maps natural-language phrases to DRL; *used by* `.rdslr` rules so business users
  write "There is a claim over 100000" instead of DRL.
- **Enumeration (`.enumeration`)** — value lists (`'Claim.status' : ['NEW', …]`); *used by* guided
  editors to show dropdowns for a fact's field.
- **Guided Rule (`.rdrl`/`.rdslr`)** — a single rule authored in BC's guided editor (XML). Same effect
  as a DRL rule; compiled to rules at build.
- **Guided Rule Template (`.template`)** — a guided rule with placeholders (`@{threshold}`) + a data
  table; generates many rules from the table rows.
- **Guided Decision Table (`.gdst`)** — rules as a table (conditions → actions per row). Guided
  Decision Table Graph links several; Guided Decision Tree (`.gdt`) is the tree form.
- **Guided Score Card (`.scgd`)** — additive scoring model (characteristics/attributes → partial
  scores) writing a numeric field (e.g. `riskScore`).
- **Score Card / Decision Table (Spreadsheet)** — the same as above but authored in Excel
  (`.xls`/`.xlsx`) — **binary**, copy the file into the project.
- **Test Scenario (`.scesim` new / `.scenario` legacy)** — given/expect tests for rules & DMN,
  run by the Test Scenario runner at build/CI.
- **Form (`.frm`/`.form`)** — the UI for a **user task** (or process start). Sample binds fields to
  the `Claim` model; referenced by the task's form key.
- **Solver configuration (`*.solver.xml`)** — an OptaPlanner solver (solution/entity classes, score
  DRL, termination) for optimization problems.
- **Work Item definition (`.wid`)** — the modeler palette entry + parameter contract for a **service
  task**. Modeled by the SDK (`descriptor.workDefinitions`) — see `work-definitions-wid.md`.
- **Global Variable(s)** — globals shared with rules; declared in `kmodule.xml`/rules, not a file.
- **Package** — a namespace grouping; set via the process `packageName`.

## SDK coverage summary
- **Authored from JSON**: Business Process (BPMN), Work Item definitions (`.wid`), and all kjar
  scaffolding (pom, kmodule, deployment descriptor, project.imports/repositories).
- **Carried verbatim (round-trip + attach-from-scratch)**: DRL, DMN, DSL, Enumeration, Guided
  Rule/Template/Decision-Table/Tree/Score-Card, Test Scenario (both), Solver config, Forms, Java.
- **Binary (attach the file yourself)**: spreadsheet decision tables & score cards (`.xls`/`.xlsx`).
