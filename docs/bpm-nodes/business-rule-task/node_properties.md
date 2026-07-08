# Business Rule Task — properties

| Property | XML | Notes |
|----------|-----|-------|
| id / name | attrs | |
| ruleFlowGroup | `drools:ruleFlowGroup` | DRL group to activate |
| implementation | `@implementation` | `##unspecified` (DRL) or DMN URL |
| ioSpecification | dataInput/Output | optional facts in/out |

## Input / output mapping
Optional `dataInputs`/`dataOutputs` (mapped from/to process variables) — same as `call-activity`.

## SDK
`{ "type":"businessRuleTask", "ruleFlowGroup":"grp", "implementation":"##unspecified" }`
