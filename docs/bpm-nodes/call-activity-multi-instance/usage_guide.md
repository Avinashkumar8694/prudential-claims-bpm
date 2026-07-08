# Call Activity (Multi-Instance) — usage guide

## 1. Details
A `<bpmn2:callActivity>` with a `<bpmn2:multiInstanceLoopCharacteristics>` child. Iterates a
**collection** process variable and invokes the called process **once per element**, optionally
collecting one output per element into a result collection.

## 2. Usage
`pru-system-claim-process` -> "Run Per Claim Evaluation (loop)" iterates `applicablePolicies`,
calling `pru-process-single-claim` per policy (passing `currentPolicy` + constant `caseId`,
`claimId`), collecting each child's `claimResult` into `claimResults`.

## 3. How / when to use
- Use to process a variable-length list where each item runs the same sub-flow.
- Sequential vs parallel is controlled by `isSequential`:
  - omitted / `false` = **parallel** (all instances created together) — current setting.
  - `true` = **sequential** (one completes before the next starts).
- With `waitForCompletion="true"` the parent proceeds only after **all** iterations finish,
  so the result collection is fully populated for the next node.
