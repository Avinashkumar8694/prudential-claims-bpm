# Transaction Sub-Process — usage guide

## 1. Details
`<bpmn2:transaction>` — an embedded sub-process with transactional semantics (commit / cancel /
compensate). A cancel end/boundary event rolls it back.

## 2. Usage
Group steps that must succeed together; on cancel, compensation handlers undo completed work.

## 3. How / when to use
- Use when a set of steps needs all-or-nothing semantics with compensation.
- jBPM support is limited — verify behaviour on import.
- SDK type `subProcess`, `subtype:"transaction"`, with nested `nodes[]`/`flows[]`.
