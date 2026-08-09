# Business Rule Task

**Category**: Tasks · **Ports**: 1 in, 1 out · **Palette**: Business Rule

## Purpose

Evaluates a decision — DRL rules, a DMN decision table, a guided decision tree, or a scorecard — over
the instance's variables, writing results back. Pick exactly one of the four; the handler checks them
in this priority order: `dmn` → `decisionTree` → `scorecard` → `ruleflowGroup`.

## Fields

| Field | Widget | Asset kind |
|---|---|---|
| `ruleflowGroup` | assetRef | [DRL rules](../assets/rulesets-drl.md) |
| `dmn.namespace` / `dmn.model` / `dmn.decision` | text / assetRef / text | [DMN decisions](../assets/decisions-dmn.md) |
| `decisionTree` | assetRef | [Decision trees](../assets/decision-trees.md) |
| `scorecard` | assetRef | [Scorecards](../assets/scorecards.md) |

## Behavior

- **DMN** (`dmn`) — matches `engine.decisions[]` by model name or namespace; an unnamed `decision`
  (the real jBPM/PAM convention — namespace/model are passed as literal `dataInputAssociation`
  values, with no separate "decision" input) defaults to the model's first decision. Only
  `decisionTable`-driven decisions evaluate — see
  [Importing real jBPM](../11-importing-and-exporting-jbpm.md) for what isn't recoverable.
- **DRL** (`ruleflowGroup`) — evaluates every rule in every ruleset with that `group`, highest
  `priority` first. See the [DRL rules asset doc](../assets/rulesets-drl.md) for the rule shape
  (`when`/`then`, blank `fact`/`set` meaning "the whole variable map").
- **Decision tree** (`decisionTree`) — walks the tree from its root, following each node's branch
  logic against the named fact (or the whole variable map if no `fact` is set), landing on a leaf's
  output values.
- **Scorecard** (`scorecard`) — starts at `baseline`, adds/subtracts each matching characteristic's
  weight, writes the total into the `target` variable.

## Example — DRL

```json
{ "id": "classify", "type": "rule", "ruleflowGroup": "risk-classification" }
```

## Example — DMN

```json
{
  "id": "eligibility", "type": "rule",
  "dmn": { "namespace": "https://acme/dmn", "model": "Eligibility", "decision": "" }
}
```

## Gotchas

- Failure (missing model/group/tree/scorecard, or a rule throwing) raises `RULE_ERROR` — catchable.
- Full FEEL (`literalExpression`, Business Knowledge Models) is **not** evaluated — only
  `decisionTable`-driven DMN decisions run. If you imported a real DMN file that uses those, the
  import report will show it under `skipped`.
