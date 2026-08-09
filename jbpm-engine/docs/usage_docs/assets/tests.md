# Test Scenarios

**Key**: `tests` · **Name field**: `name` · **Exports as**: `.scesim` (Business Central "Test
Scenario" format)

## Purpose

Given/expect test cases against a decision or process — authored alongside the [DRL](rulesets-drl.md)/
[DMN](decisions-dmn.md)/[decision tree](decision-trees.md)/[scorecard](scorecards.md) or process it
targets, exported in a format Business Central's own test-scenario tooling understands.

## Shape

```json
{ "name": "EligibilityTests", "target": "", "cases": [] }
```

| Property | Notes |
|---|---|
| `target` | The name of the decision/process this scenario tests |
| `cases` | `{ given: {...}, expect: {...} }` entries — input variables in, expected output variables out |

## Example

```json
{
  "name": "EligibilityTests", "target": "Eligibility",
  "cases": [
    { "given": { "amount": 5000 }, "expect": { "approved": true } },
    { "given": { "amount": 100 }, "expect": { "approved": false } }
  ]
}
```

## Gotchas

- This asset is a durable, exportable record of expected behavior — it is **not** wired into this
  engine's own automated test suite (`server/test/*.test.ts`) or run automatically on publish. Use it
  for documenting/communicating expected behavior and for downstream Business Central tooling; verify
  real behavior changes with an actual run (or the server's own test suite) before trusting a process.
