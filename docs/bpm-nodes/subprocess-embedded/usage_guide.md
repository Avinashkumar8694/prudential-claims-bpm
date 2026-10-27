# Embedded Sub-Process — usage guide

## 1. Details
`<bpmn2:subProcess>` (no `triggeredByEvent`) containing its own start event, flow nodes, and
sequence flows. Shares the parent's process variables. Groups a reusable-in-place chunk of flow.

## 2. Usage
Encapsulate a set of steps under one node; can carry boundary events (timer/error) on the whole
block.

## 3. How / when to use
- Use to scope boundary events over several steps, or to visually group a phase.
- SDK type `subProcess`, `subtype:"embedded"`, with nested `nodes[]` and `flows[]` (recursive).
