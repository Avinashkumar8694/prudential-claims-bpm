# Business Rule Task — usage guide

## 1. Details
BPMN element: `<bpmn2:businessRuleTask>`. Delegates a decision to a rule engine. In jBPM it fires a
DRL ruleflow-group (`drools:ruleFlowGroup`) or a DMN model (`implementation`).

## 2. Usage
Evaluates rules against process variables (globals/facts) and updates them. Rules must be in the
same kjar.

## 3. How / when to use
- Use to externalize complex/volatile decision logic into rules instead of scripts/gateways.
- Set `ruleFlowGroup` (DRL) or `implementation` (`##unspecified`, or a DMN URL) + DMN refs.
- SDK type `businessRuleTask` with `ruleFlowGroup`, `implementation`, optional `dataInputs/Outputs`.
