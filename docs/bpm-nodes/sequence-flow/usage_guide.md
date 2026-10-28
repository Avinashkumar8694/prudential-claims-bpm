# Sequence Flow — usage guide

## 1. Details
BPMN element: `<bpmn2:sequenceFlow sourceRef targetRef>`. The directed connector between two
flow nodes. May carry a `conditionExpression` (used on diverging-gateway outgoings).

## 2. Usage
Every transition. Named flows (e.g. `Death`, `Promote to Claim`, `Documents uploaded`) also carry
a `drools:metaData name="elementname"` label. Conditional flows carry a Java condition.

## 3. How / when to use
- Always set `sourceRef`/`targetRef` to existing node ids; keep node `<incoming>`/`<outgoing>`
  in sync (this is the #1 jBPM import breaker).
- Put `conditionExpression` only on flows leaving a diverging exclusive/inclusive gateway.
