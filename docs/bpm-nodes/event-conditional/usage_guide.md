# Conditional Event — usage guide

## 1. Details
`<bpmn2:conditionalEventDefinition><condition>…</condition></…>`. Fires when a boolean condition
over process data becomes true.

## 2. Usage
- Conditional **start**: start when a condition holds.
- Conditional **catch** (intermediate/boundary): wait until the condition becomes true.

## 3. How / when to use
- Use for data-driven waiting/triggering instead of an explicit signal/message.
- SDK: event node with `eventType:"conditional"` + `conditionExpr` (+ `conditionExprLanguage`).
